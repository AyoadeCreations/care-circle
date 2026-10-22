// Shared types for Care Circle
// These are the domain objects that flow through the application.

export type TaskStatus = 'open' | 'completed';

export interface CareRecipient {
  id: number;
  name: string;
  relationship: string;
  demo_data: number; // 1 if this is demo/fictional data
}

export interface Caregiver {
  id: number;
  display_name: string;
  demo_data: number;
}

export interface CareTask {
  id: number;
  recipient_id: number;
  description: string;
  due_date: string | null;       // ISO 8601 string or null
  responsible_person: string | null;
  status: TaskStatus;
  source_update: string | null;  // raw update text that led to this task
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskHistory {
  id: number;
  task_id: number;
  changed_by: string;
  old_status: TaskStatus;
  new_status: TaskStatus;
  changed_at: string;
  note: string | null;
}

export interface CareUpdate {
  id: number;
  recipient_id: number;
  caregiver_name: string;
  raw_text: string;
  created_at: string;
}

export interface Handoff {
  id: number;
  recipient_id: number;
  generated_by: string;
  content: string;
  generated_at: string;
}

// --- MCP Tool payload types ---

/**
 * Returned by capture_care_update before the user confirms.
 * This is a proposal only — nothing is saved to the DB yet.
 */
export interface ProposedUpdate {
  update_id: number;           // ID of the stored raw CareUpdate row
  recipient_id: number;
  recipient_name: string;
  caregiver_name: string;
  raw_text: string;
  proposed_tasks: ProposedTask[];
  ambiguities: string[];       // questions to surface to the user
  created_at: string;
}

export interface ProposedTask {
  description: string;
  due_date: string | null;       // ISO 8601 or null if not stated
  responsible_person: string | null;
  confidence: 'high' | 'medium' | 'needs_confirmation';
}

export interface TodayPlan {
  recipient_id: number;
  recipient_name: string;
  as_of: string;               // ISO timestamp of when plan was generated
  overdue: CareTask[];
  due_today: CareTask[];
  upcoming: CareTask[];
  unscheduled: CareTask[];
}

export interface HandoffSummary {
  recipient_id: number;
  recipient_name: string;
  generated_at: string;
  generated_by: string;
  completed_since_last_handoff: CareTask[];
  outstanding: CareTask[];
  upcoming_appointments: CareTask[];
  unassigned: CareTask[];
  recent_changes: TaskHistory[];
  notes: string;
}
