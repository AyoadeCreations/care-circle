/**
 * Seed script — populates the database with fictional demo data.
 * Safe to run multiple times (checks count first).
 * All data is clearly fictional and labelled demo_data=1.
 */
import { getDb, initSchema } from './database.js';
import type { Client } from '@libsql/client';

export async function seedDatabase(clientOverride?: Client): Promise<void> {
  const db = clientOverride ?? getDb();

  // Ensure schema exists
  await initSchema(db);

  // Check if already seeded
  const countResult = await db.execute('SELECT COUNT(*) as c FROM care_recipients');
  const count = Number(countResult.rows[0]?.c ?? 0);
  if (count > 0) return;

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
  const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0];
  const nextWeekStr = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];

  // Insert recipients
  const margaretRes = await db.execute({
    sql: "INSERT INTO care_recipients (name, relationship, demo_data) VALUES (?, ?, 1)",
    args: ['Margaret Chen', 'Mother'],
  });
  const margaret = Number(margaretRes.lastInsertRowid);

  const arthurRes = await db.execute({
    sql: "INSERT INTO care_recipients (name, relationship, demo_data) VALUES (?, ?, 1)",
    args: ['Arthur Okafor', 'Father-in-law'],
  });
  const arthur = Number(arthurRes.lastInsertRowid);

  // Caregivers
  for (const name of ['Sarah (daughter)', 'James (son-in-law)', 'Priya (neighbour)']) {
    await db.execute({ sql: "INSERT INTO caregivers (display_name, demo_data) VALUES (?, 1)", args: [name] });
  }

  const now = new Date().toISOString();

  // Tasks for Margaret
  const t1 = await db.execute({
    sql: `INSERT INTO care_tasks (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [margaret, 'Pick up blood pressure medication from Boots pharmacy', todayStr, 'Sarah (daughter)', 'open', 'Demo seed data', 'System (seed)', now, now],
  });

  await db.execute({
    sql: `INSERT INTO care_tasks (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [margaret, 'GP appointment — annual review', `${tomorrowStr}T10:30:00`, 'James (son-in-law)', 'open', 'Demo seed data', 'System (seed)', now, now],
  });

  await db.execute({
    sql: `INSERT INTO care_tasks (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [margaret, 'Confirm transport to physiotherapy session', null, null, 'open', 'Demo seed data', 'System (seed)', now, now],
  });

  const t4 = await db.execute({
    sql: `INSERT INTO care_tasks (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [margaret, 'Order repeat prescription online', `${yesterdayStr}T09:00:00`, 'Sarah (daughter)', 'completed', 'Demo seed data', 'System (seed)', now, now],
  });
  const t4id = Number(t4.lastInsertRowid);
  await db.execute({
    sql: `INSERT INTO task_history (task_id, changed_by, old_status, new_status, changed_at, note)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [t4id, 'Sarah (daughter)', 'open', 'completed', now, 'Ordered via NHS repeat prescription portal'],
  });

  await db.execute({
    sql: `INSERT INTO care_tasks (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [margaret, 'Arrange weekly shopping delivery', nextWeekStr, 'Priya (neighbour)', 'open', 'Demo seed data', 'System (seed)', now, now],
  });

  // Tasks for Arthur
  await db.execute({
    sql: `INSERT INTO care_tasks (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [arthur, 'Collect walking frame from equipment loan store', todayStr, null, 'open', 'Demo seed data', 'System (seed)', now, now],
  });

  await db.execute({
    sql: `INSERT INTO care_tasks (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [arthur, 'Eye test appointment at Vision Express', `${nextWeekStr}T14:00:00`, 'James (son-in-law)', 'open', 'Demo seed data', 'System (seed)', now, now],
  });

  await db.execute({
    sql: `INSERT INTO care_tasks (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [arthur, 'Call social worker regarding home assessment', null, null, 'open', 'Demo seed data', 'System (seed)', now, now],
  });

  console.log('[Seed] Database seeded with fictional demo data.');
}

// Allow running as a script: node dist/db/seed.js
if (process.argv[1] && process.argv[1].includes('seed')) {
  seedDatabase().then(() => process.exit(0)).catch(console.error);
}
