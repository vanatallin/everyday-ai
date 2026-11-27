/**
 * HTTP transport for remote / multi-user deployments.
 *
 * Each MCP client session is bound to one `UserIdentity`. Bearer tokens are
 * verified on every request; a session can only be used by the identity that
 * created it.
 */

import * as http from "node:http";
import { randomUUID } from "node:crypto";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { config } from "./config.js";
import { logger } from "./logger.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./mcp-server.js";
import { type SessionStore } from "./session.js";
import {
  type IdentityVerifier,
  createVerifier,
  parseBearer,
} from "./http-auth.js";
import { GoogleOAuthFlow } from "./oauth-flow.js";
import { LOCAL_IDENTITY, type UserIdentity } from "./identity.js";
import { RateLimiter } from "./rate-limit.js";
import { RevocationRegistry } from "./revocation.js";
import { getTokenStore } from "./token-store.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

interface HttpSession {
  transport: StreamableHTTPServerTransport;
  identity: UserIdentity;
}

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function unauthorized(res: http.ServerResponse): void {
  sendJson(
    res,
    401,
    { error: "unauthorized", message: "A valid bearer token is required" },
    { "WWW-Authenticate": `Bearer realm="${SERVER_NAME}"` }
  );
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    return undefined;
  }
  return JSON.parse(text);
}

function toAuthInfo(token: string, identity: UserIdentity): AuthInfo {
  return {
    token,
    clientId: identity.subject,
    scopes: [],
    extra: { subject: identity.subject, email: identity.email },
  };
}

export interface HttpServerOptions {
  verifier?: IdentityVerifier | null;
  allowAnonymous?: boolean;
  oauthFlow?: GoogleOAuthFlow | null;
  rateLimitPerMinute?: number;
  maxSessionsPerUser?: number;
  revocations?: RevocationRegistry;
}

/**
 * Create the HTTP server. Exported so tests can start it on an ephemeral port.
 */
export function createHttpServer(
  sessions: SessionStore,
  options: HttpServerOptions = {}
): http.Server {
  const revocations = options.revocations ?? new RevocationRegistry();

  const built = createVerifier({
    authTokens: config.authTokens,
    signingKey: config.tokenSigningKey,
    ttlSeconds: config.authTokenTtlSeconds,
    revocations,
  });

  const verifier =
    options.verifier !== undefined ? options.verifier : built.verifier;
  const allowAnonymous = options.allowAnonymous ?? config.allowAnonymous;
  const rateLimiter = new RateLimiter(
    options.rateLimitPerMinute ?? config.rateLimitPerMinute
  );
  const maxSessionsPerUser =
    options.maxSessionsPerUser ?? config.maxSessionsPerUser;

  const metrics = {
    startedAt: Date.now(),
    requests: 0,
    unauthorized: 0,
    rateLimited: 0,
    errors: 0,
    sessionsOpened: 0,
  };

  const oauthFlow =
    options.oauthFlow !== undefined
      ? options.oauthFlow
      : built.issuer
        ? new GoogleOAuthFlow({
            credentialsPath: config.credentialsPath,
            callbackUrl: `${config.publicBaseUrl}/oauth/google/callback`,
            scopes: config.scopes,
            allowedRedirects: config.allowedRedirects,
            issuer: built.issuer,
          })
        : null;

  if (!verifier && !allowAnonymous) {
    throw new Error(
      "HTTP transport requires authentication. Set MCP_AUTH_TOKENS, MCP_TOKEN_SIGNING_KEY, or MCP_ALLOW_ANONYMOUS=true."
    );
  }

  const httpSessions = new Map<string, HttpSession>();

  async function resolveRequestIdentity(
    req: http.IncomingMessage
  ): Promise<{ identity: UserIdentity; token: string } | null> {
    const token = parseBearer(req.headers.authorization);
    if (token && verifier) {
      const identity = await verifier.verify(token);
      if (identity) {
        return { identity, token };
      }
      return null;
    }
    if (allowAnonymous) {
      return { identity: LOCAL_IDENTITY, token: "" };
    }
    return null;
  }

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res);

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }

      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, {
          status: "ok",
          name: SERVER_NAME,
          version: SERVER_VERSION,
          uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
          sessions: httpSessions.size,
          requests: metrics.requests,
          unauthorized: metrics.unauthorized,
          rateLimited: metrics.rateLimited,
          errors: metrics.errors,
        });
        return;
      }

      if (url.pathname === config.httpPath || url.pathname.startsWith("/oauth/")) {
        metrics.requests += 1;
      }

      // -- Sign out --------------------------------------------------------
      if (req.method === "POST" && url.pathname === "/oauth/logout") {
        const auth = await resolveRequestIdentity(req);
        if (!auth) {
          metrics.unauthorized += 1;
          unauthorized(res);
          return;
        }

        revocations.revoke(auth.identity.subject);

        for (const [id, entry] of httpSessions) {
          if (entry.identity.subject === auth.identity.subject) {
            httpSessions.delete(id);
            await entry.transport.close();
          }
        }

        if (oauthFlow) {
          await oauthFlow.signOut(auth.identity.subject);
        } else {
          await getTokenStore().delete(auth.identity.subject);
        }

        logger.info(`Signed out subject "${auth.identity.subject}"`);
        res.writeHead(204).end();
        return;
      }

      // -- Per-user Google OAuth -------------------------------------------
      if (req.method === "GET" && url.pathname === "/oauth/authorize") {
        if (!oauthFlow) {
          sendJson(res, 503, {
            error: "oauth_unconfigured",
            message: "Set MCP_TOKEN_SIGNING_KEY to enable per-user OAuth.",
          });
          return;
        }

        try {
          const redirectUri = url.searchParams.get("redirect_uri") ?? undefined;
          const { url: authUrl } = oauthFlow.start(redirectUri);
          res.writeHead(302, { Location: authUrl }).end();
        } catch (error) {
          sendJson(res, 400, {
            error: "oauth_start_failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/oauth/google/callback") {
        if (!oauthFlow) {
          sendJson(res, 503, { error: "oauth_unconfigured" });
          return;
        }

        const oauthError = url.searchParams.get("error");
        if (oauthError) {
          sendHtml(
            res,
            400,
            `<h1>Sign-in failed</h1><p>${escapeHtml(oauthError)}</p>`
          );
          return;
        }

        const state = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        if (!state || !code) {
          sendJson(res, 400, {
            error: "bad_request",
            message: "Missing state or code",
          });
          return;
        }

        try {
          const result = await oauthFlow.complete(state, code);

          if (result.redirectUri) {
            const target = new URL(result.redirectUri, config.publicBaseUrl);
            target.searchParams.set("token", result.token);
            target.searchParams.set("expires_in", String(result.expiresIn));
            res.writeHead(302, { Location: target.toString() }).end();
            return;
          }

          const acceptsJson = (req.headers.accept || "").includes("application/json");
          if (acceptsJson) {
            sendJson(res, 200, {
              access_token: result.token,
              token_type: "Bearer",
              expires_in: result.expiresIn,
              subject: result.identity.subject,
              email: result.identity.email,
            });
            return;
          }

          sendHtml(
            res,
            200,
            `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:640px;margin:40px auto">
<h1>✅ Signed in</h1>
<p>${escapeHtml(result.identity.email ?? result.identity.subject)}</p>
<p>Use this bearer token for the MCP endpoint. It expires in ${result.expiresIn} seconds.</p>
<pre style="white-space:pre-wrap;word-break:break-all;background:#f4f4f4;padding:12px">${escapeHtml(result.token)}</pre>
</body></html>`
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error("OAuth callback failed", error);
          sendHtml(res, 400, `<h1>Sign-in failed</h1><p>${escapeHtml(message)}</p>`);
        }
        return;
      }

      if (url.pathname !== config.httpPath) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      // Authenticate before touching session state.
      const auth = await resolveRequestIdentity(req);
      if (!auth) {
        metrics.unauthorized += 1;
        unauthorized(res);
        return;
      }

      const withinLimit = rateLimiter.check(auth.identity.subject);
      if (!withinLimit.allowed) {
        metrics.rateLimited += 1;
        sendJson(
          res,
          429,
          { error: "rate_limited", message: "Too many requests; retry later" },
          { "Retry-After": String(withinLimit.retryAfter ?? 1) }
        );
        return;
      }

      const sessionId = req.headers["mcp-session-id"];
      const existing = typeof sessionId === "string" ? httpSessions.get(sessionId) : undefined;

      if (existing) {
        // A session belongs to exactly one identity.
        if (existing.identity.subject !== auth.identity.subject) {
          sendJson(res, 403, {
            error: "forbidden",
            message: "This session belongs to a different user",
          });
          return;
        }

        (req as http.IncomingMessage & { auth?: AuthInfo }).auth = toAuthInfo(
          auth.token,
          auth.identity
        );

        if (req.method === "DELETE") {
          httpSessions.delete(sessionId as string);
          await existing.transport.close();
          res.writeHead(204).end();
          return;
        }

        const body = req.method === "POST" ? await readBody(req) : undefined;
        await existing.transport.handleRequest(req, res, body);
        return;
      }

      if (req.method !== "POST") {
        sendJson(res, 400, {
          error: "bad_request",
          message: "Missing or invalid Mcp-Session-Id header",
        });
        return;
      }

      const body = await readBody(req);
      if (!isInitializeRequest(body)) {
        sendJson(res, 400, {
          error: "bad_request",
          message: "No session found and the request is not an initialize request",
        });
        return;
      }

      // New session: one transport and one server per client session.
      if (maxSessionsPerUser > 0) {
        const active = [...httpSessions.values()].filter(
          (entry) => entry.identity.subject === auth.identity.subject
        ).length;
        if (active >= maxSessionsPerUser) {
          metrics.rateLimited += 1;
          sendJson(res, 429, {
            error: "too_many_sessions",
            message: `Maximum concurrent sessions per user is ${maxSessionsPerUser}`,
          });
          return;
        }
      }

      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id: string) => {
          httpSessions.set(id, { transport, identity: auth.identity });
          metrics.sessionsOpened += 1;
          logger.info(`HTTP session ${id} opened for subject "${auth.identity.subject}"`);
        },
      });

      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) {
          httpSessions.delete(id);
          logger.info(`HTTP session ${id} closed`);
        }
      };

      (req as http.IncomingMessage & { auth?: AuthInfo }).auth = toAuthInfo(
        auth.token,
        auth.identity
      );

      const mcpServer = createServer(sessions);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      metrics.errors += 1;
      logger.error("HTTP request failed", error);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal_error", message });
      } else {
        res.end();
      }
    }
  });

  const pruneTimer = setInterval(() => rateLimiter.prune(), 60_000);
  pruneTimer.unref();
  server.on("close", () => clearInterval(pruneTimer));

  return server;
}

/** Start the HTTP transport and block until the process exits. */
export async function startHttpServer(sessions: SessionStore): Promise<void> {
  const server = createHttpServer(sessions);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.httpPort, config.httpHost, () => resolve());
  });

  logger.info(`HTTP transport listening on http://${config.httpHost}:${config.httpPort}${config.httpPath}`);
  console.error(
    `Google Service MCP Server v${SERVER_VERSION} running on http://${config.httpHost}:${config.httpPort}${config.httpPath}`
  );
}
