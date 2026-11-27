/**
 * Configuration Module
 * Centralizes all configuration with environment variable support
 */

import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Application configuration
 */
export const config = {
  /** Path to OAuth credentials file */
  credentialsPath: process.env.GOOGLE_CREDENTIALS_PATH || 
    path.resolve(__dirname, "..", "credentials.json"),
  
  /** Path to stored OAuth token (legacy single-user / `local` subject) */
  tokenPath: process.env.GOOGLE_TOKEN_PATH || 
    path.resolve(__dirname, "..", "token.json"),

  /** Directory holding one token file per user subject */
  tokenDir: process.env.GOOGLE_TOKEN_DIR ||
    path.resolve(__dirname, "..", "tokens"),

  /** Optional AES-256-GCM key; when set, per-user tokens are encrypted at rest */
  tokenEncryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,

  /** Transport: stdio (default) or HTTP for remote/multi-user deployments */
  transport: (process.env.MCP_TRANSPORT === "http" ? "http" : "stdio") as "stdio" | "http",

  /** HTTP bind address (default: loopback only) */
  httpHost: process.env.MCP_HOST || "127.0.0.1",

  /** HTTP listen port */
  httpPort: parseInt(process.env.PORT || process.env.MCP_PORT || "8080", 10),

  /** Path serving the MCP endpoint */
  httpPath: process.env.MCP_PATH || "/mcp",

  /**
   * Static bearer tokens: JSON object mapping token -> { subject, email? }.
   * Used until the per-user OAuth flow issues dynamic tokens.
   */
  authTokens: process.env.MCP_AUTH_TOKENS,

  /** Allow unauthenticated HTTP requests as the local identity (dev only). */
  allowAnonymous: process.env.MCP_ALLOW_ANONYMOUS === "true",

  /** Public base URL used to build the Google OAuth callback (e.g. https://mcp.example.com) */
  get publicBaseUrl(): string {
    return (
      process.env.MCP_PUBLIC_BASE_URL ||
      `http://${this.httpHost === "0.0.0.0" ? "localhost" : this.httpHost}:${this.httpPort}`
    ).replace(/\/$/, "");
  },

  /** HMAC key for server-issued bearer tokens. Falls back to the token encryption key. */
  tokenSigningKey:
    process.env.MCP_TOKEN_SIGNING_KEY || process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,

  /** Lifetime of an issued bearer token, in seconds (default: 7 days). */
  authTokenTtlSeconds: parseInt(process.env.MCP_TOKEN_TTL_SECONDS || "604800", 10),

  /** Comma-separated redirect URI prefixes allowed after OAuth (open-redirect guard). */
  allowedRedirects: (process.env.MCP_ALLOWED_REDIRECTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),

  /** Requests per minute per user (0 disables). */
  rateLimitPerMinute: parseInt(process.env.MCP_RATE_LIMIT_PER_MINUTE || "120", 10),

  /** Maximum concurrent MCP sessions per user (0 disables). */
  maxSessionsPerUser: parseInt(process.env.MCP_MAX_SESSIONS_PER_USER || "10", 10),
  
  /** OAuth callback port */
  oauthPort: parseInt(process.env.OAUTH_PORT || "3000", 10),
  
  /** OAuth callback URL */
  get oauthRedirectUri(): string {
    return `http://localhost:${this.oauthPort}`;
  },
  
  /** Google Meet API base URL */
  meetApiBase: "https://meet.googleapis.com/v2",
  
  /** Default page sizes */
  defaults: {
    conferencePageSize: 10,
    participantPageSize: 50,
    transcriptPageSize: 100,
    calendarMaxResults: 10,
    pastMeetingsDays: 30,
  },
  
  /** OAuth2 scopes */
  scopes: [
    // Identity (subject + email for per-user sessions)
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    // Google Meet
    "https://www.googleapis.com/auth/meetings.space.readonly",
    "https://www.googleapis.com/auth/meetings.space.created",
    // Google Calendar
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    // Google Drive — full scope is required to create, reply to, resolve and
    // delete comments on existing files. It supersedes drive.readonly and
    // drive.file (uploads and comment reads are included).
    "https://www.googleapis.com/auth/drive",
    // Gmail
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
    // Google Docs
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/documents.readonly",
    // Google Slides
    "https://www.googleapis.com/auth/presentations",
    // Google Sheets
    "https://www.googleapis.com/auth/spreadsheets",
  ] as string[],
  
  /** Gmail defaults */
  gmail: {
    maxResults: 10,
    defaultLabels: ["INBOX"],
  },
};

export type Config = typeof config;
