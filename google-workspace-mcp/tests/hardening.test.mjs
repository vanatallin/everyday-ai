import test from 'node:test';
import assert from 'node:assert/strict';

import { redact } from '../dist/logger.js';
import { RateLimiter } from '../dist/rate-limit.js';
import { RevocationRegistry } from '../dist/revocation.js';
import { SignedTokenIssuer } from '../dist/http-auth.js';

const identity = { subject: 'user-1', email: 'u@example.com', source: 'token' };

test('redact removes credentials from log text', () => {
  assert.equal(redact('Authorization: Bearer abc.def-ghi'), 'Authorization: Bearer [redacted]');
  assert.equal(redact('{"refresh_token":"1//abc"}'), '{"refresh_token":"[redacted]"}');
  assert.equal(redact('access_token=ya29.xyz&scope=x'), 'access_token=[redacted]&scope=x');
  assert.equal(redact('token mcp1.payload.signature here'), 'token [redacted-token] here');
  assert.equal(redact('nothing secret here'), 'nothing secret here');
});

test('rate limiter allows up to the limit then blocks with Retry-After', () => {
  const limiter = new RateLimiter(2, 60_000);
  const now = 1_000_000;

  assert.deepEqual(limiter.check('a', now), { allowed: true });
  assert.deepEqual(limiter.check('a', now + 1), { allowed: true });

  const blocked = limiter.check('a', now + 2);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 60);

  // The window resets.
  assert.deepEqual(limiter.check('a', now + 60_000), { allowed: true });

  // Limits are per key.
  assert.deepEqual(limiter.check('b', now + 2), { allowed: true });
});

test('a zero limit disables rate limiting', () => {
  const limiter = new RateLimiter(0);
  for (let i = 0; i < 100; i++) {
    assert.equal(limiter.check('a').allowed, true);
  }
});

test('rate limiter prunes expired windows', () => {
  const limiter = new RateLimiter(5, 1_000);
  limiter.check('a', 1_000);
  limiter.check('b', 1_500);

  limiter.prune(2_001);
  assert.equal(limiter.size, 1);
  limiter.prune(2_600);
  assert.equal(limiter.size, 0);
});

test('revocation invalidates tokens issued before the cutoff only', async () => {
  const revocations = new RevocationRegistry();
  const issuer = new SignedTokenIssuer('secret', 3600, revocations);
  const identityA = { ...identity, subject: 'a' };
  const identityB = { ...identity, subject: 'b' };

  const before = issuer.issue(identityA).token;
  const other = issuer.issue(identityB).token;

  assert.ok(await issuer.verify(before));

  revocations.revoke('a');

  assert.equal(await issuer.verify(before), null);
  // Other subjects are unaffected.
  assert.ok(await issuer.verify(other));

  // A token issued after the revocation is valid again.
  const after = issuer.issue(identityA).token;
  assert.ok(await issuer.verify(after));

  revocations.clear('a');
  assert.ok(await issuer.verify(before));
});
