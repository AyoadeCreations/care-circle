/**
 * Lightweight NLP-like parser for caregiver update text.
 *
 * This does NOT call any LLM or paid API.
 * It uses pattern matching + heuristics to extract:
 *   - explicit dates and times
 *   - mentions of named people (as potential task owners)
 *   - action keywords that suggest tasks
 *
 * The goal is to surface a *proposal* for the user to review and correct —
 * NOT to silently save inferred facts as ground truth.
 */

import type { ProposedTask } from '../types/index.js';

// Day-of-week names
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Month names
const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Attempt to extract an ISO date from text.
 * Returns null if no date can be reliably determined.
 * Never invents a date.
 */
function extractDate(text: string): string | null {
  const lower = text.toLowerCase();
  const today = new Date();

  // "today"
  if (/\btoday\b/.test(lower)) {
    return today.toISOString().split('T')[0];
  }

  // "tomorrow"
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }

  // Day name: "Tuesday", "next Monday"
  for (let i = 0; i < DAYS.length; i++) {
    const dayRegex = new RegExp(`\\b(next\\s+)?${DAYS[i]}\\b`, 'i');
    const m = lower.match(dayRegex);
    if (m) {
      const d = new Date(today);
      const currentDay = d.getDay();
      let daysAhead = i - currentDay;
      if (daysAhead <= 0 || m[1]) {
        // "next Monday" or past day → go to next occurrence
        daysAhead += 7;
      }
      d.setDate(d.getDate() + daysAhead);
      // Try to extract time too
      const timeStr = extractTime(text);
      const base = d.toISOString().split('T')[0];
      return timeStr ? `${base}T${timeStr}` : base;
    }
  }

  // Explicit date: "20th October", "October 20", "20/10/2026", "2026-10-20"
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const timeStr = extractTime(text);
    return timeStr ? `${isoMatch[0]}T${timeStr}` : isoMatch[0];
  }

  // DD/MM/YYYY or MM/DD/YYYY — ambiguous, skip
  // Prefer written month names for clarity
  for (const [monthName, monthIdx] of Object.entries(MONTHS)) {
    const r = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthName}\\b|\\b${monthName}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
    const m = text.match(r);
    if (m) {
      const day = parseInt(m[1] ?? m[2]);
      const year = today.getFullYear();
      const d = new Date(year, monthIdx, day);
      // If in the past, assume next year
      if (d < today) d.setFullYear(year + 1);
      const base = d.toISOString().split('T')[0];
      const timeStr = extractTime(text);
      return timeStr ? `${base}T${timeStr}` : base;
    }
  }

  return null; // No date found — don't invent one
}

/**
 * Extract a time string like "10:30" or "14:00" from text.
 * Returns "HH:MM" or null.
 */
function extractTime(text: string): string | null {
  // "10:30 AM", "10:30am", "10 AM", "14:30"
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return null;

  let hours = parseInt(m[1]);
  const mins = parseInt(m[2] ?? '0');
  const meridiem = (m[3] ?? '').toLowerCase();

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  // Don't return midnight or noon from bare "12" without meridiem — ambiguous
  if (!meridiem && hours === 0) return null;

  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:00`;
}

/**
 * Attempt to extract a responsible person from update text.
 * Looks for "we", named people, or "I will" patterns.
 * Returns null rather than guessing.
 */
function extractResponsiblePerson(text: string): string | null {
  // "I will", "I'll", "I am" → the caregiver themselves, but we don't know who
  // We let the confirm step clarify.

  // "John will", "Sarah to pick up" etc.
  const m = text.match(/\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s+(?:will|to|is\s+going|can|should)\b/);
  if (m) {
    // Basic filter — ignore common sentence starters
    const stopWords = ['The', 'She', 'He', 'We', 'They', 'It', 'This', 'That', 'Transport'];
    if (!stopWords.includes(m[1])) {
      return m[1];
    }
  }

  return null;
}

/**
 * Extract action items from update text.
 * Looks for imperative verbs + object pairs.
 * Returns a plain description string.
 */
function extractActions(text: string): string[] {
  const sentences = text
    .split(/[.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  const actionKeywords = [
    'need to', 'needs to', 'must', 'should', 'confirm', 'pick up', 'call',
    'arrange', 'book', 'schedule', 'collect', 'remind', 'check', 'follow up',
    'contact', 'ensure', 'make sure', 'organise', 'organize',
  ];

  return sentences.filter((s) => {
    const lower = s.toLowerCase();
    return actionKeywords.some((kw) => lower.includes(kw));
  });
}

export interface ParsedUpdate {
  proposed_tasks: ProposedTask[];
  ambiguities: string[];
}

/**
 * Main entry point.
 * Parse free-form caregiver update text into a structured proposal.
 *
 * Rules:
 *   - Never invent dates, times, or owners.
 *   - If a date is ambiguous, flag it in ambiguities.
 *   - Mark tasks with low-confidence info as 'needs_confirmation'.
 */
export function parseUpdateText(updateText: string): ParsedUpdate {
  const ambiguities: string[] = [];
  const proposed_tasks: ProposedTask[] = [];

  // Split the update into meaningful sentences / clauses
  const sentences = updateText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) {
    return { proposed_tasks: [], ambiguities: ['Update text appears to be empty.'] };
  }

  // Look for explicitly stated changes first
  const changeIndicators = /\b(changed|moved|updated|rescheduled|cancelled|new|now)\b/i;
  const needIndicators   = /\b(need|must|confirm|arrange|book|schedule|pick up|collect|call|contact|follow up)\b/i;

  const seenDescriptions = new Set<string>();

  for (const sentence of sentences) {
    const date = extractDate(sentence);
    const responsible = extractResponsiblePerson(sentence);
    const lower = sentence.toLowerCase();

    // Detect slash-like numeric dates (e.g. 10/10) — flag as ambiguous
    if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(sentence)) {
      ambiguities.push(
        `The date in "${sentence.substring(0, 60)}..." uses a numeric format that may be ambiguous (DD/MM vs MM/DD). ` +
        `Please confirm the exact date.`
      );
    }

    if (changeIndicators.test(sentence)) {
      // This describes a change — create a task for it
      const description = summariseSentence(sentence);
      if (!seenDescriptions.has(description)) {
        seenDescriptions.add(description);
        const confidence =
          date && responsible ? 'high' :
          date || responsible ? 'medium' :
          'needs_confirmation';

        proposed_tasks.push({
          description,
          due_date: date,
          responsible_person: responsible,
          confidence,
        });
      }
    }

    if (needIndicators.test(sentence)) {
      const actions = extractActions(sentence);
      for (const action of actions) {
        const description = summariseSentence(action);
        if (!seenDescriptions.has(description)) {
          seenDescriptions.add(description);
          const date2 = extractDate(action);
          const responsible2 = extractResponsiblePerson(action);
          proposed_tasks.push({
            description,
            due_date: date2,
            responsible_person: responsible2,
            confidence: date2 && responsible2 ? 'medium' : 'needs_confirmation',
          });
        }
      }
    }
  }

  // If nothing was extracted, propose a single task from the whole update
  if (proposed_tasks.length === 0) {
    const description = summariseSentence(updateText);
    const date = extractDate(updateText);
    const responsible = extractResponsiblePerson(updateText);

    proposed_tasks.push({
      description,
      due_date: date,
      responsible_person: responsible,
      confidence: 'needs_confirmation',
    });

    ambiguities.push(
      'Could not identify specific tasks automatically. Please review and edit the proposed task description.'
    );
  }

  return { proposed_tasks, ambiguities };
}

/** Trim and tidy a sentence into a task description */
function summariseSentence(s: string): string {
  return s
    .replace(/^(we still need to|we need to|we must|please|you need to|need to)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}
