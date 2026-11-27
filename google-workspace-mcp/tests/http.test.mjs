import test from 'node:test';
import assert from 'node:assert/strict';

import { StaticTokenVerifier, parseAuthTokens, parseBearer } from '../dist/http-auth.js';
import { createHttpServer } from '../dist/http.js';
import { SessionStore } from '../dist/session.js';

const initializeBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
};

function verifier() {
  return new StaticTokenVerifier([
    { token: 'token-a', subject: 'user-a', email: 'a@example.com' },
    { token: 'token-b', subject: 'user-b' },
  ]);
}

async function start(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

function request(url, { method = 'POST', body, token, sessionId } = {}) {
  const headers = {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function withServer(options, fn) {
  const server = createHttpServer(new SessionStore(), options);
  const url = await start(server);
  try {
    await fn(`${url}/mcp`, url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('parseBearer accepts only Bearer headers', () => {
  assert.equal(parseBearer('Bearer abc'), 'abc');
  assert.equal(parseBearer('bearer abc'), 'abc');
  assert.equal(parseBearer('Basic abc'), null);
  assert.equal(parseBearer(undefined), null);
});

test('parseAuthTokens validates the token table', () => {
  const parsed = parseAuthTokens(JSON.stringify({ t1: { subject: 'a', email: 'a@b.c' } }));
  assert.ok(parsed instanceof StaticTokenVerifier);

  assert.equal(parseAuthTokens(undefined), null);
  assert.throws(() => parseAuthTokens('not json'), /valid JSON/);
  assert.throws(() => parseAuthTokens('[]'), /JSON object/);
  assert.throws(() => parseAuthTokens(JSON.stringify({ t1: {} })), /missing a subject/);
});

test('StaticTokenVerifier matches tokens and returns their identity', async () => {
  const v = verifier();

  assert.deepEqual(await v.verify('token-a'), {
    subject: 'user-a',
    email: 'a@example.com',
    source: 'token',
  });
  assert.equal(await v.verify('nope'), null);
  assert.equal(await v.verify(''), null);
});

test('HTTP transport refuses to start without auth', () => {
  assert.throws(
    () => createHttpServer(new SessionStore(), { verifier: null, allowAnonymous: false }),
    /requires authentication/
  );
});

test('health endpoint does not require auth', async () => {
  await withServer({ verifier: verifier() }, async (url) => {
    const res = await fetch(url.replace('/mcp', '/healthz'));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'ok');
  });
});

test('missing or invalid bearer tokens get 401', async () => {
  await withServer({ verifier: verifier() }, async (url) => {
    const missing = await request(url, { body: initializeBody });
    assert.equal(missing.status, 401);
    assert.match(missing.headers.get('www-authenticate') ?? '', /Bearer/);

    const invalid = await request(url, { body: initializeBody, token: 'nope' });
    assert.equal(invalid.status, 401);
  });
});

test('an initialize request opens a session bound to the caller', async () => {
  await withServer({ verifier: verifier() }, async (url) => {
    const res = await request(url, { body: initializeBody, token: 'token-a' });
    assert.equal(res.status, 200);

    const sessionId = res.headers.get('mcp-session-id');
    assert.ok(sessionId);

    // The same identity can reuse the session.
    const tools = await request(url, {
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      token: 'token-a',
      sessionId,
    });
    assert.equal(tools.status, 200);

    // A different identity cannot hijack it.
    const hijack = await request(url, {
      body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      token: 'token-b',
      sessionId,
    });
    assert.equal(hijack.status, 403);
  });
});

test('two identities get separate sessions', async () => {
  await withServer({ verifier: verifier() }, async (url) => {
    const a = await request(url, { body: initializeBody, token: 'token-a' });
    const b = await request(url, { body: initializeBody, token: 'token-b' });

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.notEqual(a.headers.get('mcp-session-id'), b.headers.get('mcp-session-id'));
  });
});

test('anonymous mode maps requests to the local identity', async () => {
  await withServer({ verifier: null, allowAnonymous: true }, async (url) => {
    const res = await request(url, { body: initializeBody });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('mcp-session-id'));
  });
});

test('requests without a session and without initialize are rejected', async () => {
  await withServer({ verifier: verifier() }, async (url) => {
    const res = await request(url, {
      body: { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
      token: 'token-a',
    });
    assert.equal(res.status, 400);
  });
});

test('OAuth routes report unconfigured when there is no issuer', async () => {
  await withServer({ verifier: verifier(), oauthFlow: null }, async (_url, base) => {
    const res = await fetch(`${base}/oauth/authorize`, { redirect: 'manual' });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'oauth_unconfigured');
  });
});

test('OAuth authorize redirects and the callback returns a JSON token', async () => {
  const oauthFlow = {
    start(redirectUri) {
      assert.equal(redirectUri, 'https://app.example.com/cb');
      return { url: 'https://accounts.google.com/consent', state: 'state-1' };
    },
    async complete(state, code) {
      assert.equal(state, 'state-1');
      assert.equal(code, 'auth-code');
      return {
        identity: { subject: 'google-sub', email: 'u@example.com', source: 'token' },
        token: 'issued-token',
        expiresIn: 60,
      };
    },
  };

  await withServer({ verifier: verifier(), oauthFlow }, async (_url, base) => {
    const authorize = await fetch(
      `${base}/oauth/authorize?redirect_uri=${encodeURIComponent('https://app.example.com/cb')}`,
      { redirect: 'manual' }
    );
    assert.equal(authorize.status, 302);
    assert.equal(authorize.headers.get('location'), 'https://accounts.google.com/consent');

    const callback = await fetch(
      `${base}/oauth/google/callback?state=state-1&code=auth-code`,
      { headers: { Accept: 'application/json' } }
    );
    assert.equal(callback.status, 200);
    const body = await callback.json();
    assert.equal(body.access_token, 'issued-token');
    assert.equal(body.email, 'u@example.com');
    assert.equal(body.expires_in, 60);
  });
});

test('OAuth callback redirects to an allowlisted client URI with the token', async () => {
  const oauthFlow = {
    start() {
      return { url: 'https://accounts.google.com/consent', state: 's' };
    },
    async complete() {
      return {
        identity: { subject: 'google-sub', source: 'token' },
        token: 'issued-token',
        expiresIn: 60,
        redirectUri: '/done',
      };
    },
  };

  await withServer({ verifier: verifier(), oauthFlow }, async (_url, base) => {
    const res = await fetch(`${base}/oauth/google/callback?state=s&code=c`, {
      redirect: 'manual',
    });
    assert.equal(res.status, 302);
    const location = new URL(res.headers.get('location'), base);
    assert.equal(location.pathname, '/done');
    assert.equal(location.searchParams.get('token'), 'issued-token');
  });
});

test('rate limiting is applied per identity', async () => {
  await withServer(
    { verifier: verifier(), rateLimitPerMinute: 1, maxSessionsPerUser: 5 },
    async (url) => {
      const first = await request(url, { body: initializeBody, token: 'token-a' });
      assert.equal(first.status, 200);

      const sessionId = first.headers.get('mcp-session-id');
      const blocked = await request(url, {
        body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        token: 'token-a',
        sessionId,
      });
      assert.equal(blocked.status, 429);
      assert.ok(blocked.headers.get('retry-after'));

      // A different identity has its own bucket.
      const other = await request(url, { body: initializeBody, token: 'token-b' });
      assert.equal(other.status, 200);
    }
  );
});

test('concurrent sessions per user are capped', async () => {
  await withServer(
    { verifier: verifier(), rateLimitPerMinute: 100, maxSessionsPerUser: 1 },
    async (url) => {
      const first = await request(url, { body: initializeBody, token: 'token-a' });
      assert.equal(first.status, 200);

      const second = await request(url, { body: initializeBody, token: 'token-a' });
      assert.equal(second.status, 429);
      assert.equal((await second.json()).error, 'too_many_sessions');

      const other = await request(url, { body: initializeBody, token: 'token-b' });
      assert.equal(other.status, 200);
    }
  );
});

test('logout revokes the user and closes their sessions', async () => {
  const signedOut = [];
  const oauthFlow = {
    start() {
      return { url: '', state: 's' };
    },
    async complete() {
      throw new Error('not used');
    },
    async signOut(subject) {
      signedOut.push(subject);
    },
  };

  await withServer(
    { verifier: verifier(), oauthFlow, rateLimitPerMinute: 100, maxSessionsPerUser: 5 },
    async (url, base) => {
      const init = await request(url, { body: initializeBody, token: 'token-a' });
      assert.equal(init.status, 200);
      const sessionId = init.headers.get('mcp-session-id');

      const res = await fetch(`${base}/oauth/logout`, {
        method: 'POST',
        headers: { Authorization: 'Bearer token-a' },
      });
      assert.equal(res.status, 204);
      assert.deepEqual(signedOut, ['user-a']);

      const after = await request(url, {
        body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
        token: 'token-a',
        sessionId,
      });
      assert.equal(after.status, 400);
    }
  );
});
