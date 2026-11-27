import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCursor,
  windowSlice,
  paginateText,
  textPageSuffix,
  windowSuffix,
} from '../dist/pagination.js';
import { summarizeInspectionSlide } from '../dist/slides-api.js';
import { GetDocSchema, GetPresentationSchema, GetSheetDataSchema, InspectPresentationSchema } from '../dist/schemas.js';

test('parseCursor accepts only non-negative integers', () => {
  assert.equal(parseCursor(undefined), 0);
  assert.equal(parseCursor('0'), 0);
  assert.equal(parseCursor('120'), 120);
  assert.throws(() => parseCursor('-1'), /Invalid cursor/);
  assert.throws(() => parseCursor('abc'), /Invalid cursor/);
  assert.throws(() => parseCursor('1.5'), /Invalid cursor/);
});

test('paginateText returns a bounded page and a stable next cursor', () => {
  const text = 'abcdefghij';

  const first = paginateText(text, 0, 4);
  assert.equal(first.text, 'abcd');
  assert.equal(first.start, 0);
  assert.equal(first.end, 4);
  assert.equal(first.total, 10);
  assert.equal(first.nextCursor, '4');

  const second = paginateText(text, 4, 4);
  assert.equal(second.text, 'efgh');
  assert.equal(second.nextCursor, '8');

  const last = paginateText(text, 8, 4);
  assert.equal(last.text, 'ij');
  assert.equal(last.nextCursor, undefined);

  // Offsets beyond the payload clamp to the end rather than throwing.
  const past = paginateText(text, 99, 4);
  assert.equal(past.text, '');
  assert.equal(past.nextCursor, undefined);
});

test('textPageSuffix names the cursor only when more content remains', () => {
  assert.equal(textPageSuffix(paginateText('abcd', 0, 10)), '');
  assert.match(
    textPageSuffix(paginateText('abcdefgh', 0, 4)),
    /Continue with `cursor: "4"`/
  );
  assert.match(
    textPageSuffix(paginateText('abcdefgh', 4, 4)),
    /Characters 4–8 of 8/
  );
});

test('windowSlice clamps and reports continuation', () => {
  const items = [1, 2, 3, 4, 5];

  const first = windowSlice(items, 0, 2);
  assert.deepEqual(first.items, [1, 2]);
  assert.equal(first.next, 2);
  assert.match(windowSuffix(first, 'slides', 'slide_start'), /slides 1–2 of 5/);

  const second = windowSlice(items, 2, 2);
  assert.deepEqual(second.items, [3, 4]);
  assert.equal(second.next, 4);

  const last = windowSlice(items, 4, 2);
  assert.deepEqual(last.items, [5]);
  assert.equal(last.next, undefined);

  const empty = windowSlice(items, 10, 2);
  assert.deepEqual(empty.items, []);
  assert.match(windowSuffix(empty, 'rows', 'start_row'), /No rows in that range; there are 5/);
});

test('read tool schemas default to bounded, non-heavy payloads', () => {
  assert.equal(GetDocSchema.parse({ document_id: 'd' }).max_chars, 20000);
  assert.equal(GetDocSchema.parse({ document_id: 'd' }).include_comments, false);
  assert.equal(GetDocSchema.safeParse({ document_id: 'd', cursor: '5' }).success, true);

  const presentation = GetPresentationSchema.parse({ presentation_id: 'p' });
  assert.equal(presentation.slide_start, 1);
  assert.equal(presentation.max_slides, 10);
  assert.equal(presentation.include_images, false);

  const inspection = InspectPresentationSchema.parse({ presentation_id: 'p' });
  assert.equal(inspection.detail, 'summary');
  assert.equal(inspection.include_layouts, false);
  assert.equal(inspection.include_masters, false);

  const sheet = GetSheetDataSchema.parse({ spreadsheet_id: 's', range: 'A1:B2' });
  assert.equal(sheet.start_row, 0);
  assert.equal(sheet.max_rows, 200);
});

test('inspection summaries keep edit-critical IDs and drop style blobs', () => {
  const slide = {
    id: 'slide-1',
    index: 0,
    name: 'TITLE',
    type: 'SLIDE',
    properties: { huge: 'x'.repeat(5000) },
    elements: [
      {
        id: 'shape-1',
        size: { width: { magnitude: 100 }, height: { magnitude: 50 } },
        transform: { scaleX: 1, scaleY: 1 },
        shape: {
          type: 'TEXT_BOX',
          text: { textElements: [{ textRun: { content: 'Hello\nworld' } }] },
          properties: { outline: { huge: true } },
        },
        title: 'Greeting',
      },
      {
        id: 'table-1',
        table: { rows: 2, columns: 3, tableRows: [{ huge: true }] },
      },
      {
        id: 'group-1',
        group: [{ id: 'child-1', shape: { type: 'RECTANGLE' } }],
      },
      {
        id: 'image-1',
        image: { sourceUrl: 'https://example.com/x.png', imageProperties: { huge: true } },
      },
    ],
  };

  const summary = summarizeInspectionSlide(slide);

  assert.equal(summary.id, 'slide-1');
  assert.equal(summary.name, 'TITLE');
  assert.deepEqual(summary.elements.map((e) => e.id), ['shape-1', 'table-1', 'group-1', 'image-1']);
  assert.equal(summary.elements[0].type, 'shape');
  assert.equal(summary.elements[0].shape_type, 'TEXT_BOX');
  assert.equal(summary.elements[0].text, 'Hello world');
  assert.equal(summary.elements[0].title, 'Greeting');
  assert.deepEqual(summary.elements[1].table, { rows: 2, columns: 3 });
  assert.deepEqual(summary.elements[2].children, ['child-1']);
  assert.equal(summary.elements[3].type, 'image');

  // Style/transform payloads are not carried into the summary.
  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes('outline'));
  assert.ok(!serialized.includes('transform'));
  assert.ok(!serialized.includes('tableRows'));
  assert.ok(!serialized.includes('imageProperties'));
});

test('inspection summaries truncate long shape text to 300 characters', () => {
  const slide = {
    id: 's',
    elements: [
      {
        id: 'shape-1',
        shape: { type: 'TEXT_BOX', text: { textElements: [{ textRun: { content: 'y'.repeat(600) } }] } },
      },
    ],
  };

  const summary = summarizeInspectionSlide(slide);
  assert.equal(summary.elements[0].text.length, 300);
  assert.ok(summary.elements[0].text.endsWith('…'));
});
