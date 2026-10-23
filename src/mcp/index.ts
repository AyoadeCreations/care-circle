/**
 * Care Circle MCP Server
 *
 * Implements 5 MCP tools over Streamable HTTP transport.
 * Protocol: spec 2025-11-25 (via @modelcontextprotocol/sdk v1.32.1)
 * Transport: StreamableHTTPServerTransport — POST /mcp
 *
 * Hackathon requirement: self-hosted MCP server, MCP spec ≥ 2025-11-25,
 * runtime SDK imported and called (not just named in README).
 */
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { seedDatabase } from '../db/seed.js';
import {
  captureUpdate,
  confirmUpdate,
  getTodayPlan,
  updateTaskStatus,
  generateHandoff,
  ToolError,
} from './tools.js';

/** Format a tool error into text that the MCP client can parse for error code. */
function formatToolError(err: unknown): string {
  if (err instanceof ToolError) {
    return `Error: ${err.message} [${err.code}]`;
  }
  return 'Error: An unexpected error occurred. [TOOL_ERROR]';
}

const MCP_PORT = parseInt(process.env.MCP_PORT ?? '3001');

export function createMcpServer(): McpServer {
  const db = getDb();
  const server = new McpServer({
    name: 'care-circle',
    version: '1.0.0',
  });

  // ── Tool: capture_care_update ──────────────────────────────────────────────
  server.tool(
    'capture_care_update',
    'Parse a caregiver\'s natural-language update and return a proposed task list for review. ' +
    'Does NOT save tasks — call confirm_care_update to save. ' +
    'Never invents dates, deadlines, or responsible people.',
    {
      recipient_id: z.number().int().positive().describe('ID of the care recipient'),
      caregiver_name: z.string().min(1).max(100).describe('Display name of the caregiver submitting this update'),
      update_text: z.string().min(1).max(2000).describe('Free-form update text in plain language'),
    },
    async ({ recipient_id, caregiver_name, update_text }) => {
      try {
        const result = await captureUpdate(db, { recipient_id, caregiver_name, update_text });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatToolError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: confirm_care_update ──────────────────────────────────────────────
  server.tool(
    'confirm_care_update',
    'Save the user-reviewed and confirmed tasks from a previous capture_care_update call to the database. ' +
    'The user must have explicitly reviewed and approved each task before calling this. ' +
    'Tasks are saved with the caregiver name as the creator.',
    {
      update_id: z.number().int().positive().describe('ID returned by capture_care_update'),
      recipient_id: z.number().int().positive().describe('ID of the care recipient'),
      caregiver_name: z.string().min(1).max(100).describe('Display name of the confirming caregiver'),
      confirmed_tasks: z.array(z.object({
        description: z.string().min(1).max(2000).describe('Task description (edited if needed)'),
        due_date: z.string().nullable().describe('ISO 8601 date/datetime or null'),
        responsible_person: z.string().max(100).nullable().describe('Person responsible, or null if unassigned'),
      })).min(1).describe('Tasks to save (must have at least one)'),
    },
    async ({ update_id, recipient_id, caregiver_name, confirmed_tasks }) => {
      try {
        const result = await confirmUpdate(db, { update_id, recipient_id, caregiver_name, confirmed_tasks });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatToolError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: get_today_plan ───────────────────────────────────────────────────
  server.tool(
    'get_today_plan',
    'Retrieve all open care tasks for the specified recipient, grouped as: overdue, due today, upcoming, and unscheduled. ' +
    'Returns structured data with timestamps and responsible persons. ' +
    'Only reflects tasks saved in the database.',
    {
      recipient_id: z.number().int().positive().describe('ID of the care recipient'),
    },
    async ({ recipient_id }) => {
      try {
        const result = await getTodayPlan(db, { recipient_id });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatToolError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: update_task_status ───────────────────────────────────────────────
  server.tool(
    'update_task_status',
    'Mark an existing task as completed or open. ' +
    'Persists the change and records an audit entry in task_history. ' +
    'Returns the updated task.',
    {
      task_id: z.number().int().positive().describe('ID of the task to update'),
      new_status: z.enum(['open', 'completed']).describe('New status for the task'),
      changed_by: z.string().min(1).max(100).describe('Display name of the person making the change'),
      note: z.string().max(500).optional().describe('Optional note about the status change'),
    },
    async ({ task_id, new_status, changed_by, note }) => {
      try {
        const result = await updateTaskStatus(db, { task_id, new_status, changed_by, note });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatToolError(err) }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: generate_care_handoff ────────────────────────────────────────────
  server.tool(
    'generate_care_handoff',
    'Generate a structured caregiver handoff summary from live database state. ' +
    'Includes: completed tasks since last handoff, outstanding tasks, upcoming appointments, ' +
    'unassigned items, and recent changes. ' +
    'All data comes from the database — nothing is invented.',
    {
      recipient_id: z.number().int().positive().describe('ID of the care recipient'),
      generated_by: z.string().min(1).max(100).describe('Display name of the person generating the handoff'),
      handed_to: z.string().max(100).nullable().optional().describe('Name of the caregiver receiving the handoff'),
    },
    async ({ recipient_id, generated_by, handed_to }) => {
      try {
        const result = await generateHandoff(db, { recipient_id, generated_by, handed_to });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: formatToolError(err) }],
          isError: true,
        };
      }
    }
  );

  return server;
}

/**
 * Start the MCP HTTP server.
 * Exposes POST /mcp using StreamableHTTPServerTransport.
 *
 * Security: validates Origin header on requests to prevent DNS rebinding.
 * Binds to localhost only in development.
 */
export async function startMcpServer(): Promise<void> {
  // Seed DB with demo data on first run
  await seedDatabase();

  const app = express();
  app.use(express.json());

  const server = createMcpServer();

  // Validate Origin header to prevent DNS rebinding attacks
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    `http://localhost:${MCP_PORT}`,
    `http://127.0.0.1:${MCP_PORT}`,
  ];

  app.post('/mcp', async (req: Request, res: Response) => {
    // Origin check (skip for requests without Origin — e.g., curl, server-to-server)
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }

    // Set CORS headers for browser requests
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version');
    }

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });

      // Connect transport to server, handle request, then clean up
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on('finish', () => {
        transport.close().catch(() => {});
      });
    } catch (err) {
      console.error('[MCP] Request handling error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.options('/mcp', (req: Request, res: Response) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version');
      res.status(204).end();
    } else {
      res.status(403).end();
    }
  });

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'care-circle-mcp', timestamp: new Date().toISOString() });
  });

  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  app.listen(MCP_PORT, host, () => {
    console.log(`[MCP] Care Circle MCP server running at http://${host}:${MCP_PORT}/mcp`);
    console.log(`[MCP] Protocol: MCP Streamable HTTP (spec 2025-11-25)`);
  });
}

// Allow running as standalone: node dist/mcp/index.js
// Guard: only start if this is the main module (not imported by unified.ts)
if (process.argv[1] && process.argv[1].includes('mcp') && !process.argv[1].includes('unified')) {
  startMcpServer().catch(console.error);
}
