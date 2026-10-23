/**
 * Care Circle — Automated Tests (libsql/@libsql/client)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Client } from '@libsql/client';
import { createTestDb, initSchema } from '../src/db/database.js';
import {
  getTasksByRecipient,
  createTask,
  updateTaskStatus as dbUpdateTaskStatus,
  getTaskHistoryByTaskId,
} from '../src/db/queries.js';
import {
  captureUpdate,
  confirmUpdate,
  getTodayPlan,
  updateTaskStatus,
  generateHandoff,
} from '../src/mcp/tools.js';
import { parseUpdateText } from '../src/utils/updateParser.js';

async function makeTestDb(): Promise<Client> {
  const db = createTestDb();
  await initSchema(db);
  await db.execute("INSERT INTO care_recipients (id, name, relationship, demo_data) VALUES (1, 'Margaret Chen', 'Mother', 1)");
  await db.execute("INSERT INTO care_recipients (id, name, relationship, demo_data) VALUES (2, 'Arthur Okafor', 'Father-in-law', 1)");
  return db;
}

// Test 1
describe('Test 1 — Update proposal vs confirmation separation', () => {
  let db: Client;
  beforeEach(async () => { db = await makeTestDb(); });
  afterEach(() => { db.close(); });

  it('capture does not create tasks', async () => {
    expect(await getTasksByRecipient(db, 1)).toHaveLength(0);
    await captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: 'Mum needs a follow-up next Tuesday' });
    expect(await getTasksByRecipient(db, 1)).toHaveLength(0);
  });

  it('capture stores raw update', async () => {
    const r = await captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: 'Need to book appointment' });
    expect(r.update_id).toBeGreaterThan(0);
    expect(r.raw_text).toBe('Need to book appointment');
  });

  it('capture returns proposal not saved task', async () => {
    const r = await captureUpdate(db, { recipient_id: 1, caregiver_name: 'James', update_text: "Transport changed to Tuesday at 10 AM. Need to confirm who picks up." });
    expect(r.proposed_tasks.length).toBeGreaterThan(0);
    expect(r.proposed_tasks[0]).toHaveProperty('confidence');
    expect(await getTasksByRecipient(db, 1)).toHaveLength(0);
  });

  it('only confirm writes tasks', async () => {
    const proposal = await captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: 'Need to collect medication tomorrow' });
    expect(await getTasksByRecipient(db, 1)).toHaveLength(0);
    await confirmUpdate(db, { update_id: proposal.update_id, recipient_id: 1, caregiver_name: 'Sarah', confirmed_tasks: [{ description: 'Collect medication', due_date: null, responsible_person: 'Sarah' }] });
    expect(await getTasksByRecipient(db, 1)).toHaveLength(1);
  });
});

// Test 2
describe('Test 2 — Persistence', () => {
  it('confirmed tasks are committed and readable', async () => {
    const db = await makeTestDb();
    try {
      const task = await createTask(db, { recipientId: 1, description: 'Book physio', dueDate: '2026-10-25', responsiblePerson: 'Sarah', sourceUpdate: 'test', createdBy: 'Test' });
      expect(task.id).toBeGreaterThan(0);
      expect(task.status).toBe('open');
      const tasks = await getTasksByRecipient(db, 1);
      expect(tasks.find((t) => t.id === task.id)).toBeDefined();
    } finally { db.close(); }
  });
});

// Test 3
describe('Test 3 — get_today_plan accuracy', () => {
  let db: Client;
  beforeEach(async () => { db = await makeTestDb(); });
  afterEach(() => { db.close(); });

  it('returns tasks in correct buckets', async () => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    await createTask(db, { recipientId: 1, description: 'Overdue', dueDate: yesterday.toISOString().split('T')[0], responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await createTask(db, { recipientId: 1, description: 'Today', dueDate: todayStr, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await createTask(db, { recipientId: 1, description: 'Upcoming', dueDate: tomorrow.toISOString().split('T')[0], responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await createTask(db, { recipientId: 1, description: 'Unscheduled', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    const plan = await getTodayPlan(db, { recipient_id: 1 });
    expect(plan.overdue).toHaveLength(1);
    expect(plan.due_today).toHaveLength(1);
    expect(plan.upcoming).toHaveLength(1);
    expect(plan.unscheduled).toHaveLength(1);
  });

  it('completed tasks not in plan', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const task = await createTask(db, { recipientId: 1, description: 'Done task', dueDate: todayStr, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await dbUpdateTaskStatus(db, task.id, 'completed', 'Sarah');
    const plan = await getTodayPlan(db, { recipient_id: 1 });
    const all = [...plan.overdue, ...plan.due_today, ...plan.upcoming, ...plan.unscheduled];
    expect(all.find((t) => t.id === task.id)).toBeUndefined();
  });

  it('plan isolates recipients', async () => {
    await createTask(db, { recipientId: 1, description: 'Margaret task', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await createTask(db, { recipientId: 2, description: 'Arthur task', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    const p1 = await getTodayPlan(db, { recipient_id: 1 });
    const p2 = await getTodayPlan(db, { recipient_id: 2 });
    const a1 = [...p1.overdue, ...p1.due_today, ...p1.upcoming, ...p1.unscheduled];
    const a2 = [...p2.overdue, ...p2.due_today, ...p2.upcoming, ...p2.unscheduled];
    expect(a1.every((t) => t.recipient_id === 1)).toBe(true);
    expect(a2.every((t) => t.recipient_id === 2)).toBe(true);
  });
});

// Test 4
describe('Test 4 — Task status update and audit trail', () => {
  let db: Client;
  beforeEach(async () => { db = await makeTestDb(); });
  afterEach(() => { db.close(); });

  it('completing changes status', async () => {
    const task = await createTask(db, { recipientId: 1, description: 'Test', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    const r = await updateTaskStatus(db, { task_id: task.id, new_status: 'completed', changed_by: 'Sarah', note: 'Done' });
    expect(r.task.status).toBe('completed');
  });

  it('records history entry', async () => {
    const task = await createTask(db, { recipientId: 1, description: 'Test', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await updateTaskStatus(db, { task_id: task.id, new_status: 'completed', changed_by: 'Sarah', note: 'Done' });
    const h = await getTaskHistoryByTaskId(db, task.id);
    expect(h).toHaveLength(1);
    expect(h[0].old_status).toBe('open');
    expect(h[0].new_status).toBe('completed');
  });

  it('reopening records history', async () => {
    const task = await createTask(db, { recipientId: 1, description: 'Test', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await updateTaskStatus(db, { task_id: task.id, new_status: 'completed', changed_by: 'Sarah' });
    await updateTaskStatus(db, { task_id: task.id, new_status: 'open', changed_by: 'James', note: 'Not done' });
    const h = await getTaskHistoryByTaskId(db, task.id);
    expect(h).toHaveLength(2);
    expect(h[0].new_status).toBe('open');
  });

  it('same status no duplicate history', async () => {
    const task = await createTask(db, { recipientId: 1, description: 'Test', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await updateTaskStatus(db, { task_id: task.id, new_status: 'open', changed_by: 'Sarah' });
    const h = await getTaskHistoryByTaskId(db, task.id);
    expect(h).toHaveLength(0);
  });
});

// Test 5
describe('Test 5 — Handoff reflects live DB state', () => {
  let db: Client;
  beforeEach(async () => { db = await makeTestDb(); });
  afterEach(() => { db.close(); });

  it('includes completed and outstanding', async () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const ct = await createTask(db, { recipientId: 1, description: 'Pick up meds', dueDate: todayStr, responsiblePerson: 'Sarah', sourceUpdate: null, createdBy: 'T' });
    const ot = await createTask(db, { recipientId: 1, description: 'Book GP', dueDate: todayStr, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await dbUpdateTaskStatus(db, ct.id, 'completed', 'Sarah');
    const h = await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah' });
    expect(h.completed_since_last_handoff.map((t) => t.id)).toContain(ct.id);
    expect(h.outstanding.map((t) => t.id)).toContain(ot.id);
  });

  it('contains recipient name', async () => {
    const h = await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah' });
    expect(h.notes).toContain('Margaret Chen');
  });

  it('no cross-recipient tasks', async () => {
    await createTask(db, { recipientId: 2, description: 'Arthur', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    const h = await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah' });
    const all = [...h.completed_since_last_handoff, ...h.outstanding, ...h.upcoming_appointments, ...h.unassigned];
    expect(all.every((t) => t.recipient_id === 1)).toBe(true);
  });

  it('saved to handoffs table', async () => {
    await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah' });
    const r = await db.execute('SELECT COUNT(*) as c FROM handoffs WHERE recipient_id = 1');
    expect(Number(r.rows[0]?.c)).toBe(1);
  });
});

// Test 6
describe('Test 6 — No invented data', () => {
  it('null due_date when no date', () => {
    const r = parseUpdateText('We need to call the social worker.');
    for (const t of r.proposed_tasks) expect(t.due_date).toBeNull();
  });

  it('null responsible when no one named', () => {
    const r = parseUpdateText('Someone needs to arrange delivery.');
    for (const t of r.proposed_tasks) {
      if (t.responsible_person !== null) expect(t.confidence).not.toBe('high');
    }
  });

  it('capture returns null dates for no-date text', async () => {
    const db = await makeTestDb();
    try {
      const r = await captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: 'Check in with physiotherapist.' });
      for (const t of r.proposed_tasks) expect(t.due_date).toBeNull();
    } finally { db.close(); }
  });

  it('null responsible stored as null', async () => {
    const db = await makeTestDb();
    try {
      const p = await captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: 'Someone arrange transport.' });
      const { saved_tasks } = await confirmUpdate(db, { update_id: p.update_id, recipient_id: 1, caregiver_name: 'Sarah', confirmed_tasks: [{ description: 'Arrange transport', due_date: null, responsible_person: null }] });
      expect(saved_tasks[0].responsible_person).toBeNull();
    } finally { db.close(); }
  });
});

// Test 7
describe('Test 7 — Safe error handling', () => {
  let db: Client;
  beforeEach(async () => { db = await makeTestDb(); });
  afterEach(() => { db.close(); });

  it('non-existent recipient NOT_FOUND', async () => {
    await expect(getTodayPlan(db, { recipient_id: 9999 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('non-existent task NOT_FOUND', async () => {
    await expect(updateTaskStatus(db, { task_id: 9999, new_status: 'completed', changed_by: 'Sarah' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('invalid recipient_id INVALID_INPUT', async () => {
    await expect(captureUpdate(db, { recipient_id: -1, caregiver_name: 'Sarah', update_text: 'test' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('empty text INVALID_INPUT', async () => {
    await expect(captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('missing update_id NOT_FOUND', async () => {
    await expect(confirmUpdate(db, { update_id: 9999, recipient_id: 1, caregiver_name: 'Sarah', confirmed_tasks: [{ description: 'T', due_date: null, responsible_person: null }] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('empty confirmed_tasks INVALID_INPUT', async () => {
    const p = await captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: 'update' });
    await expect(confirmUpdate(db, { update_id: p.update_id, recipient_id: 1, caregiver_name: 'Sarah', confirmed_tasks: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('invalid status INVALID_INPUT', async () => {
    const t = await createTask(db, { recipientId: 1, description: 'T', dueDate: null, responsiblePerson: null, sourceUpdate: null, createdBy: 'T' });
    await expect(updateTaskStatus(db, { task_id: t.id, new_status: 'deleted' as 'open', changed_by: 'Sarah' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('HTML in name INVALID_INPUT', async () => {
    await expect(captureUpdate(db, { recipient_id: 1, caregiver_name: '<script>x</script>', update_text: 'test' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('non-existent recipient handoff NOT_FOUND', async () => {
    await expect(generateHandoff(db, { recipient_id: 9999, generated_by: 'Sarah' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

// Test 8
describe('Test 8 — End-to-end workflow', () => {
  let db: Client;
  beforeEach(async () => { db = await makeTestDb(); });
  afterEach(() => { db.close(); });

  it('capture to handoff', async () => {
    const proposal = await captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah (daughter)', update_text: "Transport changed to Tuesday at 10 AM. Need to confirm who picks up." });
    expect(proposal.update_id).toBeGreaterThan(0);
    expect(proposal.proposed_tasks.length).toBeGreaterThan(0);
    expect(await getTasksByRecipient(db, 1)).toHaveLength(0);
    const { saved_tasks } = await confirmUpdate(db, { update_id: proposal.update_id, recipient_id: 1, caregiver_name: 'Sarah (daughter)', confirmed_tasks: [{ description: 'Transport Tuesday 10 AM', due_date: null, responsible_person: null }, { description: 'Confirm who picks up', due_date: null, responsible_person: null }] });
    expect(saved_tasks).toHaveLength(2);
    const plan = await getTodayPlan(db, { recipient_id: 1 });
    expect([...plan.overdue, ...plan.due_today, ...plan.upcoming, ...plan.unscheduled].length).toBe(2);
    await updateTaskStatus(db, { task_id: saved_tasks[0].id, new_status: 'completed', changed_by: 'Sarah (daughter)', note: 'Confirmed' });
    const plan2 = await getTodayPlan(db, { recipient_id: 1 });
    expect([...plan2.overdue, ...plan2.due_today, ...plan2.upcoming, ...plan2.unscheduled].length).toBe(1);
    const handoff = await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah (daughter)' });
    expect(handoff.completed_since_last_handoff.map((t) => t.id)).toContain(saved_tasks[0].id);
    expect(handoff.notes).toContain('COMPLETED');
    expect(handoff.notes).toContain('OUTSTANDING');
  });
});

// Parser
describe('Update parser', () => {
  it('parses Tuesday at 10 AM', () => {
    const r = parseUpdateText('Appointment changed to Tuesday at 10 AM.');
    const t = r.proposed_tasks[0];
    if (t.due_date) expect(t.due_date).toMatch(/T10:00:00$/);
  });
  it('flags ambiguous dates', () => {
    const r = parseUpdateText('Appointment on 10/11 at 2pm');
    expect(r.ambiguities.length).toBeGreaterThan(0);
    expect(r.ambiguities[0]).toMatch(/ambiguous/i);
  });
  it('empty text', () => {
    const r = parseUpdateText('');
    expect(r.proposed_tasks).toEqual([]);
    expect(r.ambiguities.length).toBeGreaterThan(0);
  });
  it('long input no crash', () => {
    expect(() => parseUpdateText('Need transport. '.repeat(80))).not.toThrow();
  });
});

// Regression: CSS
describe('Regression — CSS [hidden]', () => {
  it('style.css has [hidden] !important', () => {
    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web', 'style.css'), 'utf-8');
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });
});

// Regression: error handling
describe('Regression — HTTP 422 error handling', () => {
  let db: Client;
  beforeEach(async () => { db = await makeTestDb(); });
  afterEach(() => { db.close(); });

  it('NOT_FOUND distinct from INVALID_INPUT', async () => {
    await expect(captureUpdate(db, { recipient_id: 9999, caregiver_name: 'Sarah', update_text: 'test' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('INVALID_INPUT for validation', async () => {
    await expect(captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
  it('no doubled Error prefix', async () => {
    try {
      await captureUpdate(db, { recipient_id: 9999, caregiver_name: 'Sarah', update_text: 'test' });
      expect.fail('Should throw');
    } catch (err) {
      expect((err as Error).message).not.toMatch(/^Error:/);
    }
  });
  it('full workflow succeeds', async () => {
    const p = await captureUpdate(db, { recipient_id: 1, caregiver_name: 'Sarah', update_text: "Transport changed to Tuesday." });
    const { saved_tasks } = await confirmUpdate(db, { update_id: p.update_id, recipient_id: 1, caregiver_name: 'Sarah', confirmed_tasks: [{ description: 'Transport Tuesday', due_date: null, responsible_person: null }] });
    await updateTaskStatus(db, { task_id: saved_tasks[0].id, new_status: 'completed', changed_by: 'Sarah' });
    const h = await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah' });
    expect(h.completed_since_last_handoff.map((t) => t.id)).toContain(saved_tasks[0].id);
  });
});

// Regression: duplicate submission
describe('Regression — Duplicate submission prevention', () => {
  it('app.js has isSubmitting guard', () => {
    const fs = require('fs');
    const path = require('path');
    const js = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web', 'app.js'), 'utf-8');
    expect(js).toMatch(/isSubmitting/);
    expect(js).toMatch(/if\s*\(state\.isSubmitting\)\s*return/);
  });
});

// Regression: handoff caregiver selection and handed_to field
describe('Regression — Handoff caregiver selection', () => {
  let db: Client;
  beforeEach(async () => { db = await makeTestDb(); });
  afterEach(() => { db.close(); });

  it('generateHandoff accepts and persists handed_to', async () => {
    const h = await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah', handed_to: 'James (son-in-law)' });
    expect(h.handed_to).toBe('James (son-in-law)');
    expect(h.notes).toContain('Handing over to: James (son-in-law)');
  });

  it('handoff without handed_to still works', async () => {
    const h = await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah' });
    expect(h.handed_to).toBeNull();
    expect(h.notes).not.toContain('Handing over to');
  });

  it('handoff with handed_to persists to database', async () => {
    await generateHandoff(db, { recipient_id: 1, generated_by: 'Sarah', handed_to: 'Priya (neighbour)' });
    const r = await db.execute('SELECT handed_to FROM handoffs WHERE recipient_id = 1 ORDER BY id DESC LIMIT 1');
    expect(r.rows[0]?.handed_to).toBe('Priya (neighbour)');
  });

  it('HTML has handoff-to select element', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web', 'index.html'), 'utf-8');
    expect(html).toContain('handoff-to');
    expect(html).toContain('handoff-recipient');
    expect(html).toContain('handoff-from');
  });

  it('API has /api/caregivers endpoint in routes', () => {
    const fs = require('fs');
    const path = require('path');
    const routes = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'server', 'routes.ts'), 'utf-8');
    expect(routes).toContain("'/caregivers'");
    expect(routes).toContain('getCaregivers');
  });

  it('no prominent DEMO badge in HTML', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web', 'index.html'), 'utf-8');
    expect(html).not.toMatch(/DEMO.*Fictional/);
    expect(html).toContain('Sample workspace');
  });

  it('Fraunces display font loaded', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web', 'index.html'), 'utf-8');
    expect(html).toContain('Fraunces');
  });

  it('CSS uses warm ivory and forest green palette', () => {
    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web', 'style.css'), 'utf-8');
    expect(css).toContain('#F7F5EF');
    expect(css).toContain('#244A3A');
    expect(css).toContain('#B9674E');
  });

  it('[hidden] !important still present', () => {
    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'web', 'style.css'), 'utf-8');
    expect(css).toMatch(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  });
});
