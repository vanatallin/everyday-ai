import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { FileTokenStore, getTokenStore, setTokenStore } from '../dist/token-store.js';
import { authenticate, isAuthenticated, getAuthStatus } from '../dist/auth.js';

const token = {
  type: 'authorized_user',
  client_id: 'client-id',
  client_secret: 'client-secret',
  refresh_token: 'refresh-token',
};

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'token-store-'));
}

test('stores, reads and deletes tokens per subject', async () => {
  const dir = await tempDir();
  const store = new FileTokenStore({ dir });

  assert.equal(await store.get('a'), null);

  await store.set('a', token);
  await store.set('b', { ...token, refresh_token: 'other' });

  assert.deepEqual(await store.get('a'), token);
  assert.equal((await store.get('b')).refresh_token, 'other');

  await store.delete('a');
  assert.equal(await store.get('a'), null);
  // Deleting a missing entry is a no-op.
  await store.delete('a');
  assert.equal((await store.get('b')).refresh_token, 'other');
});

test('writes token files with owner-only permissions', async () => {
  const dir = await tempDir();
  const store = new FileTokenStore({ dir });
  await store.set('a', token);

  const [file] = await fs.readdir(dir);
  const stat = await fs.stat(path.join(dir, file));
  assert.equal(stat.mode & 0o777, 0o600);
});

test('encrypts tokens at rest when a key is configured', async () => {
  const dir = await tempDir();
  const store = new FileTokenStore({ dir, encryptionKey: 'test-key' });
  await store.set('a', token);

  const [file] = await fs.readdir(dir);
  const raw = await fs.readFile(path.join(dir, file), 'utf8');

  assert.ok(!raw.includes('refresh-token'));
  assert.ok(!raw.includes('client-secret'));
  assert.equal(JSON.parse(raw).v, 1);

  assert.deepEqual(await store.get('a'), token);
});

test('a different encryption key cannot read the token', async () => {
  const dir = await tempDir();
  await new FileTokenStore({ dir, encryptionKey: 'key-one' }).set('a', token);

  const wrongKey = new FileTokenStore({ dir, encryptionKey: 'key-two' });
  assert.equal(await wrongKey.get('a'), null);
});

test('corrupt entries are treated as unauthenticated', async () => {
  const dir = await tempDir();
  const store = new FileTokenStore({ dir });
  await store.set('a', token);

  const [file] = await fs.readdir(dir);
  await fs.writeFile(path.join(dir, file), 'not json');

  assert.equal(await store.get('a'), null);
});

test('the local subject uses the legacy token path', async () => {
  const dir = await tempDir();
  const legacyPath = path.join(await tempDir(), 'token.json');
  const store = new FileTokenStore({ dir, legacyPath, encryptionKey: 'k' });

  await store.set('local', token);

  assert.deepEqual(await store.get('local'), token);
  const legacyRaw = await fs.readFile(legacyPath, 'utf8');
  assert.ok(!legacyRaw.includes('refresh-token'));

  // Non-local subjects still go into the per-user directory.
  await store.set('someone', token);
  assert.equal((await fs.readdir(dir)).length, 1);
});

test('non-local authenticate reads only that subject and never the disk files', async () => {
  const previous = getTokenStore();
  const stored = new Map();

  setTokenStore({
    async get(subject) {
      return stored.get(subject) ?? null;
    },
    async set(subject, value) {
      stored.set(subject, value);
    },
    async delete(subject) {
      stored.delete(subject);
    },
  });

  try {
    const identity = { subject: 'user-1', email: 'u@example.com', source: 'token' };

    await assert.rejects(authenticate({ identity }), /NOT_AUTHENTICATED/);
    assert.equal(await isAuthenticated(identity), false);
    assert.match(await getAuthStatus(identity), /Not authenticated/);

    stored.set('user-1', token);

    assert.equal(await isAuthenticated(identity), true);
    assert.match(await getAuthStatus(identity), /u@example.com/);

    const auth = await authenticate({ identity });
    assert.ok(auth);

    // Another subject does not see this token.
    assert.equal(await isAuthenticated({ ...identity, subject: 'user-2' }), false);
  } finally {
    setTokenStore(previous);
  }
});
