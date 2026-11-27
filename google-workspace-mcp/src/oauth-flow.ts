/**
 * Per-user Google OAuth flow for the HTTP transport.
 *
 * The client is redirected to Google, and the callback stores that user's
 * refresh token under their Google `sub`. The server then issues its own
 * short-lived bearer token so MCP clients never see Google credentials.
 *
 * Pending authorizations are held in memory with a short TTL; this assumes a
 * single server instance (fine until a shared session store is needed).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";

import { google } from "googleapis";
import { CodeChallengeMethod, type OAuth2Client } from "google-auth-library";

import { logger } from "./logger.js";
import { type TokenStore, getTokenStore } from "./token-store.js";
import { type SignedTokenIssuer } from "./http-auth.js";
import type { UserIdentity } from "./identity.js";
import type { OAuthCredentials, SavedToken } from "./types.js";

const PENDING_TTL_MS = 10 * 60 * 1000;
const STATE_BYTES = 32;

interface PendingAuthorization {
  codeVerifier: string;
  redirectUri?: string;
  createdAt: number;
}

interface OAuthClientKey {
  client_id: string;
  client_secret: string;
}

export type { OAuthClientKey };

export interface OAuthFlowOptions {
  credentialsPath: string;
  callbackUrl: string;
  scopes: string[];
  allowedRedirects: string[];
  tokenStore?: TokenStore;
  issuer: SignedTokenIssuer;
  /** Test seam: build the OAuth client for a credential key. */
  oauthClientFactory?: (key: OAuthClientKey) => OAuth2Client;
}

export interface StartResult {
  url: string;
  state: string;
}

export interface CompletionResult {
  identity: UserIdentity;
  token: string;
  expiresIn: number;
  redirectUri?: string;
}

export class GoogleOAuthFlow {
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly tokenStore: TokenStore;

  constructor(private readonly options: OAuthFlowOptions) {
    this.tokenStore = options.tokenStore ?? getTokenStore();
  }

  /** Build a Google consent URL. `redirectUri` is where we send the server token back. */
  start(redirectUri?: string): StartResult {
    if (redirectUri && !this.isAllowedRedirect(redirectUri)) {
      throw new Error("Redirect URI is not allowed");
    }

    const key = this.loadClientKey();
    const client = this.createClient(key);

    const state = crypto.randomBytes(STATE_BYTES).toString("hex");
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    this.prunePending();
    this.pending.set(state, {
      codeVerifier,
      redirectUri,
      createdAt: Date.now(),
    });

    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: this.options.scopes,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });

    return { url, state };
  }

  /** Exchange the Google code, persist the refresh token, and issue a server token. */
  async complete(state: string, code: string): Promise<CompletionResult> {
    const pending = this.pending.get(state);
    this.pending.delete(state);

    if (!pending) {
      throw new Error("Unknown or already-used OAuth state");
    }
    if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new Error("OAuth state expired; start the sign-in again");
    }

    const key = this.loadClientKey();
    const client = this.createClient(key);

    const { tokens } = await client.getToken({
      code,
      codeVerifier: pending.codeVerifier,
    });
    client.setCredentials(tokens);

    if (!tokens.access_token) {
      throw new Error("Google did not return an access token");
    }
    if (!tokens.refresh_token) {
      throw new Error(
        "Google did not return a refresh token. Remove the app's access at https://myaccount.google.com/permissions and try again."
      );
    }

    const tokenInfo = await client.getTokenInfo(tokens.access_token);
    const subject = tokenInfo.sub || tokenInfo.user_id;
    if (!subject) {
      throw new Error("Google did not return a user identifier");
    }

    const identity: UserIdentity = {
      subject,
      email: tokenInfo.email ?? undefined,
      source: "token",
    };

    const saved: SavedToken = {
      type: "authorized_user",
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: tokens.refresh_token,
    };
    await this.tokenStore.set(subject, saved);

    const issued = this.options.issuer.issue(identity);
    logger.info(`Google OAuth completed for subject "${subject}"`);

    return {
      identity,
      token: issued.token,
      expiresIn: issued.expiresIn,
      redirectUri: pending.redirectUri,
    };
  }

  /** Revoke the Google grant (best effort) and delete the stored token. */
  async signOut(subject: string): Promise<void> {
    const token = await this.tokenStore.get(subject);

    if (token?.refresh_token) {
      try {
        const response = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: token.refresh_token }).toString(),
        });
        if (!response.ok) {
          logger.warn(`Google token revocation returned ${response.status}`);
        }
      } catch (error) {
        // The stored token is deleted regardless; Google may already have
        // revoked it or the network may be unavailable.
        logger.warn("Google token revocation failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.tokenStore.delete(subject);
  }

  private isAllowedRedirect(redirectUri: string): boolean {
    // Relative paths are same-origin and therefore safe.
    if (redirectUri.startsWith("/") && !redirectUri.startsWith("//")) {
      return true;
    }
    return this.options.allowedRedirects.some((prefix) => redirectUri.startsWith(prefix));
  }

  private prunePending(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [state, pending] of this.pending) {
      if (pending.createdAt < cutoff) {
        this.pending.delete(state);
      }
    }
  }

  private loadClientKey(): OAuthClientKey {
    if (!fs.existsSync(this.options.credentialsPath)) {
      throw new Error(
        `Google OAuth credentials not found at ${this.options.credentialsPath}`
      );
    }

    const credentials = JSON.parse(
      fs.readFileSync(this.options.credentialsPath, "utf-8")
    ) as OAuthCredentials;

    const key = "installed" in credentials ? credentials.installed : credentials.web;
    if (!key?.client_id || !key?.client_secret) {
      throw new Error("Credentials file is not an OAuth client (installed or web)");
    }
    return { client_id: key.client_id, client_secret: key.client_secret };
  }

  private createClient(key: OAuthClientKey): OAuth2Client {
    if (this.options.oauthClientFactory) {
      return this.options.oauthClientFactory(key);
    }
    return new google.auth.OAuth2(key.client_id, key.client_secret, this.options.callbackUrl);
  }
}
