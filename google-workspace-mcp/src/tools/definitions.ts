/**
 * MCP Tool Definitions
 * Defines all available tools with their schemas
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

const id = { type: "string", minLength: 1 };
const number = { type: "number" };
const color = { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Colour as #RRGGBB" };
const alpha = { type: "number", minimum: 0, maximum: 1 };
const box = { x: number, y: number, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 } };
const alignment = { type: "string", enum: ["START", "CENTER", "END", "JUSTIFIED"] };
const bulletPreset = { type: "string", enum: [
  "BULLET_DISC_CIRCLE_SQUARE", "BULLET_DIAMONDX_ARROW3D_SQUARE", "BULLET_CHECKBOX",
  "BULLET_ARROW_DIAMOND_DISC", "BULLET_STAR_CIRCLE_SQUARE", "BULLET_ARROW3D_CIRCLE_SQUARE",
  "BULLET_LEFTTRIANGLE_DIAMOND_DISC", "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE", "BULLET_DIAMOND_CIRCLE_SQUARE",
  "NUMBERED_DIGIT_ALPHA_ROMAN", "NUMBERED_DIGIT_ALPHA_ROMAN_PARENS", "NUMBERED_DIGIT_NESTED",
  "NUMBERED_UPPERALPHA_ROMAN", "NUMBERED_UPPERROMAN_UPPERALPHA_DIGIT", "NUMBERED_ZERODIGIT_ALPHA_ROMAN",
] };
const style = { type: "object", additionalProperties: false, minProperties: 1, properties: {
  font_family: id, font_size: { type: "number", exclusiveMinimum: 0 }, color, background_color: color,
  bold: { type: "boolean" }, italic: { type: "boolean" }, underline: { type: "boolean" },
  strikethrough: { type: "boolean" }, small_caps: { type: "boolean" },
  baseline_offset: { type: "string", enum: ["NONE", "SUPERSCRIPT", "SUBSCRIPT"] },
  align: alignment,
  vertical_anchor: { type: "string", enum: ["TOP", "MIDDLE", "BOTTOM"], description: "Vertical text anchor (shape content alignment)" },
  line_spacing: { type: "number", exclusiveMinimum: 0, description: "Line spacing percentage, where 100 is normal" },
  space_before: { type: "number", minimum: 0, description: "Space above a paragraph in points" },
  space_after: { type: "number", minimum: 0, description: "Space below a paragraph in points" },
  link_url: { type: "string", format: "uri" },
  bullets: bulletPreset,
  remove_bullets: { type: "boolean" },
} };
const textRun = { type: "object", additionalProperties: false, properties: { text: { type: "string", minLength: 1 }, style }, required: ["text", "style"] };
const outline = {
  outline_color: color,
  outline_weight: { type: "number", minimum: 0, description: "Outline weight in points" },
  outline_alpha: alpha,
  outline_dash_style: { type: "string", enum: ["SOLID", "DOT", "DASH", "LONG_DASH", "LONG_DOT", "DASH_DOT", "LONG_DASH_DOT"] },
};
const imageSource = { url: { type: "string", format: "uri" }, drive_file_id: { type: "string", minLength: 1 } };
const cellStyle = { type: "object", additionalProperties: false, properties: { fill_color: color, text_color: color, bold: { type: "boolean" }, font_size: { type: "number", exclusiveMinimum: 0 }, align: alignment } };
const operation = (type: string, properties: Record<string, unknown>, required: string[]) => ({
  type: "object", additionalProperties: false, properties: { type: { type: "string", enum: [type] }, ...properties }, required: ["type", ...required],
});
const atLeastOne = (...names: string[]) => ({ anyOf: names.map((name) => ({ required: [name] })) });
const slideOperations = [
  operation("add_slide", {
    index: { type: "integer", minimum: 0 },
    layout: { type: "string", enum: ["BLANK", "TITLE", "TITLE_AND_BODY", "TITLE_AND_TWO_COLUMNS", "TITLE_ONLY", "SECTION_HEADER", "SECTION_TITLE_AND_DESCRIPTION", "ONE_COLUMN_TEXT", "MAIN_POINT", "BIG_NUMBER", "CAPTION_ONLY"] },
    layout_id: id,
  }, []),
  operation("delete_slide", { slide_id: id }, ["slide_id"]),
  operation("duplicate_slide", { slide_id: id }, ["slide_id"]),
  operation("move_slide", { slide_id: id, index: { type: "integer", minimum: 0 } }, ["slide_id", "index"]),
  operation("copy_slide", { source_presentation_id: id, source_slide_id: id, index: { type: "integer", minimum: 0 } }, ["source_presentation_id", "source_slide_id"]),
  operation("add_text_box", { slide_id: id, text: id, runs: { type: "array", minItems: 1, items: textRun }, ...box, style }, ["slide_id", "x", "y", "width", "height"]),
  operation("add_shape", {
    slide_id: id, shape: { type: "string", minLength: 1, description: "Google Slides ShapeType, e.g. RECTANGLE, ROUND_RECTANGLE, ELLIPSE, CHEVRON, DONUT, CLOUD_CALLOUT" },
    ...box, fill_color: color, alpha, rotation: { type: "number", description: "Clockwise rotation in degrees around the centre" },
    link_url: { type: "string", format: "uri" }, text: id, text_style: style, ...outline,
  }, ["slide_id", "shape", "x", "y", "width", "height"]),
  { ...operation("add_image", { slide_id: id, ...imageSource, ...box, alt_text: { type: "string" }, title: { type: "string" }, rotation: { type: "number" } }, ["slide_id", "x", "y", "width", "height"]), ...atLeastOne("url", "drive_file_id") },
  operation("add_table", {
    slide_id: id, rows: { type: "integer", minimum: 1 }, columns: { type: "integer", minimum: 1 }, ...box,
    cells: { type: "array", items: { type: "array", items: { type: "string" } } },
    header_row: { type: "boolean" }, header_fill_color: color, body_fill_color: color, text_color: color,
    font_size: { type: "number", exclusiveMinimum: 0 }, bold: { type: "boolean" }, align: alignment,
    border_color: color, border_weight: { type: "number", minimum: 0 },
    cell_styles: { type: "array", items: { type: "array", items: cellStyle } },
  }, ["slide_id", "rows", "columns", "x", "y", "width", "height"]),
  operation("replace_text", { element_id: id, text: { type: "string" } }, ["element_id", "text"]),
  operation("style_text", { element_id: id, style, start_index: { type: "integer", minimum: 0 }, end_index: { type: "integer", minimum: 0 } }, ["element_id", "style"]),
  { ...operation("style_shape", { element_id: id, fill_color: color, alpha, content_alignment: { type: "string", enum: ["TOP", "MIDDLE", "BOTTOM"] }, link_url: { type: "string", format: "uri" }, text_style: style, ...outline }, ["element_id"]), ...atLeastOne("fill_color", "alpha", "content_alignment", "link_url", "text_style", "outline_color", "outline_weight", "outline_alpha", "outline_dash_style") },
  { ...operation("style_image", { element_id: id, link_url: { type: "string", format: "uri" }, ...outline }, ["element_id"]), ...atLeastOne("link_url", "outline_color", "outline_weight", "outline_alpha", "outline_dash_style") },
  { ...operation("set_background", { slide_id: id, color, theme_color: { type: "string", enum: ["DARK1", "LIGHT1", "DARK2", "LIGHT2", "ACCENT1", "ACCENT2", "ACCENT3", "ACCENT4", "ACCENT5", "ACCENT6", "HYPERLINK", "FOLLOWED_HYPERLINK"] }, image_url: { type: "string", format: "uri" }, drive_file_id: id }, ["slide_id"]), ...atLeastOne("color", "theme_color", "image_url", "drive_file_id") },
  operation("add_notes", { slide_id: id, text: id }, ["slide_id", "text"]),
  operation("link_element", { element_id: id, url: { type: "string", format: "uri" } }, ["element_id", "url"]),
  operation("set_alt_text", { element_id: id, title: { type: "string" }, description: { type: "string" } }, ["element_id"]),
  operation("group_elements", { element_ids: { type: "array", minItems: 2, items: id, description: "Page elements on the same slide that are not already grouped" }, group_id: { type: "string", minLength: 1, description: "Optional object ID for the new group" } }, ["element_ids"]),
  operation("ungroup_elements", { group_id: id }, ["group_id"]),
  operation("z_order", { element_ids: { type: "array", minItems: 1, items: id }, operation: { type: "string", enum: ["BRING_TO_FRONT", "BRING_FORWARD", "SEND_TO_BACK", "SEND_BACKWARD"] } }, ["element_ids", "operation"]),
  operation("align_elements", { element_ids: { type: "array", minItems: 1, items: id }, alignment: { type: "string", enum: ["LEFT", "CENTER", "RIGHT", "TOP", "MIDDLE", "BOTTOM"] } }, ["element_ids", "alignment"]),
  operation("distribute_elements", { element_ids: { type: "array", minItems: 2, items: id }, axis: { type: "string", enum: ["HORIZONTAL", "VERTICAL"] } }, ["element_ids", "axis"]),
  operation("move_element", { element_id: id, x: number, y: number }, ["element_id", "x", "y"]),
  operation("transform_element", { element_id: id, x: number, y: number, scale_x: { type: "number", exclusiveMinimum: 0 }, scale_y: { type: "number", exclusiveMinimum: 0 }, rotation: { type: "number" } }, ["element_id", "x", "y", "scale_x", "scale_y"]),
  operation("delete_element", { element_id: id }, ["element_id"]),
];

export const tools: Tool[] = [
  {
    name: "auth_status",
    description:
      "Check the current authentication status with Google. Returns whether you are authenticated or need to sign in.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "authenticate",
    description:
      "Authenticate with Google. Use force=true to renew OAuth consent after permission changes.",
    inputSchema: {
      type: "object" as const,
      properties: { force: { type: "boolean", description: "Request new OAuth consent without deleting the existing token first." } },
    },
  },
  {
    name: "list_conferences",
    description:
      "List recent conference records (past Google Meet meetings). Returns meeting details including start/end times.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of conferences to return (default: 10, max: 100)",
        },
      },
    },
  },
  {
    name: "get_conference",
    description:
      "Get details about a specific conference record by its resource name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description:
            "The conference record resource name (e.g., conferenceRecords/abc123)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "list_participants",
    description:
      "List all participants who joined a specific conference/meeting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conference_name: {
          type: "string",
          description:
            "The conference record resource name (e.g., conferenceRecords/abc123)",
        },
      },
      required: ["conference_name"],
    },
  },
  {
    name: "list_recordings",
    description:
      "List all recordings for a specific conference. Returns recording status and Google Drive links.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conference_name: {
          type: "string",
          description:
            "The conference record resource name (e.g., conferenceRecords/abc123)",
        },
      },
      required: ["conference_name"],
    },
  },
  {
    name: "list_transcripts",
    description:
      "List all transcripts for a specific conference. Returns transcript status and Google Docs links.",
    inputSchema: {
      type: "object" as const,
      properties: {
        conference_name: {
          type: "string",
          description:
            "The conference record resource name (e.g., conferenceRecords/abc123)",
        },
      },
      required: ["conference_name"],
    },
  },
  {
    name: "get_transcript_text",
    description:
      "Get the actual transcript text/entries for a specific transcript. Returns speaker-attributed text with timestamps.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_name: {
          type: "string",
          description:
            "The transcript resource name (e.g., conferenceRecords/abc123/transcripts/xyz789)",
        },
      },
      required: ["transcript_name"],
    },
  },
  {
    name: "create_meeting",
    description:
      "Create a new Google Meet meeting space. Returns the meeting link and code.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_upcoming_meetings",
    description:
      "List upcoming Google Meet meetings from your Google Calendar.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of meetings to return (default: 10, max: 100)",
        },
      },
    },
  },
  {
    name: "list_past_meetings",
    description:
      "List past Google Meet meetings from your Google Calendar (last 30 days).",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of meetings to return (default: 10, max: 100)",
        },
      },
    },
  },
  {
    name: "summarize_transcript",
    description:
      "Get a transcript and format it for summarization. Returns the full transcript text that can be summarized by the AI.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transcript_name: {
          type: "string",
          description: "The transcript resource name",
        },
      },
      required: ["transcript_name"],
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Create a new calendar event with optional Google Meet link. Can add attendees who will receive invitations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "Event title/name",
        },
        description: {
          type: "string",
          description: "Event description (optional)",
        },
        start_time: {
          type: "string",
          description: "Start time in format 'YYYY-MM-DD HH:mm' (e.g., '2024-01-30 14:00') or ISO 8601",
        },
        end_time: {
          type: "string",
          description: "End time (optional, defaults to start + duration)",
        },
        duration_minutes: {
          type: "number",
          description: "Duration in minutes (default: 60, used if end_time not provided)",
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "List of attendee email addresses",
        },
        location: {
          type: "string",
          description: "Event location (optional)",
        },
        timezone: {
          type: "string",
          description: "Timezone (default: Asia/Kolkata)",
        },
        add_meet_link: {
          type: "boolean",
          description: "Add Google Meet link (default: true)",
        },
      },
      required: ["summary", "start_time"],
    },
  },

  // =========================================================================
  // Gmail Tools
  // =========================================================================
  {
    name: "gmail_profile",
    description:
      "Get your Gmail profile information including email address and message counts.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_emails",
    description:
      "List recent emails from your inbox. Returns subject, sender, and snippet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of emails to return (default: 10, max: 50)",
        },
      },
    },
  },
  {
    name: "search_emails",
    description:
      "Search emails using Gmail search syntax. Examples: 'from:user@example.com', 'subject:meeting', 'is:unread', 'has:attachment'.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Gmail search query (e.g., 'from:boss@company.com is:unread')",
        },
        limit: {
          type: "number",
          description: "Maximum number of emails to return (default: 10, max: 50)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_email",
    description:
      "Get the full content of a specific email by its message ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID",
        },
      },
      required: ["message_id"],
    },
  },
  {
    name: "get_thread",
    description:
      "Get all messages in an email thread/conversation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        thread_id: {
          type: "string",
          description: "The Gmail thread ID",
        },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "send_email",
    description:
      "Send a new email. Requires recipient, subject, and body.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body (plain text)",
        },
        cc: {
          type: "string",
          description: "CC recipients (comma-separated)",
        },
        bcc: {
          type: "string",
          description: "BCC recipients (comma-separated)",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "create_draft",
    description:
      "Create a draft email without sending it.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient email address",
        },
        subject: {
          type: "string",
          description: "Email subject line",
        },
        body: {
          type: "string",
          description: "Email body (plain text)",
        },
        cc: {
          type: "string",
          description: "CC recipients (comma-separated)",
        },
        bcc: {
          type: "string",
          description: "BCC recipients (comma-separated)",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "list_labels",
    description:
      "List all Gmail labels (folders) in your account.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "trash_email",
    description:
      "Move an email to trash.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID to trash",
        },
      },
      required: ["message_id"],
    },
  },
  {
    name: "mark_as_read",
    description:
      "Mark an email as read.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID",
        },
      },
      required: ["message_id"],
    },
  },
  {
    name: "mark_as_unread",
    description:
      "Mark an email as unread.",
    inputSchema: {
      type: "object" as const,
      properties: {
        message_id: {
          type: "string",
          description: "The Gmail message ID",
        },
      },
      required: ["message_id"],
    },
  },

  // =========================================================================
  // Google Docs Tools
  // =========================================================================
  {
    name: "list_docs",
    description:
      "List recent Google Docs documents from your Drive, sorted by last modified.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of documents to return (default: 10, max: 50)",
        },
      },
    },
  },
  {
    name: "search_docs",
    description:
      "Search for Google Docs documents by name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query to find documents by name",
        },
        limit: {
          type: "number",
          description: "Maximum number of documents to return (default: 10, max: 50)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_doc",
    description:
      "Get the content of a Google Doc. Returns text content with tables formatted as markdown tables. Comments are excluded by default; set include_comments to append a compact summary, or use list_comments for the full thread.",
    inputSchema: {
      type: "object" as const,
      properties: {
        document_id: {
          type: "string",
          description: "The Google Doc document ID",
        },
        include_comments: {
          type: "boolean",
          description: "Append a compact comment summary to the output (default: false)",
        },
      },
      required: ["document_id"],
    },
  },
  {
    name: "create_doc",
    description:
      "Create a new Google Doc with optional initial content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Title of the new document",
        },
        content: {
          type: "string",
          description: "Optional initial content for the document",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "append_to_doc",
    description:
      "Append text to the end of an existing Google Doc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        document_id: {
          type: "string",
          description: "The Google Doc document ID",
        },
        text: {
          type: "string",
          description: "Text to append to the document",
        },
      },
      required: ["document_id", "text"],
    },
  },
  {
    name: "replace_in_doc",
    description:
      "Find and replace text in a Google Doc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        document_id: {
          type: "string",
          description: "The Google Doc document ID",
        },
        search_text: {
          type: "string",
          description: "Text to search for",
        },
        replace_text: {
          type: "string",
          description: "Text to replace with",
        },
        match_case: {
          type: "boolean",
          description: "Whether to match case (default: false)",
        },
      },
      required: ["document_id", "search_text", "replace_text"],
    },
  },

  // =========================================================================
  // Google Slides Tools
  // =========================================================================
  {
    name: "list_presentations",
    description:
      "List recent Google Slides presentations from your Drive, sorted by last modified.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of presentations to return (default: 10, max: 50)",
        },
      },
    },
  },
  {
    name: "search_presentations",
    description:
      "Search for Google Slides presentations by name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query to find presentations by name",
        },
        limit: {
          type: "number",
          description: "Maximum number of presentations to return (default: 10, max: 50)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_presentation",
    description:
      "Get the content of a Google Slides presentation. Returns slide text, speaker notes, and optionally downloads images for visual analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {
        presentation_id: {
          type: "string",
          description: "The Google Slides presentation ID",
        },
        include_images: {
          type: "boolean",
          description: "If true, downloads and includes base64-encoded image data for visual analysis (default: false). Note: This increases response size significantly.",
        },
      },
      required: ["presentation_id"],
    },
  },
  {
    name: "create_presentation",
    description: "Create an empty Google Slides presentation; returns its ID and URL. Optionally set the page size in points (default 720x405).",
    inputSchema: { type: "object", properties: { title: id, width: { type: "number", exclusiveMinimum: 0 }, height: { type: "number", exclusiveMinimum: 0 } }, required: ["title"] },
  },
  {
    name: "inspect_presentation",
    description: "Inspect slide, layout, master and element IDs, placeholders, positions, sizes, text, styles and revision before editing. Use a layout id with add_slide layout_id to inherit a master. Coordinates are in the units returned by Google; 1 point = 12,700 EMU.",
    inputSchema: { type: "object", properties: { presentation_id: id }, required: ["presentation_id"] },
  },
  {
    name: "edit_presentation",
    description: "Apply Slides edits atomically. Coordinates and dimensions are points. Text styles support alignment, vertical anchor, line spacing, space before/after, bullets and per-range styling (style_text start_index/end_index or add_text_box runs). Shape styles support fill, alpha, outline colour/weight/alpha/dash and rotation; the full Google ShapeType set is accepted. add_image uses a public URL or Drive file ID; set_background accepts a colour or a stretched image; add_table creates a real table; add_notes, link_element, set_alt_text, z_order, group_elements and ungroup_elements cover notes, links, alt text, layering and grouping. add_slide accepts a predefined layout or layout_id so the deck can inherit a master. copy_slide copies a slide from another presentation. Slide index is zero-based; move_slide index is based on the order BEFORE the move. replace_text replaces the entire text and may change formatting. move_element x/y are relative offsets; transform_element replaces the existing transform with absolute translation and scale. For safety confirm before deleting. Use revision_id from inspect_presentation to reject stale edits. New IDs are available after this call, so add content to a new slide in a subsequent call.",
    inputSchema: { type: "object", properties: { presentation_id: id, revision_id: id, operations: { type: "array", minItems: 1, maxItems: 100, items: { oneOf: slideOperations } } }, required: ["presentation_id", "operations"] },
  },
  {
    name: "get_slide_preview",
    description: "Render a slide preview as an image for visual inspection.",
    inputSchema: { type: "object", properties: { presentation_id: id, slide_id: id }, required: ["presentation_id", "slide_id"] },
  },
  {
    name: "add_slide_image",
    description: "Insert a local PNG, JPEG or GIF privately using the configured Apps Script helper. No public sharing. Maximum 3 MiB; x/y/width/height are in points. The absolute path must be accessible on the MCP server host. For images already reachable by URL (or uploaded with upload_drive_file), use edit_presentation add_image instead.",
    inputSchema: { type: "object", properties: { presentation_id: id, slide_id: id, file_path: id, ...box }, required: ["presentation_id", "slide_id", "file_path", "x", "y", "width", "height"] },
  },
  {
    name: "upload_drive_file",
    description: "Upload a local file to Google Drive and return its file ID and direct URL. Set share_anyone=true to make it publicly readable so edit_presentation add_image can fetch it. This changes Drive sharing.",
    inputSchema: { type: "object", properties: { file_path: id, name: id, share_anyone: { type: "boolean", description: "Grant anyone with the link read access (default false)" } }, required: ["file_path"] },
  },
  {
    name: "copy_slide",
    description: "Copy a slide from one presentation into another. With the Apps Script helper configured this is a lossless native copy (including layouts and images); otherwise the source is read and its elements are recreated, with unsupported elements reported in warnings.",
    inputSchema: { type: "object", properties: { target_presentation_id: id, source_presentation_id: id, source_slide_id: id, index: { type: "integer", minimum: 0 } }, required: ["target_presentation_id", "source_presentation_id", "source_slide_id"] },
  },

  // =========================================================================
  // Google Sheets Tools
  // =========================================================================
  {
    name: "list_spreadsheets",
    description:
      "List recent Google Sheets spreadsheets from your Drive, sorted by last modified.",
    inputSchema: {
      type: "object" as const,
      properties: {
        max_results: {
          type: "number",
          description: "Maximum number of spreadsheets to return (default: 10, max: 100)",
        },
      },
    },
  },
  {
    name: "search_spreadsheets",
    description:
      "Search for Google Sheets spreadsheets by name.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query to find spreadsheets by name",
        },
        max_results: {
          type: "number",
          description: "Maximum number of spreadsheets to return (default: 10, max: 100)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_spreadsheet",
    description:
      "Get metadata about a Google Sheets spreadsheet including its title and list of sheets (tabs).",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID",
        },
      },
      required: ["spreadsheet_id"],
    },
  },
  {
    name: "get_sheet_data",
    description:
      "Read cell values from a Google Sheets spreadsheet. Supports A1 notation for ranges.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID",
        },
        range: {
          type: "string",
          description: "The range to read in A1 notation (e.g., 'Sheet1!A1:D10', 'A1:D10', or 'Sheet1')",
        },
      },
      required: ["spreadsheet_id", "range"],
    },
  },
  {
    name: "update_cells",
    description:
      "Update cell values in a Google Sheets spreadsheet. Values are entered as the user would type them.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID",
        },
        range: {
          type: "string",
          description: "The range to update in A1 notation (e.g., 'Sheet1!A1:B2')",
        },
        values: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description: "2D array of values to write (rows of cells)",
        },
      },
      required: ["spreadsheet_id", "range", "values"],
    },
  },
  {
    name: "append_rows",
    description:
      "Append rows of data to the end of a Google Sheets spreadsheet or sheet.",
    inputSchema: {
      type: "object" as const,
      properties: {
        spreadsheet_id: {
          type: "string",
          description: "The Google Sheets spreadsheet ID",
        },
        range: {
          type: "string",
          description: "The sheet or range to append to (e.g., 'Sheet1' or 'Sheet1!A:D')",
        },
        values: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description: "2D array of rows to append",
        },
      },
      required: ["spreadsheet_id", "range", "values"],
    },
  },
  {
    name: "create_spreadsheet",
    description:
      "Create a new Google Sheets spreadsheet with the specified title.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Title of the new spreadsheet",
        },
      },
      required: ["title"],
    },
  },

  // Comments (Drive API — works for Docs, Slides, Sheets and any Drive file)
  {
    name: "list_comments",
    description:
      "List comments on a Google Doc, Slide deck, Sheet or other Drive file. Uses the editor's native comment API so quoted/anchor context is preserved. Returns a compact summary: id, author, open/resolved status, quoted text and truncated content.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_id: {
          type: "string",
          description: "The document, presentation or spreadsheet ID",
        },
        status: {
          type: "string",
          enum: ["all", "open", "resolved"],
          description: "Filter by comment status (default: open)",
        },
        include_deleted: {
          type: "boolean",
          description: "Include deleted comments (default: false)",
        },
        max_comments: {
          type: "number",
          description: "Maximum number of comments to return, 1-200 (default: 50)",
        },
        page_token: {
          type: "string",
          description:
            "Pagination token from a previous list_comments call (Drive fallback files only)",
        },
      },
      required: ["file_id"],
    },
  },
  {
    name: "manage_comment",
    description:
      "Create, reply, update, resolve, reopen or delete a comment on a Google Doc, Slide deck, Sheet or other Drive file. On Docs/Slides/Sheets comments use the editor's native anchor API, so they are highlighted in the editor like a manually added comment. Anchor a create with quoted_text (Docs, or Slides with object_id), start_index/end_index, object_id, or cell.",
    inputSchema: {
      type: "object" as const,
      properties: {
        file_id: {
          type: "string",
          description: "The document, presentation or spreadsheet ID",
        },
        action: {
          type: "string",
          enum: ["create", "reply", "update", "resolve", "reopen", "delete"],
          description: "The operation to perform",
        },
        comment_id: {
          type: "string",
          description: "Comment ID (required for reply, update, resolve, reopen and delete)",
        },
        post_id: {
          type: "string",
          description: "Post ID to edit on update; defaults to the thread's head post",
        },
        content: {
          type: "string",
          description: "Comment text (required for create, reply and update)",
        },
        quoted_text: {
          type: "string",
          description:
            "Create only. Text to find and anchor the comment to. Docs: first match in the body. Slides: pair with object_id (shape text) or object_id + table_cell (text inside a table cell). Not supported for Sheets.",
        },
        start_index: {
          type: "number",
          description: "Create only. Zero-based start index for a precise text-range anchor",
        },
        end_index: {
          type: "number",
          description: "Create only. Exclusive end index; must be greater than start_index",
        },
        tab_id: {
          type: "string",
          description: "Create only. Document tab for the range anchor (Docs)",
        },
        object_id: {
          type: "string",
          description:
            "Create only. Slides page or page element to anchor to. Add start_index/end_index or quoted_text to anchor to text inside a shape; add table_cell to anchor inside a table.",
        },
        table_cell: {
          type: "string",
          description:
            "Create only. Slides table cell in A1-style notation within the table, e.g. \"B2\" or \"B2:C3\". Requires object_id of the table. Without a text range it highlights the cells; add quoted_text or start_index/end_index to highlight text inside one cell.",
        },
        row_span: {
          type: "number",
          description: "Create only. Number of table rows covered when anchoring to a table range",
        },
        column_span: {
          type: "number",
          description: "Create only. Number of table columns covered when anchoring to a table range",
        },
        cell: {
          type: "string",
          description:
            "Create only. Sheets cell in A1 notation, e.g. \"Sheet1!B2\". Must be a single cell; ranges are not supported by the Sheets comment API.",
        },
        sheet_id: {
          type: "number",
          description: "Create only. Sheets numeric sheet ID, with row_index and column_index",
        },
        row_index: {
          type: "number",
          description: "Create only. Zero-based row index for a Sheets anchor",
        },
        column_index: {
          type: "number",
          description: "Create only. Zero-based column index for a Sheets anchor",
        },
        assignee_email: {
          type: "string",
          description: "Create only. Assign the comment to this person",
        },
        anchor: {
          type: "string",
          description:
            "Create only. Raw anchor JSON for the Drive fallback (non-Docs/Slides/Sheets files)",
        },
      },
      required: ["file_id", "action"],
    },
  },
];
