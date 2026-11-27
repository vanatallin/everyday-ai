import test from 'node:test';
import assert from 'node:assert/strict';

import { MetadataCache } from '../dist/metadata-cache.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('caches a loaded value and exposes peek/size', async () => {
  let loads = 0;
  const cache = new MetadataCache();

  const first = await cache.get('a', async () => {
    loads++;
    return { value: 1 };
  });
  const second = await cache.get('a', async () => {
    loads++;
    return { value: 2 };
  });

  assert.equal(loads, 1);
  assert.equal(first, second);
  assert.deepEqual(cache.peek('a'), { value: 1 });
  assert.equal(cache.size, 1);
  assert.equal(cache.peek('missing'), undefined);
});

test('reloads after the TTL expires', async () => {
  let loads = 0;
  const cache = new MetadataCache({ ttlMs: 20 });

  await cache.get('a', async () => ++loads);
  await cache.get('a', async () => ++loads);
  assert.equal(loads, 1);

  await sleep(30);
  const refreshed = await cache.get('a', async () => ++loads);
  assert.equal(loads, 2);
  assert.equal(refreshed, 2);
});

test('ttlMs 0 keeps entries forever', async () => {
  let loads = 0;
  const cache = new MetadataCache({ ttlMs: 0 });

  await cache.get('a', async () => ++loads);
  await sleep(10);
  await cache.get('a', async () => ++loads);
  assert.equal(loads, 1);
});

test('coalesces concurrent misses into one loader call', async () => {
  let loads = 0;
  const cache = new MetadataCache();

  const load = async () => {
    loads++;
    await sleep(10);
    return 'value';
  };

  const [a, b, c] = await Promise.all([
    cache.get('key', load),
    cache.get('key', load),
    cache.get('key', load),
  ]);

  assert.equal(loads, 1);
  assert.deepEqual([a, b, c], ['value', 'value', 'value']);
});

test('does not cache failures and retries on the next call', async () => {
  let attempts = 0;
  const cache = new MetadataCache();

  await assert.rejects(
    cache.get('a', async () => {
      attempts++;
      throw new Error('boom');
    }),
    /boom/
  );

  const value = await cache.get('a', async () => {
    attempts++;
    return 'ok';
  });

  assert.equal(attempts, 2);
  assert.equal(value, 'ok');
  assert.equal(cache.peek('a'), 'ok');
});

test('evicts the least recently used entry past maxEntries', async () => {
  const cache = new MetadataCache({ maxEntries: 2, ttlMs: 0 });

  await cache.get('a', async () => 'a');
  await cache.get('b', async () => 'b');

  // Touch a so b becomes the least recently used entry.
  assert.equal(cache.peek('a'), 'a');

  await cache.get('c', async () => 'c');

  assert.equal(cache.peek('a'), 'a');
  assert.equal(cache.peek('b'), undefined);
  assert.equal(cache.peek('c'), 'c');
  assert.equal(cache.size, 2);
});

test('delete and clear remove entries', async () => {
  const cache = new MetadataCache();

  await cache.get('a', async () => 'a');
  await cache.get('b', async () => 'b');

  cache.delete('a');
  assert.equal(cache.peek('a'), undefined);
  assert.equal(cache.size, 1);

  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.peek('b'), undefined);
});
