/**
 * Google Workspace Comments Service
 *
 * Comments are routed to the API that owns the file:
 *
 * - Docs, Slides and Sheets expose native, anchor-aware comment endpoints
 *   (`insertComment` and friends). These produce comments that the editor
 *   actually highlights, unlike Drive-created comments, which Workspace
 *   editors always treat as unanchored.
 * - Any other Drive file (PDF, image, …) falls back to the Drive API.
 *
 * The file type is detected once per session from the Drive mimeType, so the
 * tools keep a single `file_id` surface with no extra parameter.
 */

import { google } from "googleapis";
import type { docs_v1, drive_v3, sheets_v4, slides_v1 } from "googleapis";

import { logger } from "./logger.js";
import { MetadataCache } from "./metadata-cache.js";
import type {
  GoogleAuth,
  FileComment,
  CommentReply,
  CommentFileKind,
  CommentAnchorInput,
  ListCommentsParams,
  ListCommentsResult,
} from "./types.js";

/**
 * Only request the fields we render. Avatars and permission lists are large and
 * never used by the compact formatter.
 */
const COMMENT_FIELDS =
  "nextPageToken,comments(id,author(displayName),content,createdTime,modifiedTime,resolved,quotedFileContent(value),anchor,deleted,replies(id,author(displayName),content,createdTime,action))";

const MAX_CONTENT_CHARS = 400;
const MAX_QUOTED_CHARS = 120;
const MAX_REPLIES_SHOWN = 3;
const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Native comment shapes
//
// The installed googleapis typings predate native comment support, so the new
// request/response shapes are described locally and passed through as unknown.
// ---------------------------------------------------------------------------

interface NativePost {
  postId?: string;
  content?: string;
  createTime?: string;
  updateTime?: string;
  commentAction?: string;
  author?: { displayName?: string };
}

interface NativeThread {
  commentId?: string;
  anchorId?: string;
  plainTextQuote?: string;
  status?: string;
  headPost?: NativePost;
  replies?: NativePost[];
}

interface TextRun {
  text: string;
  startIndex: number;
}

function truncate(text: string, limit: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  if (singleLine.length <= limit) {
    return singleLine;
  }
  return `${singleLine.slice(0, limit - 1)}…`;
}

function mapReply(reply: drive_v3.Schema$Reply): CommentReply {
  return {
    id: reply.id || "",
    author: reply.author?.displayName || "Unknown",
    content: reply.content || "",
    createdTime: reply.createdTime || "",
    action: reply.action || undefined,
  };
}

function mapDriveComment(comment: drive_v3.Schema$Comment): FileComment {
  return {
    id: comment.id || "",
    author: comment.author?.displayName || "Unknown",
    content: comment.content || "",
    createdTime: comment.createdTime || "",
    modifiedTime: comment.modifiedTime || undefined,
    resolved: comment.resolved || false,
    quotedText: comment.quotedFileContent?.value || undefined,
    anchor: comment.anchor || undefined,
    deleted: comment.deleted || undefined,
    replies: (comment.replies || []).map(mapReply),
  };
}

function mapNativeThread(thread: NativeThread): FileComment {
  return {
    id: thread.commentId || "",
    author: thread.headPost?.author?.displayName || "Unknown",
    content: thread.headPost?.content || "",
    createdTime: thread.headPost?.createTime || "",
    modifiedTime: thread.headPost?.updateTime || undefined,
    resolved: thread.status === "RESOLVED",
    quotedText: thread.plainTextQuote || undefined,
    anchorId: thread.anchorId || undefined,
    postId: thread.headPost?.postId || undefined,
    replies: (thread.replies || []).map((post) => ({
      id: post.postId || "",
      author: post.author?.displayName || "Unknown",
      content: post.content || "",
      createdTime: post.createTime || "",
      action:
        post.commentAction && post.commentAction !== "NO_COMMENT_ACTION_CHANGE"
          ? post.commentAction.toLowerCase()
          : undefined,
    })),
  };
}

/**
 * Render comments as a compact, model-friendly block.
 *
 * Bodies and quotes are truncated so a long thread cannot monopolise context;
 * callers can page with `page_token` when they need the rest.
 */
export function formatComments(fileId: string, result: ListCommentsResult): string {
  const { comments, nextPageToken } = result;

  if (comments.length === 0) {
    return nextPageToken
      ? `No matching comments on file \`${fileId}\` in this page. More pages exist — pass \`page_token: "${nextPageToken}"\` to continue.`
      : `No matching comments found on file \`${fileId}\`.`;
  }

  const open = comments.filter((c) => !c.resolved).length;
  const resolved = comments.length - open;

  const rendered = comments.map((comment) => {
    const status = comment.deleted ? "deleted" : comment.resolved ? "resolved" : "open";
    const lines = [
      `- \`${comment.id}\` · **${comment.author}** · ${status} · ${comment.createdTime}`,
    ];

    if (comment.quotedText) {
      lines.push(`  > "${truncate(comment.quotedText, MAX_QUOTED_CHARS)}"`);
    }

    lines.push(`  ${truncate(comment.content, MAX_CONTENT_CHARS)}`);

    const replies = comment.replies.filter((r) => !r.action);
    for (const reply of replies.slice(0, MAX_REPLIES_SHOWN)) {
      lines.push(`  - **${reply.author}**: ${truncate(reply.content, MAX_CONTENT_CHARS)}`);
    }
    if (replies.length > MAX_REPLIES_SHOWN) {
      const hidden = replies.length - MAX_REPLIES_SHOWN;
      lines.push(`  - …${hidden} more repl${hidden === 1 ? "y" : "ies"}`);
    }

    return lines.join("\n");
  });

  const header =
    `**Comments on \`${fileId}\`** — ${comments.length} shown ` +
    `(${open} open, ${resolved} resolved)`;

  const footer = nextPageToken
    ? `\n\n_More comments available. Pass \`page_token: "${nextPageToken}"\` to continue._`
    : "";

  return `${header}\n\n${rendered.join("\n\n")}${footer}`;
}

// ---------------------------------------------------------------------------
// Anchor helpers
// ---------------------------------------------------------------------------

function collectTextRuns(elements: unknown[], runs: TextRun[]): void {
  for (const raw of elements as Array<Record<string, any>>) {
    if (raw.paragraph) {
      for (const element of raw.paragraph.elements || []) {
        if (element.textRun?.content) {
          runs.push({ text: element.textRun.content, startIndex: element.startIndex ?? 0 });
        }
      }
    }
    if (raw.table) {
      for (const row of raw.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          collectTextRuns(cell.content || [], runs);
        }
      }
    }
    if (raw.tableOfContents) {
      collectTextRuns(raw.tableOfContents.content || [], runs);
    }
  }
}

function locateText(
  runs: TextRun[],
  needle: string
): { startIndex: number; endIndex: number } | undefined {
  let text = "";
  const indexMap: number[] = [];

  for (const run of runs) {
    for (let i = 0; i < run.text.length; i++) {
      text += run.text[i];
      indexMap.push(run.startIndex + i);
    }
  }

  const at = text.indexOf(needle);
  if (at < 0) {
    return undefined;
  }

  return {
    startIndex: indexMap[at],
    endIndex: indexMap[at + needle.length - 1] + 1,
  };
}

function columnToIndex(letters: string): number {
  let value = 0;
  for (const char of letters.toUpperCase()) {
    value = value * 26 + (char.charCodeAt(0) - 64);
  }
  return value - 1;
}

function parseCellRef(address: string): { rowIndex: number; columnIndex: number } {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(address.trim());
  if (!match) {
    throw new Error(`Invalid cell reference "${address}". Use A1 notation such as "B2".`);
  }
  return {
    columnIndex: columnToIndex(match[1]),
    rowIndex: parseInt(match[2], 10) - 1,
  };
}

function parseCell(cell: string): { sheetName?: string; rowIndex: number; columnIndex: number } {
  if (cell.includes(":")) {
    throw new Error(
      `Sheets comments anchor to a single cell, not a range. Use the top-left cell of "${cell}".`
    );
  }
  const [sheetName, address] = cell.includes("!") ? cell.split("!", 2) : [undefined, cell];
  return { sheetName, ...parseCellRef(address) };
}

function parseTableRange(
  cell: string,
  rowSpan?: number,
  columnSpan?: number
): {
  location: { rowIndex: number; columnIndex: number };
  rowSpan: number;
  columnSpan: number;
} {
  const [startRaw, endRaw] = cell.split(":");
  const start = parseCellRef(startRaw);
  const end = endRaw ? parseCellRef(endRaw) : start;

  if (end.rowIndex < start.rowIndex || end.columnIndex < start.columnIndex) {
    throw new Error(`Invalid table range "${cell}": end must be below and to the right of start`);
  }

  return {
    location: { rowIndex: start.rowIndex, columnIndex: start.columnIndex },
    rowSpan: rowSpan ?? end.rowIndex - start.rowIndex + 1,
    columnSpan: columnSpan ?? end.columnIndex - start.columnIndex + 1,
  };
}

function findTableCell(
  table: any,
  location: { rowIndex: number; columnIndex: number }
): any | undefined {
  for (const row of table.tableRows || []) {
    for (const cell of row.tableCells || []) {
      const cellLocation = cell.location;
      if (cellLocation) {
        if (
          cellLocation.rowIndex === location.rowIndex &&
          cellLocation.columnIndex === location.columnIndex
        ) {
          return cell;
        }
      }
    }
  }

  // Fallback for responses that omit cell.location: index by grid position.
  return table.tableRows?.[location.rowIndex]?.tableCells?.[location.columnIndex];
}

function collectTextContentRuns(textContent: any): TextRun[] {
  const runs: TextRun[] = [];
  for (const textElement of textContent?.textElements || []) {
    if (textElement.textRun?.content) {
      runs.push({
        text: textElement.textRun.content,
        startIndex: textElement.startIndex ?? 0,
      });
    }
  }
  return runs;
}

function isAnchorEmpty(anchor: CommentAnchorInput): boolean {
  return (
    anchor.quotedText === undefined &&
    anchor.startIndex === undefined &&
    anchor.objectId === undefined &&
    anchor.cell === undefined &&
    anchor.sheetId === undefined &&
    anchor.rawAnchor === undefined
  );
}

function describeAnchor(anchor: CommentAnchorInput): string {
  if (anchor.tableCell) {
    const text =
      anchor.quotedText !== undefined
        ? ` text "${truncate(anchor.quotedText, MAX_QUOTED_CHARS)}"`
        : anchor.startIndex !== undefined && anchor.endIndex !== undefined
          ? ` text ${anchor.startIndex}-${anchor.endIndex}`
          : "";
    return `table cell ${anchor.tableCell}${text}`;
  }
  if (anchor.quotedText) {
    return `text "${truncate(anchor.quotedText, MAX_QUOTED_CHARS)}"`;
  }
  if (anchor.startIndex !== undefined && anchor.endIndex !== undefined) {
    return `range ${anchor.startIndex}-${anchor.endIndex}`;
  }
  if (anchor.cell) {
    return `cell ${anchor.cell}`;
  }
  if (anchor.objectId) {
    return `object ${anchor.objectId}`;
  }
  if (anchor.sheetId !== undefined) {
    return `sheet ${anchor.sheetId} row ${anchor.rowIndex ?? 0} column ${anchor.columnIndex ?? 0}`;
  }
  return "the file";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class GoogleCommentsService {
  private drive: drive_v3.Drive;
  private docs: docs_v1.Docs;
  private slides: slides_v1.Slides;
  private sheets: sheets_v4.Sheets;

  // A file's mimeType never changes (conversion creates a new file ID), so the
  // kind cache never expires — only the LRU cap applies.
  private kindCache = new MetadataCache<CommentFileKind>({ ttlMs: 0, maxEntries: 1000 });

  // Sheet titles can change; a short TTL keeps A1 resolution correct without
  // re-fetching spreadsheet metadata on every anchored comment.
  private sheetIndex = new MetadataCache<Array<{ sheetId: number; title: string }>>({
    ttlMs: 60_000,
  });

  constructor(auth: GoogleAuth) {
    const castAuth = auth as Parameters<typeof google.drive>[0]["auth"];
    this.drive = google.drive({ version: "v3", auth: castAuth });
    this.docs = google.docs({ version: "v1", auth: castAuth });
    this.slides = google.slides({ version: "v1", auth: castAuth });
    this.sheets = google.sheets({ version: "v4", auth: castAuth });
  }

  /**
   * Resolve which API owns the file. Cached: a file's kind never changes.
   */
  async detectKind(fileId: string): Promise<CommentFileKind> {
    try {
      return await this.kindCache.get(fileId, async () => {
        const response = await this.drive.files.get({ fileId, fields: "mimeType" });
        return kindFromMimeType(response.data.mimeType || "");
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to determine file type for ${fileId}: ${message}`);
    }
  }

  // -- Read ------------------------------------------------------------------

  async list(fileId: string, params: ListCommentsParams): Promise<ListCommentsResult> {
    const kind = await this.detectKind(fileId);
    const comments =
      kind === "drive"
        ? undefined
        : (await this.listNative(kind, fileId)).filter((comment) =>
            matchesStatus(comment, params.status)
          );

    if (!comments) {
      return this.listDrive(fileId, params);
    }

    return {
      comments: comments.slice(0, params.maxComments),
      nextPageToken: undefined,
    };
  }

  private async listNative(kind: CommentFileKind, fileId: string): Promise<FileComment[]> {
    try {
      if (kind === "doc") {
        const response = await (this.docs.documents.get as (params: unknown) => Promise<any>)({
          documentId: fileId,
          includeTabsContent: true,
          suggestionsViewMode: "SUGGESTIONS_INLINE",
          commentsViewMode: "COMMENTS_VIEW_MODE_INCLUDED",
          fields: "comments",
        });
        return (response.data.comments || []).map(mapNativeThread);
      }

      if (kind === "slides") {
        const response = await (this.slides.presentations.get as (params: unknown) => Promise<any>)(
          {
            presentationId: fileId,
            commentsViewMode: "COMMENTS_VIEW_MODE_INCLUDED",
            fields: "comments",
          }
        );
        return (response.data.comments || []).map(mapNativeThread);
      }

      const response = await (this.sheets.spreadsheets.get as (params: unknown) => Promise<any>)({
        spreadsheetId: fileId,
        commentsViewMode: "COMMENTS_VIEW_MODE_INCLUDED",
        fields: "comments",
      });
      return (response.data.comments || []).map(mapNativeThread);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list comments: ${message}`);
    }
  }

  private async listDrive(
    fileId: string,
    params: ListCommentsParams
  ): Promise<ListCommentsResult> {
    const collected: FileComment[] = [];
    let pageToken = params.pageToken;
    let nextPageToken: string | undefined;

    try {
      do {
        const remaining = params.maxComments - collected.length;
        const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, remaining));

        logger.debug(`Listing Drive comments for ${fileId} (pageSize=${pageSize})`);

        const response = await this.drive.comments.list({
          fileId,
          pageSize,
          pageToken,
          includeDeleted: params.includeDeleted,
          fields: COMMENT_FIELDS,
        });

        for (const raw of response.data.comments || []) {
          const comment = mapDriveComment(raw);
          if (matchesStatus(comment, params.status)) {
            collected.push(comment);
          }
          if (collected.length >= params.maxComments) {
            break;
          }
        }

        nextPageToken = response.data.nextPageToken || undefined;
        if (collected.length >= params.maxComments) {
          break;
        }
        pageToken = nextPageToken;
      } while (nextPageToken);

      return { comments: collected, nextPageToken };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to list comments: ${message}`);
    }
  }

  // -- Create ----------------------------------------------------------------

  /**
   * Create a comment. On Docs/Slides/Sheets the comment is anchored with the
   * editor's native anchor, so it is highlighted in the document like a
   * manually created comment.
   */
  async create(
    fileId: string,
    content: string,
    anchor: CommentAnchorInput = {},
    assigneeEmail?: string
  ): Promise<FileComment> {
    const kind = await this.detectKind(fileId);

    if (kind === "drive") {
      return this.createDrive(fileId, content, anchor);
    }

    try {
      if (kind === "doc") {
        const range = await this.resolveDocRange(fileId, anchor);
        const response = await (this.docs.documents.batchUpdate as (params: unknown) => Promise<any>)(
          {
            documentId: fileId,
            requestBody: {
              requests: [
                {
                  insertComment: {
                    content,
                    range,
                    assigneeEmailAddress: assigneeEmail,
                  },
                },
              ],
            },
          }
        );
        return this.readInsertedThread(response.data, fileId, content);
      }

      if (kind === "slides") {
        const request = await this.buildSlidesAnchor(fileId, anchor, content, assigneeEmail);
        const response = await (
          this.slides.presentations.batchUpdate as (params: unknown) => Promise<any>
        )({
          presentationId: fileId,
          requestBody: { requests: [{ insertComment: request }] },
        });
        return this.readInsertedThread(response.data, fileId, content);
      }

      const request = await this.buildSheetsAnchor(fileId, anchor, content, assigneeEmail);
      const response = await (
        this.sheets.spreadsheets.batchUpdate as (params: unknown) => Promise<any>
      )({
        spreadsheetId: fileId,
        requestBody: { requests: [{ insertComment: request }] },
      });
      return this.readInsertedThread(response.data, fileId, content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create comment: ${message}`);
    }
  }

  private async createDrive(
    fileId: string,
    content: string,
    anchor: CommentAnchorInput
  ): Promise<FileComment> {
    try {
      if (anchor.rawAnchor) {
        try {
          JSON.parse(anchor.rawAnchor);
        } catch {
          throw new Error("anchor must be a valid JSON string");
        }
      }

      const response = await this.drive.comments.create({
        fileId,
        fields: `id,author(displayName),content,createdTime,resolved,quotedFileContent(value),anchor`,
        requestBody: {
          content,
          quotedFileContent: anchor.quotedText ? { value: anchor.quotedText } : undefined,
          anchor: anchor.rawAnchor,
        },
      });

      return mapDriveComment(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create comment: ${message}`);
    }
  }

  private readInsertedThread(data: any, fileId: string, content: string): FileComment {
    const thread: NativeThread | undefined =
      data?.replies?.[0]?.insertComment?.commentThread ??
      data?.replies?.[0]?.insertComment?.comment;

    if (thread) {
      return mapNativeThread(thread);
    }

    // Some responses omit the thread; return a minimal echo so callers still
    // get the content they asked for.
    logger.debug(`insertComment response for ${fileId} did not include the thread`);
    return { id: "", author: "me", content, createdTime: "", resolved: false, replies: [] };
  }

  private async resolveDocRange(
    fileId: string,
    anchor: CommentAnchorInput
  ): Promise<Record<string, unknown> | undefined> {
    if (anchor.startIndex !== undefined && anchor.endIndex !== undefined) {
      const range: Record<string, unknown> = {
        startIndex: anchor.startIndex,
        endIndex: anchor.endIndex,
      };
      if (anchor.tabId) {
        range.tabId = anchor.tabId;
      }
      return range;
    }

    if (!anchor.quotedText) {
      return undefined;
    }

    const response = await (this.docs.documents.get as (params: unknown) => Promise<any>)({
      documentId: fileId,
      includeTabsContent: true,
    });

    const tabs: any[] = response.data.tabs || [];
    for (const tab of flattenTabs(tabs)) {
      const runs: TextRun[] = [];
      collectTextRuns(tab.documentTab?.body?.content || [], runs);
      const located = locateText(runs, anchor.quotedText);
      if (located) {
        return {
          ...located,
          tabId: tab.tabProperties?.tabId,
        };
      }
    }

    throw new Error(
      `Could not find quoted text in the document: "${truncate(anchor.quotedText, MAX_QUOTED_CHARS)}". Pass start_index/end_index instead.`
    );
  }

  private async buildSlidesAnchor(
    fileId: string,
    anchor: CommentAnchorInput,
    content: string,
    assigneeEmail?: string
  ): Promise<Record<string, unknown>> {
    const request: Record<string, unknown> = {
      content,
      assigneeEmailAddress: assigneeEmail,
    };

    if (anchor.tableCell) {
      return this.buildSlidesTableAnchor(fileId, anchor, request);
    }

    if (anchor.objectId) {
      let range: { startIndex: number; endIndex: number } | undefined;

      if (anchor.startIndex !== undefined && anchor.endIndex !== undefined) {
        range = { startIndex: anchor.startIndex, endIndex: anchor.endIndex };
      } else if (anchor.quotedText) {
        const response = await (this.slides.presentations.get as (params: unknown) => Promise<any>)(
          { presentationId: fileId }
        );
        const element = findSlidesElement(response.data, anchor.objectId);
        if (!element) {
          throw new Error(`No slide or element with object ID ${anchor.objectId}`);
        }
        if (element.table) {
          throw new Error(
            `object ${anchor.objectId} is a table; pass table_cell (e.g. "B2") to anchor inside it`
          );
        }
        const runs: TextRun[] = collectSlidesTextRuns(element);
        range = locateText(runs, anchor.quotedText);
        if (!range) {
          throw new Error(
            `Could not find quoted text in element ${anchor.objectId}: "${truncate(anchor.quotedText, MAX_QUOTED_CHARS)}"`
          );
        }
      }

      if (range) {
        request.shapeTextAnchor = {
          objectId: anchor.objectId,
          textRange: { type: "FIXED_RANGE", ...range },
        };
      } else {
        request.objectId = anchor.objectId;
      }
    }

    return request;
  }

  /**
   * Slides table anchors come in two flavours:
   *
   * - `tableAnchor` covers a rectangular cell range and highlights the cells.
   * - `tableCellTextAnchor` covers text inside one cell and highlights the
   *   characters, mirroring how a comment inside a table cell behaves in the
   *   Slides editor.
   */
  private async buildSlidesTableAnchor(
    fileId: string,
    anchor: CommentAnchorInput,
    request: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!anchor.objectId) {
      throw new Error("table_cell requires object_id of the table");
    }

    const parsed = parseTableRange(anchor.tableCell!, anchor.rowSpan, anchor.columnSpan);
    const hasTextRange =
      anchor.startIndex !== undefined && anchor.endIndex !== undefined;

    const response = await (this.slides.presentations.get as (params: unknown) => Promise<any>)({
      presentationId: fileId,
    });
    const element = findSlidesElement(response.data, anchor.objectId);
    if (!element?.table) {
      throw new Error(`object ${anchor.objectId} is not a table`);
    }

    const table = element.table;
    if (
      (typeof table.rows === "number" &&
        parsed.location.rowIndex + parsed.rowSpan > table.rows) ||
      (typeof table.columns === "number" &&
        parsed.location.columnIndex + parsed.columnSpan > table.columns)
    ) {
      throw new Error(
        `Table range ${anchor.tableCell} is outside the ${table.rows}x${table.columns} table ${anchor.objectId}`
      );
    }

    const cell = findTableCell(table, parsed.location);
    if (!cell) {
      throw new Error(
        `No table cell at row ${parsed.location.rowIndex}, column ${parsed.location.columnIndex} in ${anchor.objectId}`
      );
    }

    if (!hasTextRange && !anchor.quotedText) {
      request.tableAnchor = {
        objectId: anchor.objectId,
        tableRange: {
          location: parsed.location,
          rowSpan: parsed.rowSpan,
          columnSpan: parsed.columnSpan,
        },
      };
      return request;
    }

    let textRange: { startIndex: number; endIndex: number };

    if (hasTextRange) {
      textRange = { startIndex: anchor.startIndex!, endIndex: anchor.endIndex! };
    } else {
      const runs = collectTextContentRuns(cell.text);
      const located = locateText(runs, anchor.quotedText!);
      if (!located) {
        throw new Error(
          `Could not find quoted text in table cell ${anchor.tableCell}: "${truncate(anchor.quotedText!, MAX_QUOTED_CHARS)}"`
        );
      }
      textRange = located;
    }

    request.tableCellTextAnchor = {
      objectId: anchor.objectId,
      cellLocation: parsed.location,
      textRange: { type: "FIXED_RANGE", ...textRange },
    };
    return request;
  }

  private async buildSheetsAnchor(
    fileId: string,
    anchor: CommentAnchorInput,
    content: string,
    assigneeEmail?: string
  ): Promise<Record<string, unknown>> {
    if (anchor.quotedText !== undefined) {
      throw new Error(
        "Sheets comments anchor to a cell, not to text. Pass cell (e.g. \"Sheet1!B2\") or sheet_id/row_index/column_index."
      );
    }

    if (anchor.startIndex !== undefined || anchor.endIndex !== undefined) {
      throw new Error(
        "Text-range anchors are not supported for Sheets. Pass cell or sheet_id/row_index/column_index."
      );
    }

    const request: Record<string, unknown> = {
      content,
      assigneeEmailAddress: assigneeEmail,
    };

    let coordinate: Record<string, number> | undefined;

    if (
      anchor.sheetId !== undefined &&
      anchor.rowIndex !== undefined &&
      anchor.columnIndex !== undefined
    ) {
      coordinate = {
        sheetId: anchor.sheetId,
        rowIndex: anchor.rowIndex,
        columnIndex: anchor.columnIndex,
      };
    } else if (anchor.cell) {
      const parsed = parseCell(anchor.cell);
      const sheets = await this.sheetIndex.get(fileId, async () => {
        const response = await (this.sheets.spreadsheets.get as (params: unknown) => Promise<any>)({
          spreadsheetId: fileId,
          fields: "sheets(properties(sheetId,title))",
        });
        return (response.data.sheets || []).map((sheet: any) => ({
          sheetId: sheet.properties?.sheetId ?? 0,
          title: sheet.properties?.title ?? "",
        }));
      });

      const sheet = parsed.sheetName
        ? sheets.find((candidate) => candidate.title === parsed.sheetName)
        : sheets[0];

      if (!sheet) {
        throw new Error(`Sheet not found: ${parsed.sheetName ?? "(first sheet)"}`);
      }

      coordinate = {
        sheetId: sheet.sheetId,
        rowIndex: parsed.rowIndex,
        columnIndex: parsed.columnIndex,
      };
    }

    if (coordinate) {
      request.coordinate = coordinate;
    }

    return request;
  }

  // -- Mutations -------------------------------------------------------------

  async reply(fileId: string, commentId: string, content: string): Promise<CommentReply> {
    const kind = await this.detectKind(fileId);

    if (kind === "drive") {
      try {
        const response = await this.drive.replies.create({
          fileId,
          commentId,
          fields: "id,author(displayName),content,createdTime,action",
          requestBody: { content },
        });
        return mapReply(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to reply to comment ${commentId}: ${message}`);
      }
    }

    try {
      await this.batchNative(kind, fileId, [
        { addCommentReply: { commentId, post: { content } } },
      ]);
      return { id: "", author: "me", content, createdTime: "" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to reply to comment ${commentId}: ${message}`);
    }
  }

  async update(
    fileId: string,
    commentId: string,
    content: string,
    postId?: string
  ): Promise<FileComment> {
    const kind = await this.detectKind(fileId);

    if (kind === "drive") {
      try {
        const response = await this.drive.comments.update({
          fileId,
          commentId,
          fields: `id,author(displayName),content,createdTime,modifiedTime,resolved,quotedFileContent(value),anchor`,
          requestBody: { content },
        });
        return mapDriveComment(response.data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to update comment ${commentId}: ${message}`);
      }
    }

    try {
      const resolvedPostId = postId ?? (await this.findHeadPostId(kind, fileId, commentId));
      await this.batchNative(kind, fileId, [
        { updateCommentPost: { commentId, postId: resolvedPostId, content } },
      ]);
      return {
        id: commentId,
        author: "me",
        content,
        createdTime: "",
        resolved: false,
        postId: resolvedPostId,
        replies: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to update comment ${commentId}: ${message}`);
    }
  }

  /**
   * Resolve or reopen a thread. Native APIs express both as a reply post whose
   * `commentAction` is RESOLVE or REOPEN.
   */
  async setResolved(fileId: string, commentId: string, resolved: boolean): Promise<void> {
    const kind = await this.detectKind(fileId);
    const verb = resolved ? "resolve" : "reopen";

    if (kind === "drive") {
      try {
        await this.drive.replies.create({
          fileId,
          commentId,
          requestBody: { action: resolved ? "resolve" : "reopen" },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to ${verb} comment ${commentId}: ${message}`);
      }
      return;
    }

    try {
      await this.batchNative(kind, fileId, [
        {
          addCommentReply: {
            commentId,
            post: { commentAction: resolved ? "RESOLVE" : "REOPEN" },
          },
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to ${verb} comment ${commentId}: ${message}`);
    }
  }

  async delete(fileId: string, commentId: string): Promise<void> {
    const kind = await this.detectKind(fileId);

    if (kind === "drive") {
      try {
        await this.drive.comments.delete({ fileId, commentId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to delete comment ${commentId}: ${message}`);
      }
      return;
    }

    try {
      await this.batchNative(kind, fileId, [{ deleteComment: { commentId } }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to delete comment ${commentId}: ${message}`);
    }
  }

  private async batchNative(
    kind: CommentFileKind,
    fileId: string,
    requests: unknown[]
  ): Promise<void> {
    if (kind === "doc") {
      await (this.docs.documents.batchUpdate as (params: unknown) => Promise<any>)({
        documentId: fileId,
        requestBody: { requests },
      });
      return;
    }

    if (kind === "slides") {
      await (this.slides.presentations.batchUpdate as (params: unknown) => Promise<any>)({
        presentationId: fileId,
        requestBody: { requests },
      });
      return;
    }

    await (this.sheets.spreadsheets.batchUpdate as (params: unknown) => Promise<any>)({
      spreadsheetId: fileId,
      requestBody: { requests },
    });
  }

  private async findHeadPostId(
    kind: CommentFileKind,
    fileId: string,
    commentId: string
  ): Promise<string | undefined> {
    const comments = await this.listNative(kind, fileId);
    const thread = comments.find((comment) => comment.id === commentId);
    if (!thread) {
      throw new Error(`Comment ${commentId} not found on file ${fileId}`);
    }
    return thread.postId;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flattenTabs(tabs: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]) => {
    for (const tab of list || []) {
      out.push(tab);
      if (tab.childTabs?.length) {
        walk(tab.childTabs);
      }
    }
  };
  walk(tabs);
  return out;
}

function collectSlidesTextRuns(element: any): TextRun[] {
  const runs: TextRun[] = [];
  const shape = element.shape ?? element.table ?? undefined;
  const textElements = element.text?.textElements ?? shape?.text?.textElements ?? [];

  for (const textElement of textElements) {
    if (textElement.textRun?.content) {
      runs.push({
        text: textElement.textRun.content,
        startIndex: textElement.startIndex ?? 0,
      });
    }
  }
  return runs;
}

function findSlidesElement(presentation: any, objectId: string): any | undefined {
  for (const slide of presentation.slides || []) {
    if (slide.objectId === objectId) {
      return slide;
    }
    for (const element of slide.pageElements || []) {
      if (element.objectId === objectId) {
        return element;
      }
    }
  }
  return undefined;
}

function kindFromMimeType(mimeType: string): CommentFileKind {
  switch (mimeType) {
    case "application/vnd.google-apps.document":
      return "doc";
    case "application/vnd.google-apps.presentation":
      return "slides";
    case "application/vnd.google-apps.spreadsheet":
      return "sheets";
    default:
      return "drive";
  }
}

function matchesStatus(comment: FileComment, status: ListCommentsParams["status"]): boolean {
  if (status === "all") {
    return true;
  }
  return status === "open" ? !comment.resolved : comment.resolved;
}

export { isAnchorEmpty, describeAnchor };
