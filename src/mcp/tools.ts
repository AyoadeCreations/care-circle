/**
 * MCP tool implementations.
 *
 * Each function receives validated input + a DB instance and returns a
 * structured result. The MCP server wires these to tool definitions.
 *
 * Key safety rules:
 *   - capture_care_update saves raw text and returns a PROPOSAL only.
 *   - confirm_care_update is the only function that writes confirmed tasks.
 *   - No tool invents dates, owners or instructions.
 */
import type Database from 'better-sqlite3';
import type { ProposedUpdate, TodayPlan, HandoffSummary, CareTask } from '../types/index.js';
import {
  getRecipientById,
  storeRawUpdate,
  getUpdateById,
  createTask,
  getTasksByRecipient,
  getTaskById,
  updateTaskStatus as dbUpdateTaskStatus,
  getRecentHistory,
  getLastHandoff,
  storeHandoff,
} from '../db/queries.js';
import { parseUpdateText } from '../utils/updateParser.js';
import {
  CaptureUpdateInput,
  ConfirmUpdateInput,
  GetTodayPlanInput,
  UpdateTaskStatusInput,
  GenerateHandoffInput,
  formatZodError,
} from '../utils/validation.js';

export class ToolError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'TOOL_ERROR'
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

// ─── Tool: capture_care_update ───────────────────────────────────────────────

export async function captureUpdate(
  db: Database.Database,
  rawInput: unknown
): Promise<ProposedUpdate> {
  const parsed = CaptureUpdateInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolError(formatZodError(parsed.error), 'INVALID_INPUT');
  }
  const { recipient_id, caregiver_name, update_text } = parsed.data;

  // Validate recipient exists
  const recipient = getRecipientById(db, recipient_id);
  if (!recipient) {
    throw new ToolError(`Care recipient with ID ${recipient_id} not found.`, 'NOT_FOUND');
  }

  // Store raw update for traceability — but NOT as confirmed tasks
  const stored = storeRawUpdate(db, recipient_id, caregiver_name, update_text);

  // Parse the text into a proposal
  const { proposed_tasks, ambiguities } = parseUpdateText(update_text);

  return {
    update_id: stored.id,
    recipient_id,
    recipient_name: recipient.name,
    caregiver_name,
    raw_text: update_text,
    proposed_tasks,
    ambiguities,
    created_at: stored.created_at,
  };
}

// ─── Tool: confirm_care_update ───────────────────────────────────────────────

export async function confirmUpdate(
  db: Database.Database,
  rawInput: unknown
): Promise<{ saved_tasks: CareTask[]; update_id: number }> {
  const parsed = ConfirmUpdateInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolError(formatZodError(parsed.error), 'INVALID_INPUT');
  }
  const { update_id, recipient_id, caregiver_name, confirmed_tasks } = parsed.data;

  // Validate the original update record exists
  const update = getUpdateById(db, update_id);
  if (!update) {
    throw new ToolError(
      `Original update with ID ${update_id} not found. Please capture an update first.`,
      'NOT_FOUND'
    );
  }

  // Validate recipient
  const recipient = getRecipientById(db, recipient_id);
  if (!recipient) {
    throw new ToolError(`Care recipient with ID ${recipient_id} not found.`, 'NOT_FOUND');
  }

  // Save each confirmed task
  const saved_tasks: CareTask[] = [];
  for (const task of confirmed_tasks) {
    const saved = createTask(db, {
      recipientId: recipient_id,
      description: task.description,
      dueDate: task.due_date,
      responsiblePerson: task.responsible_person,
      sourceUpdate: update.raw_text,
      createdBy: caregiver_name,
    });
    saved_tasks.push(saved);
  }

  return { saved_tasks, update_id };
}

// ─── Tool: get_today_plan ────────────────────────────────────────────────────

export async function getTodayPlan(
  db: Database.Database,
  rawInput: unknown
): Promise<TodayPlan> {
  const parsed = GetTodayPlanInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolError(formatZodError(parsed.error), 'INVALID_INPUT');
  }
  const { recipient_id } = parsed.data;

  const recipient = getRecipientById(db, recipient_id);
  if (!recipient) {
    throw new ToolError(`Care recipient with ID ${recipient_id} not found.`, 'NOT_FOUND');
  }

  const tasks = getTasksByRecipient(db, recipient_id);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0]; // "YYYY-MM-DD"

  const overdue: CareTask[] = [];
  const due_today: CareTask[] = [];
  const upcoming: CareTask[] = [];
  const unscheduled: CareTask[] = [];

  for (const task of tasks) {
    if (task.status === 'completed') continue; // Completed tasks not in today's plan

    if (!task.due_date) {
      unscheduled.push(task);
      continue;
    }

    const taskDate = task.due_date.split('T')[0]; // Compare date part only

    if (taskDate < todayStr) {
      overdue.push(task);
    } else if (taskDate === todayStr) {
      due_today.push(task);
    } else {
      upcoming.push(task);
    }
  }

  return {
    recipient_id,
    recipient_name: recipient.name,
    as_of: now.toISOString(),
    overdue,
    due_today,
    upcoming,
    unscheduled,
  };
}

// ─── Tool: update_task_status ────────────────────────────────────────────────

export async function updateTaskStatus(
  db: Database.Database,
  rawInput: unknown
): Promise<{ task: CareTask; message: string }> {
  const parsed = UpdateTaskStatusInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolError(formatZodError(parsed.error), 'INVALID_INPUT');
  }
  const { task_id, new_status, changed_by, note } = parsed.data;

  const task = getTaskById(db, task_id);
  if (!task) {
    throw new ToolError(`Task with ID ${task_id} not found.`, 'NOT_FOUND');
  }

  const updated = dbUpdateTaskStatus(db, task_id, new_status, changed_by, note);
  const action = new_status === 'completed' ? 'marked complete' : 'reopened';

  return {
    task: updated,
    message: `Task "${updated.description}" has been ${action} by ${changed_by}.`,
  };
}

// ─── Tool: generate_care_handoff ─────────────────────────────────────────────

export async function generateHandoff(
  db: Database.Database,
  rawInput: unknown
): Promise<HandoffSummary> {
  const parsed = GenerateHandoffInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new ToolError(formatZodError(parsed.error), 'INVALID_INPUT');
  }
  const { recipient_id, generated_by } = parsed.data;

  const recipient = getRecipientById(db, recipient_id);
  if (!recipient) {
    throw new ToolError(`Care recipient with ID ${recipient_id} not found.`, 'NOT_FOUND');
  }

  const allTasks = getTasksByRecipient(db, recipient_id);
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  // Find last handoff to determine "since last handoff" window
  const lastHandoff = getLastHandoff(db, recipient_id);
  const lastHandoffAt = lastHandoff?.generated_at ?? null;

  // Completed tasks (filter by since last handoff if available)
  const completed_since_last_handoff = allTasks.filter((t) => {
    if (t.status !== 'completed') return false;
    if (!lastHandoffAt) return true; // include all completed tasks if no previous handoff
    return t.updated_at >= lastHandoffAt;
  });

  // Outstanding (open) tasks
  const outstanding = allTasks.filter(
    (t) => t.status === 'open' && (!t.due_date || t.due_date.split('T')[0] <= todayStr)
  );

  // Upcoming appointments/deadlines
  const upcoming_appointments = allTasks.filter(
    (t) => t.status === 'open' && t.due_date && t.due_date.split('T')[0] > todayStr
  );

  // Unassigned tasks
  const unassigned = allTasks.filter(
    (t) => t.status === 'open' && !t.responsible_person
  );

  // Recent task history
  const recent_changes = getRecentHistory(db, recipient_id, 10);

  // Build plain-text handoff content
  const lines: string[] = [
    `CARE CIRCLE HANDOFF — ${recipient.name}`,
    `Generated: ${now.toLocaleDateString('en-GB', { dateStyle: 'full' })} at ${now.toLocaleTimeString('en-GB', { timeStyle: 'short' })}`,
    `Prepared by: ${generated_by}`,
    '',
  ];

  if (completed_since_last_handoff.length > 0) {
    lines.push('✅ COMPLETED SINCE LAST HANDOFF');
    for (const t of completed_since_last_handoff) {
      lines.push(`  • ${t.description}`);
    }
    lines.push('');
  }

  if (outstanding.length > 0) {
    lines.push('📋 OUTSTANDING (DUE TODAY OR OVERDUE)');
    for (const t of outstanding) {
      const by = t.responsible_person ? ` — ${t.responsible_person}` : ' — unassigned';
      const due = t.due_date ? ` (due ${formatDate(t.due_date)})` : '';
      lines.push(`  • ${t.description}${due}${by}`);
    }
    lines.push('');
  }

  if (upcoming_appointments.length > 0) {
    lines.push('📅 UPCOMING');
    for (const t of upcoming_appointments) {
      const by = t.responsible_person ? ` — ${t.responsible_person}` : ' — unassigned';
      const due = t.due_date ? ` (${formatDate(t.due_date)})` : '';
      lines.push(`  • ${t.description}${due}${by}`);
    }
    lines.push('');
  }

  if (unassigned.length > 0) {
    lines.push('⚠️  UNASSIGNED — NEEDS CONFIRMATION');
    for (const t of unassigned) {
      lines.push(`  • ${t.description}`);
    }
    lines.push('');
  }

  if (outstanding.length === 0 && upcoming_appointments.length === 0 && unassigned.length === 0) {
    lines.push('No outstanding or upcoming tasks at this time.');
    lines.push('');
  }

  const content = lines.join('\n');

  // Persist handoff to DB
  storeHandoff(db, recipient_id, generated_by, content);

  return {
    recipient_id,
    recipient_name: recipient.name,
    generated_at: now.toISOString(),
    generated_by,
    completed_since_last_handoff,
    outstanding,
    upcoming_appointments,
    unassigned,
    recent_changes,
    notes: content,
  };
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
