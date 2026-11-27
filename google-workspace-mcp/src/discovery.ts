/**
 * Deferred tool discovery.
 *
 * Advertising every schema costs a lot of context. `MCP_DISCOVERY` controls
 * how tools are exposed:
 *
 *   full      (default) every tool is listed, as before
 *   zero-cost only the four meta-tools are listed; call anything via `workspace_call`
 *   lazy      meta-tools plus whatever `workspace_discover` has loaded
 *
 * Meta-tool calls execute inside the same session context as normal tools, so
 * `workspace_call` goes through the usual auth, validation and caching paths.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

import { tools } from "./tools/definitions.js";
import { handleToolCall } from "./tools/handlers.js";
import { createErrorResponse, createSuccessResponse } from "./utils.js";
import type { ToolResponse } from "./types.js";

export type DiscoveryMode = "full" | "lazy" | "zero-cost";

const objectSchema = (properties: Record<string, object>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  ...(required.length > 0 ? { required } : {}),
});

export const META_TOOLS: Tool[] = [
  {
    name: "workspace_list_tools",
    description:
      "List available Google Workspace tools with one-line descriptions. Use this to find the tool you need, then inspect it with workspace_tool_help or run it with workspace_call.",
    inputSchema: objectSchema({
      query: {
        type: "string",
        description: "Optional case-insensitive filter on name or description",
      },
      limit: {
        type: "number",
        description: "Maximum tools to return (default: 50)",
      },
    }),
  },
  {
    name: "workspace_tool_help",
    description:
      "Return the full description and JSON input schema for one or more tools, so you can call them correctly without listing every schema.",
    inputSchema: objectSchema({
      name: { type: "string", description: "Tool name" },
      names: {
        type: "array",
        items: { type: "string" },
        description: "Several tool names at once",
      },
    }),
  },
  {
    name: "workspace_discover",
    description:
      "Load specific tools into the advertised tool list (lazy discovery mode). Returns which names were loaded and which are unknown.",
    inputSchema: objectSchema(
      {
        tools: {
          type: "array",
          items: { type: "string" },
          description: "Tool names to load",
        },
      },
      ["tools"]
    ),
  },
  {
    name: "workspace_call",
    description:
      "Run any Google Workspace tool by name with its arguments. Use this in zero-cost or lazy discovery mode instead of loading every schema up front.",
    inputSchema: objectSchema(
      {
        tool: { type: "string", description: "Tool name to run" },
        arguments: {
          type: "object",
          description: "Arguments for the tool, matching its input schema",
        },
      },
      ["tool"]
    ),
  },
];

const META_NAMES = new Set(META_TOOLS.map((tool) => tool.name));

export function isMetaTool(name: string): boolean {
  return META_NAMES.has(name);
}

export class ToolCatalog {
  private readonly loaded = new Set<string>();

  constructor(readonly mode: DiscoveryMode = "full") {}

  /** Tools advertised in `tools/list` for this session. */
  list(): Tool[] {
    if (this.mode === "full") {
      return tools;
    }
    return [...META_TOOLS, ...tools.filter((tool) => this.loaded.has(tool.name))];
  }

  discover(names: string[]): { loaded: string[]; unknown: string[] } {
    const loaded: string[] = [];
    const unknown: string[] = [];

    for (const name of names) {
      if (!tools.some((tool) => tool.name === name)) {
        unknown.push(name);
        continue;
      }
      if (this.mode !== "full") {
        this.loaded.add(name);
      }
      loaded.push(name);
    }

    return { loaded, unknown };
  }

  get loadedCount(): number {
    return this.loaded.size;
  }
}

function summarise(tool: Tool): { name: string; description: string } {
  const description = tool.description ?? "";
  return {
    name: tool.name,
    description:
      description.length > 200 ? `${description.slice(0, 199)}…` : description,
  };
}

/**
 * Handle one of the meta-tools. Returns undefined when `name` is not a meta-tool.
 */
export async function handleMetaTool(
  name: string,
  args: unknown,
  catalog: ToolCatalog
): Promise<ToolResponse | null> {
  if (!isMetaTool(name)) {
    return null;
  }

  const input = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case "workspace_list_tools": {
      const query =
        typeof input.query === "string" ? input.query.toLowerCase() : undefined;
      const limit =
        typeof input.limit === "number" && input.limit > 0
          ? Math.floor(input.limit)
          : 50;

      const matches = tools
        .filter(
          (tool) =>
            !query ||
            tool.name.toLowerCase().includes(query) ||
            (tool.description ?? "").toLowerCase().includes(query)
        )
        .slice(0, limit)
        .map(summarise);

      return createSuccessResponse(
        JSON.stringify({ total: tools.length, shown: matches.length, tools: matches })
      );
    }

    case "workspace_tool_help": {
      const names = Array.isArray(input.names)
        ? input.names.filter((value): value is string => typeof value === "string")
        : typeof input.name === "string"
          ? [input.name]
          : [];

      if (names.length === 0) {
        return createErrorResponse("Provide `name` or `names`.");
      }

      const found = names
        .map((toolName) => tools.find((tool) => tool.name === toolName))
        .filter((tool): tool is Tool => Boolean(tool));

      const missing = names.filter(
        (toolName) => !tools.some((tool) => tool.name === toolName)
      );

      if (found.length === 0) {
        return createErrorResponse(`Unknown tool(s): ${missing.join(", ")}`);
      }

      return createSuccessResponse(
        JSON.stringify({
          tools: found.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
          ...(missing.length > 0 ? { missing } : {}),
        })
      );
    }

    case "workspace_discover": {
      const requested = Array.isArray(input.tools)
        ? input.tools.filter((value): value is string => typeof value === "string")
        : [];
      if (requested.length === 0) {
        return createErrorResponse("Provide a non-empty `tools` array.");
      }

      const result = catalog.discover(requested);
      return createSuccessResponse(
        JSON.stringify({
          mode: catalog.mode,
          ...result,
          ...(catalog.mode === "full"
            ? { note: "full discovery mode already advertises every tool" }
            : {}),
        })
      );
    }

    case "workspace_call": {
      const toolName = input.tool;
      if (typeof toolName !== "string" || !toolName) {
        return createErrorResponse("Provide `tool`.");
      }
      if (isMetaTool(toolName)) {
        return createErrorResponse("workspace_call cannot call another meta-tool.");
      }
      if (!tools.some((tool) => tool.name === toolName)) {
        return createErrorResponse(`Unknown tool: ${toolName}`);
      }

      const toolArgs = input.arguments;
      if (toolArgs !== undefined && (typeof toolArgs !== "object" || toolArgs === null)) {
        return createErrorResponse("`arguments` must be an object.");
      }

      return handleToolCall(toolName, toolArgs ?? {});
    }
  }

  return null;
}
