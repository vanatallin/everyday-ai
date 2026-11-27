/**
 * Google Authentication Module
 * Supports both Service Account and OAuth2 authentication
 */

import { google } from "googleapis";
import { type OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import * as fs from "fs";
import * as http from "http";
import * as crypto from "crypto";
import { URL } from "url";

import { config } from "./config.js";
import { logger } from "./logger.js";
import { getTokenStore } from "./token-store.js";
import { type UserIdentity, LOCAL_IDENTITY } from "./identity.js";
import type {
  ServiceAccountCredentials,
  OAuthCredentials,
  SavedToken,
  GoogleAuth,
} from "./types.js";

/**
 * Detect credential type from file content
 */
function getCredentialType(credentials: unknown): "service_account" | "oauth" {
  if (
    typeof credentials === "object" &&
    credentials !== null &&
    "type" in credentials &&
    credentials.type === "service_account"
  ) {
    return "service_account";
  }
  return "oauth";
}

/**
 * Authenticate using Service Account
 */
async function authenticateServiceAccount(
  credentials: ServiceAccountCredentials
): Promise<GoogleAuth> {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: config.scopes,
  });

  return auth as unknown as GoogleAuth;
}

/**
 * Load a saved OAuth token for a subject from the per-user token store.
 */
async function loadSavedToken(subject: string): Promise<SavedToken | null> {
  try {
    return await getTokenStore().get(subject);
  } catch (err) {
    logger.error("Error loading saved token", err);
    return null;
  }
}

/**
 * Save OAuth credentials for a subject.
 */
async function saveCredentials(
  client: OAuth2Client,
  credentials: OAuthCredentials,
  subject: string
): Promise<void> {
  const key = "installed" in credentials ? credentials.installed : credentials.web;
  if (!key || !client.credentials.refresh_token) {
    throw new Error("Google did not return a refresh token; existing credentials were not changed. Retry OAuth consent.");
  }

  const payload: SavedToken = {
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  };
  await getTokenStore().set(subject, payload);
  logger.info(`OAuth credentials saved for subject "${subject}"`);
}

/**
 * Start local server for OAuth callback
 */
function startLocalServer(
  oauth2Client: OAuth2Client,
  credentials: OAuthCredentials,
  subject: string,
  expectedState: string,
  codeVerifier: string,
  resolve: (value: GoogleAuth) => void,
  reject: (reason?: Error) => void
): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, config.oauthRedirectUri);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");

      // Validate state to prevent CSRF attacks
      if (returnedState !== expectedState) {
        res.writeHead(403, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Authentication Failed</title></head>
            <body style="font-family: system-ui; text-align: center; padding: 50px;">
              <h1>❌ Authentication Failed</h1>
              <p>Invalid state parameter. Please try again.</p>
            </body>
          </html>
        `);
        server.close();
        reject(new Error("Invalid state parameter - possible CSRF attack"));
        return;
      }

      if (code) {
        const { tokens } = await oauth2Client.getToken({
          code: code,
          codeVerifier: codeVerifier,
        });
        oauth2Client.setCredentials(tokens);
        await saveCredentials(oauth2Client, credentials, subject);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Authentication Successful</title></head>
            <body style="font-family: system-ui; text-align: center; padding: 50px;">
              <h1>✅ Authentication Successful!</h1>
              <p>You can close this window and return to your application.</p>
            </body>
          </html>
        `);

        server.close();
        resolve(oauth2Client as GoogleAuth);
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("No authorization code received");
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Authentication failed");
      server.close();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return server;
}

/**
 * Authenticate using OAuth2
 */
async function authenticateOAuth(
  credentials: OAuthCredentials,
  identity: UserIdentity,
  force = false
): Promise<GoogleAuth> {
  const subject = identity.subject;

  // Check for existing token
  if (!force) {
    const savedToken = await loadSavedToken(subject);
    if (savedToken) {
      logger.debug(`Using saved OAuth token for subject "${subject}"`);
      const auth = google.auth.fromJSON(savedToken);
      return auth as GoogleAuth;
    }
  }

  const key = "installed" in credentials ? credentials.installed : credentials.web;
  if (!key) {
    throw new Error("Invalid OAuth credentials format");
  }

  const oauth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    config.oauthRedirectUri
  );

  // Generate cryptographically secure random state for CSRF protection
  const state = crypto.randomBytes(32).toString("hex");

  // Generate PKCE code verifier and challenge for Authorization Code Interception protection
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Generate auth URL with state parameter and PKCE
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: config.scopes,
    prompt: "consent",
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  logger.info("Authorization required - please visit the URL to authorize");
  console.error("\n🔐 Authorization required!");
  console.error("Please visit this URL to authorize:\n");
  console.error(authUrl);
  console.error("\n");

  // Start local server and wait for callback
  return new Promise((resolve, reject) => {
    const server = startLocalServer(oauth2Client, credentials, subject, state, codeVerifier, resolve, reject);
    server.listen(config.oauthPort, () => {
      logger.info(`OAuth callback server listening on port ${config.oauthPort}`);
    });
  });
}

/**
 * Main authentication function
 * Automatically detects credential type and authenticates accordingly
 */
export async function authenticate(
  options: { force?: boolean; identity?: UserIdentity } = {}
): Promise<GoogleAuth> {
  const identity = options.identity ?? LOCAL_IDENTITY;

  // Non-local identities are authenticated by the transport/OAuth flow and
  // only ever read their own token entry. They do not touch the local
  // credentials file.
  if (identity.source !== "local") {
    const savedToken = await loadSavedToken(identity.subject);
    if (!savedToken) {
      throw new Error("NOT_AUTHENTICATED");
    }
    return google.auth.fromJSON(savedToken) as GoogleAuth;
  }

  // Check for credentials file
  if (!fs.existsSync(config.credentialsPath)) {
    throw new Error(
      `credentials.json not found at ${config.credentialsPath}\n\n` +
        "To get credentials:\n" +
        "1. Go to https://console.cloud.google.com/\n" +
        "2. Create a project and enable Google Meet API\n" +
        "3. Go to APIs & Services → Credentials\n" +
        "4. Create either:\n" +
        "   - Service Account (recommended) - download JSON key\n" +
        "   - OAuth client ID (Desktop app) - download JSON\n" +
        "5. Save the file as 'credentials.json' in the project root"
    );
  }

  const credentials = JSON.parse(fs.readFileSync(config.credentialsPath, "utf-8"));
  const credType = getCredentialType(credentials);

  if (credType === "service_account") {
    logger.info("Using Service Account authentication");
    return authenticateServiceAccount(credentials as ServiceAccountCredentials);
  } else {
    logger.info("Using OAuth2 authentication");
    return authenticateOAuth(credentials as OAuthCredentials, identity, options.force);
  }
}

/**
 * Check if a subject is authenticated.
 */
export async function isAuthenticated(
  identity: UserIdentity = LOCAL_IDENTITY
): Promise<boolean> {
  if (identity.source !== "local") {
    return (await loadSavedToken(identity.subject)) !== null;
  }

  if (!fs.existsSync(config.credentialsPath)) {
    return false;
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(config.credentialsPath, "utf-8"));
    const credType = getCredentialType(credentials);

    if (credType === "service_account") {
      // Service accounts are always "authenticated" if credentials exist
      return true;
    }

    // OAuth requires a saved token
    return (await loadSavedToken(identity.subject)) !== null;
  } catch {
    return false;
  }
}

/**
 * Get auth status message for a subject.
 */
export async function getAuthStatus(
  identity: UserIdentity = LOCAL_IDENTITY
): Promise<string> {
  if (identity.source !== "local") {
    return (await isAuthenticated(identity))
      ? `✅ Authenticated as ${identity.email ?? identity.subject}`
      : "⚠️ Not authenticated. Complete the OAuth flow and retry.";
  }

  if (!fs.existsSync(config.credentialsPath)) {
    return "❌ No credentials found. Please add credentials.json to the project root.";
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(config.credentialsPath, "utf-8"));
    const credType = getCredentialType(credentials);

    if (credType === "service_account") {
      const serviceAccount = credentials as ServiceAccountCredentials;
      return `✅ Service Account configured: ${serviceAccount.client_email}`;
    } else if (await isAuthenticated(identity)) {
      return "✅ Authenticated with Google (OAuth)";
    } else {
      return "⚠️ OAuth credentials found but not authenticated. Use the 'authenticate' tool to sign in.";
    }
  } catch {
    return "❌ Error reading credentials file.";
  }
}
