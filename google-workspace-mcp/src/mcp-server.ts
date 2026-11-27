/**
 * MCP server construction.
 *
 * Kept separate from the entry point so both transports (stdio and HTTP) can
 * create identically configured servers without triggering process startup.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { logger } from "./logger.js";
import { tools, handleToolCall } from "./tools/index.js";
import { createErrorResponse } from "./utils.js";
import { type SessionStore, resolveIdentity, sessionStorage } from "./session.js";

export const SERVER_NAME = "google-service";
export const SERVER_VERSION = "1.0.0";

export function createServer(sessions: SessionStore): Server {
  const server = new Server(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug("Listing available tools");
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    try {
      // Every tool call runs in a session context so handlers can resolve the
      // right auth, services and caches for the calling user.
      const identity = resolveIdentity(extra);
      const session = sessions.get(identity);
      return await sessionStorage.run(session, () => handleToolCall(name, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Tool call failed: ${name}`, error);
      return createErrorResponse(`Error: ${message}`);
    }
  });

  return server;
}
