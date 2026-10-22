/**
 * Input validation helpers using Zod.
 * Centralised here so validation rules are defined once.
 */
import { z } from 'zod';

// A non-empty string stripped of excessive whitespace
export const NonEmptyString = z.string().trim().min(1).max(2000);

// Care-recipient identifier
export const RecipientId = z.number().int().positive();

// Task identifier
export const TaskId = z.number().int().positive();

// Caregiver display name — limited to reasonable length, no HTML
export const CaregiverName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((s) => !/<[^>]*>/.test(s), { message: 'Display name must not contain HTML' });

// ISO 8601 date string or null
export const ISODateOrNull = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, 'Must be ISO 8601 date, e.g. 2026-10-20 or 2026-10-20T14:30')
  .nullable();

// Task status
export const TaskStatusEnum = z.enum(['open', 'completed']);

// ─── Tool input schemas ──────────────────────────────────────────────────────

export const CaptureUpdateInput = z.object({
  recipient_id: RecipientId,
  caregiver_name: CaregiverName,
  update_text: NonEmptyString,
});

export const ConfirmUpdateInput = z.object({
  update_id: z.number().int().positive(),
  recipient_id: RecipientId,
  caregiver_name: CaregiverName,
  confirmed_tasks: z.array(
    z.object({
      description: NonEmptyString,
      due_date: ISODateOrNull,
      responsible_person: z.string().trim().max(100).nullable(),
    })
  ).min(1, 'At least one task must be confirmed'),
});

export const GetTodayPlanInput = z.object({
  recipient_id: RecipientId,
});

export const UpdateTaskStatusInput = z.object({
  task_id: TaskId,
  new_status: TaskStatusEnum,
  changed_by: CaregiverName,
  note: z.string().trim().max(500).optional(),
});

export const GenerateHandoffInput = z.object({
  recipient_id: RecipientId,
  generated_by: CaregiverName,
});

// ─── Sanitisation helpers ────────────────────────────────────────────────────

/** Strip HTML tags from a string */
export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

/** Format a Zod error into a readable message */
export function formatZodError(error: z.ZodError): string {
  return error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}
