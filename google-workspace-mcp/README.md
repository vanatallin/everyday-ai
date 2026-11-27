# Google Service MCP Server

A Model Context Protocol (MCP) server for Google Workspace integration. Access Google Meet, Calendar, Gmail, and Docs through AI assistants.

> **Note:** This folder is part of the **everyday-ai** repo. For full setup (Cursor config for Slack, Jira, GitHub, and repo layout), see the [repo root README](../README.md).

## ✨ Features

### Google Meet & Calendar
| Feature | Description |
|---------|-------------|
| 📅 **Calendar Integration** | List upcoming and past meetings |
| ➕ **Create Calendar Events** | Schedule meetings with attendees & Meet links |
| 📋 **Conference Records** | View past Google Meet sessions |
| 👥 **Participants** | See who attended each meeting |
| 🎥 **Recordings** | Access meeting recordings from Drive |
| 📝 **Transcripts** | Get meeting transcripts with speaker attribution |
| 🔗 **Create Meetings** | Generate new Google Meet links |

### Gmail
| Feature | Description |
|---------|-------------|
| 📧 **List Emails** | View inbox messages |
| 🔍 **Search Emails** | Search with Gmail query syntax |
| 📖 **Read Emails** | Get full email content |
| 💬 **Email Threads** | View conversation threads |
| ✉️ **Send Emails** | Compose and send new emails |
| 📝 **Drafts** | Create email drafts |
| 🗑️ **Trash** | Move emails to trash |
| ✅ **Mark Read/Unread** | Manage email status |

### Google Docs
| Feature | Description |
|---------|-------------|
| 📄 **List Documents** | View recent Google Docs |
| 🔍 **Search Documents** | Find documents by name |
| 📖 **Read Documents** | Get document content as text |
| ✏️ **Create Documents** | Create new Google Docs |
| ➕ **Append Text** | Add content to existing docs |
| 🔄 **Find & Replace** | Replace text in documents |

### Comments (Docs, Slides, Sheets)
| Feature | Description |
|---------|-------------|
| 💬 **List Comments** | Read open/resolved threads on any Drive file |
| ✍️ **Create Comments** | Start a thread anchored to text, an object or a cell |
| ↩️ **Reply & Edit** | Reply to a thread or update a comment's text |
| ✅ **Resolve / Reopen** | Change thread status |
| 🗑️ **Delete** | Remove a comment thread |

One pair of tools (`list_comments`, `manage_comment`) covers Docs, Slides, Sheets and any other Drive file. The file type is detected automatically from the Drive mimeType.

On Docs, Slides and Sheets, comments use the editor's **native comment API** (`insertComment`, `addCommentReply`, …), so they are anchored to a real text range, object or cell and are highlighted in the editor exactly like a manually added comment. Comments created through the Drive API are always shown as unanchored in Workspace editors, which is why the native path is used.

Anchor a new comment with:
- Docs: `quoted_text` (first match in the body) or `start_index`/`end_index` (+ optional `tab_id`)
- Slides: `object_id` (page or element). For text inside a shape, add `quoted_text` or `start_index`/`end_index`. For tables, add `table_cell` (A1-style within the table, e.g. `B2` or `B2:C3`) — without a text range it highlights the cells, and with `quoted_text`/indices it highlights text inside one cell
- Sheets: `cell` in A1 notation, or `sheet_id` + `row_index`/`column_index`. The Sheets API only anchors to a **single cell**, so `A1:B2` is rejected; `quoted_text` is not supported

`get_doc` no longer embeds comments by default — pass `include_comments: true` for a compact summary.

### Session cache
Metadata that is safe to be briefly stale is cached in-process, scoped to each service instance (one instance per authenticated session), so it can never leak between accounts:

- Drive `mimeType` → file kind, cached for the life of the service instance (a file's type never changes)
- Sheet title → sheet ID, cached for 60 seconds so anchored Sheet comments don't re-fetch spreadsheet metadata on every call

The cache is TTL + LRU bounded, coalesces concurrent misses into one API request, and never stores failures. Document and presentation **content**, and `revisionId`, are never cached — edits are always planned against fresh state.

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Google Cloud Project with APIs enabled
- OAuth 2.0 credentials

### 1. Install

From the **everyday-ai** repo root, go into this folder and install:

```bash
cd google-workspace-mcp
npm install
```

(If you're already inside `google-workspace-mcp`, run `npm install` from here.)

### 2. Setup Google Cloud Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable these APIs:
   - [Google Meet API](https://console.cloud.google.com/apis/library/meet.googleapis.com)
   - [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
   - [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
   - [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
   - [Google Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
   - [Google Slides API](https://console.cloud.google.com/apis/library/slides.googleapis.com)
4. Go to **APIs & Services** → **Credentials**
5. Click **Create Credentials** → **OAuth client ID**
6. Select **Desktop app**
7. Download and save as `credentials.json` in **this folder** (the `google-workspace-mcp` directory, same folder as `package.json`)

The file should look like this:

```json
{
  "installed": {
    "client_id": "123456789-xxxxxxxxx.apps.googleusercontent.com",
    "project_id": "your-project-id",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "GOCSPX-xxxxxxxxxxxxxxxxxx",
    "redirect_uris": ["http://localhost"]
  }
}
```

### 3. Build

```bash
npm run build
```

### 4. Authenticate

Run the server once to authenticate:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"authenticate","arguments":{}}}' | node dist/index.js
```

A browser window will open for Google sign-in. After authorizing, a `token.json` file will be auto-created:

```json
{
  "type": "authorized_user",
  "client_id": "123456789-xxxxxxxxx.apps.googleusercontent.com",
  "client_secret": "GOCSPX-xxxxxxxxxxxxxxxxxx",
  "refresh_token": "1//0gxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

> ⚠️ **Note**: `token.json` contains your personal authorization. Never share or commit it!

### Using multiple Google accounts

Each server process has exactly one identity, so run one entry per account with its own token file. The OAuth **client** (`credentials.json`) is shared; only the token path differs.

Authenticate each account separately (use a different `OAUTH_PORT` per account):

```bash
GOOGLE_TOKEN_PATH=~/.google-mcp/work-token.json OAUTH_PORT=3000 \
  node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"authenticate","arguments":{}}}
EOF

GOOGLE_TOKEN_PATH=~/.google-mcp/personal-token.json OAUTH_PORT=3001 \
  node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"authenticate","arguments":{}}}
EOF
```

Then register both in your MCP client:

```json
{
  "mcpServers": {
    "google-work": {
      "command": "node",
      "args": ["/absolute/path/to/google-workspace-mcp/dist/index.js"],
      "env": { "GOOGLE_TOKEN_PATH": "/Users/you/.google-mcp/work-token.json" }
    },
    "google-personal": {
      "command": "node",
      "args": ["/absolute/path/to/google-workspace-mcp/dist/index.js"],
      "env": { "GOOGLE_TOKEN_PATH": "/Users/you/.google-mcp/personal-token.json" }
    }
  }
}
```

The client shows two tool sets (`google-work: get_doc`, `google-personal: get_doc`, …). Each entry is a separate process, so auth and caches are fully isolated.

- Use absolute paths. Never point two entries at the same token file.
- Desktop-app OAuth clients accept any `http://localhost:<port>` callback; web clients must register both redirect URIs.
- Confirm which account an entry uses with the `gmail_profile` tool (it returns the email address).
- Re-consent an account by repeating its command with `"arguments":{"force":true}`.

### Google Slides creation and editing

The Slides tools can create presentations, inspect elements and revisions, add, duplicate, delete or reorder slides, add shapes, text, images and tables, change text and shape styling, set slide backgrounds, add speaker notes, links and alt text, reorder layers, copy slides between decks, and render slide previews. `edit_presentation` applies a batch atomically (operations that need element metadata are resolved first, then sent as one batch). Inspect first and pass its `revisionId` as `revision_id` to prevent overwriting concurrent edits. Slide positions use zero-based indices; the move index refers to the order before the move. Coordinates for edits are in points. Newly created IDs are returned in `createdIds`; duplicated IDs are returned in the API replies. Add content to newly created slides in a subsequent call.

#### What `edit_presentation` supports

| Area | Operations |
| --- | --- |
| Slides | `add_slide` (with `layout` or `layout_id`), `delete_slide`, `duplicate_slide`, `move_slide`, `copy_slide` |
| Text | `add_text_box`, `replace_text`, `style_text` (full range or `start_index`/`end_index`), `add_text_box.runs` for per-run rich text |
| Shape | `add_shape` (full Google ShapeType vocabulary), `style_shape`, `transform_element` with `rotation` |
| Media | `add_image` (public URL or Drive file ID), `style_image`, `set_background` (colour, theme colour or stretched image) |
| Tables | `add_table` with cell text, header/body fills, cell styles and borders |
| Structure | `add_notes`, `link_element`, `set_alt_text`, `group_elements`, `ungroup_elements`, `z_order`, `align_elements`, `distribute_elements` |

Text styling covers alignment, vertical anchor, line spacing, space before/after, bullets (including numbered presets), links, strikethrough, small caps, superscript/subscript and background colour. Shapes cover fill colour and alpha, outline colour/weight/alpha/dash and hyperlinks. For card borders, set `outline_color` and optionally `outline_weight` on `add_shape` or `style_shape`.

`add_image` accepts either `url` (publicly reachable) or `drive_file_id`. Use `upload_drive_file` with `share_anyone: true` to publish a local file and get a Drive ID/direct URL; this requires the `drive` OAuth scope and changes the file's sharing. `add_slide_image` remains the private option for local files when the Apps Script helper is configured.

`copy_slide` / the `copy_slide` operation copies a slide across presentations. When the Apps Script helper is configured, `copy_slide` uses `insertSlide`/`appendSlide`, which preserves text, images, tables, layouts and masters losslessly. Without the helper it recreates shapes, text, tables, lines, groups, videos and images that have a public source URL; images without a source URL and unsupported elements are reported in `warnings`.

#### Known API limitations

Google Slides does not expose some editor features through the REST API or Apps Script. The following cannot be implemented reliably from the MCP server: changing page size after creation (use `create_presentation` `width`/`height`), custom corner radius (use `ROUND_RECTANGLE`), text inset overrides, picture fills on shapes (only slide backgrounds support stretched images), shape shadows/gradients (shadow is read-only), and inserting a dynamic slide-number field.

Existing OAuth users must call `authenticate` with `{"force": true}` and complete consent for the new Slides write scope; the existing token is kept until the new consent succeeds. Restart the server after changing environment configuration. Service accounts can use the Slides editing tools for presentations shared with them, but Google does not support service accounts for Apps Script API execution.

#### Private local images (one-time setup)

`add_slide_image` reads a local PNG, JPEG, or GIF (maximum 3 MiB) on the MCP server host and sends its bytes to a private Apps Script API executable. It does not create a Drive image or change sharing permissions. The resulting image is visible to anyone who can view the presentation. To configure it:

1. Enable the [Apps Script API](https://console.cloud.google.com/apis/library/script.googleapis.com) in the **same standard Google Cloud project** used by the MCP server's OAuth client. Enable the Slides API too.
2. Create a standalone project at [script.google.com](https://script.google.com/). Copy `apps-script/PrivateSlideImages.gs` into its editor. In Project Settings enable showing the manifest, then replace `appsscript.json` with `apps-script/appsscript.json` from this repository. Use the same standard Cloud project as your OAuth client (Project Settings → Google Cloud Platform project).
3. Deploy as an **API executable**, restricted to yourself. Copy the deployment ID, not the project ID. See Google's [execution setup](https://developers.google.com/apps-script/api/how-tos/execute). Workspace policy may require administrator approval.
4. Set `GOOGLE_SLIDES_IMAGE_SCRIPT_DEPLOYMENT_ID` in the MCP server environment to that deployment ID, and restart the server. Reauthorize with `authenticate` and `{"force":true}` if you haven't granted Slides write access yet.

The same deployment also implements lossless cross-presentation `copy_slide` (function `copySlideFromPresentation`). Set `GOOGLE_SLIDES_SCRIPT_DEPLOYMENT_ID` to use a shared helper deployment; it falls back to `GOOGLE_SLIDES_IMAGE_SCRIPT_DEPLOYMENT_ID`.

The script and OAuth client must share the Cloud project; API execution uses the OAuth user's permissions and is unavailable for service accounts. A failed or missing helper returns an error; there is no public-image fallback. Preview images from Google are temporary access-bearing URLs and are returned as image data, not exposed as links.

---

## 🔧 Usage

### Option A: With Cursor IDE

The **everyday-ai** repo has a full Cursor config at the repo root: **mcp-servers-config.json** (Google + Slack + Jira + GitHub). Use that file in **Settings** → **Features** → **MCP Servers**. The `google-service` entry should point at **this folder’s** built server:

```json
{
  "google-service": {
    "command": "node",
    "args": [
      "/path/to/everyday-ai/google-workspace-mcp/dist/index.js"
    ]
  }
}
```

If Cursor’s workspace is the everyday-ai repo, you can use `./google-workspace-mcp/dist/index.js`. See the [repo root README](../README.md) for full setup.

Restart Cursor, then use natural language prompts (see Quick Prompts below).

---

## 💬 Quick Prompts (Copy & Paste)

Use these prompts directly in Cursor chat:

### Calendar & Meetings
```
Show my upcoming meetings
```
```
What meetings do I have this week?
```
```
Create a meeting with john@example.com tomorrow at 3 PM for 30 minutes titled "Quick Sync"
```
```
Schedule a team standup for Monday 10 AM with alice@example.com and bob@example.com
```
```
List my past meetings from last week
```

### Gmail
```
Show my recent emails
```
```
Check for unread emails from my boss
```
```
Search emails about "project deadline"
```
```
Read the email with subject "Invoice"
```
```
Send an email to john@example.com saying "Meeting confirmed for tomorrow"
```
```
Draft an email to the team about the weekly update
```

### Google Docs
```
List my recent documents
```
```
Find documents named "meeting notes"
```
```
Create a new document called "Project Ideas"
```
```
Read the document "Weekly Report"
```
```
Add "Action Items:\n- Review PR\n- Update docs" to my project document
```

### Combo Tasks
```
Create a meeting for tomorrow 2 PM with john@example.com, create a doc called "Meeting Agenda", and share the doc link in the meeting invite
```
```
Send an email to the team reminding them about the meeting tomorrow
```
```
Check my calendar for next week and summarize it
```

---

### Option B: Direct Command Line

Test the MCP server directly by sending JSON-RPC messages:

#### Check Authentication
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"auth_status","arguments":{}}}' | node dist/index.js
```

#### List Upcoming Meetings
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_upcoming_meetings","arguments":{}}}' | node dist/index.js
```

#### List Past Conferences
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_conferences","arguments":{"limit":5}}}' | node dist/index.js
```

#### Create a New Meeting
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_meeting","arguments":{}}}' | node dist/index.js
```

#### List All Available Tools
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

### Shell Aliases (Add to ~/.zshrc or ~/.bashrc)

```bash
# Google Service MCP shortcuts
export GMCP="/path/to/google-workspace-mcp"

# Quick commands
alias gmcp="cd $GMCP && node dist/index.js"
alias gmcp-auth='echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"authenticate\",\"arguments\":{}}}" | gmcp'
alias gmcp-status='echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"auth_status\",\"arguments\":{}}}" | gmcp'
alias gmcp-meetings='echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"list_upcoming_meetings\",\"arguments\":{}}}" | gmcp'
alias gmcp-emails='echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"list_emails\",\"arguments\":{\"limit\":5}}}" | gmcp'
alias gmcp-docs='echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"list_docs\",\"arguments\":{\"limit\":5}}}" | gmcp'
alias gmcp-tools='echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}" | gmcp'
```

After adding, run `source ~/.zshrc` then use:
```bash
gmcp-meetings    # List upcoming meetings
gmcp-emails      # List recent emails
gmcp-docs        # List recent documents
gmcp-status      # Check auth status
```

---

## 📚 Available Tools

### Authentication
| Tool | Description | Required Args |
|------|-------------|---------------|
| `auth_status` | Check authentication status | - |
| `authenticate` | Sign in with Google OAuth | - |

### Google Meet & Calendar
| Tool | Description | Required Args |
|------|-------------|---------------|
| `list_upcoming_meetings` | List upcoming calendar meetings | `limit?` |
| `list_past_meetings` | List past 30 days of meetings | `limit?` |
| `create_calendar_event` | Create calendar event with Meet link | `summary`, `start_time`, `attendees?`, `duration_minutes?`, `timezone?` |
| `list_conferences` | List Google Meet conference records | `limit?` |
| `get_conference` | Get specific conference details | `name` |
| `list_participants` | List meeting participants | `conference_name` |
| `list_recordings` | List meeting recordings | `conference_name` |
| `list_transcripts` | List meeting transcripts | `conference_name` |
| `get_transcript_text` | Get transcript with speaker attribution | `transcript_name` |
| `create_meeting` | Create new Google Meet link (no calendar event) | - |
| `summarize_transcript` | Format transcript for AI summary | `transcript_name` |

### Gmail
| Tool | Description | Required Args |
|------|-------------|---------------|
| `gmail_profile` | Get Gmail profile info | - |
| `list_emails` | List inbox emails | `limit?` |
| `search_emails` | Search emails with Gmail syntax | `query`, `limit?` |
| `get_email` | Get full email content | `message_id` |
| `get_thread` | Get email thread/conversation | `thread_id` |
| `send_email` | Send a new email | `to`, `subject`, `body`, `cc?`, `bcc?` |
| `create_draft` | Create email draft | `to`, `subject`, `body`, `cc?`, `bcc?` |
| `list_labels` | List Gmail labels/folders | - |
| `trash_email` | Move email to trash | `message_id` |
| `mark_as_read` | Mark email as read | `message_id` |
| `mark_as_unread` | Mark email as unread | `message_id` |

### Google Docs
| Tool | Description | Required Args |
|------|-------------|---------------|
| `list_docs` | List recent Google Docs | `limit?` |
| `search_docs` | Search documents by name | `query`, `limit?` |
| `get_doc` | Get document content as text (comments opt-in) | `document_id`, `include_comments?` |
| `create_doc` | Create new Google Doc | `title`, `content?` |
| `append_to_doc` | Append text to document | `document_id`, `text` |
| `replace_in_doc` | Find and replace text | `document_id`, `search_text`, `replace_text`, `match_case?` |

### Comments (Docs, Slides, Sheets)
| Tool | Description | Required Args |
|------|-------------|---------------|
| `list_comments` | List comments with pagination and status filter | `file_id`, `status?`, `max_comments?`, `page_token?` |
| `manage_comment` | Create, reply, update, resolve, reopen or delete | `file_id`, `action`, `comment_id?`, `content?` |

`manage_comment` actions: `create`, `reply`, `update`, `resolve`, `reopen`, `delete`. Anchors are native: `quoted_text`, `start_index`/`end_index`, `object_id`, `table_cell` or `cell`, depending on the file type (see the Comments features section above). `update` edits the head post by default; pass `post_id` to edit a specific reply. Files that are not Google Docs/Slides/Sheets fall back to Drive comments, which cannot be anchored inside editor files.

### Example: Create Calendar Event

```bash
# Create a meeting for tomorrow at 2 PM IST with attendees
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_calendar_event","arguments":{"summary":"Team Sync","start_time":"2026-01-30T14:00:00","duration_minutes":60,"attendees":["user@example.com"],"add_meet_link":true}}}' | node dist/index.js
```

> **Note:** Default timezone is `Asia/Kolkata` (IST). Use `timezone` parameter to override.

### Example: Get Transcript

```bash
# First, list conferences to get the name
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_conferences","arguments":{"limit":1}}}' | node dist/index.js

# Then list transcripts for that conference
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_transcripts","arguments":{"conference_name":"conferenceRecords/abc123"}}}' | node dist/index.js

# Finally, get the transcript text
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_transcript_text","arguments":{"transcript_name":"conferenceRecords/abc123/transcripts/xyz789"}}}' | node dist/index.js
```

### Example: Gmail Operations

```bash
# Get Gmail profile
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"gmail_profile","arguments":{}}}' | node dist/index.js

# List recent emails
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_emails","arguments":{"limit":5}}}' | node dist/index.js

# Search for unread emails from a specific sender
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_emails","arguments":{"query":"from:boss@company.com is:unread"}}}' | node dist/index.js

# Read a specific email
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_email","arguments":{"message_id":"abc123"}}}' | node dist/index.js

# Send an email
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"send_email","arguments":{"to":"recipient@example.com","subject":"Hello","body":"This is a test email."}}}' | node dist/index.js

# Create a draft
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_draft","arguments":{"to":"recipient@example.com","subject":"Draft","body":"This is a draft."}}}' | node dist/index.js
```

### Gmail Search Syntax

| Query | Description |
|-------|-------------|
| `from:user@example.com` | Emails from specific sender |
| `to:user@example.com` | Emails to specific recipient |
| `subject:meeting` | Emails with "meeting" in subject |
| `is:unread` | Unread emails |
| `is:starred` | Starred emails |
| `has:attachment` | Emails with attachments |
| `after:2024/01/01` | Emails after date |
| `before:2024/12/31` | Emails before date |
| `label:important` | Emails with specific label |

### Example: Google Docs Operations

```bash
# List recent documents
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_docs","arguments":{"limit":5}}}' | node dist/index.js

# Search for documents
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_docs","arguments":{"query":"meeting notes"}}}' | node dist/index.js

# Create a new document
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_doc","arguments":{"title":"Project Plan","content":"Initial project outline..."}}}' | node dist/index.js

# Read a document
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_doc","arguments":{"document_id":"1234abcd..."}}}' | node dist/index.js

# Append to a document
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"append_to_doc","arguments":{"document_id":"1234abcd...","text":"\\n\\nNew section added."}}}' | node dist/index.js
```

---

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CREDENTIALS_PATH` | Path to credentials.json | `./credentials.json` |
| `GOOGLE_TOKEN_PATH` | Path to token.json | `./token.json` |
| `OAUTH_PORT` | OAuth callback port | `3000` |
| `LOG_LEVEL` | Logging level (DEBUG, INFO, WARN, ERROR) | `INFO` |

### Example with Custom Config

```bash
GOOGLE_CREDENTIALS_PATH=/custom/path/credentials.json \
OAUTH_PORT=8080 \
LOG_LEVEL=DEBUG \
node dist/index.js
```

---

## 📁 Project Structure

```
google-workspace-mcp/
├── src/
│   ├── index.ts          # Server entry point
│   ├── config.ts         # Configuration management
│   ├── logger.ts         # Logging utility
│   ├── types.ts          # TypeScript definitions
│   ├── schemas.ts        # Zod validation schemas
│   ├── utils.ts          # Helper functions
│   ├── auth.ts           # Google authentication
│   ├── meet-api.ts       # Google Meet & Calendar API
│   ├── gmail-api.ts      # Gmail API wrapper
│   ├── docs-api.ts       # Google Docs API wrapper
│   └── tools/
│       ├── index.ts      # Tool exports
│       ├── definitions.ts # MCP tool definitions
│       └── handlers.ts   # Tool implementations
├── dist/                 # Compiled JavaScript
├── credentials.json      # Google OAuth credentials (git-ignored)
├── token.json           # Stored OAuth token (git-ignored)
├── package.json
└── tsconfig.json
```

---

## ❗ Troubleshooting

### "Not authenticated" error
```bash
# Run authentication first
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"authenticate","arguments":{}}}' | node dist/index.js
```

### "credentials.json not found"
Download OAuth credentials from Google Cloud Console and save as `credentials.json` in **this folder** (`google-workspace-mcp`), next to `package.json`.

### "No conference records found"
Conference records are only available for meetings where:
- Recording or transcription was **enabled** during the meeting
- You have a **Google Workspace** account (not personal Gmail)
- Records haven't expired (limited retention period)

### OAuth consent screen issues
1. Go to Google Cloud Console → APIs & Services → OAuth consent screen
2. Add your email as a test user (if app is in testing mode)
3. Ensure all required scopes are added

### Port already in use
```bash
# Use a different OAuth port
OAUTH_PORT=8080 node dist/index.js
```

---

## 🔐 OAuth Scopes

This server requests the following permissions:

### Google Meet & Calendar
| Scope | Purpose |
|-------|---------|
| `meetings.space.readonly` | Read meeting spaces |
| `meetings.space.created` | Create meeting spaces |
| `calendar.readonly` | Read calendar events |
| `calendar.events` | Create/modify calendar events |
| `drive` | Read recordings, upload files, and read/write comments on non-editor Drive files (Docs/Slides/Sheets comments use their own APIs) |

### Gmail
| Scope | Purpose |
|-------|---------|
| `gmail.readonly` | Read emails and labels |
| `gmail.send` | Send emails |
| `gmail.compose` | Create drafts |
| `gmail.modify` | Modify labels, mark read/unread, trash |

### Google Docs
| Scope | Purpose |
|-------|---------|
| `documents` | Create and edit documents |
| `documents.readonly` | Read documents |

> ⚠️ **Note**: If you previously authenticated with fewer scopes, delete `token.json` and re-authenticate to grant all permissions. Docs/Slides/Sheets comment writes use the `documents`, `presentations` and `spreadsheets` scopes already requested for editing. The full `drive` scope is only needed for comments on non-editor Drive files, and supersedes `drive.readonly`/`drive.file`.

---

## 📄 License

MIT

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to verify
5. Submit a pull request
