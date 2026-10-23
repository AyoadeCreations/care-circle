/**
 * Care Circle — Frontend Application
 *
 * All data flows through the REST API (/api/*) which calls the MCP server.
 * No hardcoded results. No mock data.
 */

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  selectedRecipientId: null,
  selectedRecipientName: '',
  proposedUpdate: null,
  isSubmitting: false,
  caregivers: [],
};

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
function show(el) { if (el) el.hidden = false; }
function hide(el) { if (el) el.hidden = true; }

function setLoading(visible, label = 'Loading…') {
  const overlay = $('loading-overlay');
  const lbl = $('loading-label');
  if (lbl) lbl.textContent = label;
  if (overlay) overlay.hidden = !visible;
}

function setButtonLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = '…';
  } else if (btn.dataset.originalText) {
    btn.textContent = btn.dataset.originalText;
  }
}

function toast(message, type = 'success') {
  const container = $('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.setAttribute('role', 'status');
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function showError(fieldId, textId, message) {
  const el = $(fieldId);
  const txt = $(textId);
  if (txt) txt.textContent = message;
  if (el) show(el);
}

function clearError(fieldId) {
  const el = $(fieldId);
  if (el) hide(el);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ── Recipients ────────────────────────────────────────────────────────────────
async function loadRecipients() {
  hide($('global-error'));
  const list = $('recipient-list');
  if (list) list.innerHTML = '<div class="skeleton-list" aria-busy="true"><div class="skeleton-item"></div><div class="skeleton-item"></div></div>';
  try {
    const data = await apiFetch('/api/recipients');
    renderRecipients(data.recipients ?? []);
  } catch (err) {
    if (list) list.innerHTML = '';
    showGlobalError(`Could not load care recipients: ${err.message}.`);
  }
}

function showGlobalError(message) {
  const el = $('global-error');
  const txt = $('global-error-text');
  if (txt) txt.textContent = message;
  if (el) show(el);
}

function renderRecipients(recipients) {
  const list = $('recipient-list');
  if (!list) return;
  if (recipients.length === 0) {
    list.innerHTML = '<p style="font-size:.875rem;color:var(--color-ink-muted)">No recipients found.</p>';
    return;
  }
  list.innerHTML = '';
  for (const r of recipients) {
    const btn = document.createElement('button');
    btn.className = 'recipient-btn';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', 'false');
    btn.dataset.id = r.id;
    btn.innerHTML = `<span class="r-name">${escapeHtml(r.name)}</span><span class="r-rel">${escapeHtml(r.relationship)}</span>`;
    btn.addEventListener('click', () => selectRecipient(r.id, r.name));
    list.appendChild(btn);
  }
  // Also populate handoff recipient dropdown
  const handoffSelect = $('handoff-recipient');
  if (handoffSelect) {
    handoffSelect.innerHTML = recipients.map((r) => `<option value="${r.id}">${escapeHtml(r.name)} — ${escapeHtml(r.relationship)}</option>`).join('');
  }
}

function selectRecipient(id, name) {
  state.selectedRecipientId = id;
  state.selectedRecipientName = name;
  document.querySelectorAll('.recipient-btn').forEach((b) => {
    const selected = parseInt(b.dataset.id) === id;
    b.classList.toggle('selected', selected);
    b.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  const display = $('dashboard-recipient');
  if (display) display.textContent = name;
  hide($('confirm-panel'));
  hide($('handoff-panel'));
  state.proposedUpdate = null;
  // Pre-fill handoff recipient
  const handoffSelect = $('handoff-recipient');
  if (handoffSelect) handoffSelect.value = String(id);
  loadTodayPlan();
}

// ── Caregivers ───────────────────────────────────────────────────────────────
async function loadCaregivers() {
  try {
    const data = await apiFetch('/api/caregivers');
    state.caregivers = data.caregivers ?? [];
    populateHandoffCaregiverSelect();
  } catch {
    // Non-critical — handoff can still use free text
  }
}

function populateHandoffCaregiverSelect() {
  const select = $('handoff-to');
  if (!select) return;
  select.innerHTML = '<option value="">— Select caregiver —</option>';
  for (const cg of state.caregivers) {
    select.innerHTML += `<option value="${escapeAttr(cg.display_name)}">${escapeHtml(cg.display_name)}</option>`;
  }
  // Also allow custom entry
  select.innerHTML += '<option value="__custom">Other (type name)…</option>';
}

// ── Today's plan ──────────────────────────────────────────────────────────────
async function loadTodayPlan() {
  if (!state.selectedRecipientId) return;
  const content = $('plan-content');
  const ts = $('plan-timestamp');
  if (content) {
    content.setAttribute('aria-busy', 'true');
    content.innerHTML = '<div class="skeleton-list"><div class="skeleton-item"></div><div class="skeleton-item"></div><div class="skeleton-item"></div></div>';
  }
  try {
    const plan = await apiFetch(`/api/plan/${state.selectedRecipientId}`);
    renderPlan(plan);
    if (ts) ts.textContent = `Updated ${new Date(plan.as_of).toLocaleTimeString('en-GB', { timeStyle: 'short' })}`;
  } catch (err) {
    if (content) content.innerHTML = `<div class="empty-state"><p>${escapeHtml(err.message)}</p></div>`;
  } finally {
    if (content) content.setAttribute('aria-busy', 'false');
  }
}

function renderPlan(plan) {
  const content = $('plan-content');
  if (!content) return;
  const groups = [
    { key: 'overdue',     label: 'Needs attention', cssClass: 'group-overdue',     tasks: plan.overdue ?? [] },
    { key: 'due_today',   label: 'Due today',        cssClass: 'group-today',       tasks: plan.due_today ?? [] },
    { key: 'upcoming',    label: 'Coming up',        cssClass: 'group-upcoming',    tasks: plan.upcoming ?? [] },
    { key: 'unscheduled', label: 'Unscheduled',      cssClass: 'group-unscheduled', tasks: plan.unscheduled ?? [] },
  ];
  const nonEmpty = groups.filter((g) => g.tasks.length > 0);
  if (nonEmpty.length === 0) {
    content.innerHTML = '<div class="empty-state"><div class="empty-icon-wrap"><svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M8 14l4 4 8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p class="empty-title">All clear</p><p class="empty-desc">No outstanding tasks right now</p></div>';
    return;
  }
  content.innerHTML = '';
  for (const group of nonEmpty) {
    const section = document.createElement('div');
    section.className = `task-group ${group.cssClass}`;
    section.innerHTML = `<div class="task-group-header"><span class="task-group-label">${group.label}</span><span class="task-group-count">${group.tasks.length}</span></div><div class="task-list" id="group-${group.key}"></div>`;
    const listEl = section.querySelector(`#group-${group.key}`);
    for (const task of group.tasks) listEl.appendChild(renderTaskCard(task, group.key));
    content.appendChild(section);
  }
}

function renderTaskCard(task, groupKey) {
  const card = document.createElement('div');
  card.className = `task-card task-${groupKey === 'overdue' ? 'overdue' : groupKey === 'due_today' ? 'today' : 'upcoming'}`;
  card.dataset.taskId = task.id;
  const checkBtn = document.createElement('button');
  checkBtn.className = `task-check-btn${task.status === 'completed' ? ' checked' : ''}`;
  checkBtn.setAttribute('aria-label', task.status === 'completed' ? 'Reopen task' : 'Mark task complete');
  checkBtn.setAttribute('aria-pressed', task.status === 'completed' ? 'true' : 'false');
  checkBtn.innerHTML = task.status === 'completed' ? '✓' : '';
  checkBtn.addEventListener('click', () => handleToggleTask(task.id, task.status, task.description));
  const duePill = task.due_date ? `<span class="task-pill ${groupKey === 'overdue' ? 'pill-over' : 'pill-due'}">${formatDate(task.due_date)}</span>` : '';
  const whoPill = task.responsible_person ? `<span class="task-pill pill-who">${escapeHtml(task.responsible_person)}</span>` : `<span class="task-pill pill-none">Unassigned</span>`;
  const body = document.createElement('div');
  body.className = 'task-body';
  body.innerHTML = `<div class="task-desc">${escapeHtml(task.description)}</div><div class="task-meta">${duePill}${whoPill}</div>`;
  card.appendChild(checkBtn);
  card.appendChild(body);
  return card;
}

async function handleToggleTask(taskId, currentStatus, description) {
  const caregiverName = getCaregiverName();
  if (!caregiverName) { toast('Enter your name in the sidebar first', 'error'); $('caregiver-name').focus(); return; }
  const newStatus = currentStatus === 'completed' ? 'open' : 'completed';
  setLoading(true, newStatus === 'completed' ? 'Marking complete…' : 'Reopening…');
  try {
    await apiFetch(`/api/tasks/${taskId}/status`, { method: 'POST', body: JSON.stringify({ new_status: newStatus, changed_by: caregiverName }) });
    toast(newStatus === 'completed' ? 'Task completed' : 'Task reopened');
    await loadTodayPlan();
  } catch (err) { toast(`Failed: ${err.message}`, 'error'); } finally { setLoading(false); }
}

// ── Update capture ────────────────────────────────────────────────────────────
$('update-text').addEventListener('input', () => { $('update-char-count').textContent = `${$('update-text').value.length} / 2000`; });
$('btn-capture').addEventListener('click', handleCapture);

async function handleCapture() {
  if (state.isSubmitting) return;
  clearError('update-error', 'update-error-text');
  hide($('confirm-panel'));
  hide($('handoff-panel'));
  const text = $('update-text').value.trim();
  if (!text) { showError('update-error', 'update-error-text', 'Please enter an update before analysing.'); return; }
  if (!state.selectedRecipientId) { showError('update-error', 'update-error-text', 'Please select a care recipient first.'); return; }
  const caregiverName = getCaregiverName();
  if (!caregiverName) { showError('update-error', 'update-error-text', 'Please enter your name in the sidebar.'); $('caregiver-name').focus(); return; }
  state.isSubmitting = true;
  const captureBtn = $('btn-capture');
  setButtonLoading(captureBtn, true);
  try {
    const result = await apiFetch('/api/updates/capture', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: state.selectedRecipientId, caregiver_name: caregiverName, update_text: text }),
    });
    state.proposedUpdate = result;
    renderConfirmPanel(result);
    show($('confirm-panel'));
    $('confirm-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) { showError('update-error', 'update-error-text', err.message); }
  finally { state.isSubmitting = false; setButtonLoading(captureBtn, false); }
}

// ── Confirm panel ─────────────────────────────────────────────────────────────
function renderConfirmPanel(proposal) {
  clearError('confirm-error', 'confirm-error-text');
  hide($('confirm-success'));
  const ambDiv = $('ambiguities-list');
  if (proposal.ambiguities?.length > 0) {
    ambDiv.innerHTML = `<strong>Please review:</strong><ul>${proposal.ambiguities.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>`;
    show(ambDiv);
  } else { hide(ambDiv); }
  const tasksList = $('proposed-tasks-list');
  tasksList.innerHTML = '';
  for (let i = 0; i < proposal.proposed_tasks.length; i++) {
    const t = proposal.proposed_tasks[i];
    const card = document.createElement('div');
    card.className = `proposed-task-card confidence-${t.confidence}`;
    const badgeLabel = t.confidence === 'needs_confirmation' ? 'Needs confirmation' : t.confidence === 'high' ? 'High confidence' : 'Medium confidence';
    card.innerHTML = `<span class="confidence-badge badge-${t.confidence}">${badgeLabel}</span>
      <div class="task-field"><label for="task-desc-${i}">Task description</label><input id="task-desc-${i}" type="text" value="${escapeAttr(t.description)}" maxlength="2000" data-idx="${i}" data-field="description" /></div>
      <div class="task-fields-row">
        <div class="task-field"><label for="task-date-${i}">Due date / time (optional)</label><input id="task-date-${i}" type="text" placeholder="e.g. 2026-10-20" value="${escapeAttr(t.due_date ?? '')}" maxlength="30" data-idx="${i}" data-field="due_date" /></div>
        <div class="task-field"><label for="task-who-${i}">Responsible person (optional)</label><input id="task-who-${i}" type="text" placeholder="e.g. Sarah" value="${escapeAttr(t.responsible_person ?? '')}" maxlength="100" data-idx="${i}" data-field="responsible_person" /></div>
      </div>`;
    tasksList.appendChild(card);
  }
}

$('btn-confirm').addEventListener('click', handleConfirm);
$('btn-discard').addEventListener('click', handleDiscard);

async function handleConfirm() {
  if (state.isSubmitting) return;
  clearError('confirm-error', 'confirm-error-text');
  hide($('confirm-success'));
  if (!state.proposedUpdate) return;
  const taskInputs = document.querySelectorAll('.proposed-task-card');
  const confirmedTasks = [];
  for (const card of taskInputs) {
    const description = card.querySelector('[data-field="description"]').value.trim();
    const due_date = card.querySelector('[data-field="due_date"]').value.trim() || null;
    const responsible = card.querySelector('[data-field="responsible_person"]').value.trim() || null;
    if (!description) { showError('confirm-error', 'confirm-error-text', 'Task descriptions cannot be empty.'); return; }
    confirmedTasks.push({ description, due_date, responsible_person: responsible });
  }
  if (confirmedTasks.length === 0) { showError('confirm-error', 'confirm-error-text', 'No tasks to confirm.'); return; }
  state.isSubmitting = true;
  const confirmBtn = $('btn-confirm');
  const discardBtn = $('btn-discard');
  setButtonLoading(confirmBtn, true);
  if (discardBtn) discardBtn.disabled = true;
  try {
    const result = await apiFetch('/api/updates/confirm', {
      method: 'POST',
      body: JSON.stringify({ update_id: state.proposedUpdate.update_id, recipient_id: state.proposedUpdate.recipient_id, caregiver_name: getCaregiverName(), confirmed_tasks: confirmedTasks }),
    });
    const count = result.saved_tasks?.length ?? confirmedTasks.length;
    $('confirm-success-text').textContent = `${count} task${count !== 1 ? 's' : ''} saved successfully.`;
    show($('confirm-success'));
    toast(`${count} task${count !== 1 ? 's' : ''} saved for ${state.selectedRecipientName}`);
    $('update-text').value = '';
    $('update-char-count').textContent = '0 / 2000';
    state.proposedUpdate = null;
    await loadTodayPlan();
    setTimeout(() => { hide($('confirm-panel')); }, 2500);
  } catch (err) { showError('confirm-error', 'confirm-error-text', err.message); }
  finally { state.isSubmitting = false; setButtonLoading(confirmBtn, false); if (discardBtn) discardBtn.disabled = false; }
}

function handleDiscard() {
  state.proposedUpdate = null;
  hide($('confirm-panel'));
  $('update-text').value = '';
  $('update-char-count').textContent = '0 / 2000';
  clearError('update-error', 'update-error-text');
  toast('Update discarded');
}

// ── Handoff ───────────────────────────────────────────────────────────────────
$('btn-handoff').addEventListener('click', () => {
  show($('handoff-panel'));
  $('handoff-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  // Pre-fill from sidebar
  if (state.selectedRecipientId) {
    const sel = $('handoff-recipient');
    if (sel) sel.value = String(state.selectedRecipientId);
  }
  const name = getCaregiverName();
  if (name) { $('handoff-from').value = name; }
  // Pre-load caregivers if not loaded
  if (state.caregivers.length === 0) loadCaregivers();
});

// Handle custom caregiver entry
$('handoff-to').addEventListener('change', () => {
  const sel = $('handoff-to');
  if (sel.value === '__custom') {
    // Replace dropdown with text input
    const parent = sel.parentElement;
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'handoff-to';
    input.placeholder = 'Type caregiver name';
    input.maxLength = 100;
    parent.replaceChild(input, sel);
    input.focus();
  }
});

$('btn-generate-handoff').addEventListener('click', async () => {
  clearError('handoff-error', 'handoff-error-text');
  hide($('handoff-text'));

  const recipientId = parseInt($('handoff-recipient').value);
  if (!recipientId) { showError('handoff-error', 'handoff-error-text', 'Please select a care recipient.'); return; }
  const fromName = $('handoff-from').value.trim();
  if (!fromName) { showError('handoff-error', 'handoff-error-text', 'Please enter your name (handing over from).'); $('handoff-from').focus(); return; }
  const toEl = $('handoff-to');
  const toName = toEl.tagName === 'SELECT' ? toEl.value : toEl.value.trim();
  if (!toName || toName === '__custom') { showError('handoff-error', 'handoff-error-text', 'Please select the caregiver receiving the handoff.'); return; }

  const genBtn = $('btn-generate-handoff');
  setButtonLoading(genBtn, true);
  try {
    const result = await apiFetch('/api/handoff', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: recipientId, generated_by: fromName, handed_to: toName }),
    });
    $('handoff-text').textContent = result.notes ?? JSON.stringify(result, null, 2);
    show($('handoff-text'));
    toast('Handoff generated');
  } catch (err) {
    showError('handoff-error', 'handoff-error-text', err.message);
  } finally {
    setButtonLoading(genBtn, false);
  }
});

$('btn-copy-handoff').addEventListener('click', async () => {
  const text = $('handoff-text').textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast('Handoff copied to clipboard');
    $('btn-copy-handoff').textContent = '✓ Copied';
    setTimeout(() => { $('btn-copy-handoff').textContent = 'Copy'; }, 2000);
  } catch { toast('Could not copy — select and copy manually', 'error'); }
});

$('btn-close-handoff').addEventListener('click', () => { hide($('handoff-panel')); });

// ── Refresh ───────────────────────────────────────────────────────────────────
$('btn-refresh').addEventListener('click', async () => {
  const refreshBtn = $('btn-refresh');
  setButtonLoading(refreshBtn, true);
  try { await loadTodayPlan(); toast('Plan refreshed'); }
  finally { setButtonLoading(refreshBtn, false); }
});

// ── Retry ─────────────────────────────────────────────────────────────────────
$('btn-retry').addEventListener('click', async () => {
  hide($('global-error'));
  await loadRecipients();
  if (state.selectedRecipientId) await loadTodayPlan();
});

// ── Utilities ─────────────────────────────────────────────────────────────────
function getCaregiverName() { return ($('caregiver-name').value ?? '').trim(); }

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const today = new Date();
    if (d.toDateString() === today.toDateString() && dateStr.includes('T'))
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
  } catch { return dateStr; }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadRecipients();
loadCaregivers();
