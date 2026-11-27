/**
 * Per-session state.
 *
 * Everything that used to be a process-wide singleton (auth + service
 * instances) now lives on a `SessionContext`. A `SessionStore` keeps one
 * context per user, and `AsyncLocalStorage` makes the active context available
 * to tool handlers without threading it through every function signature.
 *
 * This is the isolation boundary for multi-user support: two identities must
 * never share a service instance, a token, or a cache.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { GoogleMeetService } from "./meet-api.js";
import { GmailService } from "./gmail-api.js";
import { GoogleDocsService } from "./docs-api.js";
import { GoogleSlidesService } from "./slides-api.js";
import { GoogleSheetsService } from "./sheets-api.js";
import { GoogleCommentsService } from "./comments-api.js";
import type { GoogleAuth } from "./types.js";
import { type UserIdentity, LOCAL_IDENTITY } from "./identity.js";

export type { UserIdentity } from "./identity.js";
export { LOCAL_IDENTITY } from "./identity.js";

export class SessionContext {
  private authInstance: GoogleAuth | null;

  private meet?: GoogleMeetService;
  private gmail?: GmailService;
  private docs?: GoogleDocsService;
  private slides?: GoogleSlidesService;
  private sheets?: GoogleSheetsService;
  private comments?: GoogleCommentsService;

  constructor(
    public readonly user: UserIdentity,
    auth: GoogleAuth | null = null
  ) {
    this.authInstance = auth;
  }

  /** Current auth, or null when this session has not authenticated yet. */
  peekAuth(): GoogleAuth | null {
    return this.authInstance;
  }

  /** Current auth; throws NOT_AUTHENTICATED when absent. */
  requireAuth(): GoogleAuth {
    if (!this.authInstance) {
      throw new Error("NOT_AUTHENTICATED");
    }
    return this.authInstance;
  }

  /**
   * Install (or replace) the auth for this session. Replacing auth drops every
   * cached service so nothing built with the old credentials survives.
   */
  setAuth(auth: GoogleAuth): void {
    this.authInstance = auth;
    this.disposeServices();
  }

  meetService(): GoogleMeetService {
    return (this.meet ??= new GoogleMeetService(this.requireAuth()));
  }

  gmailService(): GmailService {
    return (this.gmail ??= new GmailService(this.requireAuth()));
  }

  docsService(): GoogleDocsService {
    return (this.docs ??= new GoogleDocsService(this.requireAuth()));
  }

  slidesService(): GoogleSlidesService {
    return (this.slides ??= new GoogleSlidesService(this.requireAuth()));
  }

  sheetsService(): GoogleSheetsService {
    return (this.sheets ??= new GoogleSheetsService(this.requireAuth()));
  }

  commentsService(): GoogleCommentsService {
    return (this.comments ??= new GoogleCommentsService(this.requireAuth()));
  }

  /** Drop service instances (and therefore their caches). */
  disposeServices(): void {
    this.meet = undefined;
    this.gmail = undefined;
    this.docs = undefined;
    this.slides = undefined;
    this.sheets = undefined;
    this.comments = undefined;
  }

  /** Full teardown; the context must not be reused afterwards. */
  dispose(): void {
    this.disposeServices();
    this.authInstance = null;
  }
}

/**
 * Session contexts keyed by identity subject.
 *
 * Contexts are created lazily and synchronously (a context holds no I/O), so
 * concurrent first calls for the same subject share one instance.
 */
export class SessionStore {
  private contexts = new Map<string, SessionContext>();

  get(user: UserIdentity): SessionContext {
    const existing = this.contexts.get(user.subject);
    if (existing) {
      return existing;
    }

    const created = new SessionContext(user);
    this.contexts.set(user.subject, created);
    return created;
  }

  /** Lookup without creating. */
  peek(subject: string): SessionContext | undefined {
    return this.contexts.get(subject);
  }

  release(subject: string): void {
    const context = this.contexts.get(subject);
    if (!context) {
      return;
    }
    this.contexts.delete(subject);
    context.dispose();
  }

  clear(): void {
    for (const subject of [...this.contexts.keys()]) {
      this.release(subject);
    }
  }

  get size(): number {
    return this.contexts.size;
  }
}

/** The active session for the current async call chain. */
export const sessionStorage = new AsyncLocalStorage<SessionContext>();

export function currentSession(): SessionContext {
  const session = sessionStorage.getStore();
  if (!session) {
    throw new Error(
      "No active session. Tool calls must run inside sessionStorage.run(session, ...)."
    );
  }
  return session;
}

/**
 * Resolve an identity from MCP request metadata.
 *
 * Phase 1 only ships the stdio path, so this always returns the local
 * identity. Phase 3 will read `extra.authInfo` for HTTP bearer tokens.
 */
export function resolveIdentity(extra?: unknown): UserIdentity {
  const authInfo = (
    extra as {
      authInfo?: {
        clientId?: string;
        extra?: { subject?: string; email?: string };
      };
    }
  )?.authInfo;

  const subject = authInfo?.extra?.subject ?? authInfo?.clientId;
  if (subject) {
    return {
      subject,
      email: authInfo?.extra?.email,
      source: "token",
    };
  }
  return LOCAL_IDENTITY;
}
