/**
 * REST API routes for the Care Circle web interface.
 *
 * All data operations go through the MCP client — the web server
 * never talks to the database directly. This demonstrates real
 * MCP client-server communication.
 *
 * Routes:
 *   GET  /api/recipients             — List all care recipients
 *   POST /api/updates/capture        — Capture and parse an update (returns proposal)
 *   POST /api/updates/confirm        — Confirm and save proposed tasks
 *   GET  /api/plan/:recipientId      — Get today's plan
 *   POST /api/tasks/:taskId/status   — Update task status
 *   POST /api/handoff                — Generate a handoff summary
 */
import { Router, type Request, type Response } from 'express';
import { callMcpTool, McpConnectionError, McpToolError } from './mcpClient.js';
import { getDb } from '../db/database.js';
import { getRecipients } from '../db/queries.js';

/**
 * Map MCP tool errors to appropriate HTTP status codes.
 * - NOT_FOUND       → 404
 * - INVALID_INPUT  → 422 (validation failure)
 * - TOOL_ERROR     → 500
 * - Connection     → 503 (server unreachable)
 */
function sendMcpError(res: Response, err: unknown): void {
  if (err instanceof McpConnectionError) {
    res.status(503).json({ error: err.message });
    return;
  }
  if (err instanceof McpToolError) {
    const code = err.code;
    if (code === 'NOT_FOUND') {
      res.status(404).json({ error: err.message });
    } else if (code === 'INVALID_INPUT') {
      res.status(422).json({ error: err.message });
    } else {
      console.error('[API] Tool error:', err.message);
      res.status(500).json({ error: err.message });
    }
    return;
  }
  const msg = err instanceof Error ? err.message : 'Unknown error';
  console.error('[API] Unexpected error:', msg);
  res.status(500).json({ error: msg });
}

export function createApiRouter(): Router {
  const router = Router();

  // ── GET /api/recipients ──────────────────────────────────────────────────
  router.get('/recipients', (_req: Request, res: Response) => {
    try {
      // Recipients are read directly from DB here — no MCP tool needed for this.
      // This keeps the MCP tool surface focused on care coordination operations.
      const db = getDb();
      const recipients = getRecipients(db);
      res.json({ recipients });
    } catch (err) {
      console.error('[API] /recipients error:', err);
      res.status(500).json({ error: 'Failed to load care recipients' });
    }
  });

  // ── POST /api/updates/capture ────────────────────────────────────────────
  router.post('/updates/capture', async (req: Request, res: Response) => {
    const { recipient_id, caregiver_name, update_text } = req.body ?? {};
    if (!recipient_id || !caregiver_name || !update_text) {
      res.status(400).json({ error: 'recipient_id, caregiver_name, and update_text are required' });
      return;
    }

    try {
      const result = await callMcpTool('capture_care_update', {
        recipient_id: Number(recipient_id),
        caregiver_name: String(caregiver_name),
        update_text: String(update_text),
      });
      res.json(result);
    } catch (err) {
      sendMcpError(res, err);
    }
  });

  // ── POST /api/updates/confirm ────────────────────────────────────────────
  router.post('/updates/confirm', async (req: Request, res: Response) => {
    const { update_id, recipient_id, caregiver_name, confirmed_tasks } = req.body ?? {};
    if (!update_id || !recipient_id || !caregiver_name || !confirmed_tasks) {
      res.status(400).json({
        error: 'update_id, recipient_id, caregiver_name, and confirmed_tasks are required',
      });
      return;
    }

    try {
      const result = await callMcpTool('confirm_care_update', {
        update_id: Number(update_id),
        recipient_id: Number(recipient_id),
        caregiver_name: String(caregiver_name),
        confirmed_tasks,
      });
      res.json(result);
    } catch (err) {
      sendMcpError(res, err);
    }
  });

  // ── GET /api/plan/:recipientId ───────────────────────────────────────────
  router.get('/plan/:recipientId', async (req: Request, res: Response) => {
    const recipientId = parseInt(String(req.params.recipientId));
    if (isNaN(recipientId) || recipientId <= 0) {
      res.status(400).json({ error: 'Invalid recipient ID' });
      return;
    }

    try {
      const result = await callMcpTool('get_today_plan', { recipient_id: recipientId });
      res.json(result);
    } catch (err) {
      sendMcpError(res, err);
    }
  });

  // ── POST /api/tasks/:taskId/status ───────────────────────────────────────
  router.post('/tasks/:taskId/status', async (req: Request, res: Response) => {
    const taskId = parseInt(String(req.params.taskId));
    if (isNaN(taskId) || taskId <= 0) {
      res.status(400).json({ error: 'Invalid task ID' });
      return;
    }

    const { new_status, changed_by, note } = req.body ?? {};
    if (!new_status || !changed_by) {
      res.status(400).json({ error: 'new_status and changed_by are required' });
      return;
    }

    try {
      const result = await callMcpTool('update_task_status', {
        task_id: taskId,
        new_status: String(new_status),
        changed_by: String(changed_by),
        note: note ? String(note) : undefined,
      });
      res.json(result);
    } catch (err) {
      sendMcpError(res, err);
    }
  });

  // ── POST /api/handoff ────────────────────────────────────────────────────
  router.post('/handoff', async (req: Request, res: Response) => {
    const { recipient_id, generated_by } = req.body ?? {};
    if (!recipient_id || !generated_by) {
      res.status(400).json({ error: 'recipient_id and generated_by are required' });
      return;
    }

    try {
      const result = await callMcpTool('generate_care_handoff', {
        recipient_id: Number(recipient_id),
        generated_by: String(generated_by),
      });
      res.json(result);
    } catch (err) {
      sendMcpError(res, err);
    }
  });

  return router;
}
