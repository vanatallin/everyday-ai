import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { TokenFile } from '../dist/token-file.js';
import {
  FileKeyBackend,
  deriveKeyMaterial,
  defaultKeyPath,
  resolveSecret,
} from '../dist/secret-store.js';

const token = {
  type: 'authorized_user',
  client_id: 'client-id',
  client_secret: 'client-secret',
  refresh_token: 'refresh-token',
};

async function tempTokenPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-file-'));
  return path.join(dir, 'token.json');
}

test('writes tokens encrypted and round-trips them', async () => {
  const file = await tempTokenPath();
  const store = new TokenFile(file, { secret: 'test-secret' });

  store.write(token);

  const raw = await fs.readFile(file, 'utf8');
  assert.ok(!raw.includes('refresh-token'));
  assert.ok(!raw.includes('client-secret'));
  assert.equal(JSON.parse(raw).v, 1);

  assert.deepEqual(new TokenFile(file, { secret: 'test-secret' }).read(), token);
});

test('token file is written with owner-only permissions', async () => {
  const file = await tempTokenPath();
  new TokenFile(file, { secret: 'k' }).write(token);

  const stat = await fs.stat(file);
  assert.equal(stat.mode & 0o777, 0o600);
});

test('migrates a legacy plaintext token in place', async () => {
  const file = await tempTokenPath();
  await fs.writeFile(file, JSON.stringify(token));

  const store = new TokenFile(file, { secret: 'migration-key' });
  assert.deepEqual(store.read(), token);

  const raw = await fs.readFile(file, 'utf8');
  assert.equal(JSON.parse(raw).v, 1);
  assert.ok(!raw.includes('refresh-token'));
});

test('a different key cannot read the token', async () => {
  const file = await tempTokenPath();
  new TokenFile(file, { secret: 'key-one' }).write(token);

  assert.equal(new TokenFile(file, { secret: 'key-two' }).read(), null);
});

test('a tampered token is rejected', async () => {
  const file = await tempTokenPath();
  new TokenFile(file, { secret: 'k' }).write(token);

  const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
  envelope.data = Buffer.from('{"refresh_token":"stolen"}').toString('base64');
  await fs.writeFile(file, JSON.stringify(envelope));

  assert.equal(new TokenFile(file, { secret: 'k' }).read(), null);
});

test('returns null when no token exists', async () => {
  const file = await tempTokenPath();
  assert.equal(new TokenFile(file, { secret: 'k' }).read(), null);
});

test('defaultKeyPath sits next to the token', () => {
  assert.equal(defaultKeyPath('/tmp/token.json'), '/tmp/token.json.key');
});

test('resolveSecret prefers the environment key', () => {
  const called = [];
  const backend = {
    name: 'fake',
    get() {
      called.push('get');
      return 'from-keychain';
    },
    set() {
      called.push('set');
    },
  };

  assert.equal(
    resolveSecret({ envKey: 'from-env', keyPath: '/tmp/k', backends: [backend] }),
    'from-env'
  );
  assert.deepEqual(called, []);
});

test('resolveSecret uses an existing backend secret', () => {
  const backend = {
    name: 'fake',
    get: () => 'existing',
    set() {
      throw new Error('should not write');
    },
  };

  assert.equal(resolveSecret({ envKey: '', keyPath: '/tmp/k', backends: [backend] }), 'existing');
});

test('resolveSecret generates and stores a key when the backend is empty', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secret-'));
  const keyPath = path.join(dir, 'k');
  let stored = null;
  const backend = {
    name: 'fake',
    get: () => stored,
    set(value) {
      stored = value;
    },
  };

  const secret = resolveSecret({ envKey: '', keyPath, backends: [backend] });
  assert.ok(secret);
  assert.equal(stored, secret);
  // A second resolution returns the stored key.
  assert.equal(resolveSecret({ envKey: '', keyPath, backends: [backend] }), secret);
});

test('resolveSecret falls back to a 0600 key file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secret-'));
  const keyPath = path.join(dir, 'token.json.key');

  const secret = resolveSecret({
    envKey: '',
    keyPath,
    backends: [
      {
        name: 'broken',
        get: () => null,
        set() {
          throw new Error('unavailable');
        },
      },
    ],
  });

  assert.ok(secret);
  const stat = await fs.stat(keyPath);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(new FileKeyBackend(keyPath).get(), secret);
});

test('resolveSecret returns null when every backend fails and files are disallowed', () => {
  const secret = resolveSecret({
    envKey: '',
    keyPath: '/tmp/unused',
    backends: [
      {
        name: 'broken',
        get: () => null,
        set() {
          throw new Error('unavailable');
        },
      },
    ],
    allowFileBackend: false,
  });

  assert.equal(secret, null);
});

test('derived key material is a stable 32-byte value', () => {
  assert.equal(deriveKeyMaterial('abc').length, 32);
  assert.deepEqual(deriveKeyMaterial('abc'), deriveKeyMaterial('abc'));
  assert.notDeepEqual(deriveKeyMaterial('abc'), deriveKeyMaterial('abd'));
});
