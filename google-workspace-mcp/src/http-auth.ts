/**
 * Bearer-token authentication for the HTTP transport.
 *
 * Phase 3 ships a static token table (`MCP_AUTH_TOKENS`) so the remote
 * transport can be exercised before the per-user OAuth flow exists. Phase 4
 * will replace it with a verifier backed by issued tokens.
 */

import * as crypto from "node:crypto";

import type { UserIdentity } from "./identity.js";
import type { RevocationRegistry } from "./revocation.js";

export interface IdentityVerifier {
  /** Resolve a bearer token to an identity, or null when invalid. */
  verify(token: string): Promise<UserIdentity | null>;
}

interface StaticEntry {
  tokenHash: Buffer;
  identity: UserIdentity;
}

function hash(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

export class StaticTokenVerifier implements IdentityVerifier {
  private readonly entries: StaticEntry[];

  constructor(entries: Array<{ token: string; subject: string; email?: string }>) {
    this.entries = entries.map((entry) => {
      if (!entry.token || !entry.subject) {
        throw new Error("Each auth token entry requires a token and a subject");
      }
      return {
        tokenHash: hash(entry.token),
        identity: {
          subject: entry.subject,
          email: entry.email,
          source: "token",
        },
      };
    });
  }

  async verify(token: string): Promise<UserIdentity | null> {
    const candidate = hash(token);
    let match: StaticEntry | undefined;

    // Compare against every entry so timing does not reveal a prefix match.
    for (const entry of this.entries) {
      if (crypto.timingSafeEqual(candidate, entry.tokenHash)) {
        match = entry;
      }
    }

    return match?.identity ?? null;
  }
}

/** Parse `MCP_AUTH_TOKENS` — a JSON object of token -> { subject, email? }. */
export function parseAuthTokens(raw: string | undefined): StaticTokenVerifier | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("MCP_AUTH_TOKENS must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("MCP_AUTH_TOKENS must be a JSON object of token -> { subject, email? }");
  }

  const entries = Object.entries(parsed as Record<string, unknown>).map(
    ([token, value]) => {
      const identity = value as { subject?: unknown; email?: unknown };
      if (typeof identity?.subject !== "string" || !identity.subject) {
        throw new Error(`MCP_AUTH_TOKENS entry for "${token.slice(0, 4)}…" is missing a subject`);
      }
      return {
        token,
        subject: identity.subject,
        email: typeof identity.email === "string" ? identity.email : undefined,
      };
    }
  );

  return new StaticTokenVerifier(entries);
}

/** Extract a bearer token from an Authorization header. */
export function parseBearer(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Server-issued tokens (Phase 4)
//
// Stateless HMAC tokens: `mcp1.<base64url(json)>.<base64url(hmac)>`.
// The payload carries the identity and an expiry, so no token table is needed.
// ---------------------------------------------------------------------------

interface IssuedPayload {
  sub: string;
  email?: string;
  /** Issued-at, epoch milliseconds. */
  iat: number;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Revocation epoch at issue time. */
  ver: number;
}

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export class SignedTokenIssuer implements IdentityVerifier {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number = 604800,
    private readonly revocations?: RevocationRegistry
  ) {
    if (!secret) {
      throw new Error("A signing key is required to issue tokens");
    }
  }

  issue(identity: UserIdentity): { token: string; expiresIn: number } {
    const nowMs = Date.now();
    const payload: IssuedPayload = {
      sub: identity.subject,
      email: identity.email,
      iat: nowMs,
      exp: Math.floor(nowMs / 1000) + this.ttlSeconds,
      ver: this.revocations?.epoch(identity.subject) ?? 0,
    };

    const encoded = b64url(JSON.stringify(payload));
    const body = `mcp1.${encoded}`;
    return { token: `${body}.${sign(body, this.secret)}`, expiresIn: this.ttlSeconds };
  }

  async verify(token: string): Promise<UserIdentity | null> {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "mcp1") {
      return null;
    }

    const body = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(sign(body, this.secret));
    const actual = Buffer.from(parts[2]);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return null;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64url").toString("utf8")
      ) as IssuedPayload;

      if (typeof payload.sub !== "string" || !payload.sub) {
        return null;
      }
      if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
        return null;
      }
      if (this.revocations) {
        const tokenEpoch = typeof payload.ver === "number" ? payload.ver : 0;
        if (this.revocations.isRevoked(payload.sub, tokenEpoch)) {
          return null;
        }
      }
      return { subject: payload.sub, email: payload.email, source: "token" };
    } catch {
      return null;
    }
  }
}

/** Tries each verifier in order until one accepts the token. */
export class CompositeVerifier implements IdentityVerifier {
  constructor(private readonly verifiers: IdentityVerifier[]) {}

  async verify(token: string): Promise<UserIdentity | null> {
    for (const verifier of this.verifiers) {
      const identity = await verifier.verify(token);
      if (identity) {
        return identity;
      }
    }
    return null;
  }
}

/**
 * Build the verifier used by the HTTP transport: static tokens plus
 * server-issued tokens when a signing key is configured.
 */
export function createVerifier(options: {
  authTokens?: string;
  signingKey?: string;
  ttlSeconds?: number;
  revocations?: RevocationRegistry;
}): { verifier: IdentityVerifier | null; issuer: SignedTokenIssuer | null } {
  const verifiers: IdentityVerifier[] = [];

  const staticVerifier = parseAuthTokens(options.authTokens);
  if (staticVerifier) {
    verifiers.push(staticVerifier);
  }

  let issuer: SignedTokenIssuer | null = null;
  if (options.signingKey) {
    issuer = new SignedTokenIssuer(
      options.signingKey,
      options.ttlSeconds,
      options.revocations
    );
    verifiers.push(issuer);
  }

  return {
    verifier: verifiers.length > 0 ? new CompositeVerifier(verifiers) : null,
    issuer,
  };
}
