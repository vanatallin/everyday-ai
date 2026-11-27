import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SessionContext,
  SessionStore,
  sessionStorage,
  currentSession,
  resolveIdentity,
  LOCAL_IDENTITY,
} from '../dist/session.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a session requires auth before building services', () => {
  const session = new SessionContext({ subject: 'a', source: 'token' });

  assert.equal(session.peekAuth(), null);
  assert.throws(() => session.requireAuth(), /NOT_AUTHENTICATED/);
  assert.throws(() => session.commentsService(), /NOT_AUTHENTICATED/);
});

test('services are created lazily and reused within a session', () => {
  const session = new SessionContext({ subject: 'a', source: 'token' }, {});

  const first = session.commentsService();
  const second = session.commentsService();

  assert.equal(first, second);
  // A different service is a different instance.
  assert.notEqual(session.commentsService(), session.docsService());
});

test('replacing auth drops cached services', () => {
  const session = new SessionContext({ subject: 'a', source: 'token' }, {});
  const before = session.commentsService();

  session.setAuth({});

  const after = session.commentsService();
  assert.notEqual(before, after);
});

test('dispose clears auth and services', () => {
  const session = new SessionContext({ subject: 'a', source: 'token' }, {});
  session.commentsService();

  session.dispose();

  assert.equal(session.peekAuth(), null);
  assert.throws(() => session.commentsService(), /NOT_AUTHENTICATED/);
});

test('SessionStore returns one context per subject and isolates subjects', () => {
  const store = new SessionStore();
  const a = { subject: 'a', source: 'token' };
  const b = { subject: 'b', source: 'token' };

  assert.equal(store.get(a), store.get(a));
  assert.notEqual(store.get(a), store.get(b));
  assert.equal(store.size, 2);
  assert.equal(store.peek('a'), store.get(a));
  assert.equal(store.peek('missing'), undefined);

  store.release('a');
  assert.equal(store.size, 1);
  assert.equal(store.peek('a'), undefined);

  store.clear();
  assert.equal(store.size, 0);
});

test('AsyncLocalStorage keeps concurrent sessions isolated across awaits', async () => {
  const a = new SessionContext({ subject: 'a', source: 'token' }, {});
  const b = new SessionContext({ subject: 'b', source: 'token' }, {});
  const seen = [];

  await Promise.all([
    sessionStorage.run(a, async () => {
      await sleep(15);
      seen.push(['a-early', currentSession().user.subject]);
      await sleep(5);
      seen.push(['a-late', currentSession().user.subject]);
    }),
    sessionStorage.run(b, async () => {
      await sleep(5);
      seen.push(['b-early', currentSession().user.subject]);
      await sleep(40);
      seen.push(['b-late', currentSession().user.subject]);
    }),
  ]);

  assert.deepEqual(seen, [
    ['b-early', 'b'],
    ['a-early', 'a'],
    ['a-late', 'a'],
    ['b-late', 'b'],
  ]);
});

test('currentSession throws outside a session scope', () => {
  assert.throws(() => currentSession(), /No active session/);
});

test('resolveIdentity defaults to local and reads authInfo when present', () => {
  assert.equal(resolveIdentity(undefined), LOCAL_IDENTITY);
  assert.deepEqual(resolveIdentity({}), LOCAL_IDENTITY);

  assert.deepEqual(resolveIdentity({ authInfo: { extra: { subject: 'user-1', email: 'a@b.c' } } }), {
    subject: 'user-1',
    email: 'a@b.c',
    source: 'token',
  });

  // Falls back to clientId when no explicit subject is provided.
  assert.deepEqual(resolveIdentity({ authInfo: { clientId: 'user-2' } }), {
    subject: 'user-2',
    email: undefined,
    source: 'token',
  });
});
