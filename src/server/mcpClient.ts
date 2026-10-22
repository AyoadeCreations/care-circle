/**
 * Internal MCP client.
 *
 * The web server uses this to call the MCP server as a proper MCP client,
 * satisfying the hackathon requirement of a "real MCP client connection."
 *
 * Transport: HTTP POST to the MCP server's /mcp endpoint.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const MCP_URL = process.env.MCP_URL ?? `http://127.0.0.1:${process.env.MCP_PORT ?? '3001'}/mcp`;

export type ToolName =
  | 'capture_care_update'
  | 'confirm_care_update'
  | 'get_today_plan'
  | 'update_task_status'
  | 'generate_care_handoff';

type TextContent = { type: 'text'; text: string };

/**
 * Error thrown when the MCP server is unreachable or returns a transport-level
 * error. Distinct from McpToolError so routes can return 503 vs 422/404.
 */
export class McpConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConnectionError';
  }
}

/**
 * Error thrown when the MCP tool itself returns an error result (isError=true).
 * Carries the error code from the tool so routes can map to the right HTTP status.
 */
export class McpToolError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'TOOL_ERROR'
  ) {
    super(message);
    this.name = 'McpToolError';
  }
}

/**
 * Call an MCP tool and return the parsed result.
 * Creates a new client + transport per call (stateless).
 *
 * Throws McpConnectionError if the server is unreachable.
 * Throws McpToolError if the tool returns an error result.
 */
export async function callMcpTool<T = unknown>(
  toolName: ToolName,
  toolArgs: Record<string, unknown>
): Promise<T> {
  const client = new Client({ name: 'care-circle-web', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

  try {
    await client.connect(transport);

    const result = await client.callTool({
      name: toolName,
      arguments: toolArgs,
    }) as CallToolResult;

    if (result.isError) {
      const errorText = (result.content as TextContent[])
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      // Strip leading "Error: " prefix that the MCP tool adds
      const cleanMsg = errorText.replace(/^Error:\s*/, '') || 'MCP tool returned an error';

      // Extract error code if embedded (format: "message [CODE]")
      const codeMatch = cleanMsg.match(/\[(?:CODE:)?([A-Z_]+)\]$/);
      const code = codeMatch ? codeMatch[1] : 'TOOL_ERROR';
      const msg = codeMatch ? cleanMsg.slice(0, codeMatch.index).trim() : cleanMsg;

      throw new McpToolError(msg, code);
    }

    // Extract text content and parse as JSON
    const textContent = (result.content as TextContent[])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    return JSON.parse(textContent) as T;
  } catch (err) {
    // If it's already our typed error, rethrow as-is
    if (err instanceof McpToolError) throw err;

    // Connection / transport errors → McpConnectionError
    if (err instanceof Error) {
      // Check for common connection error patterns
      const msg = err.message;
      if (
        msg.includes('ECONNREFUSED') ||
        msg.includes('fetch failed') ||
        msg.includes('connect') ||
        msg.includes('aborted') ||
        msg.includes('timeout') ||
        msg.includes('network')
      ) {
        throw new McpConnectionError(
          `Could not connect to MCP server at ${MCP_URL}. Ensure it is running.`
        );
      }
      // Other unexpected errors
      throw new McpToolError(msg, 'TOOL_ERROR');
    }
    throw new McpToolError('Unknown error', 'TOOL_ERROR');
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Verify the MCP server is reachable.
 */
export async function pingMcpServer(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.MCP_PORT ?? '3001'}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
