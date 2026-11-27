import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  SignedTokenIssuer,
  StaticTokenVerifier,
  CompositeVerifier,
  createVerifier,
} from '../dist/http-auth.js';
import { GoogleOAuthFlow } from '../dist/oauth-flow.js';

const identity = { subject: 'user-1', email: 'u@example.com', source: 'token' };

function memoryStore() {
  const data = new Map();
  return {
    data,
    async get(subject) {
      return data.get(subject) ?? null;
    },
    async set(subject, value) {
      data.set(subject, value);
    },
    async delete(subject) {
      data.delete(subject);
    },
  };
}

test('signed tokens round-trip and verify', async () => {
  const issuer = new SignedTokenIssuer('secret', 3600);

  const { token, expiresIn } = issuer.issue(identity);
  assert.equal(expiresIn, 3600);
  assert.match(token, /^mcp1\./);

  assert.deepEqual(await issuer.verify(token), identity);
});

test('signed tokens reject tampering, wrong keys and expiry', async () => {
  const issuer = new SignedTokenIssuer('secret', 3600);
  const { token } = issuer.issue(identity);

  const [prefix, payload, signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  decoded.sub = 'attacker';
  const forged = `${prefix}.${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;

  assert.equal(await issuer.verify(forged), null);
  assert.equal(await issuer.verify(`${prefix}.${payload}.deadbeef`), null);
  assert.equal(await new SignedTokenIssuer('other', 3600).verify(token), null);
  const expired = new SignedTokenIssuer('secret', 0).issue(identity).token;
  assert.equal(await issuer.verify(expired), null);
  assert.equal(await issuer.verify('not-a-token'), null);
});

test('composite verifier accepts either token source', async () => {
  const issuer = new SignedTokenIssuer('secret', 3600);
  const composite = new CompositeVerifier([
    new StaticTokenVerifier([{ token: 'static-token', subject: 'static-user' }]),
    issuer,
  ]);

  assert.equal((await composite.verify('static-token')).subject, 'static-user');
  assert.equal((await composite.verify(issuer.issue(identity).token)).subject, 'user-1');
  assert.equal(await composite.verify('nope'), null);
});

test('createVerifier reports an issuer only when a signing key exists', () => {
  const withoutKey = createVerifier({ ttlSeconds: 60 });
  assert.equal(withoutKey.verifier, null);
  assert.equal(withoutKey.issuer, null);

  const withKey = createVerifier({ signingKey: 'k', ttlSeconds: 60 });
  assert.ok(withKey.verifier);
  assert.ok(withKey.issuer);
});

async function credentialsFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oauth-'));
  const file = path.join(dir, 'credentials.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      installed: { client_id: 'client-id', client_secret: 'client-secret' },
    })
  );
  return file;
}

function fakeClient(overrides = {}) {
  return {
    generateAuthUrl(options) {
      this.lastAuthUrl = options;
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${options.state}`;
    },
    async getToken() {
      return { tokens: { access_token: 'access', refresh_token: 'refresh' } };
    },
    setCredentials() {},
    async getTokenInfo() {
      return { sub: 'google-sub', email: 'user@example.com' };
    },
    ...overrides,
  };
}

async function flowWith(client) {
  const store = memoryStore();
  const issuer = new SignedTokenIssuer('secret', 3600);
  const flow = new GoogleOAuthFlow({
    credentialsPath: await credentialsFile(),
    callbackUrl: 'https://mcp.example.com/oauth/google/callback',
    scopes: ['openid'],
    allowedRedirects: ['https://app.example.com/callback'],
    tokenStore: store,
    issuer,
    oauthClientFactory: () => client,
  });
  return { flow, store, issuer };
}

test('start builds a consent URL with state and PKCE', async () => {
  const client = fakeClient();
  const { flow } = await flowWith(client);

  const { url, state } = flow.start();

  assert.match(url, /accounts\.google\.com/);
  assert.equal(client.lastAuthUrl.state, state);
  assert.equal(client.lastAuthUrl.access_type, 'offline');
  assert.equal(client.lastAuthUrl.prompt, 'consent');
  assert.ok(client.lastAuthUrl.code_challenge);
  assert.equal(client.lastAuthUrl.code_challenge_method, 'S256');
});

test('start rejects redirect URIs that are not allowed', async () => {
  const { flow } = await flowWith(fakeClient());

  assert.throws(() => flow.start('https://evil.example.com/steal'), /not allowed/);
  assert.throws(() => flow.start('//evil.example.com'), /not allowed/);

  // Relative and allowlisted redirects are fine.
  assert.ok(flow.start('/done').state);
  assert.ok(flow.start('https://app.example.com/callback').state);
});

test('complete stores the refresh token and issues a server token', async () => {
  const { flow, store, issuer } = await flowWith(fakeClient());
  const { state } = flow.start('https://app.example.com/callback');

  const result = await flow.complete(state, 'auth-code');

  assert.equal(result.identity.subject, 'google-sub');
  assert.equal(result.identity.email, 'user@example.com');
  assert.equal(result.redirectUri, 'https://app.example.com/callback');

  const saved = await store.get('google-sub');
  assert.equal(saved.refresh_token, 'refresh');
  assert.equal(saved.client_id, 'client-id');

  assert.equal((await issuer.verify(result.token)).subject, 'google-sub');
});

test('complete rejects unknown, reused and expired state', async () => {
  const { flow } = await flowWith(fakeClient());

  await assert.rejects(flow.complete('unknown', 'code'), /Unknown or already-used/);

  const { state } = flow.start();
  await flow.complete(state, 'code');
  await assert.rejects(flow.complete(state, 'code'), /Unknown or already-used/);
});

test('complete fails clearly when Google omits a refresh token', async () => {
  const client = fakeClient({
    async getToken() {
      return { tokens: { access_token: 'access' } };
    },
  });
  const { flow } = await flowWith(client);

  const { state } = flow.start();
  await assert.rejects(flow.complete(state, 'code'), /refresh token/);
});
