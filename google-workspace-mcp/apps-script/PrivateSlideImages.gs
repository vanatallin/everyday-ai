/**
 * API executable for inserting an image without publishing it to Drive.
 * Called under the OAuth user's identity; no image or URL is logged or shared.
 */
function insertPrivateSlideImage(presentationId, slideId, base64, mimeType, x, y, width, height) {
  if (!['image/png', 'image/jpeg', 'image/gif'].includes(mimeType)) {
    throw new Error('Unsupported image type');
  }
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('Invalid image bounds');
  }
  const bytes = Utilities.base64Decode(base64);
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) {
    throw new Error('Image must be between 1 byte and 3 MiB');
  }
  const presentation = SlidesApp.openById(presentationId);
  const slide = presentation.getSlides().find((item) => item.getObjectId() === slideId);
  if (!slide) throw new Error('Slide not found in presentation');
  const image = slide.insertImage(Utilities.newBlob(bytes, mimeType), x, y, width, height);
  const objectId = image.getObjectId();
  presentation.saveAndClose();
  return { objectId };
}

/**
 * Copy a slide between presentations. The Apps Script Slides service supports
 * this natively, preserving text, images, tables, layouts and masters, unlike
 * the REST API. index may be null to append.
 */
function copySlideFromPresentation(sourcePresentationId, sourceSlideId, targetPresentationId, index) {
  const source = SlidesApp.openById(sourcePresentationId);
  const target = SlidesApp.openById(targetPresentationId);
  const slide = source.getSlides().find((item) => item.getObjectId() === sourceSlideId);
  if (!slide) throw new Error('Source slide not found in presentation');
  const copied = index === null || index === undefined || index < 0
    ? target.appendSlide(slide)
    : target.insertSlide(index, slide);
  const objectId = copied.getObjectId();
  source.saveAndClose();
  target.saveAndClose();
  return { objectId };
}
