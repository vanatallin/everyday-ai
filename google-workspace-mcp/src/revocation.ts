/**
 * Issued-token revocation.
 *
 * Server bearer tokens are stateless HMAC tokens, so each subject carries an
 * epoch counter. A token records the epoch it was issued under; signing out
 * increments the epoch, invalidating every previously issued token without
 * needing a per-token table.
 *
 * In-memory, like pending OAuth states; replace with shared storage when
 * running multiple instances.
 */

export class RevocationRegistry {
  private readonly epochs = new Map<string, number>();

  /** Current epoch for a subject (0 when never revoked). */
  epoch(subject: string): number {
    return this.epochs.get(subject) ?? 0;
  }

  /** Revoke every token issued for `subject` so far. */
  revoke(subject: string): void {
    this.epochs.set(subject, this.epoch(subject) + 1);
  }

  /** True when a token issued under `tokenEpoch` is no longer valid. */
  isRevoked(subject: string, tokenEpoch: number): boolean {
    return tokenEpoch !== this.epoch(subject);
  }

  /** Reset a subject to epoch 0 (admin/testing helper). */
  clear(subject: string): void {
    this.epochs.delete(subject);
  }

  get size(): number {
    return this.epochs.size;
  }
}
