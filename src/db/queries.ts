/**
 * Data access layer for Care Circle.
 * Uses @libsql/client (async). All functions are async.
 * No raw SQL outside this file.
 */
import type { Client } from '@libsql/client';
import type { CareRecipient, CareTask, CareUpdate, Handoff, TaskHistory, TaskStatus } from '../types/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract rows from a libsql ResultSet as typed objects */
function rows<T>(result: { rows: Record<string, unknown>[] }): T[] {
  return result.rows as unknown as T[];
}

function row<T>(result: { rows: Record<string, unknown>[] }): T | null {
  return (result.rows[0] as unknown as T) ?? null;
}

// ─── Recipients ───────────────────────────────────────────────────────────────

export async function getRecipients(db: Client): Promise<CareRecipient[]> {
  const result = await db.execute('SELECT * FROM care_recipients ORDER BY name');
  return rows<CareRecipient>(result);
}

export async function getRecipientById(db: Client, id: number): Promise<CareRecipient | null> {
  const result = await db.execute({ sql: 'SELECT * FROM care_recipients WHERE id = ?', args: [id] });
  return row<CareRecipient>(result);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export async function getTasksByRecipient(db: Client, recipientId: number): Promise<CareTask[]> {
  const result = await db.execute({
    sql: `SELECT * FROM care_tasks
          WHERE recipient_id = ?
          ORDER BY
            CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
            due_date ASC,
            created_at ASC`,
    args: [recipientId],
  });
  return rows<CareTask>(result);
}

export async function getTaskById(db: Client, taskId: number): Promise<CareTask | null> {
  const result = await db.execute({ sql: 'SELECT * FROM care_tasks WHERE id = ?', args: [taskId] });
  return row<CareTask>(result);
}

export interface CreateTaskInput {
  recipientId: number;
  description: string;
  dueDate: string | null;
  responsiblePerson: string | null;
  sourceUpdate: string | null;
  createdBy: string;
}

export async function createTask(db: Client, input: CreateTaskInput): Promise<CareTask> {
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO care_tasks
            (recipient_id, description, due_date, responsible_person, status,
             source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    args: [
      input.recipientId,
      input.description,
      input.dueDate,
      input.responsiblePerson,
      input.sourceUpdate,
      input.createdBy,
      now,
      now,
    ],
  });
  const task = await getTaskById(db, Number(result.lastInsertRowid));
  if (!task) throw new Error('Failed to retrieve created task');
  return task;
}

export async function updateTaskStatus(
  db: Client,
  taskId: number,
  newStatus: TaskStatus,
  changedBy: string,
  note?: string
): Promise<CareTask> {
  const task = await getTaskById(db, taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status === newStatus) return task;

  const now = new Date().toISOString();

  await db.execute({
    sql: 'UPDATE care_tasks SET status = ?, updated_at = ? WHERE id = ?',
    args: [newStatus, now, taskId],
  });

  await db.execute({
    sql: `INSERT INTO task_history (task_id, changed_by, old_status, new_status, changed_at, note)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [taskId, changedBy, task.status, newStatus, now, note ?? null],
  });

  return (await getTaskById(db, taskId)) as CareTask;
}

export async function getRecentHistory(db: Client, recipientId: number, limit = 20): Promise<TaskHistory[]> {
  const result = await db.execute({
    sql: `SELECT th.*
          FROM task_history th
          JOIN care_tasks ct ON ct.id = th.task_id
          WHERE ct.recipient_id = ?
          ORDER BY th.changed_at DESC, th.id DESC
          LIMIT ?`,
    args: [recipientId, limit],
  });
  return rows<TaskHistory>(result);
}

export async function getTaskHistoryByTaskId(db: Client, taskId: number): Promise<TaskHistory[]> {
  const result = await db.execute({
    sql: 'SELECT * FROM task_history WHERE task_id = ? ORDER BY changed_at DESC, id DESC',
    args: [taskId],
  });
  return rows<TaskHistory>(result);
}

// ─── Care updates ─────────────────────────────────────────────────────────────

export async function storeRawUpdate(
  db: Client,
  recipientId: number,
  caregiverName: string,
  rawText: string
): Promise<CareUpdate> {
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO care_updates (recipient_id, caregiver_name, raw_text, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [recipientId, caregiverName, rawText, now],
  });
  const update = await db.execute({
    sql: 'SELECT * FROM care_updates WHERE id = ?',
    args: [Number(result.lastInsertRowid)],
  });
  return row<CareUpdate>(update) as CareUpdate;
}

export async function getUpdateById(db: Client, updateId: number): Promise<CareUpdate | null> {
  const result = await db.execute({ sql: 'SELECT * FROM care_updates WHERE id = ?', args: [updateId] });
  return row<CareUpdate>(result);
}

// ─── Handoffs ─────────────────────────────────────────────────────────────────

export async function storeHandoff(
  db: Client,
  recipientId: number,
  generatedBy: string,
  content: string
): Promise<Handoff> {
  const now = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO handoffs (recipient_id, generated_by, content, generated_at)
          VALUES (?, ?, ?, ?)`,
    args: [recipientId, generatedBy, content, now],
  });
  const handoff = await db.execute({
    sql: 'SELECT * FROM handoffs WHERE id = ?',
    args: [Number(result.lastInsertRowid)],
  });
  return row<Handoff>(handoff) as Handoff;
}

export async function getLastHandoff(db: Client, recipientId: number): Promise<Handoff | null> {
  const result = await db.execute({
    sql: 'SELECT * FROM handoffs WHERE recipient_id = ? ORDER BY generated_at DESC LIMIT 1',
    args: [recipientId],
  });
  return row<Handoff>(result);
}
