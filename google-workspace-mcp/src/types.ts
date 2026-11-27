/**
 * Type Definitions
 * Centralized TypeScript interfaces for the application
 */

import type { OAuth2Client } from "google-auth-library";
import type { calendar_v3 } from "googleapis";

// ============================================================================
// Authentication Types
// ============================================================================

export interface ServiceAccountCredentials {
  type: "service_account";
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

export interface OAuthInstalledCredentials {
  installed: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

export interface OAuthWebCredentials {
  web: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
}

export type OAuthCredentials = OAuthInstalledCredentials | OAuthWebCredentials;

export interface SavedToken {
  type: "authorized_user";
  client_id: string;
  client_secret: string;
  refresh_token: string;
}

export type GoogleAuth = OAuth2Client | ReturnType<typeof import("googleapis").google.auth.fromJSON>;

// ============================================================================
// Google Meet API Types
// ============================================================================

export interface MeetingSpace {
  name: string;
  meetingUri?: string;
  meetingCode?: string;
  config?: {
    accessType?: string;
    entryPointAccess?: string;
  };
}

export interface ConferenceRecord {
  name: string;
  startTime?: string;
  endTime?: string;
  expireTime?: string;
  space?: string;
}

export interface Participant {
  name: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: {
    user?: string;
    displayName?: string;
  };
  anonymousUser?: {
    displayName?: string;
  };
  phoneUser?: {
    displayName?: string;
  };
}

export interface Recording {
  name: string;
  state?: "STARTED" | "ENDED" | "FILE_GENERATED";
  startTime?: string;
  endTime?: string;
  driveDestination?: {
    file?: string;
    exportUri?: string;
  };
}

export interface Transcript {
  name: string;
  state?: "STARTED" | "ENDED" | "FILE_GENERATED";
  startTime?: string;
  endTime?: string;
  docsDestination?: {
    document?: string;
    exportUri?: string;
  };
}

export interface TranscriptEntry {
  name: string;
  participant?: string;
  text?: string;
  languageCode?: string;
  startTime?: string;
  endTime?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ListConferenceRecordsResponse {
  conferenceRecords?: ConferenceRecord[];
  nextPageToken?: string;
}

export interface ListParticipantsResponse {
  participants?: Participant[];
  nextPageToken?: string;
}

export interface ListRecordingsResponse {
  recordings?: Recording[];
  nextPageToken?: string;
}

export interface ListTranscriptsResponse {
  transcripts?: Transcript[];
  nextPageToken?: string;
}

export interface ListTranscriptEntriesResponse {
  transcriptEntries?: TranscriptEntry[];
  nextPageToken?: string;
}

// ============================================================================
// Calendar Types
// ============================================================================

export type CalendarEvent = calendar_v3.Schema$Event;

export interface MeetingEvent {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  start?: {
    dateTime?: string | null;
    date?: string | null;
    timeZone?: string | null;
  };
  end?: {
    dateTime?: string | null;
    date?: string | null;
    timeZone?: string | null;
  };
  hangoutLink?: string | null;
  conferenceData?: {
    conferenceSolution?: {
      name?: string | null;
    };
    entryPoints?: Array<{
      uri?: string | null;
      entryPointType?: string | null;
    }>;
  };
}

// ============================================================================
// Calendar Event Creation Types
// ============================================================================

export interface CreateCalendarEventParams {
  summary: string;
  description?: string;
  start_time: string; // ISO 8601 format or YYYY-MM-DD HH:mm
  end_time?: string;  // ISO 8601 format or YYYY-MM-DD HH:mm
  duration_minutes?: number; // Alternative to end_time
  attendees?: string[]; // List of email addresses
  location?: string;
  timezone?: string;
  add_meet_link?: boolean;
}

export interface CreatedCalendarEvent {
  id: string;
  summary: string;
  htmlLink: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  hangoutLink?: string;
  attendees?: Array<{
    email: string;
    responseStatus?: string;
  }>;
}

// ============================================================================
// Tool Input Types
// ============================================================================

export interface ListConferencesInput {
  limit?: number;
}

export interface GetConferenceInput {
  name: string;
}

export interface ConferenceNameInput {
  conference_name: string;
}

export interface TranscriptNameInput {
  transcript_name: string;
}

export interface LimitInput {
  limit?: number;
}

// ============================================================================
// Google Docs Types
// ============================================================================

export interface DocumentTab {
  tabId: string;
  title: string;
  body?: {
    content?: DocContent[];
  };
}

export interface DocTab {
  tabProperties?: {
    tabId?: string;
    title?: string;
    index?: number;
  };
  documentTab?: {
    body?: {
      content?: DocContent[];
    };
  };
  childTabs?: DocTab[];
}

export interface GoogleDoc {
  documentId: string;
  title: string;
  body?: {
    content?: DocContent[];
  };
  tabs?: DocTab[];
  revisionId?: string;
}

export interface DocContent {
  startIndex?: number;
  endIndex?: number;
  paragraph?: {
    elements?: ParagraphElement[];
    paragraphStyle?: {
      namedStyleType?: string;
    };
  };
  table?: {
    rows?: number;
    columns?: number;
    tableRows?: TableRow[];
  };
  sectionBreak?: object;
}

export interface ParagraphElement {
  startIndex?: number;
  endIndex?: number;
  textRun?: {
    content?: string;
    textStyle?: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      link?: {
        url?: string;
      };
    };
  };
}

export interface TableRow {
  tableCells?: TableCell[];
}

export interface TableCell {
  content?: DocContent[];
}

export interface CreateDocParams {
  title: string;
  content?: string;
}

export interface AppendToDocParams {
  document_id: string;
  text: string;
}

export interface GetDocParams {
  document_id: string;
}

export interface DocComment {
  id: string;
  author: string;
  content: string;
  createdTime: string;
  resolved: boolean;
  quotedText?: string;
  replies: Array<{
    id: string;
    author: string;
    content: string;
    createdTime: string;
  }>;
}

// ============================================================================
// Drive Comments Types
//
// Comments live in the Drive API, not the Docs/Slides/Sheets APIs, so a single
// service covers every Workspace file type.
// ============================================================================

export type CommentStatusFilter = "all" | "open" | "resolved";

export interface CommentReply {
  id: string;
  author: string;
  content: string;
  createdTime: string;
  action?: string;
}

export interface FileComment {
  id: string;
  author: string;
  content: string;
  createdTime: string;
  modifiedTime?: string;
  resolved: boolean;
  quotedText?: string;
  anchor?: string;
  anchorId?: string;
  postId?: string;
  deleted?: boolean;
  replies: CommentReply[];
}

/**
 * Which API owns a file's comments. Google Docs, Slides and Sheets expose
 * native, anchor-aware comment endpoints; other Drive files fall back to the
 * Drive API, which cannot anchor comments inside editor files.
 */
export type CommentFileKind = "doc" | "slides" | "sheets" | "drive";

/**
 * Anchor inputs accepted by `manage_comment` on create.
 *
 * - Docs: `quoted_text` or `start_index`/`end_index` (+ optional `tab_id`)
 * - Slides: `object_id` (page or element), optionally with a text range
 * - Sheets: `cell` (A1) or `sheet_id` + `row_index`/`column_index`
 */
export interface CommentAnchorInput {
  quotedText?: string;
  startIndex?: number;
  endIndex?: number;
  tabId?: string;
  objectId?: string;
  /** Slides table cell in A1-style notation within the table, e.g. "B2" or "B2:C3". */
  tableCell?: string;
  rowSpan?: number;
  columnSpan?: number;
  cell?: string;
  sheetId?: number;
  rowIndex?: number;
  columnIndex?: number;
  /** Raw anchor JSON for the Drive fallback path. */
  rawAnchor?: string;
}

export interface ListCommentsParams {
  status: CommentStatusFilter;
  includeDeleted: boolean;
  maxComments: number;
  pageToken?: string;
}

export interface ListCommentsResult {
  comments: FileComment[];
  nextPageToken?: string;
}

// ============================================================================
// Gmail Types
// ============================================================================

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  payload?: {
    headers?: Array<{
      name: string;
      value: string;
    }>;
    body?: {
      data?: string;
      size?: number;
    };
    parts?: Array<{
      mimeType?: string;
      body?: {
        data?: string;
        size?: number;
      };
    }>;
    mimeType?: string;
  };
  internalDate?: string;
}

export interface GmailThread {
  id: string;
  snippet?: string;
  historyId?: string;
  messages?: GmailMessage[];
}

export interface GmailLabel {
  id: string;
  name: string;
  type?: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
}

export interface GmailDraft {
  id: string;
  message?: GmailMessage;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}

export interface SearchEmailParams {
  query: string;
  maxResults?: number;
}

export interface GetEmailParams {
  messageId: string;
}

export interface GetThreadParams {
  threadId: string;
}

// ============================================================================
// MCP Response Types
// ============================================================================

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type ContentBlock = TextContent | ImageContent;

export interface ToolResponse {
  content: ContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
}

// ============================================================================
// Google Sheets Types
// ============================================================================

export interface SpreadsheetInfo {
  spreadsheetId: string;
  title: string;
  sheets: SheetInfo[];
  spreadsheetUrl: string;
}

export interface SheetInfo {
  sheetId: number;
  title: string;
  index: number;
  rowCount?: number;
  columnCount?: number;
}

export interface CellData {
  range: string;
  values: string[][];
}
