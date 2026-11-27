/**
 * Google Slides API Service
 * Wraps Google Slides REST API calls
 */

import { google } from "googleapis";
import type { slides_v1, script_v1 } from "googleapis";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { isAbsolute } from "node:path";

import { logger } from "./logger.js";
import type { GoogleAuth } from "./types.js";
import type { SlideEditOperation, SlideTextStyle } from "./schemas.js";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

type TextStyleInput = SlideTextStyle;
type ShapeStyleInput = Extract<SlideEditOperation, { type: "style_shape" }>;
type ImageStyleInput = Extract<SlideEditOperation, { type: "style_image" }>;

function newObjectId(): string { return `obj_${randomUUID().replace(/-/g, "")}`; }

function rgb(hex: string): slides_v1.Schema$RgbColor {
  return { red: parseInt(hex.slice(1, 3), 16) / 255, green: parseInt(hex.slice(3, 5), 16) / 255, blue: parseInt(hex.slice(5, 7), 16) / 255 };
}

function solidFill(hex: string, alpha = 1): slides_v1.Schema$SolidFill {
  return { color: { rgbColor: rgb(hex) }, alpha };
}

function pt(magnitude: number): slides_v1.Schema$Dimension {
  return { magnitude, unit: "PT" };
}

/** Convert a decimal degrees rotation into an AffineTransform that rotates around the element centre. */
export function rotationTransform(x: number, y: number, width: number, height: number, degrees: number, scaleX = 1, scaleY = 1): slides_v1.Schema$AffineTransform {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const scaledWidth = width * scaleX;
  const scaledHeight = height * scaleY;
  const cx = scaledWidth / 2;
  const cy = scaledHeight / 2;
  return {
    scaleX: cos * scaleX, scaleY: cos * scaleY,
    shearX: -sin * scaleY, shearY: sin * scaleX,
    translateX: x + cx - cos * cx + sin * cy,
    translateY: y + cy - sin * cx - cos * cy,
    unit: "PT",
  };
}

function makeTextStyle(style: TextStyleInput): { style: slides_v1.Schema$TextStyle; fields: string[] } {
  const result: slides_v1.Schema$TextStyle = {};
  const fields: string[] = [];
  if (style.font_family !== undefined) { result.fontFamily = style.font_family; fields.push("fontFamily"); }
  if (style.font_size !== undefined) { result.fontSize = pt(style.font_size); fields.push("fontSize"); }
  if (style.color !== undefined) { result.foregroundColor = { opaqueColor: { rgbColor: rgb(style.color) } }; fields.push("foregroundColor"); }
  if (style.background_color !== undefined) { result.backgroundColor = { opaqueColor: { rgbColor: rgb(style.background_color) } }; fields.push("backgroundColor"); }
  if (style.bold !== undefined) { result.bold = style.bold; fields.push("bold"); }
  if (style.italic !== undefined) { result.italic = style.italic; fields.push("italic"); }
  if (style.underline !== undefined) { result.underline = style.underline; fields.push("underline"); }
  if (style.strikethrough !== undefined) { result.strikethrough = style.strikethrough; fields.push("strikethrough"); }
  if (style.small_caps !== undefined) { result.smallCaps = style.small_caps; fields.push("smallCaps"); }
  if (style.baseline_offset !== undefined) { result.baselineOffset = style.baseline_offset; fields.push("baselineOffset"); }
  if (style.link_url !== undefined) { result.link = { url: style.link_url }; fields.push("link"); }
  return { style: result, fields };
}

function makeParagraphStyle(style: TextStyleInput): { style: slides_v1.Schema$ParagraphStyle; fields: string[] } {
  const result: slides_v1.Schema$ParagraphStyle = {};
  const fields: string[] = [];
  if (style.align !== undefined) { result.alignment = style.align; fields.push("alignment"); }
  if (style.line_spacing !== undefined) { result.lineSpacing = style.line_spacing; fields.push("lineSpacing"); }
  if (style.space_before !== undefined) { result.spaceAbove = pt(style.space_before); fields.push("spaceAbove"); }
  if (style.space_after !== undefined) { result.spaceBelow = pt(style.space_after); fields.push("spaceBelow"); }
  return { style: result, fields };
}

function textRange(startIndex?: number, endIndex?: number): slides_v1.Schema$Range {
  return startIndex !== undefined && endIndex !== undefined ? { startIndex, endIndex } : { type: "ALL" };
}

function appendTextStyle(
  requests: slides_v1.Schema$Request[],
  objectId: string,
  input: TextStyleInput,
  options: { range?: slides_v1.Schema$Range; paragraph?: boolean; shape?: boolean } = {},
): void {
  const range = options.range || { type: "ALL" };
  const { style, fields } = makeTextStyle(input);
  if (fields.length) requests.push({ updateTextStyle: { objectId, textRange: range, style, fields: fields.join(",") } });
  if (options.paragraph !== false) {
    const paragraph = makeParagraphStyle(input);
    if (paragraph.fields.length) requests.push({ updateParagraphStyle: { objectId, textRange: range, style: paragraph.style, fields: paragraph.fields.join(",") } });
    if (input.remove_bullets) requests.push({ deleteParagraphBullets: { objectId, textRange: range } });
    else if (input.bullets) requests.push({ createParagraphBullets: { objectId, textRange: range, bulletPreset: input.bullets } });
  }
  if (options.shape !== false && input.vertical_anchor !== undefined) {
    requests.push({ updateShapeProperties: { objectId, shapeProperties: { contentAlignment: input.vertical_anchor }, fields: "contentAlignment" } });
  }
}

function outlineProperties(input: { outline_color?: string; outline_weight?: number; outline_alpha?: number; outline_dash_style?: string }): { outline: slides_v1.Schema$Outline; fields: string[] } {
  const outline: slides_v1.Schema$Outline = {};
  const fields: string[] = [];
  if (input.outline_color !== undefined) {
    outline.outlineFill = { solidFill: solidFill(input.outline_color, input.outline_alpha ?? 1) };
    fields.push("outlineFill.solidFill");
  } else if (input.outline_alpha !== undefined) {
    outline.outlineFill = { solidFill: { alpha: input.outline_alpha } };
    fields.push("outlineFill.solidFill.alpha");
  }
  if (input.outline_weight !== undefined) { outline.weight = pt(input.outline_weight); fields.push("weight"); }
  if (input.outline_dash_style !== undefined) { outline.dashStyle = input.outline_dash_style; fields.push("dashStyle"); }
  if (fields.length) { outline.propertyState = "RENDERED"; fields.push("propertyState"); }
  return { outline, fields };
}

function shapeStyleRequest(objectId: string, input: ShapeStyleInput): slides_v1.Schema$Request | undefined {
  const shapeProperties: slides_v1.Schema$ShapeProperties = {};
  const fields: string[] = [];
  if (input.fill_color !== undefined) {
    shapeProperties.shapeBackgroundFill = { solidFill: solidFill(input.fill_color, input.alpha ?? 1) };
    fields.push("shapeBackgroundFill.solidFill");
  }
  const outline = outlineProperties(input);
  if (outline.fields.length) { shapeProperties.outline = outline.outline; fields.push(...outline.fields.map((field) => `outline.${field}`)); }
  if (input.link_url !== undefined) { shapeProperties.link = { url: input.link_url }; fields.push("link"); }
  if (input.content_alignment !== undefined) { shapeProperties.contentAlignment = input.content_alignment; fields.push("contentAlignment"); }
  return fields.length ? { updateShapeProperties: { objectId, shapeProperties, fields: fields.join(",") } } : undefined;
}

function imageStyleRequest(objectId: string, input: ImageStyleInput): slides_v1.Schema$Request {
  const imageProperties: slides_v1.Schema$ImageProperties = {};
  const fields: string[] = [];
  if (input.link_url !== undefined) { imageProperties.link = { url: input.link_url }; fields.push("link"); }
  const outline = outlineProperties(input);
  if (outline.fields.length) { imageProperties.outline = outline.outline; fields.push(...outline.fields.map((field) => `outline.${field}`)); }
  return { updateImageProperties: { objectId, imageProperties, fields: fields.join(",") } };
}

function googleDriveImageUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

function insertionRequests(requests: slides_v1.Schema$Request[], objectId: string, text: string, style?: TextStyleInput, runs?: Array<{ text: string; style: TextStyleInput }>): void {
  if (runs?.length) {
    requests.push({ insertText: { objectId, text: runs.map((run) => run.text).join(""), insertionIndex: 0 } });
    let offset = 0;
    for (const run of runs) {
      appendTextStyle(requests, objectId, run.style, {
        range: { startIndex: offset, endIndex: offset + run.text.length }, paragraph: false, shape: false,
      });
      offset += run.text.length;
    }
  } else if (text) {
    requests.push({ insertText: { objectId, text, insertionIndex: 0 } });
  }
  if (style) appendTextStyle(requests, objectId, style);
}

function tableCellStyleRequests(requests: slides_v1.Schema$Request[], tableId: string, row: number, column: number, style: {
  fill_color?: string; text_color?: string; bold?: boolean; font_size?: number; align?: string;
}): void {
  if (style.fill_color !== undefined) {
    requests.push({ updateTableCellProperties: {
      objectId: tableId,
      tableRange: { location: { rowIndex: row, columnIndex: column }, rowSpan: 1, columnSpan: 1 },
      tableCellProperties: { tableCellBackgroundFill: { solidFill: solidFill(style.fill_color) } },
      fields: "tableCellBackgroundFill.solidFill",
    } });
  }
  const textStyle: slides_v1.Schema$TextStyle = {};
  const textFields: string[] = [];
  if (style.text_color !== undefined) { textStyle.foregroundColor = { opaqueColor: { rgbColor: rgb(style.text_color) } }; textFields.push("foregroundColor"); }
  if (style.bold !== undefined) { textStyle.bold = style.bold; textFields.push("bold"); }
  if (style.font_size !== undefined) { textStyle.fontSize = pt(style.font_size); textFields.push("fontSize"); }
  if (textFields.length) {
    requests.push({ updateTextStyle: { objectId: tableId, textRange: { type: "ALL" }, style: textStyle, fields: textFields.join(",") } });
  }
  if (style.align !== undefined) {
    requests.push({ updateParagraphStyle: { objectId: tableId, textRange: { type: "ALL" }, style: { alignment: style.align }, fields: "alignment" } });
  }
}

/** Compile a validated, typed editing operation into Slides API requests. */
export function compileSlideEdits(operations: SlideEditOperation[]): { requests: slides_v1.Schema$Request[]; createdIds: Array<{ operation: number; objectId: string }> } {
  const requests: slides_v1.Schema$Request[] = [];
  const createdIds: Array<{ operation: number; objectId: string }> = [];
  operations.forEach((op, operation) => {
    switch (op.type) {
      case "add_slide": {
        const objectId = newObjectId();
        createdIds.push({ operation, objectId });
        const layoutReference = op.layout_id ? { layoutId: op.layout_id } : { predefinedLayout: op.layout || "BLANK" };
        requests.push({ createSlide: { objectId, insertionIndex: op.index, slideLayoutReference: layoutReference } });
        break;
      }
      case "delete_slide": requests.push({ deleteObject: { objectId: op.slide_id } }); break;
      case "duplicate_slide": requests.push({ duplicateObject: { objectId: op.slide_id } }); break;
      case "move_slide": requests.push({ updateSlidesPosition: { slideObjectIds: [op.slide_id], insertionIndex: op.index } }); break;
      case "copy_slide": throw new Error("copy_slide requires the service (cross-presentation copy)");
      case "align_elements":
      case "distribute_elements": throw new Error(`${op.type} requires the service (element geometry lookup)`);
      case "add_text_box":
      case "add_shape": {
        const objectId = newObjectId();
        createdIds.push({ operation, objectId });
        const transform = op.type === "add_shape" && op.rotation !== undefined
          ? rotationTransform(op.x, op.y, op.width, op.height, op.rotation)
          : { scaleX: 1, scaleY: 1, translateX: op.x, translateY: op.y, unit: "PT" };
        requests.push({ createShape: {
          objectId,
          shapeType: op.type === "add_text_box" ? "TEXT_BOX" : op.shape,
          elementProperties: {
            pageObjectId: op.slide_id,
            size: { width: pt(op.width), height: pt(op.height) },
            transform,
          },
        } });
        if (op.type === "add_text_box") {
          insertionRequests(requests, objectId, op.text || "", op.style, op.runs);
        } else {
          if (op.text) insertionRequests(requests, objectId, op.text, op.text_style);
          if (op.fill_color !== undefined || op.alpha !== undefined || op.outline_color !== undefined || op.outline_weight !== undefined || op.outline_alpha !== undefined || op.outline_dash_style !== undefined || op.link_url !== undefined) {
            const style = shapeStyleRequest(objectId, {
              type: "style_shape", element_id: objectId, fill_color: op.fill_color, alpha: op.alpha,
              outline_color: op.outline_color, outline_weight: op.outline_weight, outline_alpha: op.outline_alpha,
              outline_dash_style: op.outline_dash_style, link_url: op.link_url,
            });
            if (style) requests.push(style);
          }
        }
        break;
      }
      case "add_image": {
        const objectId = newObjectId();
        createdIds.push({ operation, objectId });
        const transform = op.rotation !== undefined
          ? rotationTransform(op.x, op.y, op.width, op.height, op.rotation)
          : { scaleX: 1, scaleY: 1, translateX: op.x, translateY: op.y, unit: "PT" };
        requests.push({ createImage: {
          objectId,
          url: op.url || googleDriveImageUrl(op.drive_file_id as string),
          elementProperties: {
            pageObjectId: op.slide_id,
            size: { width: pt(op.width), height: pt(op.height) },
            transform,
          },
        } });
        if (op.alt_text !== undefined || op.title !== undefined) {
          requests.push({ updatePageElementAltText: {
            objectId,
            ...(op.title !== undefined ? { title: op.title } : {}),
            ...(op.alt_text !== undefined ? { description: op.alt_text } : {}),
          } });
        }
        break;
      }
      case "add_table": {
        const objectId = newObjectId();
        createdIds.push({ operation, objectId });
        requests.push({ createTable: {
          objectId,
          rows: op.rows,
          columns: op.columns,
          elementProperties: {
            pageObjectId: op.slide_id,
            size: { width: pt(op.width), height: pt(op.height) },
            transform: { scaleX: 1, scaleY: 1, translateX: op.x, translateY: op.y, unit: "PT" },
          },
        } });
        if (op.cells) {
          op.cells.forEach((rowValues, row) => rowValues.forEach((text, column) => {
            if (text) requests.push({ insertText: { objectId, text, insertionIndex: 0, cellLocation: { rowIndex: row, columnIndex: column } } });
          }));
        }
        op.cell_styles?.forEach((rowStyles, row) => rowStyles.forEach((style, column) => {
          tableCellStyleRequests(requests, objectId, row, column, style);
        }));
        if (op.header_row) {
          for (let column = 0; column < op.columns; column++) {
            tableCellStyleRequests(requests, objectId, 0, column, {
              fill_color: op.header_fill_color, text_color: op.text_color,
              bold: op.bold ?? true, font_size: op.font_size, align: op.align,
            });
          }
          for (let row = 1; row < op.rows; row++) {
            for (let column = 0; column < op.columns; column++) {
              tableCellStyleRequests(requests, objectId, row, column, {
                fill_color: op.body_fill_color, text_color: op.text_color,
                bold: op.bold, font_size: op.font_size, align: op.align,
              });
            }
          }
        } else if (op.body_fill_color !== undefined || op.text_color !== undefined || op.bold !== undefined || op.font_size !== undefined || op.align !== undefined) {
          for (let row = 0; row < op.rows; row++) {
            for (let column = 0; column < op.columns; column++) {
              tableCellStyleRequests(requests, objectId, row, column, {
                fill_color: op.body_fill_color, text_color: op.text_color,
                bold: op.bold, font_size: op.font_size, align: op.align,
              });
            }
          }
        }
        if (op.border_color !== undefined || op.border_weight !== undefined) {
          const tableBorderProperties: slides_v1.Schema$TableBorderProperties = {};
          const fields: string[] = [];
          if (op.border_color !== undefined) { tableBorderProperties.tableBorderFill = { solidFill: solidFill(op.border_color) }; fields.push("tableBorderFill.solidFill"); }
          if (op.border_weight !== undefined) { tableBorderProperties.weight = pt(op.border_weight); fields.push("weight"); }
          requests.push({ updateTableBorderProperties: { objectId, tableBorderProperties, fields: fields.join(",") } });
        }
        break;
      }
      case "replace_text":
        requests.push({ deleteText: { objectId: op.element_id, textRange: { type: "ALL" } } });
        if (op.text) requests.push({ insertText: { objectId: op.element_id, text: op.text, insertionIndex: 0 } });
        break;
      case "style_text":
        appendTextStyle(requests, op.element_id, op.style, { range: textRange(op.start_index, op.end_index) });
        break;
      case "style_shape": {
        const shapeStyle = shapeStyleRequest(op.element_id, op);
        if (shapeStyle) requests.push(shapeStyle);
        if (op.text_style) appendTextStyle(requests, op.element_id, op.text_style);
        break;
      }
      case "style_image": requests.push(imageStyleRequest(op.element_id, op)); break;
      case "set_background": {
        const pageBackgroundFill: slides_v1.Schema$PageBackgroundFill = op.image_url || op.drive_file_id
          ? { stretchedPictureFill: { contentUrl: op.image_url || googleDriveImageUrl(op.drive_file_id as string) } }
          : { solidFill: op.color ? solidFill(op.color) : { color: { themeColor: op.theme_color } } };
        const field = op.image_url || op.drive_file_id ? "pageBackgroundFill.stretchedPictureFill" : "pageBackgroundFill.solidFill";
        requests.push({ updatePageProperties: { objectId: op.slide_id, pageProperties: { pageBackgroundFill }, fields: field } });
        break;
      }
      case "add_notes": throw new Error("add_notes requires the service (notes page lookup)");
      case "link_element": throw new Error("link_element requires the service (element kind lookup)");
      case "set_alt_text": requests.push({ updatePageElementAltText: {
        objectId: op.element_id,
        ...(op.title !== undefined ? { title: op.title } : {}),
        ...(op.description !== undefined ? { description: op.description } : {}),
      } }); break;
      case "group_elements": {
        const objectId = op.group_id || newObjectId();
        createdIds.push({ operation, objectId });
        requests.push({ groupObjects: { groupObjectId: objectId, childrenObjectIds: op.element_ids } });
        break;
      }
      case "ungroup_elements": requests.push({ ungroupObjects: { objectIds: [op.group_id] } }); break;
      case "z_order": requests.push({ updatePageElementsZOrder: { pageElementObjectIds: op.element_ids, operation: op.operation } }); break;
      case "move_element": requests.push({ updatePageElementTransform: { objectId: op.element_id, applyMode: "RELATIVE", transform: { scaleX: 1, scaleY: 1, translateX: op.x, translateY: op.y, unit: "PT" } } }); break;
      case "transform_element": {
        const transform = op.rotation !== undefined
          ? { ...rotationTransform(op.x, op.y, 1, 1, op.rotation, op.scale_x, op.scale_y) }
          : { scaleX: op.scale_x, scaleY: op.scale_y, translateX: op.x, translateY: op.y, unit: "PT" };
        requests.push({ updatePageElementTransform: { objectId: op.element_id, applyMode: "ABSOLUTE", transform } });
        break;
      }
      case "delete_element": requests.push({ deleteObject: { objectId: op.element_id } }); break;
    }
  });
  return { requests, createdIds };
}

// Types for slide media content
export interface SlideImage {
  contentUrl: string;
  sourceUrl?: string;
  description?: string;
  width?: number;
  height?: number;
  base64Data?: string;
  mimeType?: string;
}

export interface SlideVideo {
  videoUrl: string;
  source: "YOUTUBE" | "DRIVE" | "UNKNOWN";
  videoId?: string;
}

export interface SlideChart {
  chartId: string;
  spreadsheetId?: string;
  description: string;
}

export interface SlideContent {
  slideNumber: number;
  objectId: string;
  text: string;
  speakerNotes: string;
  images: SlideImage[];
  videos: SlideVideo[];
  charts: SlideChart[];
  shapes: string[];
}

export interface PresentationContent {
  id: string;
  title: string;
  slideCount: number;
  slides: SlideContent[];
}

export class GoogleSlidesService {
  private slides: slides_v1.Slides;
  private drive: ReturnType<typeof google.drive>;
  private script: ReturnType<typeof google.script>;

  constructor(auth: GoogleAuth) {
    this.slides = google.slides({
      version: "v1",
      auth: auth as Parameters<typeof google.slides>[0]["auth"],
    });
    this.drive = google.drive({
      version: "v3",
      auth: auth as Parameters<typeof google.drive>[0]["auth"],
    });
    this.script = google.script({ version: "v1", auth: auth as Parameters<typeof google.script>[0]["auth"] });
  }

  async createPresentation(title: string, pageSize?: { width: number; height: number }): Promise<{ id: string; title: string; url: string }> {
    const response = await this.slides.presentations.create({
      requestBody: {
        title,
        ...(pageSize ? { pageSize: { width: pt(pageSize.width), height: pt(pageSize.height) } } : {}),
      },
    });
    const id = response.data.presentationId;
    if (!id) throw new Error("Google did not return a presentation ID");
    return { id, title: response.data.title || title, url: getPresentationUrl(id) };
  }

  async inspectPresentation(presentationId: string): Promise<unknown> {
    const { data } = await this.slides.presentations.get({ presentationId });
    const describeElement = (element: slides_v1.Schema$PageElement): unknown => ({
      id: element.objectId, size: element.size, transform: element.transform,
      placeholder: element.shape?.placeholder || element.image?.placeholder,
      shape: element.shape && { type: element.shape.shapeType, text: element.shape.text, properties: element.shape.shapeProperties },
      image: element.image ? { sourceUrl: element.image.sourceUrl, properties: element.image.imageProperties } : undefined,
      line: element.line && { type: element.line.lineType, category: element.line.lineCategory, properties: element.line.lineProperties },
      video: element.video && { source: element.video.source, id: element.video.id, properties: element.video.videoProperties },
      table: element.table, group: element.elementGroup?.children?.map(describeElement),
      title: element.title, description: element.description,
    });
    const describePage = (page: slides_v1.Schema$Page, index?: number) => ({
      id: page.objectId, index, name: page.layoutProperties?.name, displayName: page.layoutProperties?.displayName,
      type: page.pageType, properties: page.pageProperties, elements: (page.pageElements || []).map(describeElement),
    });
    return {
      id: data.presentationId, title: data.title, revisionId: data.revisionId, pageSize: data.pageSize,
      slides: (data.slides || []).map((slide, index) => describePage(slide, index)),
      layouts: (data.layouts || []).map((layout) => describePage(layout)),
      masters: (data.masters || []).map((master) => describePage(master)),
    };
  }

  async editPresentation(presentationId: string, operations: SlideEditOperation[], revisionId?: string): Promise<unknown> {
    // Operations that need element/page metadata are resolved before the
    // atomic batch is sent. Everything else is compiled directly.
    const needsInspection = operations.some((op) =>
      op.type === "delete_slide" || op.type === "delete_element" || op.type === "add_notes" ||
      op.type === "link_element" || op.type === "copy_slide" ||
      op.type === "align_elements" || op.type === "distribute_elements" ||
      (op.type === "transform_element" && op.rotation !== undefined)
    );
    const presentation = needsInspection
      ? (await this.slides.presentations.get({ presentationId })).data
      : undefined;
    if (presentation) revisionId ||= presentation.revisionId || undefined;

    const slideIds = new Set((presentation?.slides || []).map((slide) => slide.objectId));
    const elementIds = new Set<string>();
    if (presentation) {
      const collect = (elements: slides_v1.Schema$PageElement[]) => {
        for (const element of elements) {
          if (element.objectId) elementIds.add(element.objectId);
          collect(element.elementGroup?.children || []);
        }
      };
      for (const slide of presentation.slides || []) collect(slide.pageElements || []);
    }
    for (const op of operations) {
      if (op.type === "delete_slide" && presentation && !slideIds.has(op.slide_id)) throw new Error("delete_slide requires a slide ID from this presentation");
      if (op.type === "add_notes" && presentation && !slideIds.has(op.slide_id)) throw new Error("add_notes requires a slide ID from this presentation");
      if (op.type === "delete_element" && presentation && !elementIds.has(op.element_id)) throw new Error("delete_element requires an element ID from this presentation");
    }

    const requests: slides_v1.Schema$Request[] = [];
    const createdIds: Array<{ operation: number; objectId: string }> = [];
    const warnings: string[] = [];

    for (let operation = 0; operation < operations.length; operation++) {
      const op = operations[operation];
      if (op.type === "copy_slide") {
        const copied = await this.buildCopySlideRequests(op);
        requests.push(...copied.requests);
        createdIds.push({ operation, objectId: copied.slideId });
        warnings.push(...copied.warnings);
      } else if (op.type === "add_notes") {
        requests.push(this.buildAddNotesRequest(presentation, op.slide_id, op.text));
      } else if (op.type === "link_element") {
        requests.push(this.buildLinkRequest(this.findElement(presentation, op.element_id), op.element_id, op.url));
      } else if (op.type === "align_elements") {
        requests.push(...this.buildAlignRequests(presentation, op.element_ids, op.alignment));
      } else if (op.type === "distribute_elements") {
        requests.push(...this.buildDistributeRequests(presentation, op.element_ids, op.axis));
      } else if (op.type === "transform_element" && op.rotation !== undefined) {
        const element = this.findElement(presentation, op.element_id);
        const toPt = (dimension: slides_v1.Schema$Dimension | null | undefined) => (dimension?.magnitude || 1) / (dimension?.unit === "EMU" ? 12700 : 1);
        const width = toPt(element?.size?.width);
        const height = toPt(element?.size?.height);
        const transform = rotationTransform(op.x, op.y, width, height, op.rotation, op.scale_x, op.scale_y);
        requests.push({ updatePageElementTransform: { objectId: op.element_id, applyMode: "ABSOLUTE", transform } });
      } else {
        const compiled = compileSlideEdits([op]);
        requests.push(...compiled.requests);
        compiled.createdIds.forEach((created) => createdIds.push({ operation, objectId: created.objectId }));
      }
    }

    if (!requests.length) return { createdIds, replies: [], warnings };
    const { data } = await this.slides.presentations.batchUpdate({ presentationId, requestBody: {
      requests, ...(revisionId ? { writeControl: { requiredRevisionId: revisionId } } : {}),
    } });
    return { createdIds, replies: data.replies, writeControl: data.writeControl, ...(warnings.length ? { warnings } : {}) };
  }

  private findElement(presentation: slides_v1.Schema$Presentation | undefined, elementId: string): slides_v1.Schema$PageElement | undefined {
    const visit = (elements: slides_v1.Schema$PageElement[]): slides_v1.Schema$PageElement | undefined => {
      for (const element of elements) {
        if (element.objectId === elementId) return element;
        const child = visit(element.elementGroup?.children || []);
        if (child) return child;
      }
      return undefined;
    };
    for (const slide of presentation?.slides || []) {
      const found = visit(slide.pageElements || []);
      if (found) return found;
    }
    return undefined;
  }

  private buildAddNotesRequest(presentation: slides_v1.Schema$Presentation | undefined, slideId: string, text: string): slides_v1.Schema$Request {
    const slide = (presentation?.slides || []).find((item) => item.objectId === slideId);
    const notesPage = slide?.slideProperties?.notesPage;
    if (!notesPage) throw new Error("add_notes could not find the slide's notes page");
    const body = notesPage.pageElements?.find((element) => element.shape?.placeholder?.type === "BODY")
      || notesPage.pageElements?.find((element) => element.shape?.text);
    if (!body?.objectId) throw new Error("add_notes could not find the notes text box");
    const existing = body.shape?.text?.textElements || [];
    const end = existing.reduce((max, element) => Math.max(max, element.endIndex || 0), 0);
    const value = end > 0 ? `${text.startsWith("\n") ? "" : "\n"}${text}` : text;
    return { insertText: { objectId: body.objectId, text: value, insertionIndex: end } };
  }

  private buildLinkRequest(element: slides_v1.Schema$PageElement | undefined, elementId: string, url: string): slides_v1.Schema$Request {
    if (element?.image) return { updateImageProperties: { objectId: elementId, imageProperties: { link: { url } }, fields: "link" } };
    if (element?.line) return { updateLineProperties: { objectId: elementId, lineProperties: { link: { url } }, fields: "link" } };
    if (element?.video) throw new Error("Google Slides does not support hyperlinks on video elements");
    return { updateShapeProperties: { objectId: elementId, shapeProperties: { link: { url } }, fields: "link" } };
  }

  private elementBounds(presentation: slides_v1.Schema$Presentation | undefined, elementId: string): { id: string; x: number; y: number; width: number; height: number } | undefined {
    const element = this.findElement(presentation, elementId);
    if (!element) return undefined;
    const toEmu = (value: number | null | undefined, unit: string | null | undefined) => (value || 0) * (unit === "PT" ? 12700 : 1);
    const transform = element.transform;
    const size = element.size;
    const width = Math.abs(toEmu(size?.width?.magnitude, size?.width?.unit) * (transform?.scaleX ?? 1));
    const height = Math.abs(toEmu(size?.height?.magnitude, size?.height?.unit) * (transform?.scaleY ?? 1));
    return {
      id: elementId,
      x: toEmu(transform?.translateX, transform?.unit),
      y: toEmu(transform?.translateY, transform?.unit),
      width,
      height,
    };
  }

  private translationRequest(id: string, x: number, y: number): slides_v1.Schema$Request {
    return { updatePageElementTransform: { objectId: id, applyMode: "RELATIVE", transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "EMU" } } };
  }

  private buildAlignRequests(presentation: slides_v1.Schema$Presentation | undefined, elementIds: string[], alignment: string): slides_v1.Schema$Request[] {
    const boxes = elementIds.map((id) => this.elementBounds(presentation, id));
    if (boxes.some((box) => !box)) throw new Error("align_elements requires element IDs from this presentation");
    const present = boxes as Array<NonNullable<typeof boxes[number]>>;
    const left = Math.min(...present.map((box) => box.x));
    const right = Math.max(...present.map((box) => box.x + box.width));
    const top = Math.min(...present.map((box) => box.y));
    const bottom = Math.max(...present.map((box) => box.y + box.height));
    return present.map((box) => {
      let dx = 0;
      let dy = 0;
      if (alignment === "LEFT") dx = left - box.x;
      else if (alignment === "RIGHT") dx = right - (box.x + box.width);
      else if (alignment === "CENTER") dx = (left + right) / 2 - (box.x + box.width / 2);
      else if (alignment === "TOP") dy = top - box.y;
      else if (alignment === "BOTTOM") dy = bottom - (box.y + box.height);
      else if (alignment === "MIDDLE") dy = (top + bottom) / 2 - (box.y + box.height / 2);
      return this.translationRequest(box.id, dx, dy);
    });
  }

  private buildDistributeRequests(presentation: slides_v1.Schema$Presentation | undefined, elementIds: string[], axis: string): slides_v1.Schema$Request[] {
    const boxes = elementIds.map((id) => this.elementBounds(presentation, id));
    if (boxes.some((box) => !box)) throw new Error("distribute_elements requires element IDs from this presentation");
    const present = boxes as Array<NonNullable<typeof boxes[number]>>;
    const horizontal = axis === "HORIZONTAL";
    const sorted = [...present].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = horizontal ? last.x + last.width - first.x : last.y + last.height - first.y;
    const total = sorted.reduce((sum, box) => sum + (horizontal ? box.width : box.height), 0);
    const gap = (span - total) / (sorted.length - 1);
    let cursor = horizontal ? first.x : first.y;
    return sorted.map((box) => {
      const dx = horizontal ? cursor - box.x : 0;
      const dy = horizontal ? 0 : cursor - box.y;
      cursor += (horizontal ? box.width : box.height) + gap;
      return this.translationRequest(box.id, dx, dy);
    });
  }

  /**
   * Upload a local file to Drive. With share_anyone the file becomes readable by
   * anyone with the link so the Slides createImage endpoint can fetch it.
   */
  async uploadDriveFile(args: { file_path: string; name?: string; share_anyone: boolean }): Promise<{ id: string; name: string; webViewLink?: string; image_url: string }> {
    if (!isAbsolute(args.file_path)) throw new Error("File path must be absolute and accessible to the MCP server");
    const info = await stat(args.file_path);
    if (!info.isFile() || info.size === 0) throw new Error("File must be a non-empty regular file");
    const name = args.name || args.file_path.split("/").pop() || "upload";
    const media = { mimeType: guessMimeType(args.file_path), body: createReadStream(args.file_path) };
    const created = await this.drive.files.create({ requestBody: { name }, media, fields: "id,name,webViewLink" });
    const id = created.data.id;
    if (!id) throw new Error("Google Drive did not return a file ID");
    if (args.share_anyone) {
      await this.drive.permissions.create({ fileId: id, requestBody: { role: "reader", type: "anyone" } });
    }
    return { id, name: created.data.name || name, webViewLink: created.data.webViewLink || undefined, image_url: googleDriveImageUrl(id) };
  }

  private scriptDeploymentId(): string | undefined {
    return (process.env.GOOGLE_SLIDES_SCRIPT_DEPLOYMENT_ID || process.env.GOOGLE_SLIDES_IMAGE_SCRIPT_DEPLOYMENT_ID)?.trim() || undefined;
  }

  /**
   * Cross-presentation slide copy. The Apps Script helper can copy the slide
   * losslessly (including layouts and images); without it, the source slide is
   * read and recreated in the target presentation.
   */
  async copySlide(args: { target_presentation_id: string; source_presentation_id: string; source_slide_id: string; index?: number }): Promise<unknown> {
    const deploymentId = this.scriptDeploymentId();
    const warnings: string[] = [];
    if (deploymentId) {
      try {
        const response = await this.script.scripts.run({
          scriptId: deploymentId,
          requestBody: { function: "copySlideFromPresentation", parameters: [args.source_presentation_id, args.source_slide_id, args.target_presentation_id, args.index ?? null] },
        }, { timeout: 380000 });
        if (response.data.error) {
          const detail = response.data.error.details?.[0] as { errorMessage?: string } | undefined;
          throw new Error(detail?.errorMessage || response.data.error.message || "unknown script error");
        }
        const result = response.data.response?.result as { objectId?: unknown } | undefined;
        if (typeof result?.objectId === "string" && result.objectId) {
          return { slideId: result.objectId, method: "apps_script", warnings };
        }
        throw new Error("Apps Script copy returned no slide ID");
      } catch (error) {
        warnings.push(`Apps Script copy failed; recreated the slide instead. ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const copied = await this.buildCopySlideRequests({
      type: "copy_slide",
      source_presentation_id: args.source_presentation_id,
      source_slide_id: args.source_slide_id,
      index: args.index,
    });
    const { data } = await this.slides.presentations.batchUpdate({
      presentationId: args.target_presentation_id,
      requestBody: { requests: copied.requests },
    });
    return { slideId: copied.slideId, method: "recreated", replies: data.replies, warnings: [...warnings, ...copied.warnings] };
  }

  private async buildCopySlideRequests(op: Extract<SlideEditOperation, { type: "copy_slide" }>): Promise<{ slideId: string; requests: slides_v1.Schema$Request[]; warnings: string[] }> {
    const { data: source } = await this.slides.presentations.get({ presentationId: op.source_presentation_id });
    const slide = (source.slides || []).find((item) => item.objectId === op.source_slide_id);
    if (!slide) throw new Error("copy_slide source slide not found in the source presentation");
    const slideId = newObjectId();
    const requests: slides_v1.Schema$Request[] = [{ createSlide: { objectId: slideId, insertionIndex: op.index, slideLayoutReference: { predefinedLayout: "BLANK" } } }];
    const warnings: string[] = [];
    const background = slide.pageProperties?.pageBackgroundFill;
    if (background?.solidFill) {
      requests.push({ updatePageProperties: {
        objectId: slideId,
        pageProperties: { pageBackgroundFill: { solidFill: background.solidFill } },
        fields: "pageBackgroundFill.solidFill",
      } });
    } else if (background?.stretchedPictureFill?.contentUrl) {
      requests.push({ updatePageProperties: {
        objectId: slideId,
        pageProperties: { pageBackgroundFill: { stretchedPictureFill: { contentUrl: background.stretchedPictureFill.contentUrl } } },
        fields: "pageBackgroundFill.stretchedPictureFill",
      } });
    }
    for (const element of slide.pageElements || []) {
      await this.clonePageElement(element, slideId, requests, warnings);
    }
    return { slideId, requests, warnings };
  }

  private async clonePageElement(element: slides_v1.Schema$PageElement, slideId: string, requests: slides_v1.Schema$Request[], warnings: string[]): Promise<string | undefined> {
    const objectId = newObjectId();
    const elementProperties: slides_v1.Schema$PageElementProperties = {
      pageObjectId: slideId,
      ...(element.size ? { size: element.size } : {}),
      ...(element.transform ? { transform: element.transform } : {}),
    };
    if (element.shape) {
      const shapeType = element.shape.shapeType || "RECTANGLE";
      requests.push({ createShape: { objectId, shapeType, elementProperties } });
      const text = (element.shape.text?.textElements || [])
        .filter((item) => item.textRun?.content)
        .map((item) => item.textRun?.content || "").join("");
      if (text) {
        requests.push({ insertText: { objectId, text, insertionIndex: 0 } });
        for (const item of element.shape.text?.textElements || []) {
          if (!item.textRun?.style) continue;
          const fields = Object.keys(item.textRun.style).join(",");
          if (!fields) continue;
          requests.push({ updateTextStyle: { objectId, textRange: { startIndex: item.startIndex ?? 0, endIndex: item.endIndex ?? 0 }, style: item.textRun.style, fields } });
        }
        for (const item of element.shape.text?.textElements || []) {
          if (!item.paragraphMarker?.style) continue;
          const fields = Object.keys(item.paragraphMarker.style).join(",");
          if (!fields) continue;
          requests.push({ updateParagraphStyle: { objectId, textRange: { startIndex: item.startIndex ?? 0, endIndex: item.endIndex ?? 0 }, style: item.paragraphMarker.style, fields } });
        }
      }
      const properties = element.shape.shapeProperties;
      if (properties && (properties.shapeBackgroundFill || properties.outline)) {
        const shapeProperties: slides_v1.Schema$ShapeProperties = {};
        const fields: string[] = [];
        if (properties.shapeBackgroundFill) { shapeProperties.shapeBackgroundFill = properties.shapeBackgroundFill; fields.push("shapeBackgroundFill"); }
        if (properties.outline) { shapeProperties.outline = properties.outline; fields.push("outline"); }
        requests.push({ updateShapeProperties: { objectId, shapeProperties, fields: fields.join(",") } });
      }
      return objectId;
    }
    if (element.image) {
      const url = element.image.sourceUrl;
      if (!url) { warnings.push("Skipped an image without a source URL; use add_slide_image for local or private images."); return undefined; }
      requests.push({ createImage: { objectId, url, elementProperties } });
      return objectId;
    }
    if (element.line) {
      requests.push({ createLine: { objectId, category: element.line.lineCategory || "STRAIGHT", elementProperties } });
      return objectId;
    }
    if (element.table) {
      requests.push({ createTable: { objectId, rows: element.table.rows || 1, columns: element.table.columns || 1, elementProperties } });
      (element.table.tableRows || []).forEach((row, rowIndex) => (row.tableCells || []).forEach((cell, columnIndex) => {
        const text = (cell.text?.textElements || []).map((item) => item.textRun?.content || "").join("");
        if (text) requests.push({ insertText: { objectId, text, insertionIndex: 0, cellLocation: { rowIndex, columnIndex } } });
      }));
      return objectId;
    }
    if (element.video) {
      requests.push({ createVideo: { objectId, id: element.video.id || undefined, source: element.video.source || undefined, elementProperties } });
      return objectId;
    }
    if (element.elementGroup?.children?.length) {
      const childIds: string[] = [];
      for (const child of element.elementGroup.children) {
        const childId = await this.clonePageElement(child, slideId, requests, warnings);
        if (childId) childIds.push(childId);
      }
      const groupable = element.elementGroup.children.every((child) => child.shape || child.image || child.line);
      if (childIds.length && groupable) requests.push({ groupObjects: { groupObjectId: objectId, childrenObjectIds: childIds } });
      else if (childIds.length) warnings.push("Flattened a group containing elements that Google Slides cannot group.");
      return childIds.length ? childIds[0] : undefined;
    }
    warnings.push(`Skipped unsupported element type${element.sheetsChart ? " (Sheets chart)" : element.wordArt ? " (Word Art)" : ""}.`);
    return undefined;
  }

  async getSlidePreview(presentationId: string, slideId: string): Promise<{ data: string; mimeType: string }> {
    const { data } = await this.slides.presentations.pages.getThumbnail({ presentationId, pageObjectId: slideId, "thumbnailProperties.mimeType": "PNG", "thumbnailProperties.thumbnailSize": "LARGE" });
    if (!data.contentUrl) throw new Error("Google did not return a slide thumbnail");
    const response = await fetch(data.contentUrl);
    if (!response.ok) throw new Error(`Could not download slide thumbnail (${response.status})`);
    return { data: Buffer.from(await response.arrayBuffer()).toString("base64"), mimeType: "image/png" };
  }

  async addSlideImage(args: { presentation_id: string; slide_id: string; file_path: string; x: number; y: number; width: number; height: number }): Promise<{ objectId: string }> {
    const deploymentId = process.env.GOOGLE_SLIDES_IMAGE_SCRIPT_DEPLOYMENT_ID?.trim();
    if (!deploymentId) throw new Error("Private image helper is not configured. See the Google Slides section of google-workspace-mcp/README.md.");
    if (!isAbsolute(args.file_path)) throw new Error("Image path must be absolute and accessible to the MCP server");
    const info = await stat(args.file_path);
    if (!info.isFile() || info.size === 0 || info.size > MAX_IMAGE_BYTES) throw new Error("Image must be a non-empty regular file of at most 3 MiB");
    const bytes = await readFile(args.file_path);
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("Image exceeds 3 MiB");
    const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "image/jpeg"
      : ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")) ? "image/gif" : null;
    if (!mimeType) throw new Error("Image must be PNG, JPEG, or GIF");
    let data: script_v1.Schema$Operation;
    try {
      const response = await this.script.scripts.run({ scriptId: deploymentId, requestBody: { function: "insertPrivateSlideImage", parameters: [args.presentation_id, args.slide_id, bytes.toString("base64"), mimeType, args.x, args.y, args.width, args.height] } }, { timeout: 380000 });
      data = response.data;
    } catch (error) {
      // Never propagate the HTTP request or its base64 image payload to logs.
      const status = (error as { response?: { status?: number } })?.response?.status;
      throw new Error(`Private image helper request failed${status ? ` (HTTP ${status})` : ""}. Check deployment, OAuth consent, and Apps Script API setup.`);
    }
    if (data.error) {
      const detail = data.error.details?.[0] as { errorMessage?: string } | undefined;
      throw new Error(`Private image helper failed: ${detail?.errorMessage || data.error.message || "unknown script error"}`);
    }
    const result = data.response?.result as { objectId?: unknown } | undefined;
    if (typeof result?.objectId !== "string" || !result.objectId) throw new Error("Private image helper returned no image ID");
    return { objectId: result.objectId };
  }

  /**
   * List recent presentations from Google Drive
   */
  async listPresentations(maxResults: number = 10): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
    try {
      logger.debug(`Listing presentations (max: ${maxResults})`);

      const response = await this.drive.files.list({
        q: "mimeType='application/vnd.google-apps.presentation'",
        pageSize: maxResults,
        fields: "files(id, name, modifiedTime)",
        orderBy: "modifiedTime desc",
      });

      const files = response.data.files || [];
      return files.map((file) => ({
        id: file.id || "",
        name: file.name || "Untitled",
        modifiedTime: file.modifiedTime || "",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list presentations: ${message}`);
    }
  }

  /**
   * Search presentations by name
   */
  async searchPresentations(
    query: string,
    maxResults: number = 10
  ): Promise<Array<{ id: string; name: string; modifiedTime: string }>> {
    try {
      logger.debug(`Searching presentations: ${query}`);

      const response = await this.drive.files.list({
        q: `mimeType='application/vnd.google-apps.presentation' and name contains '${query.replace(/'/g, "\\'")}'`,
        pageSize: maxResults,
        fields: "files(id, name, modifiedTime)",
        orderBy: "modifiedTime desc",
      });

      const files = response.data.files || [];
      return files.map((file) => ({
        id: file.id || "",
        name: file.name || "Untitled",
        modifiedTime: file.modifiedTime || "",
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to search presentations: ${message}`);
    }
  }

  /**
   * Get a presentation by ID with full content including media
   * @param presentationId - The presentation ID
   * @param options.includeImageData - If true, downloads and includes base64-encoded image data
   */
  async getPresentation(
    presentationId: string,
    options: { includeImageData?: boolean; slideNumbers?: number[] } = {}
  ): Promise<PresentationContent> {
    try {
      logger.debug(`Getting presentation: ${presentationId}`);

      const response = await this.slides.presentations.get({
        presentationId,
      });

      const presentation = response.data;
      const slides = presentation.slides || [];

      const extractedSlides: SlideContent[] = [];

      for (let index = 0; index < slides.length; index++) {
        const slide = slides[index];
        const content = this.extractAllContent(slide);

        // Download image data if requested. Page-limited reads only fetch
        // images for the requested window so pagination actually saves work.
        const inWindow =
          !options.slideNumbers || options.slideNumbers.includes(index + 1);

        if (options.includeImageData && inWindow && content.images.length > 0) {
          for (const image of content.images) {
            if (image.contentUrl) {
              const imageData = await this.downloadImage(image.contentUrl);
              if (imageData) {
                image.base64Data = imageData.base64;
                image.mimeType = imageData.mimeType;
              }
            }
          }
        }

        extractedSlides.push({
          slideNumber: index + 1,
          objectId: slide.objectId || "",
          text: content.text,
          speakerNotes: this.extractSpeakerNotes(slide),
          images: content.images,
          videos: content.videos,
          charts: content.charts,
          shapes: content.shapes,
        });
      }

      logger.info(`Retrieved presentation: ${presentationId} (${slides.length} slides)`);

      return {
        id: presentation.presentationId || presentationId,
        title: presentation.title || "Untitled",
        slideCount: slides.length,
        slides: extractedSlides,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to get presentation: ${message}`);
    }
  }

  /**
   * Download an image from a Google URL and return base64 data
   */
  private async downloadImage(
    contentUrl: string
  ): Promise<{ base64: string; mimeType: string } | null> {
    try {
      // Get access token from the auth client
      const authClient = this.slides as unknown as { auth: { getAccessToken: () => Promise<{ token?: string | null }> } };
      const tokenResponse = await authClient.auth.getAccessToken();
      const accessToken = tokenResponse.token;

      if (!accessToken) {
        logger.debug("No access token available for image download");
        return null;
      }

      // Fetch the image with authentication
      const response = await fetch(contentUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        logger.debug(`Failed to download image: ${response.status}`);
        return null;
      }

      const contentType = response.headers.get("content-type") || "image/png";
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");

      return {
        base64,
        mimeType: contentType,
      };
    } catch (error) {
      logger.debug(`Error downloading image: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Helper: Extract all content from a slide (text, images, videos, charts, shapes)
   */
  private extractAllContent(slide: slides_v1.Schema$Page): {
    text: string;
    images: SlideImage[];
    videos: SlideVideo[];
    charts: SlideChart[];
    shapes: string[];
  } {
    const textParts: string[] = [];
    const images: SlideImage[] = [];
    const videos: SlideVideo[] = [];
    const charts: SlideChart[] = [];
    const shapes: string[] = [];

    if (!slide.pageElements) {
      return { text: "", images: [], videos: [], charts: [], shapes: [] };
    }

    for (const element of slide.pageElements) {
      // Extract text from shapes
      if (element.shape?.text?.textElements) {
        const shapeText = this.extractTextFromTextElements(element.shape.text.textElements);
        if (shapeText.trim()) {
          textParts.push(shapeText);
        }
      }

      // Extract non-text shapes (drawings, lines, etc.)
      if (element.shape?.shapeType && !element.shape?.text?.textElements?.length) {
        const shapeType = element.shape.shapeType;
        if (shapeType !== "TEXT_BOX" && shapeType !== "RECTANGLE") {
          shapes.push(shapeType);
        }
      }

      // Extract tables
      if (element.table?.tableRows) {
        const tableText = this.extractTableAsMarkdown(element.table);
        if (tableText.trim()) {
          textParts.push(tableText);
        }
      }

      // Extract images
      if (element.image) {
        const image = this.extractImage(element);
        if (image) {
          images.push(image);
        }
      }

      // Extract videos
      if (element.video) {
        const video = this.extractVideo(element);
        if (video) {
          videos.push(video);
        }
      }

      // Extract charts (embedded from Sheets)
      if (element.sheetsChart) {
        const chart = this.extractChart(element);
        if (chart) {
          charts.push(chart);
        }
      }

      // Extract content from groups (recursive)
      if (element.elementGroup?.children) {
        for (const child of element.elementGroup.children) {
          const childContent = this.extractAllContent({ pageElements: [child] } as slides_v1.Schema$Page);
          textParts.push(childContent.text);
          images.push(...childContent.images);
          videos.push(...childContent.videos);
          charts.push(...childContent.charts);
          shapes.push(...childContent.shapes);
        }
      }
    }

    return {
      text: textParts.filter(t => t.trim()).join("\n\n"),
      images,
      videos,
      charts,
      shapes: [...new Set(shapes)], // Deduplicate shapes
    };
  }

  /**
   * Helper: Extract image data from a page element
   */
  private extractImage(element: slides_v1.Schema$PageElement): SlideImage | null {
    if (!element.image) return null;

    const image = element.image;
    const size = element.size;

    return {
      contentUrl: image.contentUrl || "",
      sourceUrl: image.sourceUrl || undefined,
      description: element.description || undefined,
      width: size?.width?.magnitude ?? undefined,
      height: size?.height?.magnitude ?? undefined,
    };
  }

  /**
   * Helper: Extract video data from a page element
   */
  private extractVideo(element: slides_v1.Schema$PageElement): SlideVideo | null {
    if (!element.video) return null;

    const video = element.video;
    let source: "YOUTUBE" | "DRIVE" | "UNKNOWN" = "UNKNOWN";
    let videoUrl = "";

    if (video.source === "YOUTUBE") {
      source = "YOUTUBE";
      videoUrl = video.id ? `https://www.youtube.com/watch?v=${video.id}` : "";
    } else if (video.source === "DRIVE") {
      source = "DRIVE";
      videoUrl = video.id ? `https://drive.google.com/file/d/${video.id}/view` : "";
    }

    return {
      videoUrl,
      source,
      videoId: video.id || undefined,
    };
  }

  /**
   * Helper: Extract chart data from a page element
   */
  private extractChart(element: slides_v1.Schema$PageElement): SlideChart | null {
    if (!element.sheetsChart) return null;

    const chart = element.sheetsChart;

    return {
      chartId: chart.chartId?.toString() || "",
      spreadsheetId: chart.spreadsheetId || undefined,
      description: element.description || "Embedded chart from Google Sheets",
    };
  }

  /**
   * Helper: Extract speaker notes from a slide
   */
  private extractSpeakerNotes(slide: slides_v1.Schema$Page): string {
    if (!slide.slideProperties?.notesPage?.pageElements) return "";

    for (const element of slide.slideProperties.notesPage.pageElements) {
      if (element.shape?.shapeType === "TEXT_BOX" && element.shape.text?.textElements) {
        const notesText = this.extractTextFromTextElements(element.shape.text.textElements);
        if (notesText.trim()) {
          return notesText.trim();
        }
      }
    }

    return "";
  }

  /**
   * Helper: Extract text from text elements array
   */
  private extractTextFromTextElements(textElements: slides_v1.Schema$TextElement[]): string {
    let text = "";

    for (const element of textElements) {
      if (element.textRun?.content) {
        text += element.textRun.content;
      }
    }

    return text;
  }

  /**
   * Helper: Extract table content as markdown table
   */
  private extractTableAsMarkdown(table: slides_v1.Schema$Table): string {
    if (!table.tableRows || table.tableRows.length === 0) return "";

    const rows: string[][] = [];

    for (const tableRow of table.tableRows) {
      const rowCells: string[] = [];
      if (tableRow.tableCells) {
        for (const cell of tableRow.tableCells) {
          let cellText = "";
          if (cell.text?.textElements) {
            cellText = this.extractTextFromTextElements(cell.text.textElements);
          }
          // Clean up cell text: trim and replace newlines with spaces
          rowCells.push(cellText.trim().replace(/\n/g, " "));
        }
      }
      rows.push(rowCells);
    }

    if (rows.length === 0) return "";

    // Build markdown table
    let markdown = "\n";

    // First row as header
    const headerRow = rows[0];
    markdown += "| " + headerRow.join(" | ") + " |\n";

    // Header separator
    markdown += "| " + headerRow.map(() => "---").join(" | ") + " |\n";

    // Data rows (skip first row since it's the header)
    for (let i = 1; i < rows.length; i++) {
      markdown += "| " + rows[i].join(" | ") + " |\n";
    }

    markdown += "\n";
    return markdown;
  }
}

function guessMimeType(filePath: string): string {
  const extension = filePath.toLowerCase().split(".").pop();
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
    csv: "text/csv", txt: "text/plain", json: "application/json",
  } as Record<string, string>)[extension || ""] || "application/octet-stream";
}

/**
 * Get presentation URL from ID
 */
export function getPresentationUrl(presentationId: string): string {
  return `https://docs.google.com/presentation/d/${presentationId}/edit`;
}

// ---------------------------------------------------------------------------
// Inspection summaries
//
// `inspect_presentation` returns raw element JSON, which is dominated by text
// styles and border tables. The summary keeps the fields needed to plan an
// edit — IDs, element types, shape types and text previews — and drops the
// rest. Callers can request `detail: "full"` when they need everything.
// ---------------------------------------------------------------------------

function textFromTextContent(content: any): string {
  return (content?.textElements || [])
    .map((element: any) => element.textRun?.content || "")
    .join("");
}

export function summarizeInspectionElement(element: any): unknown {
  const type = element.shape
    ? "shape"
    : element.image
      ? "image"
      : element.table
        ? "table"
        : element.line
          ? "line"
          : element.video
            ? "video"
            : Array.isArray(element.group)
              ? "group"
              : "element";

  const text = element.shape?.text
    ? textFromTextContent(element.shape.text).replace(/\s+/g, " ").trim()
    : "";

  return {
    id: element.id,
    type,
    ...(element.shape?.type ? { shape_type: element.shape.type } : {}),
    ...(element.title ? { title: element.title } : {}),
    ...(element.placeholder ? { placeholder: element.placeholder } : {}),
    ...(text ? { text: text.length > 300 ? `${text.slice(0, 299)}…` : text } : {}),
    ...(element.table
      ? { table: { rows: element.table.rows, columns: element.table.columns } }
      : {}),
    ...(Array.isArray(element.group)
      ? { children: element.group.map((child: any) => child.id) }
      : {}),
  };
}

export function summarizeInspectionSlide(slide: any): unknown {
  return {
    id: slide.id,
    index: slide.index,
    ...(slide.name ? { name: slide.name } : {}),
    ...(slide.type ? { type: slide.type } : {}),
    elements: (slide.elements || []).map(summarizeInspectionElement),
  };
}
