import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ToolCatalog,
  META_TOOLS,
  isMetaTool,
  handleMetaTool,
} from '../dist/discovery.js';
import { tools } from '../dist/tools/definitions.js';

const metaNames = META_TOOLS.map((tool) => tool.name);

test('full mode advertises every tool and no meta-tools', () => {
  const catalog = new ToolCatalog('full');
  const names = catalog.list().map((tool) => tool.name);

  assert.equal(names.length, tools.length);
  for (const meta of metaNames) {
    assert.ok(!names.includes(meta));
  }
});

test('zero-cost mode advertises only meta-tools', () => {
  const catalog = new ToolCatalog('zero-cost');
  const names = catalog.list().map((tool) => tool.name);

  assert.deepEqual(names.sort(), [...metaNames].sort());
  assert.equal(catalog.list().length, 4);
});

test('lazy mode advertises meta-tools plus discovered tools', () => {
  const catalog = new ToolCatalog('lazy');
  assert.equal(catalog.list().length, 4);

  const result = catalog.discover(['get_doc', 'not_a_tool']);
  assert.deepEqual(result.loaded, ['get_doc']);
  assert.deepEqual(result.unknown, ['not_a_tool']);

  const names = catalog.list().map((tool) => tool.name);
  assert.equal(names.length, 5);
  assert.ok(names.includes('get_doc'));
  assert.ok(names.includes('workspace_call'));
  assert.equal(catalog.loadedCount, 1);
});

test('isMetaTool recognises only the meta-tools', () => {
  for (const name of metaNames) {
    assert.equal(isMetaTool(name), true);
  }
  assert.equal(isMetaTool('get_doc'), false);
});

test('workspace_list_tools filters by query and respects limit', async () => {
  const catalog = new ToolCatalog('zero-cost');

  const all = await handleMetaTool('workspace_list_tools', {}, catalog);
  const parsed = JSON.parse(all.content[0].text);
  assert.equal(parsed.total, tools.length);
  assert.equal(parsed.shown, tools.length);

  const filtered = JSON.parse(
    (await handleMetaTool('workspace_list_tools', { query: 'slides' }, catalog)).content[0].text
  );
  assert.ok(filtered.tools.length > 0);
  assert.ok(
    filtered.tools.every(
      (tool) =>
        tool.name.includes('slides') || tool.description.toLowerCase().includes('slides')
    )
  );

  const limited = JSON.parse(
    (await handleMetaTool('workspace_list_tools', { limit: 3 }, catalog)).content[0].text
  );
  assert.equal(limited.shown, 3);
});

test('workspace_tool_help returns full schemas and reports unknown names', async () => {
  const catalog = new ToolCatalog('zero-cost');

  const response = await handleMetaTool(
    'workspace_tool_help',
    { names: ['get_doc', 'nope'] },
    catalog
  );
  const parsed = JSON.parse(response.content[0].text);

  assert.equal(parsed.tools.length, 1);
  assert.equal(parsed.tools[0].name, 'get_doc');
  assert.ok(parsed.tools[0].inputSchema);
  assert.deepEqual(parsed.missing, ['nope']);

  const none = await handleMetaTool('workspace_tool_help', {}, catalog);
  assert.equal(none.isError, true);

  const unknown = await handleMetaTool('workspace_tool_help', { name: 'nope' }, catalog);
  assert.equal(unknown.isError, true);
});

test('workspace_discover reports loaded and unknown tools', async () => {
  const catalog = new ToolCatalog('lazy');

  const response = await handleMetaTool(
    'workspace_discover',
    { tools: ['get_doc', 'get_sheet_data', 'nope'] },
    catalog
  );
  const parsed = JSON.parse(response.content[0].text);

  assert.equal(parsed.mode, 'lazy');
  assert.deepEqual(parsed.loaded, ['get_doc', 'get_sheet_data']);
  assert.deepEqual(parsed.unknown, ['nope']);
});

test('workspace_call validates its target and refuses meta recursion', async () => {
  const catalog = new ToolCatalog('zero-cost');

  const missing = await handleMetaTool('workspace_call', {}, catalog);
  assert.equal(missing.isError, true);

  const recursion = await handleMetaTool(
    'workspace_call',
    { tool: 'workspace_list_tools' },
    catalog
  );
  assert.equal(recursion.isError, true);
  assert.match(recursion.content[0].text, /meta-tool/);

  const unknown = await handleMetaTool('workspace_call', { tool: 'nope' }, catalog);
  assert.equal(unknown.isError, true);
  assert.match(unknown.content[0].text, /Unknown tool/);

  const badArgs = await handleMetaTool(
    'workspace_call',
    { tool: 'get_doc', arguments: 'nope' },
    catalog
  );
  assert.equal(badArgs.isError, true);
});

test('handleMetaTool returns null for normal tools', async () => {
  assert.equal(await handleMetaTool('get_doc', {}, new ToolCatalog('full')), null);
});
