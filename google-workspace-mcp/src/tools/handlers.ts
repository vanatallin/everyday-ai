/**
 * Tool Handlers
 * Implementation of all MCP tool handlers
 */

import { authenticate, isAuthenticated, getAuthStatus } from "../auth.js";
import { GoogleMeetService } from "../meet-api.js";
import { GmailService, getHeader, getMessageBody } from "../gmail-api.js";
import { GoogleDocsService, getDocumentUrl } from "../docs-api.js";
import { GoogleCommentsService, formatComments, describeAnchor, isAnchorEmpty } from "../comments-api.js";
import { GoogleSlidesService, getPresentationUrl } from "../slides-api.js";
import { GoogleSheetsService, getSpreadsheetUrl } from "../sheets-api.js";
import { logger } from "../logger.js";
import {
  formatDate,
  formatDuration,
  getParticipantDisplayName,
  getMeetingLink,
  createErrorResponse,
  createSuccessResponse,
  NOT_AUTHENTICATED_RESPONSE,
} from "../utils.js";
import {
  validateInput,
  AuthenticateSchema,
  ListConferencesSchema,
  GetConferenceSchema,
  ConferenceNameSchema,
  TranscriptNameSchema,
  ListMeetingsSchema,
  ListEmailsSchema,
  SearchEmailsSchema,
  GetEmailSchema,
  GetThreadSchema,
  SendEmailSchema,
  TrashEmailSchema,
  MarkEmailSchema,
  ListDocsSchema,
  SearchDocsSchema,
  GetDocSchema,
  CreateDocSchema,
  AppendToDocSchema,
  ReplaceInDocSchema,
  CreateCalendarEventSchema,
  ListPresentationsSchema,
  SearchPresentationsSchema,
  GetPresentationSchema,
  CreatePresentationSchema,
  InspectPresentationSchema,
  SlidePreviewSchema,
  EditPresentationSchema,
  AddSlideImageSchema,
  UploadDriveFileSchema,
  CopySlideSchema,
  ListSpreadsheetsSchema,
  SearchSpreadsheetsSchema,
  GetSpreadsheetSchema,
  GetSheetDataSchema,
  UpdateCellsSchema,
  AppendRowsSchema,
  CreateSpreadsheetSchema,
  ListCommentsSchema,
  ManageCommentSchema,
} from "../schemas.js";
import type { ToolResponse, GoogleAuth } from "../types.js";
import { currentSession, type SessionContext } from "../session.js";

/**
 * Ensure the active session is authenticated and return its auth instance.
 *
 * The `local` identity keeps the historical behavior of loading
 * `credentials.json` / `token.json` from disk. Other identities are expected to
 * have auth installed by the transport layer (per-user token store).
 */
async function ensureAuth(): Promise<GoogleAuth> {
  const session = currentSession();
  const existing = session.peekAuth();
  if (existing) {
    return existing;
  }

  if (session.user.source !== "local") {
    throw new Error("NOT_AUTHENTICATED");
  }

  if (await isAuthenticated(session.user)) {
    logger.debug("Auto-authenticating with saved credentials");
    const auth = await authenticate({ identity: session.user });
    session.setAuth(auth);
    return auth;
  }

  throw new Error("NOT_AUTHENTICATED");
}

/** Resolve a service from the active session, authenticating on first use. */
async function sessionService<T>(pick: (session: SessionContext) => T): Promise<T> {
  const session = currentSession();
  if (!session.peekAuth()) {
    await ensureAuth();
  }
  return pick(session);
}

const getMeetService = () => sessionService((s) => s.meetService());
const getGmailService = () => sessionService((s) => s.gmailService());
const getDocsService = () => sessionService((s) => s.docsService());
const getSlidesService = () => sessionService((s) => s.slidesService());
const getSheetsService = () => sessionService((s) => s.sheetsService());
const getCommentsService = () => sessionService((s) => s.commentsService());

/**
 * Wrapper to handle authentication errors consistently
 */
async function withMeetAuth<T>(
  handler: (service: GoogleMeetService) => Promise<T>
): Promise<T | ToolResponse> {
  try {
    const service = await getMeetService();
    return await handler(service);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_AUTHENTICATED") {
      return NOT_AUTHENTICATED_RESPONSE;
    }
    throw error;
  }
}

/**
 * Wrapper for Gmail handlers
 */
async function withGmailAuth<T>(
  handler: (service: GmailService) => Promise<T>
): Promise<T | ToolResponse> {
  try {
    const service = await getGmailService();
    return await handler(service);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_AUTHENTICATED") {
      return NOT_AUTHENTICATED_RESPONSE;
    }
    throw error;
  }
}

/**
 * Wrapper for Docs handlers
 */
async function withDocsAuth<T>(
  handler: (service: GoogleDocsService) => Promise<T>
): Promise<T | ToolResponse> {
  try {
    const service = await getDocsService();
    return await handler(service);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_AUTHENTICATED") {
      return NOT_AUTHENTICATED_RESPONSE;
    }
    throw error;
  }
}

/**
 * Wrapper for Slides handlers
 */
async function withSlidesAuth<T>(
  handler: (service: GoogleSlidesService) => Promise<T>
): Promise<T | ToolResponse> {
  try {
    const service = await getSlidesService();
    return await handler(service);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_AUTHENTICATED") {
      return NOT_AUTHENTICATED_RESPONSE;
    }
    throw error;
  }
}

/**
 * Wrapper for Sheets handlers
 */
async function withSheetsAuth<T>(
  handler: (service: GoogleSheetsService) => Promise<T>
): Promise<T | ToolResponse> {
  try {
    const service = await getSheetsService();
    return await handler(service);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_AUTHENTICATED") {
      return NOT_AUTHENTICATED_RESPONSE;
    }
    throw error;
  }
}

/**
 * Wrapper for Comments handlers
 */
async function withCommentsAuth<T>(
  handler: (service: GoogleCommentsService) => Promise<T>
): Promise<T | ToolResponse> {
  try {
    const service = await getCommentsService();
    return await handler(service);
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_AUTHENTICATED") {
      return NOT_AUTHENTICATED_RESPONSE;
    }
    throw error;
  }
}

// ============================================================================
// Auth Tool Handlers
// ============================================================================

export async function handleAuthStatus(): Promise<ToolResponse> {
  const session = currentSession();
  return createSuccessResponse(await getAuthStatus(session.user));
}

export async function handleAuthenticate(args: unknown): Promise<ToolResponse> {
  try {
    const { force } = validateInput(AuthenticateSchema, args ?? {});
    const session = currentSession();

    // Browser-based consent only works for the local stdio user. Remote
    // sessions are authenticated by the transport layer instead.
    if (session.user.source !== "local") {
      return createErrorResponse(
        "❌ This session cannot start a local OAuth flow. Authenticate through the server's OAuth endpoint and retry."
      );
    }

    session.setAuth(await authenticate({ force, identity: session.user }));
    return createSuccessResponse(
      "✅ Successfully authenticated with Google!\n\nYou can now use Google Meet, Calendar, Gmail, Docs, Slides, and Sheets tools."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResponse(`❌ Authentication failed: ${message}`);
  }
}

// ============================================================================
// Meet Tool Handlers
// ============================================================================

export async function handleListConferences(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { limit } = validateInput(ListConferencesSchema, args);
    const conferences = await service.listConferenceRecords(limit);

    if (conferences.length === 0) {
      return createSuccessResponse(
        "No conference records found.\n\n" +
          "Note: Conference records are only available for meetings where:\n" +
          "- Recording or transcription was enabled\n" +
          "- The meeting occurred recently (records expire after some time)"
      );
    }

    const formatted = conferences
      .map((conf, i) => {
        return `**${i + 1}. Conference**
- Name: \`${conf.name}\`
- Start: ${formatDate(conf.startTime)}
- End: ${formatDate(conf.endTime)}
- Duration: ${formatDuration(conf.startTime, conf.endTime)}`;
      })
      .join("\n\n");

    return createSuccessResponse(
      `**Recent Conference Records:**\n\n${formatted}\n\n---\n` +
        "Use `list_recordings` or `list_transcripts` with a conference name to get artifacts."
    );
  }) as Promise<ToolResponse>;
}

export async function handleGetConference(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { name } = validateInput(GetConferenceSchema, args);
    const conf = await service.getConferenceRecord(name);

    return createSuccessResponse(
      `**Conference Details:**\n\n` +
        `- Name: \`${conf.name}\`\n` +
        `- Start: ${formatDate(conf.startTime)}\n` +
        `- End: ${formatDate(conf.endTime)}\n` +
        `- Duration: ${formatDuration(conf.startTime, conf.endTime)}\n` +
        `- Space: ${conf.space || "N/A"}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleListParticipants(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { conference_name } = validateInput(ConferenceNameSchema, args);
    const participants = await service.listParticipants(conference_name);

    if (participants.length === 0) {
      return createSuccessResponse("No participants found for this conference.");
    }

    const formatted = participants
      .map((p, i) => {
        const displayName = getParticipantDisplayName(p);
        return `${i + 1}. **${displayName}**
   - Joined: ${formatDate(p.earliestStartTime)}
   - Left: ${formatDate(p.latestEndTime)}`;
      })
      .join("\n\n");

    return createSuccessResponse(`**Participants (${participants.length}):**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleListRecordings(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { conference_name } = validateInput(ConferenceNameSchema, args);
    const recordings = await service.listRecordings(conference_name);

    if (recordings.length === 0) {
      return createSuccessResponse(
        "No recordings found for this conference.\n\n" +
          "Note: Recordings must be enabled in the meeting for them to be available."
      );
    }

    const formatted = recordings
      .map((rec, i) => {
        return `**${i + 1}. Recording**
- Name: \`${rec.name}\`
- State: ${rec.state || "N/A"}
- Start: ${formatDate(rec.startTime)}
- End: ${formatDate(rec.endTime)}
- Drive Link: ${rec.driveDestination?.exportUri || "N/A"}`;
      })
      .join("\n\n");

    return createSuccessResponse(`**Recordings:**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleListTranscripts(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { conference_name } = validateInput(ConferenceNameSchema, args);
    const transcripts = await service.listTranscripts(conference_name);

    if (transcripts.length === 0) {
      return createSuccessResponse(
        "No transcripts found for this conference.\n\n" +
          "Note: Transcription must be enabled in the meeting for transcripts to be available."
      );
    }

    const formatted = transcripts
      .map((trans, i) => {
        return `**${i + 1}. Transcript**
- Name: \`${trans.name}\`
- State: ${trans.state || "N/A"}
- Start: ${formatDate(trans.startTime)}
- End: ${formatDate(trans.endTime)}
- Docs Link: ${trans.docsDestination?.exportUri || "N/A"}`;
      })
      .join("\n\n");

    return createSuccessResponse(
      `**Transcripts:**\n\n${formatted}\n\n---\n` +
        "Use `get_transcript_text` with a transcript name to get the actual text."
    );
  }) as Promise<ToolResponse>;
}

export async function handleGetTranscriptText(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { transcript_name } = validateInput(TranscriptNameSchema, args);
    const entries = await service.listTranscriptEntries(transcript_name);

    if (entries.length === 0) {
      return createSuccessResponse("No transcript entries found.");
    }

    const formatted = entries
      .map((entry) => {
        const time = formatDate(entry.startTime);
        const speaker = entry.participant || "Unknown";
        return `[${time}] ${speaker}: ${entry.text}`;
      })
      .join("\n");

    return createSuccessResponse(`**Transcript:**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleCreateMeeting(): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const space = await service.createSpace();

    return createSuccessResponse(
      `✅ **Meeting Created!**\n\n` +
        `- Meeting URI: ${space.meetingUri || "N/A"}\n` +
        `- Meeting Code: ${space.meetingCode || "N/A"}\n` +
        `- Resource Name: \`${space.name}\``
    );
  }) as Promise<ToolResponse>;
}

export async function handleListUpcomingMeetings(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { limit } = validateInput(ListMeetingsSchema, args);
    const meetings = await service.listUpcomingMeetings(limit);

    if (meetings.length === 0) {
      return createSuccessResponse("No upcoming Google Meet meetings found in your calendar.");
    }

    const formatted = meetings
      .map((event, i) => {
        const start = event.start?.dateTime || event.start?.date;
        const meetLink = getMeetingLink(event);
        return `**${i + 1}. ${event.summary || "Untitled"}**
- When: ${formatDate(start)}
- Meet Link: ${meetLink}`;
      })
      .join("\n\n");

    return createSuccessResponse(`**Upcoming Google Meet Meetings:**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleListPastMeetings(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { limit } = validateInput(ListMeetingsSchema, args);
    const meetings = await service.listPastMeetings(limit);

    if (meetings.length === 0) {
      return createSuccessResponse(
        "No past Google Meet meetings found in your calendar (last 30 days)."
      );
    }

    const formatted = meetings
      .map((event, i) => {
        const start = event.start?.dateTime || event.start?.date;
        const meetLink = getMeetingLink(event);
        return `**${i + 1}. ${event.summary || "Untitled"}**
- When: ${formatDate(start)}
- Meet Link: ${meetLink}`;
      })
      .join("\n\n");

    return createSuccessResponse(`**Past Google Meet Meetings (Last 30 Days):**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleSummarizeTranscript(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const { transcript_name } = validateInput(TranscriptNameSchema, args);
    const entries = await service.listTranscriptEntries(transcript_name);

    if (entries.length === 0) {
      return createSuccessResponse("No transcript entries found to summarize.");
    }

    const transcriptText = entries
      .map((entry) => {
        const speaker = entry.participant || "Speaker";
        return `${speaker}: ${entry.text}`;
      })
      .join("\n");

    const totalDuration =
      entries.length > 0
        ? formatDuration(entries[0].startTime, entries[entries.length - 1].endTime)
        : "N/A";

    return createSuccessResponse(
      `Here is the meeting transcript to summarize:\n\n` +
        `---\n**TRANSCRIPT** (Duration: ${totalDuration}, Entries: ${entries.length})\n---\n\n` +
        `${transcriptText}\n\n` +
        `---\n\n` +
        `Please provide a comprehensive meeting summary including:\n\n` +
        `1. **Meeting Overview**: Brief description of what the meeting was about\n\n` +
        `2. **Key Discussion Points**: Main topics that were discussed\n\n` +
        `3. **Decisions Made**: Any decisions or conclusions reached\n\n` +
        `4. **Action Items**: Tasks or follow-ups mentioned (with assignees if mentioned)\n\n` +
        `5. **Important Quotes**: Any notable statements or commitments\n\n` +
        `6. **Next Steps**: What should happen after this meeting`
    );
  }) as Promise<ToolResponse>;
}

export async function handleCreateCalendarEvent(args: unknown): Promise<ToolResponse> {
  return withMeetAuth(async (service) => {
    const params = validateInput(CreateCalendarEventSchema, args);
    const event = await service.createCalendarEvent(params);

    const attendeesList = event.attendees?.length
      ? event.attendees.map((a) => `  - ${a.email}`).join("\n")
      : "None";

    const startTime = event.start.dateTime
      ? new Date(event.start.dateTime).toLocaleString()
      : event.start.date || "N/A";

    return createSuccessResponse(
      `✅ **Calendar Event Created!**\n\n` +
        `- **Title:** ${event.summary}\n` +
        `- **When:** ${startTime}\n` +
        `- **Calendar Link:** ${event.htmlLink}\n` +
        (event.hangoutLink ? `- **Google Meet:** ${event.hangoutLink}\n` : "") +
        `\n**Attendees:**\n${attendeesList}`
    );
  }) as Promise<ToolResponse>;
}

// ============================================================================
// Gmail Tool Handlers
// ============================================================================

export async function handleGmailProfile(): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const profile = await service.getProfile();

    return createSuccessResponse(
      `**Gmail Profile:**\n\n` +
        `- Email: ${profile.emailAddress}\n` +
        `- Total Messages: ${profile.messagesTotal.toLocaleString()}\n` +
        `- Total Threads: ${profile.threadsTotal.toLocaleString()}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleListEmails(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const { limit } = validateInput(ListEmailsSchema, args);
    const messages = await service.listMessages(undefined, limit);

    if (messages.length === 0) {
      return createSuccessResponse("No emails found in your inbox.");
    }

    const formatted = messages
      .map((msg, i) => {
        const from = getHeader(msg, "From");
        const subject = getHeader(msg, "Subject") || "(No Subject)";
        const date = getHeader(msg, "Date");
        const isUnread = msg.labelIds?.includes("UNREAD") ? "🔵 " : "";
        return `**${i + 1}. ${isUnread}${subject}**
- From: ${from}
- Date: ${date}
- ID: \`${msg.id}\`
- Snippet: ${msg.snippet?.substring(0, 100)}...`;
      })
      .join("\n\n");

    return createSuccessResponse(`**Inbox (${messages.length} emails):**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleSearchEmails(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const { query, limit } = validateInput(SearchEmailsSchema, args);
    const messages = await service.searchEmails(query, limit);

    if (messages.length === 0) {
      return createSuccessResponse(`No emails found matching: "${query}"`);
    }

    const formatted = messages
      .map((msg, i) => {
        const from = getHeader(msg, "From");
        const subject = getHeader(msg, "Subject") || "(No Subject)";
        const date = getHeader(msg, "Date");
        return `**${i + 1}. ${subject}**
- From: ${from}
- Date: ${date}
- ID: \`${msg.id}\``;
      })
      .join("\n\n");

    return createSuccessResponse(
      `**Search Results for "${query}" (${messages.length} emails):**\n\n${formatted}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleGetEmail(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const { message_id } = validateInput(GetEmailSchema, args);
    const message = await service.getMessage(message_id);

    const from = getHeader(message, "From");
    const to = getHeader(message, "To");
    const subject = getHeader(message, "Subject") || "(No Subject)";
    const date = getHeader(message, "Date");
    const body = getMessageBody(message);

    return createSuccessResponse(
      `**Email Details:**\n\n` +
        `- **Subject:** ${subject}\n` +
        `- **From:** ${from}\n` +
        `- **To:** ${to}\n` +
        `- **Date:** ${date}\n` +
        `- **Thread ID:** \`${message.threadId}\`\n\n` +
        `---\n\n**Body:**\n\n${body}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleGetThread(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const { thread_id } = validateInput(GetThreadSchema, args);
    const thread = await service.getThread(thread_id);

    if (!thread.messages || thread.messages.length === 0) {
      return createSuccessResponse("No messages found in this thread.");
    }

    const formatted = thread.messages
      .map((msg, i) => {
        const from = getHeader(msg, "From");
        const date = getHeader(msg, "Date");
        const body = getMessageBody(msg);
        return `**Message ${i + 1}**\n- From: ${from}\n- Date: ${date}\n\n${body}`;
      })
      .join("\n\n---\n\n");

    const subject = getHeader(thread.messages[0], "Subject") || "(No Subject)";

    return createSuccessResponse(
      `**Thread: ${subject}** (${thread.messages.length} messages)\n\n---\n\n${formatted}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleSendEmail(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const params = validateInput(SendEmailSchema, args);
    const message = await service.sendEmail(params);

    return createSuccessResponse(
      `✅ **Email Sent Successfully!**\n\n` +
        `- To: ${params.to}\n` +
        `- Subject: ${params.subject}\n` +
        `- Message ID: \`${message.id}\``
    );
  }) as Promise<ToolResponse>;
}

export async function handleCreateDraft(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const params = validateInput(SendEmailSchema, args);
    const draft = await service.createDraft(params);

    return createSuccessResponse(
      `✅ **Draft Created Successfully!**\n\n` +
        `- To: ${params.to}\n` +
        `- Subject: ${params.subject}\n` +
        `- Draft ID: \`${draft.id}\``
    );
  }) as Promise<ToolResponse>;
}

export async function handleListLabels(): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const labels = await service.listLabels();

    const formatted = labels
      .map((label) => `- **${label.name}** (\`${label.id}\`)`)
      .join("\n");

    return createSuccessResponse(`**Gmail Labels:**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleTrashEmail(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const { message_id } = validateInput(TrashEmailSchema, args);
    await service.trashMessage(message_id);

    return createSuccessResponse(`✅ Email moved to trash: \`${message_id}\``);
  }) as Promise<ToolResponse>;
}

export async function handleMarkAsRead(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const { message_id } = validateInput(MarkEmailSchema, args);
    await service.markAsRead(message_id);

    return createSuccessResponse(`✅ Email marked as read: \`${message_id}\``);
  }) as Promise<ToolResponse>;
}

export async function handleMarkAsUnread(args: unknown): Promise<ToolResponse> {
  return withGmailAuth(async (service) => {
    const { message_id } = validateInput(MarkEmailSchema, args);
    await service.markAsUnread(message_id);

    return createSuccessResponse(`✅ Email marked as unread: \`${message_id}\``);
  }) as Promise<ToolResponse>;
}

// ============================================================================
// Google Docs Tool Handlers
// ============================================================================

export async function handleListDocs(args: unknown): Promise<ToolResponse> {
  return withDocsAuth(async (service) => {
    const { limit } = validateInput(ListDocsSchema, args);
    const docs = await service.listDocuments(limit);

    if (docs.length === 0) {
      return createSuccessResponse("No Google Docs found in your Drive.");
    }

    const formatted = docs
      .map((doc, i) => {
        const modified = new Date(doc.modifiedTime).toLocaleString();
        return `**${i + 1}. ${doc.name}**
- ID: \`${doc.id}\`
- Modified: ${modified}
- URL: ${getDocumentUrl(doc.id)}`;
      })
      .join("\n\n");

    return createSuccessResponse(`**Recent Google Docs (${docs.length}):**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleSearchDocs(args: unknown): Promise<ToolResponse> {
  return withDocsAuth(async (service) => {
    const { query, limit } = validateInput(SearchDocsSchema, args);
    const docs = await service.searchDocuments(query, limit);

    if (docs.length === 0) {
      return createSuccessResponse(`No documents found matching: "${query}"`);
    }

    const formatted = docs
      .map((doc, i) => {
        const modified = new Date(doc.modifiedTime).toLocaleString();
        return `**${i + 1}. ${doc.name}**
- ID: \`${doc.id}\`
- Modified: ${modified}
- URL: ${getDocumentUrl(doc.id)}`;
      })
      .join("\n\n");

    return createSuccessResponse(
      `**Search Results for "${query}" (${docs.length} documents):**\n\n${formatted}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleGetDoc(args: unknown): Promise<ToolResponse> {
  return withDocsAuth(async (service) => {
    const { document_id, include_comments } = validateInput(GetDocSchema, args);

    // Comments are opt-in: fetching them for every read wastes context and an
    // extra API call. list_comments is the richer, paginated path.
    const [docWithTabs, comments] = await Promise.all([
      service.getDocumentWithTabs(document_id),
      include_comments
        ? service.getDocumentComments(document_id).catch(() => []) // Don't fail if comments can't be fetched
        : Promise.resolve([]),
    ]);

    let content: string;
    let tabInfo = "";

    if (docWithTabs.tabs.length === 1) {
      // Single tab - simple format
      content = docWithTabs.tabs[0].content || "(Empty document)";
    } else {
      // Multiple tabs - show tab structure
      tabInfo = `- Tabs: ${docWithTabs.tabs.length} (${docWithTabs.tabs.map(t => t.title).join(", ")})\n`;
      content = docWithTabs.tabs
        .map((tab) => `## ${tab.title}\n\n${tab.content || "(Empty tab)"}`)
        .join("\n\n---\n\n");
    }

    // Compact summary only — use list_comments for full bodies and pagination.
    const commentsSection =
      comments.length > 0
        ? `\n\n---\n\n${formatComments(document_id, { comments })}`
        : "";

    return createSuccessResponse(
      `**Document: ${docWithTabs.title}**\n\n` +
        `- ID: \`${document_id}\`\n` +
        tabInfo +
        `- URL: ${getDocumentUrl(document_id)}\n\n` +
        `---\n\n${content}${commentsSection}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleCreateDoc(args: unknown): Promise<ToolResponse> {
  return withDocsAuth(async (service) => {
    const { title, content } = validateInput(CreateDocSchema, args);
    const doc = await service.createDocument({ title, content });

    return createSuccessResponse(
      `✅ **Document Created!**\n\n` +
        `- Title: ${doc.title}\n` +
        `- ID: \`${doc.documentId}\`\n` +
        `- URL: ${getDocumentUrl(doc.documentId)}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleAppendToDoc(args: unknown): Promise<ToolResponse> {
  return withDocsAuth(async (service) => {
    const { document_id, text } = validateInput(AppendToDocSchema, args);
    await service.appendText(document_id, text);

    return createSuccessResponse(
      `✅ Text appended to document!\n\n` +
        `- Document ID: \`${document_id}\`\n` +
        `- URL: ${getDocumentUrl(document_id)}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleReplaceInDoc(args: unknown): Promise<ToolResponse> {
  return withDocsAuth(async (service) => {
    const { document_id, search_text, replace_text, match_case } = validateInput(
      ReplaceInDocSchema,
      args
    );
    const count = await service.replaceText(document_id, search_text, replace_text, match_case);

    return createSuccessResponse(
      `✅ Text replaced in document!\n\n` +
        `- Occurrences replaced: ${count}\n` +
        `- Search: "${search_text}"\n` +
        `- Replace: "${replace_text}"\n` +
        `- Document: ${getDocumentUrl(document_id)}`
    );
  }) as Promise<ToolResponse>;
}

// ============================================================================
// Google Slides Tool Handlers
// ============================================================================

export async function handleCreatePresentation(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const { title, width, height } = validateInput(CreatePresentationSchema, args);
    const pageSize = width !== undefined && height !== undefined ? { width, height } : undefined;
    return createSuccessResponse(JSON.stringify(await service.createPresentation(title, pageSize), null, 2));
  }) as Promise<ToolResponse>;
}

export async function handleInspectPresentation(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const { presentation_id } = validateInput(InspectPresentationSchema, args);
    return createSuccessResponse(JSON.stringify(await service.inspectPresentation(presentation_id), null, 2));
  }) as Promise<ToolResponse>;
}

export async function handleEditPresentation(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const { presentation_id, operations, revision_id } = validateInput(EditPresentationSchema, args);
    return createSuccessResponse(JSON.stringify(await service.editPresentation(presentation_id, operations, revision_id), null, 2));
  }) as Promise<ToolResponse>;
}

export async function handleSlidePreview(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const { presentation_id, slide_id } = validateInput(SlidePreviewSchema, args);
    const image = await service.getSlidePreview(presentation_id, slide_id);
    return { content: [{ type: "image" as const, data: image.data, mimeType: image.mimeType }] };
  }) as Promise<ToolResponse>;
}

export async function handleAddSlideImage(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const input = validateInput(AddSlideImageSchema, args);
    return createSuccessResponse(JSON.stringify(await service.addSlideImage(input), null, 2));
  }) as Promise<ToolResponse>;
}

export async function handleUploadDriveFile(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const input = validateInput(UploadDriveFileSchema, args);
    return createSuccessResponse(JSON.stringify(await service.uploadDriveFile(input), null, 2));
  }) as Promise<ToolResponse>;
}

export async function handleCopySlide(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const input = validateInput(CopySlideSchema, args);
    return createSuccessResponse(JSON.stringify(await service.copySlide(input), null, 2));
  }) as Promise<ToolResponse>;
}

export async function handleListPresentations(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const { limit } = validateInput(ListPresentationsSchema, args);
    const presentations = await service.listPresentations(limit);

    if (presentations.length === 0) {
      return createSuccessResponse("No Google Slides presentations found in your Drive.");
    }

    const formatted = presentations
      .map((pres, i) => {
        const modified = new Date(pres.modifiedTime).toLocaleString();
        return `**${i + 1}. ${pres.name}**
- ID: \`${pres.id}\`
- Modified: ${modified}
- URL: ${getPresentationUrl(pres.id)}`;
      })
      .join("\n\n");

    return createSuccessResponse(`**Recent Presentations (${presentations.length}):**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleSearchPresentations(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const { query, limit } = validateInput(SearchPresentationsSchema, args);
    const presentations = await service.searchPresentations(query, limit);

    if (presentations.length === 0) {
      return createSuccessResponse(`No presentations found matching: "${query}"`);
    }

    const formatted = presentations
      .map((pres, i) => {
        const modified = new Date(pres.modifiedTime).toLocaleString();
        return `**${i + 1}. ${pres.name}**
- ID: \`${pres.id}\`
- Modified: ${modified}
- URL: ${getPresentationUrl(pres.id)}`;
      })
      .join("\n\n");

    return createSuccessResponse(
      `**Search Results for "${query}" (${presentations.length} presentations):**\n\n${formatted}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleGetPresentation(args: unknown): Promise<ToolResponse> {
  return withSlidesAuth(async (service) => {
    const { presentation_id, include_images } = validateInput(GetPresentationSchema, args);
    const presentation = await service.getPresentation(presentation_id, {
      includeImageData: include_images,
    });

    // Collect all image content blocks for MCP response
    const imageBlocks: Array<{ type: "image"; data: string; mimeType: string }> = [];

    const slidesContent = presentation.slides
      .map((slide) => {
        let content = `## Slide ${slide.slideNumber}\n\n`;

        // Text content
        content += slide.text || "(No text content)";

        // Images
        if (slide.images.length > 0) {
          content += `\n\n**Images (${slide.images.length}):**\n`;
          slide.images.forEach((img, i) => {
            content += `- Image ${i + 1}:`;
            if (img.description) content += ` "${img.description}"`;
            if (img.width && img.height) content += ` (${Math.round(img.width)}x${Math.round(img.height)})`;
            if (!include_images) {
              content += `\n  URL: ${img.contentUrl}\n`;
            }
            if (img.sourceUrl) content += `\n  Source: ${img.sourceUrl}`;
            content += "\n";

            // Add image to content blocks if data was downloaded
            if (img.base64Data && img.mimeType) {
              imageBlocks.push({
                type: "image",
                data: img.base64Data,
                mimeType: img.mimeType,
              });
            }
          });
        }

        // Videos
        if (slide.videos.length > 0) {
          content += `\n\n**Videos (${slide.videos.length}):**\n`;
          slide.videos.forEach((vid, i) => {
            content += `- Video ${i + 1}: [${vid.source}] ${vid.videoUrl}\n`;
          });
        }

        // Charts
        if (slide.charts.length > 0) {
          content += `\n\n**Charts (${slide.charts.length}):**\n`;
          slide.charts.forEach((chart, i) => {
            content += `- Chart ${i + 1}: ${chart.description}`;
            if (chart.spreadsheetId) {
              content += `\n  Linked to Sheets: https://docs.google.com/spreadsheets/d/${chart.spreadsheetId}`;
            }
            content += "\n";
          });
        }

        // Non-text shapes
        if (slide.shapes.length > 0) {
          content += `\n\n**Shapes:** ${slide.shapes.join(", ")}`;
        }

        // Speaker notes
        if (slide.speakerNotes) {
          content += `\n\n**Speaker Notes:**\n${slide.speakerNotes}`;
        }

        return content;
      })
      .join("\n\n---\n\n");

    // Summary of media across all slides
    const totalImages = presentation.slides.reduce((sum, s) => sum + s.images.length, 0);
    const totalVideos = presentation.slides.reduce((sum, s) => sum + s.videos.length, 0);
    const totalCharts = presentation.slides.reduce((sum, s) => sum + s.charts.length, 0);

    let mediaSummary = "";
    if (totalImages > 0 || totalVideos > 0 || totalCharts > 0) {
      mediaSummary = `- Media: ${totalImages} images, ${totalVideos} videos, ${totalCharts} charts\n`;
      if (include_images && imageBlocks.length > 0) {
        mediaSummary += `- Downloaded: ${imageBlocks.length} images for visual analysis\n`;
      }
    }

    const textContent =
      `# ${presentation.title}\n\n` +
      `- ID: \`${presentation.id}\`\n` +
      `- Slides: ${presentation.slideCount}\n` +
      mediaSummary +
      `- URL: ${getPresentationUrl(presentation.id)}\n\n` +
      `---\n\n${slidesContent}`;

    // Return text content followed by image content blocks
    return {
      content: [
        { type: "text" as const, text: textContent },
        ...imageBlocks,
      ],
    };
  }) as Promise<ToolResponse>;
}

// ============================================================================
// Google Sheets Tool Handlers
// ============================================================================

export async function handleListSpreadsheets(args: unknown): Promise<ToolResponse> {
  return withSheetsAuth(async (service) => {
    const { max_results } = validateInput(ListSpreadsheetsSchema, args);
    const spreadsheets = await service.listSpreadsheets(max_results);

    if (spreadsheets.length === 0) {
      return createSuccessResponse("No Google Sheets spreadsheets found in your Drive.");
    }

    const formatted = spreadsheets
      .map((sheet, i) => {
        const modified = new Date(sheet.modifiedTime).toLocaleString();
        return `**${i + 1}. ${sheet.name}**
- ID: \`${sheet.id}\`
- Modified: ${modified}
- URL: ${getSpreadsheetUrl(sheet.id)}`;
      })
      .join("\n\n");

    return createSuccessResponse(`**Recent Spreadsheets (${spreadsheets.length}):**\n\n${formatted}`);
  }) as Promise<ToolResponse>;
}

export async function handleSearchSpreadsheets(args: unknown): Promise<ToolResponse> {
  return withSheetsAuth(async (service) => {
    const { query, max_results } = validateInput(SearchSpreadsheetsSchema, args);
    const spreadsheets = await service.searchSpreadsheets(query, max_results);

    if (spreadsheets.length === 0) {
      return createSuccessResponse(`No spreadsheets found matching: "${query}"`);
    }

    const formatted = spreadsheets
      .map((sheet, i) => {
        const modified = new Date(sheet.modifiedTime).toLocaleString();
        return `**${i + 1}. ${sheet.name}**
- ID: \`${sheet.id}\`
- Modified: ${modified}
- URL: ${getSpreadsheetUrl(sheet.id)}`;
      })
      .join("\n\n");

    return createSuccessResponse(
      `**Search Results for "${query}" (${spreadsheets.length} spreadsheets):**\n\n${formatted}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleGetSpreadsheet(args: unknown): Promise<ToolResponse> {
  return withSheetsAuth(async (service) => {
    const { spreadsheet_id } = validateInput(GetSpreadsheetSchema, args);
    const spreadsheet = await service.getSpreadsheet(spreadsheet_id);

    const sheetsFormatted = spreadsheet.sheets
      .map((sheet) => {
        const dimensions = sheet.rowCount != null && sheet.columnCount != null
          ? ` (${sheet.rowCount} rows x ${sheet.columnCount} cols)`
          : "";
        return `- **${sheet.title}**${dimensions}`;
      })
      .join("\n");

    return createSuccessResponse(
      `**Spreadsheet: ${spreadsheet.title}**\n\n` +
        `- ID: \`${spreadsheet.spreadsheetId}\`\n` +
        `- Sheets: ${spreadsheet.sheets.length}\n` +
        `- URL: ${spreadsheet.spreadsheetUrl}\n\n` +
        `**Sheets:**\n${sheetsFormatted}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleGetSheetData(args: unknown): Promise<ToolResponse> {
  return withSheetsAuth(async (service) => {
    const { spreadsheet_id, range } = validateInput(GetSheetDataSchema, args);
    const data = await service.getSheetData(spreadsheet_id, range);

    if (data.values.length === 0) {
      return createSuccessResponse(`No data found in range: ${range}`);
    }

    // Format as markdown table
    let table = "";
    if (data.values.length > 0) {
      const maxCols = Math.max(...data.values.map((row) => row.length));

      // Header row
      const headerRow = data.values[0] || [];
      table += "| " + headerRow.map((cell) => cell || "").join(" | ") + " |\n";
      table += "| " + Array(maxCols).fill("---").join(" | ") + " |\n";

      // Data rows
      for (let i = 1; i < data.values.length; i++) {
        const row = data.values[i] || [];
        // Pad row to match header columns
        const paddedRow = Array(maxCols).fill("").map((_, j) => row[j] || "");
        table += "| " + paddedRow.join(" | ") + " |\n";
      }
    }

    return createSuccessResponse(
      `**Sheet Data** (Range: ${data.range})\n\n` +
        `Rows: ${data.values.length}, Columns: ${data.values[0]?.length || 0}\n\n` +
        table
    );
  }) as Promise<ToolResponse>;
}

export async function handleUpdateCells(args: unknown): Promise<ToolResponse> {
  return withSheetsAuth(async (service) => {
    const { spreadsheet_id, range, values } = validateInput(UpdateCellsSchema, args);
    const result = await service.updateCells(spreadsheet_id, range, values);

    return createSuccessResponse(
      `✅ Cells updated successfully!\n\n` +
        `- Updated cells: ${result.updatedCells}\n` +
        `- Range: ${result.updatedRange}\n` +
        `- URL: ${getSpreadsheetUrl(spreadsheet_id)}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleAppendRows(args: unknown): Promise<ToolResponse> {
  return withSheetsAuth(async (service) => {
    const { spreadsheet_id, range, values } = validateInput(AppendRowsSchema, args);
    const result = await service.appendRows(spreadsheet_id, range, values);

    return createSuccessResponse(
      `✅ Rows appended successfully!\n\n` +
        `- Rows added: ${values.length}\n` +
        `- Updated cells: ${result.updatedCells}\n` +
        `- Range: ${result.updatedRange}\n` +
        `- URL: ${getSpreadsheetUrl(spreadsheet_id)}`
    );
  }) as Promise<ToolResponse>;
}

export async function handleCreateSpreadsheet(args: unknown): Promise<ToolResponse> {
  return withSheetsAuth(async (service) => {
    const { title } = validateInput(CreateSpreadsheetSchema, args);
    const spreadsheet = await service.createSpreadsheet(title);

    return createSuccessResponse(
      `✅ **Spreadsheet Created!**\n\n` +
        `- Title: ${spreadsheet.title}\n` +
        `- ID: \`${spreadsheet.spreadsheetId}\`\n` +
        `- Sheets: ${spreadsheet.sheets.map((s) => s.title).join(", ")}\n` +
        `- URL: ${spreadsheet.spreadsheetUrl}`
    );
  }) as Promise<ToolResponse>;
}

// ============================================================================
// Comment Handlers (Drive API — Docs, Slides, Sheets)
// ============================================================================

export async function handleListComments(args: unknown): Promise<ToolResponse> {
  return withCommentsAuth(async (service) => {
    const params = validateInput(ListCommentsSchema, args);

    const result = await service.list(params.file_id, {
      status: params.status,
      includeDeleted: params.include_deleted,
      maxComments: params.max_comments,
      pageToken: params.page_token,
    });

    return createSuccessResponse(formatComments(params.file_id, result));
  }) as Promise<ToolResponse>;
}

export async function handleManageComment(args: unknown): Promise<ToolResponse> {
  return withCommentsAuth(async (service) => {
    const input = validateInput(ManageCommentSchema, args);

    switch (input.action) {
      case "create": {
        const anchor = {
          quotedText: input.quoted_text,
          startIndex: input.start_index,
          endIndex: input.end_index,
          tabId: input.tab_id,
          objectId: input.object_id,
          tableCell: input.table_cell,
          rowSpan: input.row_span,
          columnSpan: input.column_span,
          cell: input.cell,
          sheetId: input.sheet_id,
          rowIndex: input.row_index,
          columnIndex: input.column_index,
          rawAnchor: input.anchor,
        };

        const comment = await service.create(
          input.file_id,
          input.content!,
          anchor,
          input.assignee_email
        );

        return createSuccessResponse(
          `✅ **Comment created**\n\n` +
            `- ID: \`${comment.id}\`\n` +
            `- Author: ${comment.author}\n` +
            (isAnchorEmpty(anchor) ? "" : `- Anchored to: ${describeAnchor(anchor)}\n`) +
            (comment.quotedText ? `- Quoted: "${comment.quotedText}"\n` : "") +
            (input.assignee_email ? `- Assigned to: ${input.assignee_email}\n` : "") +
            `\n${comment.content}`
        );
      }

      case "reply": {
        const reply = await service.reply(input.file_id, input.comment_id!, input.content!);
        return createSuccessResponse(
          `✅ **Reply added to comment \`${input.comment_id}\`**\n\n` +
            `- ID: \`${reply.id}\`\n` +
            `- Author: ${reply.author}\n\n${reply.content}`
        );
      }

      case "update": {
        const comment = await service.update(
          input.file_id,
          input.comment_id!,
          input.content!,
          input.post_id
        );
        return createSuccessResponse(
          `✅ **Comment \`${comment.id}\` updated**\n\n${comment.content}`
        );
      }

      case "resolve":
      case "reopen": {
        const resolve = input.action === "resolve";
        await service.setResolved(input.file_id, input.comment_id!, resolve);
        return createSuccessResponse(
          resolve
            ? `✅ Comment \`${input.comment_id}\` resolved.`
            : `✅ Comment \`${input.comment_id}\` reopened.`
        );
      }

      case "delete": {
        await service.delete(input.file_id, input.comment_id!);
        return createSuccessResponse(`✅ Comment \`${input.comment_id}\` deleted.`);
      }
    }
  }) as Promise<ToolResponse>;
}

// ============================================================================
// Tool Router
// ============================================================================

/**
 * Route tool calls to appropriate handlers
 */
export async function handleToolCall(
  name: string,
  args: unknown
): Promise<ToolResponse> {
  logger.debug(`Handling tool call: ${name}`);

  switch (name) {
    // Auth
    case "auth_status":
      return handleAuthStatus();
    case "authenticate":
      return handleAuthenticate(args);

    // Meet
    case "list_conferences":
      return handleListConferences(args);
    case "get_conference":
      return handleGetConference(args);
    case "list_participants":
      return handleListParticipants(args);
    case "list_recordings":
      return handleListRecordings(args);
    case "list_transcripts":
      return handleListTranscripts(args);
    case "get_transcript_text":
      return handleGetTranscriptText(args);
    case "create_meeting":
      return handleCreateMeeting();
    case "list_upcoming_meetings":
      return handleListUpcomingMeetings(args);
    case "list_past_meetings":
      return handleListPastMeetings(args);
    case "summarize_transcript":
      return handleSummarizeTranscript(args);
    case "create_calendar_event":
      return handleCreateCalendarEvent(args);

    // Gmail
    case "gmail_profile":
      return handleGmailProfile();
    case "list_emails":
      return handleListEmails(args);
    case "search_emails":
      return handleSearchEmails(args);
    case "get_email":
      return handleGetEmail(args);
    case "get_thread":
      return handleGetThread(args);
    case "send_email":
      return handleSendEmail(args);
    case "create_draft":
      return handleCreateDraft(args);
    case "list_labels":
      return handleListLabels();
    case "trash_email":
      return handleTrashEmail(args);
    case "mark_as_read":
      return handleMarkAsRead(args);
    case "mark_as_unread":
      return handleMarkAsUnread(args);

    // Google Docs
    case "list_docs":
      return handleListDocs(args);
    case "search_docs":
      return handleSearchDocs(args);
    case "get_doc":
      return handleGetDoc(args);
    case "create_doc":
      return handleCreateDoc(args);
    case "append_to_doc":
      return handleAppendToDoc(args);
    case "replace_in_doc":
      return handleReplaceInDoc(args);

    // Google Slides
    case "list_presentations":
      return handleListPresentations(args);
    case "search_presentations":
      return handleSearchPresentations(args);
    case "get_presentation":
      return handleGetPresentation(args);
    case "create_presentation":
      return handleCreatePresentation(args);
    case "inspect_presentation":
      return handleInspectPresentation(args);
    case "edit_presentation":
      return handleEditPresentation(args);
    case "get_slide_preview":
      return handleSlidePreview(args);
    case "add_slide_image":
      return handleAddSlideImage(args);
    case "upload_drive_file":
      return handleUploadDriveFile(args);
    case "copy_slide":
      return handleCopySlide(args);

    // Google Sheets
    case "list_spreadsheets":
      return handleListSpreadsheets(args);
    case "search_spreadsheets":
      return handleSearchSpreadsheets(args);
    case "get_spreadsheet":
      return handleGetSpreadsheet(args);
    case "get_sheet_data":
      return handleGetSheetData(args);
    case "update_cells":
      return handleUpdateCells(args);
    case "append_rows":
      return handleAppendRows(args);
    case "create_spreadsheet":
      return handleCreateSpreadsheet(args);

    // Comments
    case "list_comments":
      return handleListComments(args);
    case "manage_comment":
      return handleManageComment(args);

    default:
      return createErrorResponse(`Unknown tool: ${name}`);
  }
}
