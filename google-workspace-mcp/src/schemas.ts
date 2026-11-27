/**
 * Zod Validation Schemas
 * Runtime validation for tool inputs
 */

import { z } from "zod";

export const AuthenticateSchema = z.object({ force: z.boolean().optional().default(false) });

/**
 * Schema for list_conferences tool
 */
export const ListConferencesSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(10),
});

/**
 * Schema for get_conference tool
 */
export const GetConferenceSchema = z.object({
  name: z.string().min(1, "Conference name is required"),
});

/**
 * Schema for tools requiring conference_name
 */
export const ConferenceNameSchema = z.object({
  conference_name: z.string().min(1, "Conference name is required"),
});

/**
 * Schema for tools requiring transcript_name
 */
export const TranscriptNameSchema = z.object({
  transcript_name: z.string().min(1, "Transcript name is required"),
});

/**
 * Schema for list_upcoming_meetings and list_past_meetings
 */
export const ListMeetingsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(10),
});

/**
 * Empty schema for tools with no inputs
 */
export const EmptySchema = z.object({});

// ============================================================================
// Gmail Schemas
// ============================================================================

/**
 * Schema for list_emails tool
 */
export const ListEmailsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

/**
 * Schema for search_emails tool
 */
export const SearchEmailsSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

/**
 * Schema for get_email tool
 */
export const GetEmailSchema = z.object({
  message_id: z.string().min(1, "Message ID is required"),
});

/**
 * Schema for get_thread tool
 */
export const GetThreadSchema = z.object({
  thread_id: z.string().min(1, "Thread ID is required"),
});

/**
 * Schema for send_email tool
 */
export const SendEmailSchema = z.object({
  to: z.string().email("Valid email address required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Email body is required"),
  cc: z.string().optional(),
  bcc: z.string().optional(),
});

/**
 * Schema for create_draft tool
 */
export const CreateDraftSchema = SendEmailSchema;

/**
 * Schema for trash_email tool
 */
export const TrashEmailSchema = z.object({
  message_id: z.string().min(1, "Message ID is required"),
});

/**
 * Schema for mark_read/unread tools
 */
export const MarkEmailSchema = z.object({
  message_id: z.string().min(1, "Message ID is required"),
});

// ============================================================================
// Google Docs Schemas
// ============================================================================

/**
 * Schema for list_docs tool
 */
export const ListDocsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

/**
 * Schema for search_docs tool
 */
export const SearchDocsSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

/**
 * Schema for get_doc tool
 */
export const GetDocSchema = z.object({
  document_id: z.string().min(1, "Document ID is required"),
  include_comments: z.boolean().optional().default(false),
  max_chars: z.number().int().min(500).max(200000).optional().default(20000),
  cursor: z.string().min(1).optional(),
}).strict();

/**
 * Schema for create_doc tool
 */
export const CreateDocSchema = z.object({
  title: z.string().min(1, "Document title is required"),
  content: z.string().optional(),
});

/**
 * Schema for append_to_doc tool
 */
export const AppendToDocSchema = z.object({
  document_id: z.string().min(1, "Document ID is required"),
  text: z.string().min(1, "Text to append is required"),
});

/**
 * Schema for replace_in_doc tool
 */
export const ReplaceInDocSchema = z.object({
  document_id: z.string().min(1, "Document ID is required"),
  search_text: z.string().min(1, "Search text is required"),
  replace_text: z.string(),
  match_case: z.boolean().optional().default(false),
});

// ============================================================================
// Google Calendar Schemas
// ============================================================================

/**
 * Schema for create_calendar_event tool
 */
export const CreateCalendarEventSchema = z.object({
  summary: z.string().min(1, "Event title is required"),
  description: z.string().optional(),
  start_time: z.string().min(1, "Start time is required (e.g., '2024-01-30 14:00' or ISO format)"),
  end_time: z.string().optional(),
  duration_minutes: z.number().int().min(5).max(480).optional().default(60),
  attendees: z.array(z.string().email()).optional(),
  location: z.string().optional(),
  timezone: z.string().optional().default("Asia/Kolkata"),
  add_meet_link: z.boolean().optional().default(true),
});

// ============================================================================
// Google Slides Schemas
// ============================================================================

/**
 * Schema for list_presentations tool
 */
export const ListPresentationsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

/**
 * Schema for search_presentations tool
 */
export const SearchPresentationsSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  limit: z.number().int().min(1).max(50).optional().default(10),
});

/**
 * Schema for get_presentation tool
 */
export const GetPresentationSchema = z.object({
  presentation_id: z.string().min(1, "Presentation ID is required"),
  include_images: z.boolean().optional().default(false),
  slide_start: z.number().int().min(1).optional().default(1),
  max_slides: z.number().int().min(1).max(100).optional().default(10),
});

const slideId = z.string().min(1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color such as #336699");
const alignment = z.enum(["START", "CENTER", "END", "JUSTIFIED"]);
const themeColor = z.enum(["DARK1", "LIGHT1", "DARK2", "LIGHT2", "ACCENT1", "ACCENT2", "ACCENT3", "ACCENT4", "ACCENT5", "ACCENT6", "HYPERLINK", "FOLLOWED_HYPERLINK"]);
const verticalAnchor = z.enum(["TOP", "MIDDLE", "BOTTOM"]);
const bulletPreset = z.enum([
  "BULLET_DISC_CIRCLE_SQUARE",
  "BULLET_DIAMONDX_ARROW3D_SQUARE",
  "BULLET_CHECKBOX",
  "BULLET_ARROW_DIAMOND_DISC",
  "BULLET_STAR_CIRCLE_SQUARE",
  "BULLET_ARROW3D_CIRCLE_SQUARE",
  "BULLET_LEFTTRIANGLE_DIAMOND_DISC",
  "BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE",
  "BULLET_DIAMOND_CIRCLE_SQUARE",
  "NUMBERED_DIGIT_ALPHA_ROMAN",
  "NUMBERED_DIGIT_ALPHA_ROMAN_PARENS",
  "NUMBERED_DIGIT_NESTED",
  "NUMBERED_UPPERALPHA_ROMAN",
  "NUMBERED_UPPERROMAN_UPPERALPHA_DIGIT",
  "NUMBERED_ZERODIGIT_ALPHA_ROMAN",
]);

/**
 * Text styling. Paragraph properties (align, spacing, bullets) apply to every
 * paragraph in the target range. Colour/weight properties apply to every
 * character in the range. vertical_anchor and the inset-free text frame
 * properties apply to the containing shape.
 */
const textStyle = z.object({
  font_family: z.string().min(1).optional(),
  font_size: z.number().positive().finite().optional(),
  color: color.optional(),
  background_color: color.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  small_caps: z.boolean().optional(),
  baseline_offset: z.enum(["NONE", "SUPERSCRIPT", "SUBSCRIPT"]).optional(),
  align: alignment.optional(),
  vertical_anchor: verticalAnchor.optional(),
  line_spacing: z.number().positive().finite().optional(),
  space_before: z.number().nonnegative().finite().optional(),
  space_after: z.number().nonnegative().finite().optional(),
  link_url: z.string().url().optional(),
  bullets: bulletPreset.optional(),
  remove_bullets: z.boolean().optional(),
}).strict().superRefine((style, ctx) => {
  if (Object.keys(style).length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide at least one style property" });
  if (style.bullets !== undefined && style.remove_bullets) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bullets and remove_bullets are mutually exclusive" });
});
export type SlideTextStyle = z.infer<typeof textStyle>;
const textRun = z.object({ text: z.string().min(1), style: textStyle }).strict();
// Accept the full Google Slides ShapeType vocabulary rather than a fixed
// subset; Google validates unrecognised names.
const shapeType = z.string().min(1);
const box = {
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().positive().finite(), height: z.number().positive().finite(),
};
const alpha = z.number().min(0).max(1).finite();
const outline = {
  outline_color: color.optional(),
  outline_weight: z.number().nonnegative().finite().optional(),
  outline_alpha: alpha.optional(),
  outline_dash_style: z.enum(["SOLID", "DOT", "DASH", "LONG_DASH", "LONG_DOT", "DASH_DOT", "LONG_DASH_DOT"]).optional(),
};
const imageSource = {
  url: z.string().url().optional(),
  drive_file_id: z.string().min(1).optional(),
};
const cellStyle = z.object({
  fill_color: color.optional(),
  text_color: color.optional(),
  bold: z.boolean().optional(),
  font_size: z.number().positive().finite().optional(),
  align: alignment.optional(),
}).strict();

export const CreatePresentationSchema = z.object({
  title: z.string().min(1),
  width: z.number().positive().finite().optional(),
  height: z.number().positive().finite().optional(),
}).superRefine((value, ctx) => {
  if ((value.width === undefined) !== (value.height === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["width"], message: "Provide both width and height" });
  }
});
export const InspectPresentationSchema = z.object({
  presentation_id: slideId,
  slide_start: z.number().int().min(1).optional().default(1),
  max_slides: z.number().int().min(1).max(100).optional().default(10),
  detail: z.enum(["summary", "full"]).optional().default("summary"),
  include_layouts: z.boolean().optional().default(false),
  include_masters: z.boolean().optional().default(false),
});
export const SlidePreviewSchema = z.object({ presentation_id: slideId, slide_id: slideId });
export const EditPresentationSchema = z.object({
  presentation_id: slideId,
  revision_id: z.string().min(1).optional(),
  operations: z.array(z.discriminatedUnion("type", [
    z.object({
      type: z.literal("add_slide"), index: z.number().int().nonnegative().optional(),
      layout: z.enum(["BLANK", "TITLE", "TITLE_AND_BODY", "TITLE_AND_TWO_COLUMNS", "TITLE_ONLY", "SECTION_HEADER", "SECTION_TITLE_AND_DESCRIPTION", "ONE_COLUMN_TEXT", "MAIN_POINT", "BIG_NUMBER", "CAPTION_ONLY"]).optional(),
      layout_id: z.string().min(1).optional(),
    }).strict(),
    z.object({ type: z.literal("delete_slide"), slide_id: slideId }).strict(),
    z.object({ type: z.literal("duplicate_slide"), slide_id: slideId }).strict(),
    z.object({ type: z.literal("move_slide"), slide_id: slideId, index: z.number().int().nonnegative() }).strict(),
    z.object({ type: z.literal("copy_slide"), source_presentation_id: slideId, source_slide_id: slideId, index: z.number().int().nonnegative().optional() }).strict(),
    z.object({ type: z.literal("add_text_box"), slide_id: slideId, text: z.string().min(1).optional(), runs: z.array(textRun).min(1).optional(), ...box, style: textStyle.optional() }).strict(),
    z.object({ type: z.literal("add_shape"), slide_id: slideId, shape: shapeType, ...box, fill_color: color.optional(), alpha: alpha.optional(), rotation: z.number().finite().optional(), link_url: z.string().url().optional(), text: z.string().min(1).optional(), text_style: textStyle.optional(), ...outline }).strict(),
    z.object({ type: z.literal("add_image"), slide_id: slideId, ...imageSource, ...box, alt_text: z.string().optional(), title: z.string().optional(), rotation: z.number().finite().optional() }).strict(),
    z.object({
      type: z.literal("add_table"), slide_id: slideId, rows: z.number().int().min(1).max(1000), columns: z.number().int().min(1).max(1000), ...box,
      cells: z.array(z.array(z.string())).optional(), header_row: z.boolean().optional(),
      header_fill_color: color.optional(), body_fill_color: color.optional(), text_color: color.optional(),
      font_size: z.number().positive().finite().optional(), bold: z.boolean().optional(), align: alignment.optional(),
      border_color: color.optional(), border_weight: z.number().nonnegative().finite().optional(),
      cell_styles: z.array(z.array(cellStyle)).optional(),
    }).strict(),
    z.object({ type: z.literal("replace_text"), element_id: slideId, text: z.string() }).strict(),
    z.object({ type: z.literal("style_text"), element_id: slideId, style: textStyle, start_index: z.number().int().nonnegative().optional(), end_index: z.number().int().nonnegative().optional() }).strict(),
    z.object({ type: z.literal("style_shape"), element_id: slideId, fill_color: color.optional(), alpha: alpha.optional(), content_alignment: verticalAnchor.optional(), link_url: z.string().url().optional(), text_style: textStyle.optional(), ...outline }).strict(),
    z.object({ type: z.literal("style_image"), element_id: slideId, link_url: z.string().url().optional(), ...outline }).strict(),
    z.object({ type: z.literal("set_background"), slide_id: slideId, color: color.optional(), theme_color: themeColor.optional(), image_url: z.string().url().optional(), drive_file_id: z.string().min(1).optional() }).strict(),
    z.object({ type: z.literal("add_notes"), slide_id: slideId, text: z.string().min(1) }).strict(),
    z.object({ type: z.literal("link_element"), element_id: slideId, url: z.string().url() }).strict(),
    z.object({ type: z.literal("set_alt_text"), element_id: slideId, title: z.string().optional(), description: z.string().optional() }).strict(),
    z.object({ type: z.literal("group_elements"), element_ids: z.array(slideId).min(2), group_id: z.string().min(1).optional() }).strict(),
    z.object({ type: z.literal("ungroup_elements"), group_id: slideId }).strict(),
    z.object({ type: z.literal("z_order"), element_ids: z.array(slideId).min(1), operation: z.enum(["BRING_TO_FRONT", "BRING_FORWARD", "SEND_TO_BACK", "SEND_BACKWARD"]) }).strict(),
    z.object({ type: z.literal("align_elements"), element_ids: z.array(slideId).min(1), alignment: z.enum(["LEFT", "CENTER", "RIGHT", "TOP", "MIDDLE", "BOTTOM"]) }).strict(),
    z.object({ type: z.literal("distribute_elements"), element_ids: z.array(slideId).min(2), axis: z.enum(["HORIZONTAL", "VERTICAL"]) }).strict(),
    z.object({ type: z.literal("move_element"), element_id: slideId, x: z.number().finite(), y: z.number().finite() }).strict(),
    z.object({ type: z.literal("transform_element"), element_id: slideId, x: z.number().finite(), y: z.number().finite(), scale_x: z.number().positive().finite(), scale_y: z.number().positive().finite(), rotation: z.number().finite().optional() }).strict(),
    z.object({ type: z.literal("delete_element"), element_id: slideId }).strict(),
  ])).min(1).max(100),
}).superRefine(({ operations }, ctx) => {
  operations.forEach((op, index) => {
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operations", index, "type"], message });
    if (op.type === "add_slide" && op.layout && op.layout_id) issue("Provide layout or layout_id, not both");
    if (op.type === "style_shape" && op.fill_color === undefined && op.alpha === undefined && op.content_alignment === undefined && op.link_url === undefined && op.text_style === undefined && op.outline_color === undefined && op.outline_weight === undefined && op.outline_alpha === undefined && op.outline_dash_style === undefined) issue("Provide at least one shape, outline or text style property");
    if (op.type === "style_image" && op.link_url === undefined && op.outline_color === undefined && op.outline_weight === undefined && op.outline_alpha === undefined && op.outline_dash_style === undefined) issue("Provide link_url or outline properties");
    if (op.type === "add_text_box" && !op.text && !op.runs) issue("Provide text or runs");
    if (op.type === "add_image" && !op.url && !op.drive_file_id) issue("Provide url or drive_file_id");
    if (op.type === "add_image" && op.url && op.drive_file_id) issue("Provide url or drive_file_id, not both");
    if (op.type === "set_background" && !op.color && !op.theme_color && !op.image_url && !op.drive_file_id) issue("Provide color, theme_color, image_url or drive_file_id");
    if (op.type === "set_background" && (op.image_url || op.drive_file_id) && (op.color || op.theme_color)) issue("Provide a solid colour or an image source, not both");
    if (op.type === "set_background" && op.image_url && op.drive_file_id) issue("Provide image_url or drive_file_id, not both");
    if (op.type === "set_background" && op.color && op.theme_color) issue("Provide color or theme_color, not both");
    if ((op.type === "add_shape" || op.type === "style_shape") && op.alpha !== undefined && op.fill_color === undefined) issue("fill_color is required with alpha");
    if (op.type === "style_text" && op.start_index !== undefined && op.end_index === undefined) issue("end_index is required with start_index");
    if (op.type === "style_text" && op.start_index !== undefined && op.end_index !== undefined && op.end_index <= op.start_index) issue("end_index must be greater than start_index");
    if (op.type === "set_alt_text" && op.title === undefined && op.description === undefined) issue("Provide title or description");
    if (op.type === "add_table" && op.cells && (op.cells.length !== op.rows || op.cells.some((row) => row.length !== op.columns))) issue("cells dimensions must match rows and columns");
    if (op.type === "add_table" && op.cell_styles && (op.cell_styles.length !== op.rows || op.cell_styles.some((row) => row.length !== op.columns))) issue("cell_styles dimensions must match rows and columns");
  });
});
export type SlideEditOperation = z.infer<typeof EditPresentationSchema>["operations"][number];
export const AddSlideImageSchema = z.object({
  presentation_id: slideId, slide_id: slideId,
  file_path: z.string().min(1), ...box,
});
export const UploadDriveFileSchema = z.object({
  file_path: z.string().min(1),
  name: z.string().min(1).optional(),
  share_anyone: z.boolean().optional().default(false),
});
export const CopySlideSchema = z.object({
  target_presentation_id: slideId,
  source_presentation_id: slideId,
  source_slide_id: slideId,
  index: z.number().int().nonnegative().optional(),
});

// ============================================================================
// Google Sheets Schemas
// ============================================================================

/**
 * Schema for list_spreadsheets tool
 */
export const ListSpreadsheetsSchema = z.object({
  max_results: z.number().int().min(1).max(100).optional().default(10),
});

/**
 * Schema for search_spreadsheets tool
 */
export const SearchSpreadsheetsSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  max_results: z.number().int().min(1).max(100).optional().default(10),
});

/**
 * Schema for get_spreadsheet tool
 */
export const GetSpreadsheetSchema = z.object({
  spreadsheet_id: z.string().min(1, "Spreadsheet ID is required"),
});

/**
 * Schema for get_sheet_data tool
 */
export const GetSheetDataSchema = z.object({
  spreadsheet_id: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required (e.g., 'Sheet1!A1:D10' or 'A1:D10')"),
  start_row: z.number().int().min(0).optional().default(0),
  max_rows: z.number().int().min(1).max(1000).optional().default(200),
});

/**
 * Schema for update_cells tool
 */
export const UpdateCellsSchema = z.object({
  spreadsheet_id: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range is required"),
  values: z.array(z.array(z.string())).min(1, "Values are required"),
});

/**
 * Schema for append_rows tool
 */
export const AppendRowsSchema = z.object({
  spreadsheet_id: z.string().min(1, "Spreadsheet ID is required"),
  range: z.string().min(1, "Range/sheet name is required"),
  values: z.array(z.array(z.string())).min(1, "Values are required"),
});

/**
 * Schema for create_spreadsheet tool
 */
export const CreateSpreadsheetSchema = z.object({
  title: z.string().min(1, "Title is required"),
});

/**
 * Schema for list_comments tool
 *
 * Comments are a Drive resource, so `file_id` works for Docs, Slides, Sheets
 * and any other Drive file.
 */
export const ListCommentsSchema = z.object({
  file_id: z.string().min(1, "File ID is required"),
  status: z.enum(["all", "open", "resolved"]).optional().default("open"),
  include_deleted: z.boolean().optional().default(false),
  max_comments: z.number().int().min(1).max(200).optional().default(50),
  page_token: z.string().min(1).optional(),
  detail: z.enum(["compact", "full"]).optional().default("compact"),
}).strict();

/**
 * Schema for manage_comment tool
 */
export const ManageCommentSchema = z.object({
  file_id: z.string().min(1, "File ID is required"),
  action: z.enum(["create", "reply", "update", "resolve", "reopen", "delete"]),
  comment_id: z.string().min(1).optional(),
  post_id: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  // Anchor inputs (create only)
  quoted_text: z.string().min(1).optional(),
  start_index: z.number().int().min(0).optional(),
  end_index: z.number().int().min(0).optional(),
  tab_id: z.string().min(1).optional(),
  object_id: z.string().min(1).optional(),
  table_cell: z.string().min(1).optional(),
  row_span: z.number().int().min(1).optional(),
  column_span: z.number().int().min(1).optional(),
  cell: z.string().min(1).optional(),
  sheet_id: z.number().int().min(0).optional(),
  row_index: z.number().int().min(0).optional(),
  column_index: z.number().int().min(0).optional(),
  assignee_email: z.string().email().optional(),
  anchor: z.string().min(1).optional(),
}).strict()
  .refine(
    (value) => value.action === "create" || Boolean(value.comment_id),
    { message: "comment_id is required for reply, update, resolve, reopen and delete", path: ["comment_id"] }
  )
  .refine(
    (value) => !["create", "reply", "update"].includes(value.action) || Boolean(value.content),
    { message: "content is required for create, reply and update", path: ["content"] }
  )
  .refine(
    (value) =>
      (value.start_index === undefined) === (value.end_index === undefined),
    { message: "start_index and end_index must be provided together", path: ["end_index"] }
  )
  .refine(
    (value) => value.start_index === undefined || value.end_index === undefined || value.end_index > value.start_index,
    { message: "end_index must be greater than start_index", path: ["end_index"] }
  )
  .refine(
    (value) => value.table_cell === undefined || Boolean(value.object_id),
    { message: "table_cell requires object_id of the Slides table", path: ["object_id"] }
  )
  .refine(
    (value) => value.action === "create" || onlyCreateFieldsAbsent(value as unknown as Record<string, unknown>),
    { message: "anchor fields and assignee_email are only valid for the create action", path: ["quoted_text"] }
  );

const CREATE_ONLY_FIELDS = [
  "quoted_text",
  "start_index",
  "end_index",
  "tab_id",
  "object_id",
  "table_cell",
  "row_span",
  "column_span",
  "cell",
  "sheet_id",
  "row_index",
  "column_index",
  "assignee_email",
  "anchor",
] as const;

function onlyCreateFieldsAbsent(value: Record<string, unknown>): boolean {
  return CREATE_ONLY_FIELDS.every((field) => value[field] === undefined);
}

/**
 * Validate and parse input with a schema
 * Returns the validated data or throws a formatted error
 */
export function validateInput<T extends z.ZodType>(
  schema: T,
  input: unknown
): z.infer<T> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `${e.path.join(".")}: ${e.message}`)
      .join(", ");
    throw new Error(`Invalid input: ${errors}`);
  }

  return result.data;
}
