import test from 'node:test';
import assert from 'node:assert/strict';

import { GoogleCommentsService, formatComments, describeAnchor, isAnchorEmpty } from '../dist/comments-api.js';
import { GetDocSchema, ListCommentsSchema, ManageCommentSchema } from '../dist/schemas.js';
import { tools } from '../dist/tools/definitions.js';

const comment = (overrides = {}) => ({
  id: 'c1',
  author: 'Ada',
  content: 'Looks good to me',
  createdTime: '2026-11-01T10:00:00Z',
  resolved: false,
  replies: [],
  ...overrides,
});

const docWithText = (text, tabId = 't.0') => ({
  data: {
    tabs: [
      {
        tabProperties: { tabId, title: 'Tab 1' },
        documentTab: {
          body: {
            content: [
              { paragraph: { elements: [{ startIndex: 1, textRun: { content: text } }] } },
            ],
          },
        },
      },
    ],
  },
});

const slidesWithTable = (objectId) => ({
  data: {
    slides: [
      {
        objectId: 'page1',
        pageElements: [
          {
            objectId,
            table: {
              tableRows: [
                {
                  tableCells: [
                    {
                      location: { rowIndex: 0, columnIndex: 0 },
                      text: { textElements: [{ startIndex: 0, textRun: { content: 'Header' } }] },
                    },
                    {
                      location: { rowIndex: 0, columnIndex: 1 },
                      text: { textElements: [{ startIndex: 0, textRun: { content: 'Value 42' } }] },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  },
});

const slidesWithShape = (objectId, text) => ({
  data: {
    slides: [
      {
        objectId: 'page1',
        pageElements: [
          {
            objectId,
            shape: { text: { textElements: [{ startIndex: 0, textRun: { content: text } }] } },
          },
        ],
      },
    ],
  },
});

test('list_comments schema applies defaults and rejects unknown fields', () => {
  const parsed = ListCommentsSchema.parse({ file_id: 'file-1' });
  assert.equal(parsed.status, 'open');
  assert.equal(parsed.max_comments, 50);
  assert.equal(parsed.include_deleted, false);

  assert.equal(ListCommentsSchema.safeParse({ file_id: 'file-1', status: 'resolved' }).success, true);
  assert.equal(ListCommentsSchema.safeParse({ file_id: 'file-1', status: 'pending' }).success, false);
  assert.equal(ListCommentsSchema.safeParse({ file_id: 'file-1', max_comments: 0 }).success, false);
  assert.equal(ListCommentsSchema.safeParse({ file_id: 'file-1', extra: true }).success, false);
  assert.equal(ListCommentsSchema.safeParse({}).success, false);
});

test('manage_comment schema enforces per-action requirements and anchor pairs', () => {
  assert.equal(ManageCommentSchema.safeParse({ file_id: 'f', action: 'create', content: 'hi' }).success, true);
  assert.equal(ManageCommentSchema.safeParse({ file_id: 'f', action: 'reply', comment_id: 'c', content: 'hi' }).success, true);
  assert.equal(ManageCommentSchema.safeParse({ file_id: 'f', action: 'resolve', comment_id: 'c' }).success, true);
  assert.equal(ManageCommentSchema.safeParse({ file_id: 'f', action: 'delete', comment_id: 'c' }).success, true);
  assert.equal(
    ManageCommentSchema.safeParse({ file_id: 'f', action: 'create', content: 'hi', quoted_text: 'target' }).success,
    true
  );
  assert.equal(
    ManageCommentSchema.safeParse({ file_id: 'f', action: 'create', content: 'hi', cell: 'Sheet1!B2' }).success,
    true
  );
  assert.equal(
    ManageCommentSchema.safeParse({
      file_id: 'f',
      action: 'create',
      content: 'hi',
      object_id: 'table1',
      table_cell: 'B2:C3',
      row_span: 2,
      column_span: 2,
    }).success,
    true
  );
  // table_cell requires a table object_id
  assert.equal(
    ManageCommentSchema.safeParse({ file_id: 'f', action: 'create', content: 'hi', table_cell: 'B2' }).success,
    false
  );

  // Missing comment_id
  assert.equal(ManageCommentSchema.safeParse({ file_id: 'f', action: 'reply', content: 'hi' }).success, false);
  // Missing content
  assert.equal(ManageCommentSchema.safeParse({ file_id: 'f', action: 'create' }).success, false);
  // Indices must be paired and ordered
  assert.equal(ManageCommentSchema.safeParse({ file_id: 'f', action: 'create', content: 'x', start_index: 1 }).success, false);
  assert.equal(
    ManageCommentSchema.safeParse({ file_id: 'f', action: 'create', content: 'x', start_index: 5, end_index: 5 }).success,
    false
  );
  // Anchor fields only on create
  assert.equal(
    ManageCommentSchema.safeParse({ file_id: 'f', action: 'reply', comment_id: 'c', content: 'x', quoted_text: 'q' }).success,
    false
  );
  assert.equal(
    ManageCommentSchema.safeParse({ file_id: 'f', action: 'resolve', comment_id: 'c', cell: 'A1' }).success,
    false
  );
  // Unknown action
  assert.equal(ManageCommentSchema.safeParse({ file_id: 'f', action: 'archive', comment_id: 'c' }).success, false);
});

test('get_doc excludes comments by default and accepts the opt-in flag', () => {
  assert.equal(GetDocSchema.parse({ document_id: 'doc' }).include_comments, false);
  assert.equal(GetDocSchema.parse({ document_id: 'doc', include_comments: true }).include_comments, true);
  assert.equal(GetDocSchema.safeParse({ document_id: 'doc', unknown: 1 }).success, false);
});

test('formatComments renders a compact block with counts and truncation', () => {
  const longContent = 'x'.repeat(600);
  const out = formatComments('file-1', {
    comments: [
      comment({ id: 'c1', content: longContent, quotedText: 'quoted '.repeat(40) }),
      comment({
        id: 'c2',
        author: 'Grace',
        resolved: true,
        replies: [
          { id: 'r1', author: 'Ada', content: 'first', createdTime: '2026-11-02T10:00:00Z' },
          { id: 'r2', author: 'Ada', content: 'second', createdTime: '2026-11-02T11:00:00Z' },
          { id: 'r3', author: 'Ada', content: 'third', createdTime: '2026-11-02T12:00:00Z' },
          { id: 'r4', author: 'Ada', content: 'fourth', createdTime: '2026-11-02T13:00:00Z' },
          { id: 'r5', author: 'Ada', content: 'resolved', createdTime: '2026-11-02T14:00:00Z', action: 'resolve' },
        ],
      }),
    ],
  });

  assert.match(out, /\*\*Comments on `file-1`\*\* — 2 shown \(1 open, 1 resolved\)/);
  assert.match(out, /`c1` · \*\*Ada\*\* · open/);
  assert.match(out, /`c2` · \*\*Grace\*\* · resolved/);
  assert.match(out, /…1 more reply/);
  assert.ok(!out.includes('x'.repeat(401)));
  assert.ok(out.includes('…'));
  assert.doesNotMatch(out, /More comments available/);
});

test('formatComments advertises pagination and handles empty pages', () => {
  const paged = formatComments('file-1', { comments: [comment()], nextPageToken: 'token-2' });
  assert.match(paged, /More comments available/);
  assert.match(paged, /page_token: "token-2"/);

  assert.match(formatComments('file-1', { comments: [] }), /No matching comments/);
  assert.match(
    formatComments('file-1', { comments: [], nextPageToken: 'token-2' }),
    /More pages exist/
  );
});

test('detectKind maps Drive mime types and caches the result', async () => {
  let calls = 0;
  const service = new GoogleCommentsService({});
  service.drive = {
    files: {
      get: async () => {
        calls++;
        return { data: { mimeType: 'application/vnd.google-apps.presentation' } };
      },
    },
  };

  assert.equal(await service.detectKind('deck'), 'slides');
  assert.equal(await service.detectKind('deck'), 'slides');
  assert.equal(calls, 1);
});

test('Docs comments read from the native API and filter by status', async () => {
  const service = new GoogleCommentsService({});
  service.kindCache.set('doc-1', 'doc');
  service.docs = {
    documents: {
      get: async () => ({
        data: {
          comments: [
            {
              commentId: 'c1',
              anchorId: 'a1',
              plainTextQuote: 'budget',
              status: 'OPEN',
              headPost: {
                postId: 'p1',
                content: 'Please check this',
                createTime: '2026-11-01T10:00:00Z',
                author: { displayName: 'Ada' },
              },
              replies: [
                { postId: 'p2', content: 'On it', createTime: '2026-11-01T11:00:00Z', author: { displayName: 'Grace' } },
                { postId: 'p3', createTime: '2026-11-01T12:00:00Z', author: { displayName: 'Ada' }, commentAction: 'RESOLVE' },
              ],
            },
            {
              commentId: 'c2',
              status: 'RESOLVED',
              headPost: { postId: 'p4', content: 'Done', author: { displayName: 'Ada' } },
              replies: [],
            },
          ],
        },
      }),
    },
  };

  const open = await service.list('doc-1', { status: 'open', includeDeleted: false, maxComments: 50 });
  assert.deepEqual(open.comments.map((c) => c.id), ['c1']);
  assert.equal(open.comments[0].quotedText, 'budget');
  assert.equal(open.comments[0].postId, 'p1');
  assert.equal(open.comments[0].replies.length, 2);

  const all = await service.list('doc-1', { status: 'all', includeDeleted: false, maxComments: 1 });
  assert.deepEqual(all.comments.map((c) => c.id), ['c1']);
  assert.equal(all.nextPageToken, undefined);
});

test('Docs create resolves quoted_text to a native range anchor', async () => {
  const calls = [];
  const service = new GoogleCommentsService({});
  service.kindCache.set('doc-1', 'doc');
  service.docs = {
    documents: {
      get: async (params) => {
        calls.push(['get', params]);
        return docWithText('Hello world\n');
      },
      batchUpdate: async (params) => {
        calls.push(['batchUpdate', params]);
        return { data: { replies: [] } };
      },
    },
  };

  const created = await service.create('doc-1', 'Check this', { quotedText: 'world' });

  const batch = calls.find(([name]) => name === 'batchUpdate')[1];
  const insert = batch.requestBody.requests[0].insertComment;
  assert.equal(insert.content, 'Check this');
  assert.deepEqual(insert.range, { startIndex: 7, endIndex: 12, tabId: 't.0' });
  assert.equal(created.content, 'Check this');
});

test('Docs create fails clearly when quoted_text is absent from the document', async () => {
  const service = new GoogleCommentsService({});
  service.kindCache.set('doc-1', 'doc');
  service.docs = {
    documents: {
      get: async () => docWithText('Hello world\n'),
      batchUpdate: async () => {
        throw new Error('should not be called');
      },
    },
  };

  await assert.rejects(
    service.create('doc-1', 'note', { quotedText: 'missing text' }),
    /Could not find quoted text/
  );
});

test('Sheets create converts an A1 cell to a grid coordinate anchor', async () => {
  const calls = [];
  const service = new GoogleCommentsService({});
  service.kindCache.set('sheet-1', 'sheets');
  service.sheets = {
    spreadsheets: {
      get: async (params) => {
        calls.push(['get', params]);
        return { data: { sheets: [{ properties: { sheetId: 42, title: 'Sheet1' } }] } };
      },
      batchUpdate: async (params) => {
        calls.push(['batchUpdate', params]);
        return { data: { replies: [] } };
      },
    },
  };

  await service.create('sheet-1', 'Fix this cell', { cell: 'Sheet1!B2' });

  const batch = calls.find(([name]) => name === 'batchUpdate')[1];
  assert.deepEqual(batch.requestBody.requests[0].insertComment.coordinate, {
    sheetId: 42,
    rowIndex: 1,
    columnIndex: 1,
  });
});

test('Slides create anchors shape text using object_id plus quoted_text', async () => {
  const calls = [];
  const service = new GoogleCommentsService({});
  service.kindCache.set('deck-1', 'slides');
  service.slides = {
    presentations: {
      get: async () => slidesWithShape('shape1', 'Quarterly revenue grew'),
      batchUpdate: async (params) => {
        calls.push(params);
        return { data: { replies: [] } };
      },
    },
  };

  await service.create('deck-1', 'Numbers look off', { objectId: 'shape1', quotedText: 'revenue' });

  const insert = calls[0].requestBody.requests[0].insertComment;
  assert.deepEqual(insert.shapeTextAnchor, {
    objectId: 'shape1',
    textRange: { type: 'FIXED_RANGE', startIndex: 10, endIndex: 17 },
  });
});

test('Slides create anchors a table cell range with tableAnchor', async () => {
  const calls = [];
  const service = new GoogleCommentsService({});
  service.kindCache.set('deck-1', 'slides');
  service.slides = {
    presentations: {
      get: async () => slidesWithTable('table1'),
      batchUpdate: async (params) => {
        calls.push(params);
        return { data: { replies: [] } };
      },
    },
  };

  await service.create('deck-1', 'Check these cells', {
    objectId: 'table1',
    tableCell: 'B1:C2',
  });

  const insert = calls[0].requestBody.requests[0].insertComment;
  assert.equal(insert.tableAnchor.objectId, 'table1');
  assert.deepEqual(insert.tableAnchor.tableRange, {
    location: { rowIndex: 0, columnIndex: 1 },
    rowSpan: 2,
    columnSpan: 2,
  });
});

test('Slides create anchors text inside a table cell via quoted_text', async () => {
  const calls = [];
  const service = new GoogleCommentsService({});
  service.kindCache.set('deck-1', 'slides');
  service.slides = {
    presentations: {
      get: async () => slidesWithTable('table1'),
      batchUpdate: async (params) => {
        calls.push(params);
        return { data: { replies: [] } };
      },
    },
  };

  await service.create('deck-1', 'Is this right?', {
    objectId: 'table1',
    tableCell: 'B1',
    quotedText: '42',
  });

  const insert = calls[0].requestBody.requests[0].insertComment;
  assert.deepEqual(insert.tableCellTextAnchor, {
    objectId: 'table1',
    cellLocation: { rowIndex: 0, columnIndex: 1 },
    textRange: { type: 'FIXED_RANGE', startIndex: 6, endIndex: 8 },
  });
});

test('Slides table anchors fail clearly on bad cells and missing tables', async () => {
  const service = new GoogleCommentsService({});
  service.kindCache.set('deck-1', 'slides');
  service.slides = {
    presentations: {
      get: async () => slidesWithTable('table1'),
      batchUpdate: async () => {
        throw new Error('should not be called');
      },
    },
  };

  await assert.rejects(
    service.create('deck-1', 'x', { objectId: 'table1', tableCell: 'B9' }),
    /No table cell at row 8, column 1/
  );

  service.kindCache.set('shape-1', 'slides');
  await assert.rejects(
    service.create('shape-1', 'x', { objectId: 'shape9', tableCell: 'B1' }),
    /is not a table/
  );
});

test('Sheets rejects text and range anchors with actionable errors', async () => {
  const service = new GoogleCommentsService({});
  service.kindCache.set('sheet-1', 'sheets');
  service.sheets = {
    spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { sheetId: 1, title: 'Sheet1' } }] } }),
      batchUpdate: async () => {
        throw new Error('should not be called');
      },
    },
  };

  await assert.rejects(
    service.create('sheet-1', 'x', { cell: 'A1:B2' }),
    /single cell, not a range/
  );
  await assert.rejects(
    service.create('sheet-1', 'x', { quotedText: 'text' }),
    /not to text/
  );
  await assert.rejects(
    service.create('sheet-1', 'x', { startIndex: 1, endIndex: 4 }),
    /not supported for Sheets/
  );
});

test('native resolve and delete use the editor batchUpdate requests', async () => {
  const service = new GoogleCommentsService({});
  service.kindCache.set('doc-1', 'doc');
  const requests = [];
  service.docs = {
    documents: {
      batchUpdate: async (params) => {
        requests.push(params.requestBody.requests);
        return { data: { replies: [] } };
      },
    },
  };

  await service.setResolved('doc-1', 'c1', true);
  await service.setResolved('doc-1', 'c1', false);
  await service.delete('doc-1', 'c1');

  assert.deepEqual(requests[0], [
    { addCommentReply: { commentId: 'c1', post: { commentAction: 'RESOLVE' } } },
  ]);
  assert.deepEqual(requests[1], [
    { addCommentReply: { commentId: 'c1', post: { commentAction: 'REOPEN' } } },
  ]);
  assert.deepEqual(requests[2], [{ deleteComment: { commentId: 'c1' } }]);
});

test('Drive fallback still paginates and filters by status', async () => {
  const calls = [];
  const pages = [
    {
      data: {
        comments: [
          { id: 'c1', author: { displayName: 'Ada' }, content: 'open-1', createdTime: 't1', resolved: false, replies: [] },
          { id: 'c2', author: { displayName: 'Ada' }, content: 'done-1', createdTime: 't2', resolved: true, replies: [] },
        ],
        nextPageToken: 'page-2',
      },
    },
    {
      data: {
        comments: [
          { id: 'c3', author: { displayName: 'Grace' }, content: 'open-2', createdTime: 't3', resolved: false, replies: [] },
        ],
      },
    },
  ];

  const service = new GoogleCommentsService({});
  service.kindCache.set('pdf-1', 'drive');
  service.drive = {
    comments: {
      list: async (params) => {
        calls.push(params);
        return pages.shift();
      },
    },
  };

  const result = await service.list('pdf-1', { status: 'open', includeDeleted: false, maxComments: 2 });

  assert.deepEqual(result.comments.map((c) => c.id), ['c1', 'c3']);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].pageToken, 'page-2');
});

test('Drive create rejects malformed anchors before calling the API', async () => {
  const service = new GoogleCommentsService({});
  service.kindCache.set('pdf-1', 'drive');
  service.drive = {
    comments: {
      create: async () => {
        throw new Error('should not be called');
      },
    },
  };

  await assert.rejects(
    service.create('pdf-1', 'hi', { rawAnchor: 'not-json' }),
    /anchor must be a valid JSON string/
  );
});

test('anchor descriptions are human-readable for success messages', () => {
  assert.equal(isAnchorEmpty({}), true);
  assert.equal(isAnchorEmpty({ quotedText: 'x' }), false);
  assert.equal(describeAnchor({ quotedText: 'target text' }), 'text "target text"');
  assert.equal(describeAnchor({ startIndex: 1, endIndex: 4 }), 'range 1-4');
  assert.equal(describeAnchor({ cell: 'Sheet1!B2' }), 'cell Sheet1!B2');
  assert.equal(describeAnchor({ objectId: 'shape1' }), 'object shape1');
  assert.equal(
    describeAnchor({ objectId: 'table1', tableCell: 'B2' }),
    'table cell B2'
  );
  assert.equal(
    describeAnchor({ objectId: 'table1', tableCell: 'B2', quotedText: '42' }),
    'table cell B2 text "42"'
  );
});

test('comments tools are registered and share the generic file_id surface', () => {
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('list_comments'));
  assert.ok(names.includes('manage_comment'));

  const listTool = tools.find((t) => t.name === 'list_comments');
  const manageTool = tools.find((t) => t.name === 'manage_comment');
  assert.deepEqual(listTool.inputSchema.required, ['file_id']);
  assert.deepEqual(manageTool.inputSchema.required, ['file_id', 'action']);

  const props = manageTool.inputSchema.properties;
  for (const anchorProp of [
    'quoted_text', 'start_index', 'end_index', 'object_id',
    'table_cell', 'row_span', 'column_span', 'cell', 'sheet_id',
  ]) {
    assert.ok(anchorProp in props, `${anchorProp} should be exposed`);
  }

  const getDoc = tools.find((t) => t.name === 'get_doc');
  assert.ok('include_comments' in getDoc.inputSchema.properties);
});
