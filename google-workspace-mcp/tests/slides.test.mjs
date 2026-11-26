import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { GoogleSlidesService, compileSlideEdits } from '../dist/slides-api.js';
import { EditPresentationSchema, AddSlideImageSchema, CopySlideSchema, UploadDriveFileSchema } from '../dist/schemas.js';
import { tools } from '../dist/tools/definitions.js';

test('validates editing operations and rejects malformed styles and image bounds', () => {
  assert.equal(EditPresentationSchema.safeParse({ presentation_id: 'p', operations: [{ type: 'style_text', element_id: 'e', style: {} }] }).success, false);
  assert.equal(EditPresentationSchema.safeParse({ presentation_id: 'p', operations: [{ type: 'set_background', slide_id: 's', color: 'red' }] }).success, false);
  assert.equal(EditPresentationSchema.safeParse({ presentation_id: 'p', operations: [{ type: 'delete_slide', slide_id: 's', unexpected: true }] }).success, false);
  assert.equal(AddSlideImageSchema.safeParse({ presentation_id: 'p', slide_id: 's', file_path: '/x', x: 0, y: 0, width: 0, height: 1 }).success, false);
  assert.equal(EditPresentationSchema.safeParse({ presentation_id: 'p', operations: [{ type: 'style_shape', element_id: 'e' }] }).success, false);
  assert.equal(EditPresentationSchema.safeParse({ presentation_id: 'p', operations: [{ type: 'style_shape', element_id: 'e', outline_color: 'gray' }] }).success, false);
});

test('styles shape outlines independently or alongside fills', () => {
  const { operations } = EditPresentationSchema.parse({ presentation_id: 'p', operations: [
    { type: 'style_shape', element_id: 'card', outline_color: '#D9D9D9' },
    { type: 'style_shape', element_id: 'card', fill_color: '#ffffff', outline_color: '#000000' },
    { type: 'add_shape', slide_id: 'slide', shape: 'RECTANGLE', x: 0, y: 0, width: 100, height: 40, outline_color: '#808080' },
  ] });
  const { requests, createdIds } = compileSlideEdits(operations);
  assert.equal(requests[0].updateShapeProperties.fields, 'outline.outlineFill.solidFill,outline.propertyState');
  assert.deepEqual(requests[0].updateShapeProperties.shapeProperties, { outline: {
    outlineFill: { solidFill: { color: { rgbColor: { red: 217 / 255, green: 217 / 255, blue: 217 / 255 } }, alpha: 1 } },
    propertyState: 'RENDERED',
  } });
  assert.equal(requests[1].updateShapeProperties.fields, 'shapeBackgroundFill.solidFill,outline.outlineFill.solidFill,outline.propertyState');
  assert.deepEqual(requests[1].updateShapeProperties.shapeProperties.outline.outlineFill.solidFill.color.rgbColor, { red: 0, green: 0, blue: 0 });
  assert.equal(requests[3].updateShapeProperties.objectId, createdIds[0].objectId);
  assert.equal(requests[3].updateShapeProperties.fields, 'outline.outlineFill.solidFill,outline.propertyState');
});

test('compiles slide, text, style, reorder, duplicate, transform and deletion operations', () => {
  const operations = EditPresentationSchema.parse({ presentation_id: 'p', operations: [
    { type: 'add_slide', index: 0 },
    { type: 'add_text_box', slide_id: 's', text: 'Hello', x: 10, y: 20, width: 200, height: 40, style: { color: '#ff0000', font_size: 24, bold: false, align: 'CENTER' } },
    { type: 'style_shape', element_id: 'shape', fill_color: '#00ff00' },
    { type: 'replace_text', element_id: 'text', text: 'new' },
    { type: 'move_slide', slide_id: 's', index: 2 },
    { type: 'duplicate_slide', slide_id: 's' },
    { type: 'transform_element', element_id: 'text', x: 5, y: 6, scale_x: 2, scale_y: 3 },
    { type: 'delete_slide', slide_id: 's' },
  ] }).operations;
  const { requests, createdIds } = compileSlideEdits(operations);
  assert.equal(createdIds.length, 2);
  assert.equal(requests[0].createSlide.objectId, createdIds[0].objectId);
  assert.equal(requests[1].createShape.objectId, createdIds[1].objectId);
  assert.equal(requests[3].updateTextStyle.style.bold, false);
  assert.deepEqual(requests[3].updateTextStyle.style.foregroundColor.opaqueColor.rgbColor, { red: 1, green: 0, blue: 0 });
  assert.equal(requests[4].updateParagraphStyle.style.alignment, 'CENTER');
  assert.equal(requests.find(r => r.updateSlidesPosition).updateSlidesPosition.insertionIndex, 2);
  assert.equal(requests.find(r => r.duplicateObject).duplicateObject.objectId, 's');
  assert.equal(requests.find(r => r.updatePageElementTransform).updatePageElementTransform.applyMode, 'ABSOLUTE');
  assert.equal(requests.at(-1).deleteObject.objectId, 's');
});

test('compiles images, layouts, rich text, tables, backgrounds and layering', () => {
  const operations = EditPresentationSchema.parse({ presentation_id: 'p', operations: [
    { type: 'add_slide', layout: 'TITLE_AND_BODY' },
    { type: 'add_image', slide_id: 's', url: 'https://example.test/a.png', x: 1, y: 2, width: 30, height: 40, alt_text: 'A logo' },
    { type: 'add_image', slide_id: 's', drive_file_id: 'drive id', x: 1, y: 2, width: 3, height: 4 },
    { type: 'add_text_box', slide_id: 's', text: 'Title', x: 0, y: 0, width: 100, height: 40, style: { align: 'CENTER', vertical_anchor: 'MIDDLE', line_spacing: 120, space_before: 4, space_after: 8, bullets: 'BULLET_DISC_CIRCLE_SQUARE' } },
    { type: 'add_text_box', slide_id: 's', runs: [{ text: 'Bold', style: { bold: true } }, { text: ' normal', style: { color: '#ff0000' } }], x: 0, y: 0, width: 100, height: 40 },
    { type: 'style_text', element_id: 'e', style: { bold: true }, start_index: 2, end_index: 5 },
    { type: 'add_table', slide_id: 's', rows: 2, columns: 2, x: 0, y: 0, width: 200, height: 80, cells: [['A', 'B'], ['C', 'D']], header_row: true, header_fill_color: '#eeeeee', border_color: '#cccccc', border_weight: 1 },
    { type: 'set_background', slide_id: 's', image_url: 'https://example.test/bg.png' },
    { type: 'z_order', element_ids: ['a', 'b'], operation: 'BRING_TO_FRONT' },
    { type: 'set_alt_text', element_id: 'e', description: 'Chart' },
  ] }).operations;
  const { requests, createdIds } = compileSlideEdits(operations);
  assert.deepEqual(requests[0].createSlide.slideLayoutReference, { predefinedLayout: 'TITLE_AND_BODY' });
  assert.equal(requests[1].createImage.url, 'https://example.test/a.png');
  assert.deepEqual(requests[2].updatePageElementAltText, { objectId: createdIds[1].objectId, description: 'A logo' });
  assert.equal(requests[3].createImage.url, 'https://drive.google.com/uc?export=download&id=drive%20id');
  const bullet = requests.find(r => r.createParagraphBullets);
  assert.equal(bullet.createParagraphBullets.bulletPreset, 'BULLET_DISC_CIRCLE_SQUARE');
  assert.equal(requests.find(r => r.updateShapeProperties?.shapeProperties?.contentAlignment).updateShapeProperties.shapeProperties.contentAlignment, 'MIDDLE');
  const runStyles = requests.filter(r => r.updateTextStyle && r.updateTextStyle.textRange.startIndex !== undefined);
  assert.deepEqual(runStyles.slice(0, 2).map(r => [r.updateTextStyle.textRange.startIndex, r.updateTextStyle.textRange.endIndex]), [[0, 4], [4, 11]]);
  const table = requests.find(r => r.createTable);
  assert.equal(table.createTable.rows, 2);
  assert.equal(requests.filter(r => r.insertText?.cellLocation).length, 4);
  assert.equal(requests.filter(r => r.updateTableCellProperties).length, 2);
  assert.equal(requests.find(r => r.updateTableBorderProperties).updateTableBorderProperties.fields, 'tableBorderFill.solidFill,weight');
  assert.equal(requests.find(r => r.updatePageProperties?.pageProperties?.pageBackgroundFill?.stretchedPictureFill).updatePageProperties.fields, 'pageBackgroundFill.stretchedPictureFill');
  assert.equal(requests.find(r => r.updatePageElementsZOrder).updatePageElementsZOrder.operation, 'BRING_TO_FRONT');
});

test('validates new operation shapes and image sources', () => {
  const parse = operations => EditPresentationSchema.safeParse({ presentation_id: 'p', operations }).success;
  assert.equal(parse([{ type: 'add_image', slide_id: 's', x: 0, y: 0, width: 1, height: 1 }]), false);
  assert.equal(parse([{ type: 'add_image', slide_id: 's', url: 'https://a/b.png', drive_file_id: 'x', x: 0, y: 0, width: 1, height: 1 }]), false);
  assert.equal(parse([{ type: 'add_text_box', slide_id: 's', x: 0, y: 0, width: 1, height: 1 }]), false);
  assert.equal(parse([{ type: 'style_shape', element_id: 'e' }]), false);
  assert.equal(parse([{ type: 'set_background', slide_id: 's' }]), false);
  assert.equal(parse([{ type: 'style_text', element_id: 'e', style: { bold: true }, start_index: 3, end_index: 2 }]), false);
  assert.equal(parse([{ type: 'add_table', slide_id: 's', rows: 2, columns: 2, x: 0, y: 0, width: 1, height: 1, cells: [['a']] }]), false);
  assert.equal(parse([{ type: 'add_slide', layout: 'TITLE', layout_id: 'layout' }]), false);
  assert.equal(parse([{ type: 'add_shape', slide_id: 's', shape: 'CHEVRON', x: 0, y: 0, width: 1, height: 1 }]), true);
});

test('resolves notes, links and rotated transforms against presentation state', async () => {
  const service = new GoogleSlidesService(null);
  let sent;
  const notesShape = { objectId: 'notes-body', shape: { placeholder: { type: 'BODY' }, text: { textElements: [{ endIndex: 3, textRun: { content: 'Old' } }] } } };
  service.slides = { presentations: {
    get: async () => ({ data: { revisionId: 'rev', slides: [{
      objectId: 'slide',
      pageElements: [{ objectId: 'shape' }, { objectId: 'image', image: {} }, { objectId: 'rotated', size: { width: { magnitude: 100 }, height: { magnitude: 50 } } }],
      slideProperties: { notesPage: { pageElements: [notesShape] } },
    }] } }),
    batchUpdate: async (request) => { sent = request; return { data: { replies: [] } }; },
  } };
  await service.editPresentation('p', EditPresentationSchema.parse({ presentation_id: 'p', operations: [
    { type: 'add_notes', slide_id: 'slide', text: 'More' },
    { type: 'link_element', element_id: 'shape', url: 'https://example.test' },
    { type: 'link_element', element_id: 'image', url: 'https://example.test/i' },
    { type: 'transform_element', element_id: 'rotated', x: 10, y: 20, scale_x: 1, scale_y: 1, rotation: 90 },
  ] }).operations);
  assert.deepEqual(sent.requestBody.requests[0].insertText, { objectId: 'notes-body', text: '\nMore', insertionIndex: 3 });
  assert.deepEqual(sent.requestBody.requests[1].updateShapeProperties.shapeProperties.link, { url: 'https://example.test' });
  assert.deepEqual(sent.requestBody.requests[2].updateImageProperties.imageProperties.link, { url: 'https://example.test/i' });
  const transform = sent.requestBody.requests[3].updatePageElementTransform.transform;
  assert.ok(Math.abs(transform.scaleX) < 1e-9 && Math.abs(transform.shearY - 1) < 1e-9);
});

test('copies a slide across presentations by recreating elements', async () => {
  const service = new GoogleSlidesService(null);
  let sent;
  service.slides = { presentations: {
    get: async () => ({ data: { slides: [{
      objectId: 'source-slide',
      pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: { red: 1, green: 1, blue: 1 } } } } },
      pageElements: [
        { objectId: 'source-shape', shape: { shapeType: 'RECTANGLE', text: { textElements: [{ startIndex: 0, endIndex: 2, textRun: { content: 'Hi', style: { bold: true } } }] } }, size: { width: { magnitude: 10 }, height: { magnitude: 10 } }, transform: { scaleX: 1, scaleY: 1, translateX: 1, translateY: 2, unit: 'PT' } },
        { objectId: 'source-image', image: { sourceUrl: 'https://example.test/i.png' }, size: { width: { magnitude: 10 }, height: { magnitude: 10 } } },
        { objectId: 'source-no-url', image: {} },
      ],
    }] } }),
    batchUpdate: async (request) => { sent = request; return { data: { replies: [] } }; },
  } };
  const result = await service.copySlide(CopySlideSchema.parse({ target_presentation_id: 'target', source_presentation_id: 'source', source_slide_id: 'source-slide', index: 1 }));
  assert.ok(result.slideId);
  assert.equal(result.warnings.length, 1);
  assert.equal(sent.requestBody.requests[0].createSlide.insertionIndex, 1);
  assert.equal(sent.requestBody.requests[1].updatePageProperties.objectId, result.slideId);
  assert.ok(sent.requestBody.requests.some(r => r.createShape?.shapeType === 'RECTANGLE'));
  assert.ok(sent.requestBody.requests.some(r => r.insertText?.text === 'Hi'));
  assert.ok(sent.requestBody.requests.some(r => r.updateTextStyle?.style?.bold === true));
  assert.ok(sent.requestBody.requests.some(r => r.createImage?.url === 'https://example.test/i.png'));
});

test('uses the Apps Script helper for lossless cross-deck copy when configured', async () => {
  const previous = process.env.GOOGLE_SLIDES_SCRIPT_DEPLOYMENT_ID;
  process.env.GOOGLE_SLIDES_SCRIPT_DEPLOYMENT_ID = 'deployment';
  try {
    const service = new GoogleSlidesService(null);
    let sent;
    service.script = { scripts: { run: async (request) => {
      sent = request;
      return { data: { response: { result: { objectId: 'copied-slide' } } } };
    } } };
    service.slides = { presentations: { batchUpdate: () => { throw new Error('must not recreate'); } } };
    const result = await service.copySlide(CopySlideSchema.parse({ target_presentation_id: 'target', source_presentation_id: 'source', source_slide_id: 'slide', index: 3 }));
    assert.equal(result.slideId, 'copied-slide');
    assert.equal(result.method, 'apps_script');
    assert.equal(sent.scriptId, 'deployment');
    assert.equal(sent.requestBody.function, 'copySlideFromPresentation');
    assert.deepEqual(sent.requestBody.parameters, ['source', 'slide', 'target', 3]);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_SLIDES_SCRIPT_DEPLOYMENT_ID;
    else process.env.GOOGLE_SLIDES_SCRIPT_DEPLOYMENT_ID = previous;
  }
});

test('aligns and distributes elements using their measured bounds', async () => {
  const service = new GoogleSlidesService(null);
  let sent;
  const element = (id, x, y, width, height) => ({ objectId: id, size: { width: { magnitude: width, unit: 'EMU' }, height: { magnitude: height, unit: 'EMU' } }, transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'EMU' } });
  service.slides = { presentations: {
    get: async () => ({ data: { slides: [{ objectId: 'slide', pageElements: [element('a', 0, 0, 100, 50), element('b', 300, 100, 50, 50), element('c', 500, 0, 100, 50)] }] } }),
    batchUpdate: async (request) => { sent = request; return { data: { replies: [] } }; },
  } };
  await service.editPresentation('p', EditPresentationSchema.parse({ presentation_id: 'p', operations: [
    { type: 'align_elements', element_ids: ['a', 'b', 'c'], alignment: 'LEFT' },
    { type: 'distribute_elements', element_ids: ['a', 'b', 'c'], axis: 'HORIZONTAL' },
  ] }).operations);
  const translations = sent.requestBody.requests.map(r => r.updatePageElementTransform);
  assert.deepEqual(translations.slice(0, 3).map(t => t.transform.translateX), [0, -300, -500]);
  assert.deepEqual(translations.slice(3).map(t => t.transform.translateX), [0, -25, 0]);
  assert.ok(sent.requestBody.requests.every(r => r.updatePageElementTransform.transform.unit === 'EMU'));
});

test('sends batch with revision, and rejects wrong object kind before deletion', async () => {
  const service = new GoogleSlidesService(null);
  let sent;
  service.slides = { presentations: {
    get: async () => ({ data: { revisionId: 'rev', slides: [{ objectId: 'slide', pageElements: [{ objectId: 'element' }] }] } }),
    batchUpdate: async (request) => { sent = request; return { data: { replies: [{}] } }; },
  } };
  await assert.rejects(service.editPresentation('p', [{ type: 'delete_element', element_id: 'slide' }]), /element ID/);
  assert.equal(sent, undefined);
  await service.editPresentation('p', [{ type: 'delete_element', element_id: 'element' }]);
  assert.deepEqual(sent.requestBody.writeControl, { requiredRevisionId: 'rev' });
  assert.equal(sent.requestBody.requests[0].deleteObject.objectId, 'element');
});

test('private image tool sends bytes only to the script API and handles errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slides-test-'));
  const path = join(dir, 'image.png');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  await writeFile(path, png);
  const previous = process.env.GOOGLE_SLIDES_IMAGE_SCRIPT_DEPLOYMENT_ID;
  process.env.GOOGLE_SLIDES_IMAGE_SCRIPT_DEPLOYMENT_ID = 'deployment';
  try {
    const service = new GoogleSlidesService(null);
    let sent;
    service.script = { scripts: { run: async (request) => { sent = request; return { data: { response: { result: { objectId: 'image-id' } } } }; } } };
    service.drive = { files: { create: () => { throw new Error('must not upload or share'); } } };
    const args = { presentation_id: 'p', slide_id: 's', file_path: path, x: 1, y: 2, width: 3, height: 4 };
    assert.deepEqual(await service.addSlideImage(args), { objectId: 'image-id' });
    assert.equal(sent.scriptId, 'deployment');
    assert.equal(sent.requestBody.parameters[2], png.toString('base64'));
    assert.equal(sent.requestBody.parameters[3], 'image/png');
    service.script.scripts.run = async () => ({ data: { error: { details: [{ errorMessage: 'Slide not found' }] } } });
    await assert.rejects(service.addSlideImage(args), /Slide not found/);
    service.script.scripts.run = async () => { throw new Error('secret image payload'); };
    await assert.rejects(service.addSlideImage(args), error => !error.message.includes('secret image payload'));
    await assert.rejects(service.addSlideImage({ ...args, file_path: 'relative.png' }), /absolute/);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_SLIDES_IMAGE_SCRIPT_DEPLOYMENT_ID;
    else process.env.GOOGLE_SLIDES_IMAGE_SCRIPT_DEPLOYMENT_ID = previous;
    await unlink(path);
    await rmdir(dir);
  }
});

test('uploads a local file to Drive and can share it by link', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slides-upload-'));
  const path = join(dir, 'logo.PNG');
  await writeFile(path, Buffer.from('image'));
  try {
    const service = new GoogleSlidesService(null);
    let permission;
    service.drive = { files: { create: async (request) => {
      assert.equal(request.media.mimeType, 'image/png');
      let bytes = 0;
      for await (const chunk of request.media.body) bytes += chunk.length;
      assert.equal(bytes, 5);
      return { data: { id: 'file-id', name: request.requestBody.name, webViewLink: 'https://drive.test/file' } };
    } },
      permissions: { create: async (request) => { permission = request; return { data: {} }; } } };
    const result = await service.uploadDriveFile(UploadDriveFileSchema.parse({ file_path: path, share_anyone: true }));
    assert.deepEqual(result, { id: 'file-id', name: 'logo.PNG', webViewLink: 'https://drive.test/file', image_url: 'https://drive.google.com/uc?export=download&id=file-id' });
    assert.deepEqual(permission.requestBody, { role: 'reader', type: 'anyone' });
    await assert.rejects(service.uploadDriveFile({ file_path: 'relative.png', share_anyone: false }), /absolute/);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
});

test('registers the new Slides tools', () => {
  const names = new Set(tools.map(tool => tool.name));
  for (const name of ['create_presentation', 'inspect_presentation', 'edit_presentation', 'get_slide_preview', 'add_slide_image', 'upload_drive_file', 'copy_slide']) assert.ok(names.has(name));
});

test('Apps Script helper inserts image bytes without Drive access', async () => {
  const source = await readFile(new URL('../apps-script/PrivateSlideImages.gs', import.meta.url), 'utf8');
  let inserted;
  let saved = false;
  const slide = { getObjectId: () => 'slide', insertImage: (blob, ...bounds) => {
    inserted = { blob, bounds };
    return { getObjectId: () => 'image' };
  } };
  const sandbox = {
    Utilities: { base64Decode: value => [...Buffer.from(value, 'base64')], newBlob: (bytes, mimeType) => ({ bytes, mimeType }) },
    SlidesApp: { openById: id => {
      assert.equal(id, 'deck');
      return { getSlides: () => [slide], saveAndClose: () => { saved = true; } };
    } },
  };
  runInNewContext(source, sandbox);
  const result = sandbox.insertPrivateSlideImage('deck', 'slide', Buffer.from('image').toString('base64'), 'image/png', 1, 2, 30, 40);
  assert.equal(result.objectId, 'image');
  assert.deepEqual(inserted.bounds, [1, 2, 30, 40]);
  assert.equal(inserted.blob.mimeType, 'image/png');
  assert.equal(saved, true);
  assert.throws(() => sandbox.insertPrivateSlideImage('deck', 'missing', 'aW1hZ2U=', 'image/png', 1, 2, 30, 40), /Slide not found/);
});

test('Apps Script helper copies slides between presentations', async () => {
  const source = await readFile(new URL('../apps-script/PrivateSlideImages.gs', import.meta.url), 'utf8');
  const sourceSlide = { getObjectId: () => 'source-slide' };
  let inserted;
  let appended;
  let closed = [];
  const sandbox = {
    SlidesApp: { openById: id => {
      if (id === 'source') return { getSlides: () => [sourceSlide], saveAndClose: () => closed.push(id) };
      if (id === 'target') return {
        insertSlide: (index, slide) => { inserted = { index, slide }; return { getObjectId: () => 'copied-slide' }; },
        appendSlide: slide => { appended = slide; return { getObjectId: () => 'appended-slide' }; },
        saveAndClose: () => closed.push(id),
      };
      throw new Error('Unknown presentation');
    } },
  };
  runInNewContext(source, sandbox);
  assert.equal(sandbox.copySlideFromPresentation('source', 'source-slide', 'target', 2).objectId, 'copied-slide');
  assert.equal(inserted.index, 2);
  assert.equal(inserted.slide, sourceSlide);
  assert.deepEqual(closed.sort(), ['source', 'target']);
  assert.equal(sandbox.copySlideFromPresentation('source', 'source-slide', 'target', null).objectId, 'appended-slide');
  assert.equal(appended, sourceSlide);
  assert.throws(() => sandbox.copySlideFromPresentation('source', 'missing', 'target', 0), /Source slide not found/);
});

test('slide preview returns image bytes rather than a shareable URL', async () => {
  const service = new GoogleSlidesService(null);
  service.slides = { presentations: { pages: { getThumbnail: async () => ({ data: { contentUrl: 'https://example.test/secret' } }) } } };
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from('preview'), { status: 200 });
  try {
    assert.deepEqual(await service.getSlidePreview('deck', 'slide'), { data: Buffer.from('preview').toString('base64'), mimeType: 'image/png' });
  } finally { globalThis.fetch = previous; }
});
