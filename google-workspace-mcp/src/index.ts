/**
 * Google Service MCP Server
 *
 * An MCP server that provides access to Google Meet API:
 * - List conference records (past meetings)
 * - Get meeting participants
 * - Access recordings and transcripts
 * - Create meeting spaces
 * - Calendar integration for upcoming/past meetings
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { config } from "./config.js";
import { logger } from "./logger.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./mcp-server.js";
import { startHttpServer } from "./http.js";
import { SessionStore } from "./session.js";

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logger.info(`Starting ${SERVER_NAME} v${SERVER_VERSION}`);

  const sessions = new SessionStore();

  if (config.transport === "http") {
    await startHttpServer(sessions);
    return;
  }

  const server = createServer(sessions);
  const transport = new StdioServerTransport();

  await server.connect(transport);

  logger.info("Server connected and ready");
  console.error(`Google Service MCP Server v${SERVER_VERSION} running on stdio`);
}

// Start the server
main().catch((error) => {
  logger.error("Fatal error during startup", error);
  console.error("Fatal error:", error);
  process.exit(1);
});
