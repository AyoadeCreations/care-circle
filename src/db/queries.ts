/**
 * Data access layer for Care Circle.
 * All DB interaction goes through these functions.
 * No raw SQL outside this file.
 */
import type Database from 'better-sqlite3';
import type { CareRecipient, CareTask, CareUpdate, Handoff, TaskHistory, TaskStatus } from '../types/index.js';

// ─── Recipients ────────────────────────────────────────────────────────────

export function getRecipients(db: Database.Database): CareRecipient[] {
  return db.prepare('SELECT * FROM care_recipients ORDER BY name').all() as CareRecipient[];
}

export function getRecipientById(db: Database.Database, id: number): CareRecipient | null {
  return (db.prepare('SELECT * FROM care_recipients WHERE id = ?').get(id) as CareRecipient) ?? null;
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export function getTasksByRecipient(db: Database.Database, recipientId: number): CareTask[] {
  return db
    .prepare(`
      SELECT * FROM care_tasks
      WHERE recipient_id = ?
      ORDER BY
        CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
        due_date ASC,
        created_at ASC
    `)
    .all(recipientId) as CareTask[];
}

export function getTaskById(db: Database.Database, taskId: number): CareTask | null {
  return (db.prepare('SELECT * FROM care_tasks WHERE id = ?').get(taskId) as CareTask) ?? null;
}

export interface CreateTaskInput {
  recipientId: number;
  description: string;
  dueDate: string | null;
  responsiblePerson: string | null;
  sourceUpdate: string | null;
  createdBy: string;
}

export function createTask(db: Database.Database, input: CreateTaskInput): CareTask {
  const now = new Date().toISOString();
  const result = db
    .prepare(`
      INSERT INTO care_tasks
        (recipient_id, description, due_date, responsible_person, status,
         source_update, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `)
    .run(
      input.recipientId,
      input.description,
      input.dueDate,
      input.responsiblePerson,
      input.sourceUpdate,
      input.createdBy,
      now,
      now
    );
  return getTaskById(db, result.lastInsertRowid as number) as CareTask;
}

export function updateTaskStatus(
  db: Database.Database,
  taskId: number,
  newStatus: TaskStatus,
  changedBy: string,
  note?: string
): CareTask {
  const task = getTaskById(db, taskId);
  if (!task) {
    throw new Error(`Task ${taskId} not found`);
  }
  if (task.status === newStatus) {
    return task; // no change needed
  }

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE care_tasks SET status = ?, updated_at = ? WHERE id = ?
  `).run(newStatus, now, taskId);

  db.prepare(`
    INSERT INTO task_history (task_id, changed_by, old_status, new_status, changed_at, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(taskId, changedBy, task.status, newStatus, now, note ?? null);

  return getTaskById(db, taskId) as CareTask;
}

export function getRecentHistory(
  db: Database.Database,
  recipientId: number,
  limit = 20
): TaskHistory[] {
  return db
    .prepare(`
      SELECT th.*
      FROM task_history th
      JOIN care_tasks ct ON ct.id = th.task_id
      WHERE ct.recipient_id = ?
      ORDER BY th.changed_at DESC, th.id DESC
      LIMIT ?
    `)
    .all(recipientId, limit) as TaskHistory[];
}

export function getTaskHistoryByTaskId(db: Database.Database, taskId: number): TaskHistory[] {
  return db
    .prepare('SELECT * FROM task_history WHERE task_id = ? ORDER BY changed_at DESC, id DESC')
    .all(taskId) as TaskHistory[];
}

// ─── Care updates (raw text) ─────────────────────────────────────────────────

export function storeRawUpdate(
  db: Database.Database,
  recipientId: number,
  caregiverName: string,
  rawText: string
): CareUpdate {
  const now = new Date().toISOString();
  const result = db
    .prepare(`
      INSERT INTO care_updates (recipient_id, caregiver_name, raw_text, created_at)
      VALUES (?, ?, ?, ?)
    `)
    .run(recipientId, caregiverName, rawText, now);
  return db.prepare('SELECT * FROM care_updates WHERE id = ?').get(result.lastInsertRowid) as CareUpdate;
}

export function getUpdateById(db: Database.Database, updateId: number): CareUpdate | null {
  return (db.prepare('SELECT * FROM care_updates WHERE id = ?').get(updateId) as CareUpdate) ?? null;
}

// ─── Handoffs ───────────────────────────────────────────────────────────────

export function storeHandoff(
  db: Database.Database,
  recipientId: number,
  generatedBy: string,
  content: string
): Handoff {
  const now = new Date().toISOString();
  const result = db
    .prepare(`
      INSERT INTO handoffs (recipient_id, generated_by, content, generated_at)
      VALUES (?, ?, ?, ?)
    `)
    .run(recipientId, generatedBy, content, now);
  return db.prepare('SELECT * FROM handoffs WHERE id = ?').get(result.lastInsertRowid) as Handoff;
}

export function getLastHandoff(db: Database.Database, recipientId: number): Handoff | null {
  return (
    (db
      .prepare('SELECT * FROM handoffs WHERE recipient_id = ? ORDER BY generated_at DESC LIMIT 1')
      .get(recipientId) as Handoff) ?? null
  );
}
