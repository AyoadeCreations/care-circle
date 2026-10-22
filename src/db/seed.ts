/**
 * Seed script — populates the database with fictional demo data.
 * Safe to run multiple times (uses INSERT OR IGNORE).
 * All data is clearly fictional and labelled demo_data=1.
 */
import { getDb } from './database.js';

export function seedDatabase(): void {
  const db = getDb();

  // Check if already seeded
  const count = (db.prepare('SELECT COUNT(*) as c FROM care_recipients').get() as { c: number }).c;
  if (count > 0) {
    return; // already seeded
  }

  const insertRecipient = db.prepare(`
    INSERT INTO care_recipients (name, relationship, demo_data)
    VALUES (?, ?, 1)
  `);

  const insertCaregiver = db.prepare(`
    INSERT INTO caregivers (display_name, demo_data)
    VALUES (?, 1)
  `);

  const insertTask = db.prepare(`
    INSERT INTO care_tasks
      (recipient_id, description, due_date, responsible_person, status, source_update, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const insertHistory = db.prepare(`
    INSERT INTO task_history (task_id, changed_by, old_status, new_status, changed_at, note)
    VALUES (?, ?, ?, ?, datetime('now'), ?)
  `);

  db.transaction(() => {
    // Care recipients (fictional)
    const margaret = insertRecipient.run('Margaret Chen', 'Mother').lastInsertRowid as number;
    const arthur   = insertRecipient.run('Arthur Okafor', 'Father-in-law').lastInsertRowid as number;

    // Caregivers (fictional)
    insertCaregiver.run('Sarah (daughter)');
    insertCaregiver.run('James (son-in-law)');
    insertCaregiver.run('Priya (neighbour)');

    // Tasks for Margaret — mix of statuses and dates
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
    const yesterdayStr = new Date(today.getTime() - 86400000).toISOString().split('T')[0];
    const nextWeekStr = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];

    const t1 = insertTask.run(
      margaret,
      'Pick up blood pressure medication from Boots pharmacy',
      todayStr,
      'Sarah (daughter)',
      'open',
      'Demo seed data — medication collection due today',
      'System (seed)'
    ).lastInsertRowid as number;

    const t2 = insertTask.run(
      margaret,
      'GP appointment — annual review',
      `${tomorrowStr}T10:30:00`,
      'James (son-in-law)',
      'open',
      'Demo seed data — scheduled GP visit',
      'System (seed)'
    ).lastInsertRowid as number;

    const t3 = insertTask.run(
      margaret,
      'Confirm transport to physiotherapy session',
      null,
      null,
      'open',
      'Demo seed data — transport unconfirmed',
      'System (seed)'
    ).lastInsertRowid as number;

    const t4 = insertTask.run(
      margaret,
      'Order repeat prescription online',
      `${yesterdayStr}T09:00:00`,
      'Sarah (daughter)',
      'completed',
      'Demo seed data — already completed',
      'System (seed)'
    ).lastInsertRowid as number;

    insertHistory.run(t4, 'Sarah (daughter)', 'open', 'completed',
      'Ordered via NHS repeat prescription portal');

    const t5 = insertTask.run(
      margaret,
      'Arrange weekly shopping delivery',
      nextWeekStr,
      'Priya (neighbour)',
      'open',
      'Demo seed data — upcoming errand',
      'System (seed)'
    ).lastInsertRowid as number;

    // Tasks for Arthur
    insertTask.run(
      arthur,
      'Collect walking frame from equipment loan store',
      todayStr,
      null,
      'open',
      'Demo seed data — equipment collection',
      'System (seed)'
    );

    insertTask.run(
      arthur,
      'Eye test appointment at Vision Express',
      `${nextWeekStr}T14:00:00`,
      'James (son-in-law)',
      'open',
      'Demo seed data — optician visit',
      'System (seed)'
    );

    insertTask.run(
      arthur,
      'Call social worker regarding home assessment',
      null,
      null,
      'open',
      'Demo seed data — needs follow-up',
      'System (seed)'
    );

  })();

  console.log('[Seed] Database seeded with fictional demo data.');
}

// Allow running as a script: node dist/db/seed.js
if (process.argv[1] && process.argv[1].includes('seed')) {
  seedDatabase();
  process.exit(0);
}
