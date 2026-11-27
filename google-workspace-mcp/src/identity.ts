/**
 * User identity primitives.
 *
 * Kept in its own module so auth and token storage can depend on identities
 * without importing the whole service graph.
 */

export interface UserIdentity {
  /** Stable, opaque identifier for the user. */
  subject: string;
  /** Display-only; never used for authorization. */
  email?: string;
  /** Where the identity came from. `local` is the stdio single-user mode. */
  source: "local" | "token";
}

export const LOCAL_IDENTITY: UserIdentity = { subject: "local", source: "local" };
