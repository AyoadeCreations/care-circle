/**
 * Internal MCP client.
 *
 * The web server uses this to call the MCP server. Two modes:
 * 1. HTTP mode (local dev): connects to a separate MCP server process
 *    via StreamableHTTPClientTransport
 * 2. In-process mode (Vercel/unified): calls MCP tool functions directly
 *    since the MCP server runs in the same process
 *
 * The mode is determined by the MCP_IN_PROCESS env var or by detecting
 * that MCP_URL is not set and there's no separate MCP server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../db/database.js';
import {
  captureUpdate,
  confirmUpdate,
  getTodayPlan,
  updateTaskStatus,
  generateHandoff,
  ToolError,
} from '../mcp/tools.js';

const MCP_URL = process.env.MCP_URL ?? `http://127.0.0.1:${process.env.MCP_PORT ?? '3001'}/mcp`;
const IN_PROCESS = process.env.MCP_IN_PROCESS === '1' || process.env.VERCEL === '1';

export type ToolName =
  | 'capture_care_update'
  | 'confirm_care_update'
  | 'get_today_plan'
  | 'update_task_status'
  | 'generate_care_handoff';

type TextContent = { type: 'text'; text: string };

export class McpConnectionError extends Error {
  constructor(message: string) { super(message); this.name = 'McpConnectionError'; }
}

export class McpToolError extends Error {
  constructor(message: string, public readonly code: string = 'TOOL_ERROR') {
    super(message); this.name = 'McpToolError';
  }
}

// ── In-process tool dispatcher ────────────────────────────────────────────────
const IN_PROCESS_TOOLS = {
  capture_care_update: captureUpdate,
  confirm_care_update: confirmUpdate,
  get_today_plan: getTodayPlan,
  update_task_status: updateTaskStatus,
  generate_care_handoff: generateHandoff,
};

async function callInProcess(toolName: ToolName, toolArgs: Record<string, unknown>): Promise<unknown> {
  const db = getDb();
  const fn = IN_PROCESS_TOOLS[toolName];
  if (!fn) throw new McpToolError(`Unknown tool: ${toolName}`, 'TOOL_ERROR');
  try {
    return await fn(db, toolArgs);
  } catch (err) {
    if (err instanceof ToolError) throw new McpToolError(err.message, err.code);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    throw new McpToolError(msg, 'TOOL_ERROR');
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function callMcpTool<T = unknown>(
  toolName: ToolName,
  toolArgs: Record<string, unknown>
): Promise<T> {
  if (IN_PROCESS) {
    return await callInProcess(toolName, toolArgs) as T;
  }

  // HTTP mode — connect to separate MCP server process
  const client = new Client({ name: 'care-circle-web', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: toolArgs }) as CallToolResult;

    if (result.isError) {
      const errorText = (result.content as TextContent[])
        .filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      const cleanMsg = errorText.replace(/^Error:\s*/, '') || 'MCP tool returned an error';
      const codeMatch = cleanMsg.match(/\[(?:CODE:)?([A-Z_]+)\]$/);
      const code = codeMatch ? codeMatch[1] : 'TOOL_ERROR';
      const msg = codeMatch ? cleanMsg.slice(0, codeMatch.index).trim() : cleanMsg;
      throw new McpToolError(msg, code);
    }

    const textContent = (result.content as TextContent[])
      .filter((c) => c.type === 'text').map((c) => c.text).join('');
    return JSON.parse(textContent) as T;
  } catch (err) {
    if (err instanceof McpToolError) throw err;
    if (err instanceof Error) {
      const msg = err.message;
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('connect') || msg.includes('aborted') || msg.includes('timeout') || msg.includes('network')) {
        throw new McpConnectionError(`Could not connect to MCP server at ${MCP_URL}.`);
      }
      throw new McpToolError(msg, 'TOOL_ERROR');
    }
    throw new McpToolError('Unknown error', 'TOOL_ERROR');
  } finally {
    await client.close().catch(() => {});
  }
}

export async function pingMcpServer(): Promise<boolean> {
  if (IN_PROCESS) return true;
  try {
    const res = await fetch(`http://127.0.0.1:${process.env.MCP_PORT ?? '3001'}/health`);
    return res.ok;
  } catch { return false; }
}
