const $ = (selector) => document.querySelector(selector);
const toast = $('#toast');
let toastTimer;
let appData = { incidents: [], zones: [], responders: [], cases: [], calls: [], scamReviews: [], alerts: [], mode: 'demo-only' };
appData.role = 'demo';
let activeFilter = 'all';
let selectedCaseId = null;
let appHealth = null;
let selectedPressureId = null;
let coverageZoneSignature = '';
let overviewRequestId = 0;

const sampleMessage = 'County Rescue Office: Your evacuation seat expires in 5 minutes. Pay a $40 fee by gift card to reserve it. Do not call the county or your request will be cancelled.';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers, cache: 'no-store' });
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function formatAge(timestamp) {
  if (!timestamp) return 'time unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function fullTime(timestamp) {
  if (!timestamp) return 'Time unavailable';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function priorityLabel(priority) {
  return ({ immediate: 'Immediate life-safety', 'time-sensitive': 'Time-sensitive need', urgent: 'Urgent assistance', 'follow-up': 'Needs follow-up' })[priority] || 'Needs review';
}

function priorityRail(priority) {
  return ({ immediate: 'rail-red', 'time-sensitive': 'rail-amber', urgent: 'rail-teal', 'follow-up': 'rail-amber' })[priority] || 'rail-teal';
}

function caseExcerpt(item) {
  const caller = (item.turns || []).filter((turn) => turn.role === 'caller').map((turn) => turn.text).join(' ');
  const text = caller || item.transcript || item.title;
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

function currentZoneId() {
  return $('#zoneFilter').value || 'all';
}

function areaCases() {
  const zone = currentZoneId();
  return appData.cases.filter((item) => zone === 'all' || (zone === 'unassigned' ? !item.zoneId : item.zoneId === zone));
}

function visibleCases() {
  return areaCases().filter((item) => activeFilter === 'resolved' ? item.status === 'resolved' : item.status !== 'resolved');
}

function filteredCases() {
  const items = visibleCases();
  if (activeFilter === 'immediate') return items.filter((item) => item.priority === 'immediate');
  if (activeFilter === 'followup') return items.filter((item) => item.priority === 'follow-up' || item.followUp);
  return items;
}

function renderCaseCard(item) {
  const excerpt = caseExcerpt(item);
  const responseState = item.assignmentNeedsReview ? 'Assignment coverage needs review' : item.assignedTo ? `Claimed by ${appData.responders.find((responder) => responder.id === item.assignedTo)?.name || 'responder'}` : item.followUpOwner ? `Follow-up owned by ${appData.responders.find((responder) => responder.id === item.followUpOwner)?.name || 'responder'}` : !item.zoneId ? 'Location follow-up unassigned' : `${(item.eligibleResponders || []).length} eligible responder${(item.eligibleResponders || []).length === 1 ? '' : 's'}`;
  const warning = item.reassessmentRequired ? ' · New report needs reassessment' : item.followUp && item.priority !== 'follow-up' ? ' · Location/details need follow-up' : '';
  const lastReport = latestCallerUpdate(item);
  const updated = lastReport?.kind === 'caller-update';
  const queueAge = updated ? lastReport.at || item.updatedAt : item.createdAt;
  return `<button class="request-card${item.id === selectedCaseId ? ' selected' : ''}" data-case-id="${escapeHtml(item.id)}" data-priority="${escapeHtml(item.priority)}">
    <span class="priority-rail ${priorityRail(item.priority)}"></span>
    <span class="request-main"><span class="request-topline"><strong>${escapeHtml(item.title)}</strong><time>${updated ? 'Updated ' : ''}${escapeHtml(formatAge(queueAge))}</time></span>
    <span class="request-meta"><span class="case-id">${escapeHtml(item.id)}</span><span>·</span><span>${escapeHtml(item.zoneName || 'Unassigned area')}</span>${item.synthetic ? '<span class="synthetic-case-label">SYNTHETIC</span>' : ''}</span>
    <span class="request-excerpt">“${escapeHtml(excerpt)}”</span>
    <span class="request-bottom"><span class="tag ${item.priority === 'immediate' ? 'tag-critical' : item.priority === 'time-sensitive' ? 'tag-time' : 'tag-review'}">${escapeHtml(priorityLabel(item.priority))}${escapeHtml(warning)}</span><span class="response-state"><i></i>${escapeHtml(responseState)}</span></span></span>
  </button>`;
}

function renderFollowupCard(item) {
  return `<button class="followup-card" data-case-id="${escapeHtml(item.id)}"><span class="followup-icon">?</span><div><strong>${escapeHtml(item.zoneId ? 'Priority/details need confirmation' : 'Location not matched')}</strong><p>${escapeHtml(item.id)} · ${escapeHtml(item.title)} · Keep visible for responder follow-up.</p></div><span class="chevron">›</span></button>`;
}

function updateCounts() {
  const area = areaCases();
  const cases = area.filter((item) => item.status !== 'resolved');
  const immediate = cases.filter((item) => item.priority === 'immediate').length;
  const followup = cases.filter((item) => item.priority === 'follow-up' || item.followUp).length;
  const open = appData.cases.filter((item) => item.status !== 'resolved').length;
  const reviews = appData.scamReviews || [];
  const alerts = appData.alerts || [];
  $('#activeCount').textContent = String(open).padStart(2, '0');
  $('#urgentCount').textContent = String(immediate).padStart(2, '0');
  $('#scamCount').textContent = String(reviews.filter((review) => review.level !== 'low').length).padStart(2, '0');
  $('#queueBadge').textContent = String(visibleCases().length);
  $('#allTabCount').textContent = String(cases.length);
  $('#immediateTabCount').textContent = String(immediate);
  $('#followupTabCount').textContent = String(followup);
  $('#resolvedTabCount').textContent = String(area.filter((item) => item.status === 'resolved').length);
  $('#followupSectionCount').textContent = `${followup} CASE${followup === 1 ? '' : 'S'}`;
  $('#callCount').textContent = String(appData.calls.length);
  $('#navOpenCount').textContent = String(open);
  $('#navAlertCount').textContent = String(alerts.length);
  $('#alertDot').hidden = !alerts.length;
  const available = appData.responders.filter((responder) => responder.approved && responder.available && responder.assignedCount < responder.capacity);
  $('#teamAvailability').textContent = `${available.length} approved profile${available.length === 1 ? '' : 's'} with capacity`;
  $('#workspaceRole').textContent = appData.role === 'coordinator' ? 'Coordinator workspace' : appData.role === 'responder' ? 'Responder workspace' : 'Synthetic demo';
  $('#workspaceSession').textContent = appData.mode === 'secured' ? 'Shared demo sign-in' : 'Fictional records only';
  $('#signOutButton').hidden = appData.mode !== 'secured';
}

function caseHistoryEntries(item) {
  return [...(Array.isArray(item.history) ? item.history : [])].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function latestCallerUpdate(item) {
  return caseHistoryEntries(item).find((entry) => entry.kind === 'caller-update' || entry.kind === 'initial') || null;
}

function priorityRankValue(priority) {
  return ({ immediate: 0, 'time-sensitive': 1, urgent: 2, 'follow-up': 3 })[priority] ?? 4;
}

function renderCaseHistory(item, changedCase = false) {
  const history = caseHistoryEntries(item);
  const latestReport = latestCallerUpdate(item);
  const linkedLoadedCalls = new Set(appData.calls.filter((call) => call.caseId === item.id).map((call) => call.id)).size;
  const historyCallCount = new Set(history.filter((entry) => entry.callId).map((entry) => entry.callId)).size;
  const linkedCallCount = Number.isSafeInteger(item.linkedCallCount) ? item.linkedCallCount : Math.max(linkedLoadedCalls, historyCallCount, item.callId ? 1 : 0);
  const latestAt = latestReport?.at || item.updatedAt || item.createdAt;
  $('#caseUpdateTitle').textContent = linkedCallCount > 1 ? 'Continuing case · caller update received' : 'Initial caller report';
  $('#caseLatestUpdate').textContent = `${latestReport ? 'Latest phone report' : 'Record updated'} ${fullTime(latestAt)}`;
  $('#caseLinkedCalls').textContent = `${linkedCallCount} linked call${linkedCallCount === 1 ? '' : 's'}`;
  $('#caseHistoryCount').textContent = String(history.length);
  $('#caseLinkageNote').textContent = linkedCallCount > 1 ? 'Multiple reports are linked to this case by the phone route. Caller identity and ownership of the phone number are not verified.' : 'This timeline records reported changes and responder reviews. A phone-route match does not verify caller identity.';
  $('#caseHistoryList').innerHTML = history.length ? history.map((entry) => {
    const changedPriority = entry.previousPriority && entry.previousPriority !== entry.priority;
    const escalated = changedPriority && priorityRankValue(entry.priority) < priorityRankValue(entry.previousPriority);
    const kindLabel = ({ initial: 'Initial report', 'caller-update': 'Caller update', 'responder-review': 'Responder review' })[entry.kind] || 'Case update';
    return `<li class="case-history-entry${escalated ? ' history-escalation' : ''}"><div class="history-entry-head"><strong>${escapeHtml(kindLabel)}</strong><time>${escapeHtml(fullTime(entry.at))}</time></div><p>${escapeHtml(entry.summary || 'Structured report updated.')}</p>${entry.priority ? `<span class="history-priority">${changedPriority ? `${escapeHtml(priorityLabel(entry.previousPriority))} → ` : ''}${escapeHtml(priorityLabel(entry.priority))}${escalated ? ' · urgency increased' : ''}</span>` : ''}${entry.reason ? `<p class="history-reason">${escapeHtml(entry.reason)}</p>` : ''}${entry.changedFields?.length ? `<span class="history-changes">Updated: ${entry.changedFields.map((field) => escapeHtml(String(field).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())).join(', ')}</span>` : ''}${entry.callId ? `<span class="history-call">Linked call ${escapeHtml(entry.callId)}</span>` : ''}</li>`;
  }).join('') : '<li class="case-history-empty">No earlier update history is loaded for this case.</li>';
  if (changedCase) $('#caseHistory').open = history.length > 1 || Boolean(item.reassessmentRequired);

  const latestPriority = item.latestPriority || item.priority;
  const aboveReviewedPriority = priorityRankValue(latestPriority) < priorityRankValue(item.priority);
  const reportEscalated = latestReport?.kind === 'caller-update' && latestReport.previousPriority && priorityRankValue(latestReport.priority) < priorityRankValue(latestReport.previousPriority);
  const attentionNeeded = item.reassessmentRequired || aboveReviewedPriority;
  $('#caseReassessment').hidden = !(attentionNeeded || reportEscalated);
  $('#caseReassessment').classList.toggle('reassessment-needed', Boolean(attentionNeeded));
  $('#caseReassessmentTitle').textContent = aboveReviewedPriority ? `Latest report suggests higher urgency: ${priorityLabel(latestPriority)}` : reportEscalated ? `Urgency increased after caller update: ${priorityLabel(latestReport.priority)}` : 'New caller report needs reassessment';
  $('#caseReassessmentReason').textContent = `${latestReport?.reason || latestReport?.summary || 'New reported facts changed this case.'}${attentionNeeded ? ' A human responder should review the newest facts and record the priority decision.' : ' The queue now reflects the newer reported circumstances.'}`;
  $('#reviewNewFactsButton').hidden = !attentionNeeded;
  $('#reviewNewFactsButton').disabled = item.status === 'resolved';
}

function eligibleFollowupOwners(item) {
  return appData.responders.filter((responder) => responder.id === item.followUpOwner || (
    responder.approved && responder.available && responder.synthetic === item.synthetic
    && responder.assignedCount < responder.capacity
    && (responder.capabilities || []).some((capability) => capability === 'general' || capability === 'information')
  ));
}

function setSelectedCase(caseId) {
  const changedCase = selectedCaseId !== caseId;
  selectedCaseId = caseId;
  const item = appData.cases.find((candidate) => candidate.id === caseId);
  if (!item) return;
  $('#caseId').textContent = item.id;
  $('#caseTitle').textContent = item.title;
  $('#caseLocation').textContent = `${item.locationText || 'Location not confirmed'} · ${item.zoneName || 'Unassigned area'}`;
  $('#caseTime').textContent = `First received ${fullTime(item.createdAt)}`;
  $('#reporterName').textContent = 'Anonymous caller';
  $('#reporterAvatar').textContent = 'AN';
  $('#caseSource').textContent = item.sourceLabel || 'Phone intake';
  $('#caseStatus').textContent = ({ new: 'Awaiting review', claimed: 'Claimed', 'follow-up': 'Needs follow-up', resolved: 'Resolved' })[item.status] || 'Needs review';
  $('#caseMessage').textContent = item.transcript || caseExcerpt(item);
  $('#caseTranscriptCaption').textContent = `${item.synthetic ? 'Synthetic scenario' : 'Caller-consented transcript'} · latest linked report · ${item.callId ? `Call ${item.callId}` : 'No call ID'}`;
  renderCaseHistory(item, changedCase);
  $('#priorityLabel').textContent = priorityLabel(item.priority);
  $('#priorityReason').textContent = item.priorityReason || 'Review the recorded facts and confirm the operational priority.';
  $('#priorityOrigin').textContent = item.priorityOverride ? 'HUMAN-REVIEWED QUEUE' : 'SUGGESTED QUEUE';
  $('#caseAuditLabel').textContent = item.synthetic ? 'Fictional scenario' : 'Caller report';
  const tags = [
    item.immediateDanger === 'yes' ? 'Caller reported immediate danger' : item.immediateDanger === 'no' ? 'No immediate danger reported' : 'Immediate danger unknown',
    item.locationStatus === 'matched' ? `Area matched: ${item.zoneName}` : 'Location needs follow-up',
    item.peopleCount ? `${item.peopleCount} people` : null,
    ...(item.needs || []).map((need) => `Need: ${need}`),
    item.scamSignals?.length ? `Possible pressure wording · ${item.scamSignals.length} signal${item.scamSignals.length === 1 ? '' : 's'}` : null,
    item.assignmentNeedsReview ? 'Assignment coverage needs review' : null,
    item.reassessmentRequired ? 'New report needs reassessment' : null,
  ].filter(Boolean);
  $('.reported-chip-row').innerHTML = tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  const select = $('#responderSelect');
  const previousResponder = changedCase ? '' : select.value;
  const needsLocationOwner = !item.zoneId;
  const eligible = needsLocationOwner
    ? eligibleFollowupOwners(item)
    : appData.responders.filter((responder) => (item.eligibleResponders || []).includes(responder.id) || item.assignedTo === responder.id);
  select.innerHTML = `<option value="">${needsLocationOwner ? 'Choose location follow-up owner' : 'Choose eligible responder'}</option>` + eligible.map((responder) => `<option value="${escapeHtml(responder.id)}">${escapeHtml(responder.name)} · ${escapeHtml(responder.organization)}</option>`).join('');
  select.value = (needsLocationOwner ? item.followUpOwner : item.assignedTo) || (eligible.some((responder) => responder.id === previousResponder) ? previousResponder : '');
  const resolved = item.status === 'resolved';
  select.disabled = resolved || !eligible.length || (!needsLocationOwner && Boolean(item.assignedTo));
  $('#assignButton').disabled = resolved || !eligible.length || (!needsLocationOwner && Boolean(item.assignedTo));
  $('#assignButton').textContent = needsLocationOwner ? 'Assign follow-up owner' : item.assignedTo ? 'Case claimed' : 'Claim for responder →';
  $('#responderSelectLabel').textContent = needsLocationOwner ? 'Responder responsible for location follow-up' : 'Responder to claim this case';
  const owner = appData.responders.find((responder) => responder.id === item.assignedTo);
  const followupOwner = appData.responders.find((responder) => responder.id === item.followUpOwner);
  const ownerDetails = [];
  if (owner) ownerDetails.push(`Response owner: ${owner.name} · ${owner.organization}.`);
  if (followupOwner) ownerDetails.push(`Location follow-up owner: ${followupOwner.name} · ${followupOwner.organization}. This is responsibility to clarify the report, not a dispatch assignment.`);
  if (!owner && !followupOwner) ownerDetails.push(resolved ? 'Resolved · no active owner.' : needsLocationOwner ? 'Location unconfirmed · assign an accountable follow-up owner before this report is overlooked.' : 'Unclaimed · choose an eligible responder to establish ownership.');
  ownerDetails.push('No external dispatch has been sent.');
  $('#caseOwner').textContent = ownerDetails.join(' ');
  $('#assignmentReviewNote').hidden = !item.assignmentNeedsReview;
  $('#releaseAssignmentButton').hidden = !item.assignmentNeedsReview || resolved;
  $('#releaseAssignmentButton').disabled = resolved;
  $('#assignmentReviewNote').textContent = item.assignmentNeedsReview ? 'The reported location changed and the existing response owner no longer matches coverage. Review the assignment before taking response action; the old claim is not proof of eligibility in the new area.' : '';
  $('#resolveButton').disabled = false;
  $('#resolveButton').textContent = resolved ? 'Reopen for review' : 'Resolve case';
  $('#followupButton').disabled = resolved;
  $('#priorityOverrideButton').disabled = resolved;
  $('#priorityOverrideSelect').disabled = resolved;
  $('#priorityOverrideReason').disabled = resolved;
  if (changedCase || !$('#priorityOverrideReason').value.trim()) $('#priorityOverrideSelect').value = item.priority;
  if (changedCase) {
    $('#priorityOverrideReason').value = '';
    $('#priorityOverrideResult').textContent = '';
    $('#priorityReview').open = false;
  }
  const override = item.priorityOverride;
  $('#priorityOverrideAudit').hidden = !override;
  $('#priorityOverrideAudit').textContent = override ? `Last reviewed ${fullTime(override.at)}${override.previousPriority ? ` · previously ${priorityLabel(override.previousPriority)}` : ''}. Reason: ${override.reason}` : '';
  document.querySelectorAll('[data-case-id]').forEach((card) => card.classList.toggle('selected', card.dataset.caseId === item.id));
}

function renderQueue() {
  const items = [...filteredCases()].sort((a, b) => a.priorityRank - b.priorityRank || a.createdAt.localeCompare(b.createdAt));
  if (!items.some((item) => item.id === selectedCaseId)) {
    const nextId = items[0]?.id || null;
    if (nextId) setSelectedCase(nextId);
    else selectedCaseId = null;
  }
  const queue = $('#queueList');
  const followups = $('#followupList');
  const area = appData.zones.find((zone) => zone.id === currentZoneId());
  $('#queueSortLabel').textContent = currentZoneId() === 'unassigned' ? 'LOCATION FOLLOW-UP' : area ? area.name.toUpperCase() : 'ALL SERVICE AREAS';
  document.querySelectorAll('.queue-tab').forEach((tab) => {
    const selected = tab.dataset.filter === activeFilter;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  const actionCases = activeFilter === 'all' ? items.filter((item) => item.priority !== 'follow-up') : activeFilter === 'followup' ? [] : items;
  const followupCases = activeFilter === 'all' ? items.filter((item) => item.priority === 'follow-up') : activeFilter === 'followup' ? items : [];
  $('.followup-label').hidden = activeFilter === 'resolved';
  followups.hidden = activeFilter === 'resolved';
  queue.innerHTML = actionCases.length ? actionCases.map(renderCaseCard).join('') : `<div class="queue-loading">${activeFilter === 'followup' ? 'Follow-up cases are shown below.' : 'No matching requests in this area.'}</div>`;
  followups.innerHTML = followupCases.length ? followupCases.map(renderFollowupCard).join('') : `<div class="queue-loading">${activeFilter === 'immediate' ? 'Immediate cases stay in the ranked queue above.' : 'No follow-up cases in this area.'}</div>`;
  updateCounts();
  if (selectedCaseId) setSelectedCase(selectedCaseId);
  else showEmptyCase();
}

function showEmptyCase() {
  $('#caseId').textContent = '—';
  $('#caseTitle').textContent = 'No case selected';
  $('#caseLocation').textContent = 'Waiting for a request in this area';
  $('#caseTime').textContent = 'No recent call';
  $('#caseUpdateTitle').textContent = 'No case selected';
  $('#caseLatestUpdate').textContent = 'Waiting for a report';
  $('#caseLinkedCalls').textContent = 'No linked calls';
  $('#caseReassessment').hidden = true;
  $('#caseHistoryCount').textContent = '0';
  $('#caseHistoryList').innerHTML = '<li class="case-history-empty">No case update history is loaded.</li>';
  $('#caseHistory').open = false;
  $('#reporterName').textContent = 'No caller';
  $('#reporterAvatar').textContent = '—';
  $('#caseSource').textContent = 'Backend connected';
  $('#caseMessage').textContent = 'Run a synthetic transcript above or connect the Photon voice line to create a case.';
  $('#priorityLabel').textContent = 'Awaiting request';
  $('#priorityReason').textContent = 'The response queue is built from persisted call sessions and transcript-derived facts.';
  $('.reported-chip-row').innerHTML = '';
  $('#responderSelect').innerHTML = '<option value="">No eligible case</option>';
  $('#responderSelect').disabled = true;
  $('#assignButton').disabled = true;
  $('#caseStatus').textContent = 'No case';
  $('#caseOwner').textContent = '';
  $('#assignmentReviewNote').hidden = true;
  $('#releaseAssignmentButton').hidden = true;
  $('#priorityOrigin').textContent = 'SUGGESTED QUEUE';
  $('#priorityOverrideAudit').hidden = true;
  $('#resolveButton').disabled = true;
  $('#followupButton').disabled = true;
  $('#priorityOverrideButton').disabled = true;
  $('#priorityOverrideSelect').disabled = true;
  $('#priorityOverrideReason').disabled = true;
}

function renderCalls() {
  const list = $('#callList');
  if (!appData.calls.length) {
    list.innerHTML = '<div class="queue-loading">No calls yet. The transcript processor above creates a synthetic session; real calls require the Photon SIP route.</div>';
    return;
  }
  list.innerHTML = appData.calls.slice(0, 10).map((call) => {
    const transcript = (call.transcript || '').split('\n').slice(-8).join('\n');
    return `<article class="call-session-card"><div class="call-session-top"><strong>${escapeHtml(call.id)}</strong><time>${escapeHtml(fullTime(call.startedAt))}</time></div>
      <div class="call-session-meta"><span>${escapeHtml(call.provider)}</span><span>Status: ${escapeHtml(call.status)}</span><span>Consent: ${escapeHtml(call.consent)}</span><span>${escapeHtml(call.transcriptionSource)}</span></div>
      ${transcript ? `<pre class="call-session-transcript">${escapeHtml(transcript)}</pre>` : ''}
      ${call.caseId ? `<a href="#response" class="call-session-link" data-jump-case="${escapeHtml(call.caseId)}">Open linked case ${escapeHtml(call.caseId)} →</a>` : '<span class="call-session-link">No help case created</span>'}
    </article>`;
  }).join('');
}

function renderPressureTrace(review) {
  const risk = review?.level || 'low';
  $('#riskLevel').textContent = review ? `${risk.toUpperCase()} SIGNAL` : 'NO REVIEW';
  $('#riskSource').textContent = review ? (review.synthetic ? 'fictional scenario' : 'consented call content') : 'waiting for data';
  $('#pressureSummary').textContent = review?.headline || 'Select a call warning or inspect a message. Content signals cannot prove identity or intent.';
  $('#pressureSourceTitle').textContent = review?.callId || review?.sourceId || (review ? 'Message content review' : 'No review selected');
  $('#pressureSourceDetail').textContent = review ? `${review.synthetic ? 'Synthetic' : 'Consented'} · ${review.createdAt ? fullTime(review.createdAt) : 'Content review'}` : 'Waiting for a call or message';
  $('#suspiciousText').textContent = review?.text || (review?.signals?.length ? review.signals.map((signal) => `“${signal.evidence}”`).join(' · ') : 'Select a scam review or analyze a synthetic message to see transcript evidence.');
  $('#traceCount').textContent = String(review?.signals?.length || 0);
  const list = $('#traceSignalList');
  if (!review?.signals?.length) {
    list.innerHTML = '<div class="signal-row"><span class="signal-number">—</span><span class="signal-copy"><strong>No strong pressure pattern found</strong><small>Wording cannot authenticate a sender; urgency alone is not proof.</small></span><span class="signal-strength">REVIEW</span></div>';
  } else {
    list.innerHTML = review.signals.map((signal, index) => `<div class="signal-row"><span class="signal-number">${String(index + 1).padStart(2, '0')}</span><span class="signal-copy"><strong>${escapeHtml(signal.label)}</strong><small>“${escapeHtml(signal.evidence)}”</small>${signal.explanation ? `<p class="signal-explanation">${escapeHtml(signal.explanation)}</p>` : ''}</span><span class="signal-strength">${risk === 'high' ? 'STRONG' : 'CHECK'}</span></div>`).join('');
  }
  const action = $('.trace-results .safe-action p');
  if (action && review) action.innerHTML = `<strong>Safer next step</strong><br />${escapeHtml(review.nextStep)}`;
}

function warningDeliveryLabel(value, displayedAt) {
  if (displayedAt) return 'Device reported notification display';
  return ({ accepted: 'Provider accepted; phone display unconfirmed', available: 'Available in app', sent: 'Provider sent; phone display unconfirmed', delivered: 'Provider delivered; phone display unconfirmed', pending: 'Delivery pending', failed: 'Delivery failed', disabled: 'Delivery not configured', 'not-configured': 'Delivery not configured', skipped: 'Delivery skipped' })[value] || 'Delivery unconfirmed';
}

function renderLiveWarnings() {
  const alerts = [...(appData.alerts || [])].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  $('#liveWarningCount').textContent = String(alerts.length);
  $('#liveWarningList').innerHTML = alerts.length ? alerts.slice(0, 8).map((alert) => `<button type="button" class="live-warning-card ${alert.level === 'high' ? 'warning-high' : 'warning-review'}" data-alert-id="${escapeHtml(alert.id)}"><span class="warning-card-head"><strong>${escapeHtml(alert.headline || 'Possible pressure pattern')}</strong><time>${escapeHtml(formatAge(alert.createdAt))}</time></span><span class="warning-card-meta">Call ${escapeHtml(alert.callId || 'unknown')} · ${escapeHtml(warningDeliveryLabel(alert.deliveryStatus, alert.displayedAt))}</span><span class="warning-card-evidence">${escapeHtml((alert.signals || []).slice(0, 2).map((signal) => `“${signal.evidence}”`).join(' · '))}</span><span class="warning-card-action">Review evidence and safe next step →</span></button>`).join('') : '<p class="queue-loading">No call warnings yet. A routed call can produce a warning as its transcript is analyzed.</p>';
}

function selectedPressureReview() {
  return [...(appData.alerts || []), ...(appData.scamReviews || [])].find((review) => review.id === selectedPressureId) || appData.alerts?.[0] || appData.scamReviews?.[0] || null;
}

function renderResponderCoverage() {
  const signature = JSON.stringify(appData.zones.map((zone) => [zone.id, zone.name]));
  if (signature !== coverageZoneSignature) {
    const selectedAreas = new Set([...document.querySelectorAll('input[name="responderArea"]:checked')].map((input) => input.value));
    $('#responderAreaOptions').innerHTML = appData.zones.length ? appData.zones.map((zone) => `<label><input type="checkbox" name="responderArea" value="${escapeHtml(zone.id)}"${selectedAreas.has(zone.id) ? ' checked' : ''} /> ${escapeHtml(zone.name)}</label>`).join('') : 'No response areas configured.';
    coverageZoneSignature = signature;
  }
  const container = $('#responderProfiles');
  if (!container) return;
  if (!appData.responders.length) {
    container.innerHTML = '<div class="queue-loading">No responder profiles registered.</div>';
    return;
  }
  container.innerHTML = appData.responders.map((responder) => {
    const areas = (responder.serviceAreas || []).map((id) => appData.zones.find((zone) => zone.id === id)?.name || id).join(', ');
    const state = responder.approved ? responder.available ? 'Approved · available' : 'Approved · off shift' : 'Awaiting coordinator approval';
    const canApprove = appData.mode !== 'secured' || appData.role === 'coordinator';
    return `<article class="responder-profile"><div><strong>${escapeHtml(responder.name)}</strong><span>${escapeHtml(responder.organization)} · ${escapeHtml(state)}</span><small>Areas: ${escapeHtml(areas || 'none')} · Active capacity: ${escapeHtml(responder.assignedCount)}/${escapeHtml(responder.capacity)}</small></div>${responder.approved || !canApprove ? '' : `<button type="button" class="text-button approve-responder" data-responder-id="${escapeHtml(responder.id)}">Approve profile</button>`}</article>`;
  }).join('');
}

function renderAnalysisResult(output, review) {
  const signalLines = review.signals?.length
    ? `<ul>${review.signals.map((signal) => `<li><strong>${escapeHtml(signal.label)}</strong> — “${escapeHtml(signal.evidence)}”${signal.explanation ? `<br /><span>${escapeHtml(signal.explanation)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p>No strong pressure pattern found. The sender is still unverified.</p>';
  output.className = `analysis-output visible ${escapeHtml(review.level)}`;
  output.innerHTML = `<strong>${escapeHtml(review.headline)}</strong>${signalLines}<span>${escapeHtml(review.nextStep)} This analysis cannot verify identity or intent.</span>`;
}

async function analyzeToServer(text, output) {
  if (!text.trim()) {
    output.className = 'analysis-output visible medium';
    output.textContent = 'Add a synthetic message to review. Do not paste a real person’s private conversation.';
    return;
  }
  output.className = 'analysis-output visible';
  output.textContent = 'Analyzing wording on the Pharos backend…';
  try {
    const result = await api('/api/scam/analyze', { method: 'POST', body: JSON.stringify({ text, synthetic: true }) });
    selectedPressureId = result.scamReview.id;
    renderAnalysisResult(output, result.scamReview);
    await loadOverview({ quiet: true });
    renderPressureTrace(result.scamReview);
  } catch (error) {
    output.className = 'analysis-output visible medium';
    output.textContent = error.message;
  }
}

function updateDataMode() {
  const status = $('#dataModeStatus');
  const modePill = $('.demo-pill');
  const voiceReady = appHealth?.voiceRoute === 'ready';
  $('#voiceLineStatus').textContent = voiceReady ? 'Tested Photon voice route configured' : 'Hotline not connected yet';
  $('#voiceIntakeCopy').textContent = voiceReady
    ? 'Residents call the Pharos test line. Short spoken answers become a transcript and a case for human responders to review.'
    : 'The Photon → LiveKit phone route still needs setup. The workbench below tests the backend with fictional transcripts; residents do not need to fill out a website form.';
  $('#guardEnrollmentButton').disabled = appData.mode !== 'secured';
  if (appData.mode !== 'secured') $('#guardEnrollmentStatus').textContent = 'Test-phone enrollment requires a secured responder session.';
  if (appData.mode === 'secured') {
    modePill.textContent = 'SECURED · FIXTURES VISIBLE';
    status.textContent = voiceReady ? 'Protected data · Photon voice route ready' : 'Protected data · Live call route not configured';
  } else {
    modePill.textContent = 'SYNTHETIC DEMO';
    status.textContent = appHealth?.persistentStorage === 'sqlite-durable-object' ? 'Synthetic data · persistent backend active · no live call route' : 'Synthetic data · backend unavailable';
  }
}

function lockWorkspace() {
  appData = { incidents: [], zones: [], responders: [], cases: [], calls: [], scamReviews: [], alerts: [], mode: 'secured', role: null };
  selectedCaseId = null;
  selectedPressureId = null;
  $('#responderLogin').hidden = false;
  $('#beaconView').hidden = true;
  $('#guidePanel').hidden = true;
  $('#guideLauncher').setAttribute('aria-expanded', 'false');
  $('#guideMessages').innerHTML = '<p class="guide-bubble guide-bot">Sign in to ask about the response desk. I cannot access call records while this workspace is locked.</p>';
  $('#sidebarIncidentName').textContent = 'Protected workspace';
  $('#sidebarIncidentStatus').textContent = 'Sign-in required';
  $('#navIncidentName').textContent = 'Incident overview';
  $('#breadcrumbCurrent').textContent = 'Sign-in required';
  $('#navOpenCount').textContent = '—';
  $('#navAlertCount').textContent = '—';
  $('#teamAvailability').textContent = 'Sign in to view coverage';
  $('#workspaceRole').textContent = 'Beacon workspace';
  $('#workspaceSession').textContent = 'Sign-in required';
  $('#signOutButton').hidden = true;
  $('#guardEnrollmentUrl').value = '';
  $('#guardEnrollmentOpen').removeAttribute('href');
  $('#guardEnrollmentResult').hidden = true;
  $('#guardEnrollmentStatus').textContent = '';
}

async function loadOverview(options = {}) {
  const requestId = ++overviewRequestId;
  try {
    const auth = await api('/api/auth/status');
    if (requestId !== overviewRequestId) return false;
    if (auth.required && !auth.authenticated) {
      lockWorkspace();
      return false;
    }
    appData.role = auth.role || 'demo';
    $('#responderLogin').hidden = true;
    const [overview, health] = await Promise.all([api('/api/overview'), api('/api/health')]);
    if (requestId !== overviewRequestId) return false;
    appData = { ...appData, ...overview, alerts: overview.alerts || [] };
    appHealth = health;
    $('#beaconView').hidden = false;
    fillZoneFilter();
    renderResponderCoverage();
    renderQueue();
    renderCalls();
    renderLiveWarnings();
    renderPressureTrace(selectedPressureReview());
    updateDataMode();
    const activeIncident = appData.incidents.find((incident) => incident.status === 'active');
    if (activeIncident) {
      $('#sidebarIncidentName').textContent = activeIncident.name;
      $('#navIncidentName').textContent = activeIncident.name;
      $('#sidebarIncidentStatus').textContent = activeIncident.synthetic ? 'Fictional incident' : 'Incident active';
      $('#breadcrumbCurrent').textContent = activeIncident.name;
    }
    if (!options.quiet) return true;
    return true;
  } catch (error) {
    if (requestId !== overviewRequestId) return false;
    if (error.status === 401 || error.body?.authRequired) {
      lockWorkspace();
      return false;
    }
    $('#dataModeStatus').textContent = 'Backend unavailable · open through the DeepSpace app or run its Worker locally';
    $('#queueList').innerHTML = `<div class="queue-loading">${escapeHtml(error.message)}. The static file preview cannot reach the persistent Worker backend.</div>`;
    return false;
  }
}

function fillZoneFilter() {
  const selector = $('#zoneFilter');
  const current = selector.value || 'all';
  selector.innerHTML = '<option value="all">All service areas</option><option value="unassigned">Unassigned · location follow-up</option>' + appData.zones.map((zone) => `<option value="${escapeHtml(zone.id)}">${escapeHtml(zone.name)}</option>`).join('');
  selector.value = current === 'unassigned' || appData.zones.some((zone) => zone.id === current) ? current : 'all';
}

async function processTranscript() {
  const textarea = $('#transcriptInput');
  const output = $('#transcriptResult');
  const button = $('#processTranscriptButton');
  const transcript = textarea.value.trim();
  if (!transcript) {
    output.className = 'backend-result visible error';
    output.textContent = 'Add a synthetic call transcript first.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Processing…';
  output.className = 'backend-result visible';
  output.textContent = 'Creating call record, parsing transcript, matching service area, ranking urgency, and checking pressure wording…';
  try {
    const result = await api('/api/demo/calls', { method: 'POST', body: JSON.stringify({ transcript }) });
    await loadOverview({ quiet: true });
    if (result.caseRecord) {
      $('#zoneFilter').value = 'all';
      activeFilter = 'all';
      setSelectedCase(result.caseRecord.id);
      renderQueue();
      output.innerHTML = `<strong>Call processed and stored.</strong><br />Call ${escapeHtml(result.call.id)} → case ${escapeHtml(result.caseRecord.id)} · ${escapeHtml(priorityLabel(result.caseRecord.priority))} · ${escapeHtml(result.caseRecord.zoneName)} · ${escapeHtml((result.caseRecord.eligibleResponders || []).length)} eligible responder(s). Human review is required; no dispatch was sent.`;
    } else {
      output.innerHTML = `<strong>Call processed and stored.</strong><br />The call was classified as ${escapeHtml(result.callKind)}; no disaster-help case was created.${result.scamReview ? ` ${escapeHtml(result.scamReview.headline)} with ${escapeHtml(result.scamReview.signals.length)} evidence signal(s).` : ''}`;
    }
    output.className = 'backend-result visible';
    if (result.scamReview) selectedPressureId = result.scamReview.id;
    renderPressureTrace(selectedPressureReview());
    showToast('Synthetic call processed into persistent Pharos data.');
  } catch (error) {
    output.className = 'backend-result visible error';
    output.textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Process transcript <span>→</span>';
  }
}

$('#processTranscriptButton').addEventListener('click', processTranscript);
$('#simulateButton').addEventListener('click', processTranscript);
$('#refreshButton').addEventListener('click', async () => {
  const loaded = await loadOverview();
  showToast(loaded ? 'Response queue refreshed from persistent storage.' : 'Could not refresh the backend queue.');
});
$('#zoneFilter').addEventListener('change', renderQueue);
document.querySelectorAll('.queue-tab').forEach((tab) => tab.addEventListener('click', () => { activeFilter = tab.dataset.filter; renderQueue(); }));

document.addEventListener('click', async (event) => {
  const caseCard = event.target.closest('[data-case-id]');
  if (caseCard) setSelectedCase(caseCard.dataset.caseId);
  const jumpLink = event.target.closest('[data-jump-case]');
  if (jumpLink) {
    event.preventDefault();
    const targetCase = appData.cases.find((item) => item.id === jumpLink.dataset.jumpCase);
    $('#zoneFilter').value = 'all';
    activeFilter = targetCase?.status === 'resolved' ? 'resolved' : 'all';
    setSelectedCase(jumpLink.dataset.jumpCase);
    renderQueue();
    $('#response').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const alertCard = event.target.closest('[data-alert-id]');
  if (alertCard) {
    selectedPressureId = alertCard.dataset.alertId;
    renderPressureTrace(selectedPressureReview());
    $('#pressure').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const approval = event.target.closest('.approve-responder');
  if (approval) {
    approval.disabled = true;
    try {
      await api(`/api/responders/${encodeURIComponent(approval.dataset.responderId)}/approval`, { method: 'POST', body: JSON.stringify({ approved: true }) });
      await loadOverview({ quiet: true });
      showToast('Responder profile approved for eligible-area routing.');
    } catch (error) { showToast(error.message); }
  }
});

$('#assignButton').addEventListener('click', async () => {
  const item = appData.cases.find((candidate) => candidate.id === selectedCaseId);
  const responderId = $('#responderSelect').value;
  if (!item || !responderId) return showToast('Choose an eligible responder or follow-up owner.');
  const locationFollowup = !item.zoneId;
  $('#assignButton').disabled = true;
  try {
    const result = await api(`/api/cases/${encodeURIComponent(item.id)}/${locationFollowup ? 'followup-owner' : 'claim'}`, { method: 'POST', body: JSON.stringify({ responderId }) });
    await loadOverview({ quiet: true });
    const caseRecord = result.caseRecord || appData.cases.find((candidate) => candidate.id === item.id);
    if (caseRecord) setSelectedCase(caseRecord.id);
    const responder = result.responder || appData.responders.find((candidate) => candidate.id === responderId);
    showToast(locationFollowup ? `${item.id}: ${responder?.name || 'Responder'} owns location follow-up. No dispatch was sent.` : `${item.id} claimed by ${responder?.name || 'responder'}. No external dispatch was sent.`);
  } catch (error) {
    showToast(error.message);
    if (selectedCaseId) setSelectedCase(selectedCaseId);
  }
});

$('#releaseAssignmentButton').addEventListener('click', async () => {
  const item = appData.cases.find((candidate) => candidate.id === selectedCaseId);
  if (!item || !item.assignmentNeedsReview) return;
  $('#releaseAssignmentButton').disabled = true;
  try {
    await api(`/api/cases/${encodeURIComponent(item.id)}/status`, { method: 'POST', body: JSON.stringify({ status: 'new' }) });
    await loadOverview({ quiet: true });
    showToast(`${item.id}: prior assignment released for coverage review. The case remains open.`);
  } catch (error) {
    showToast(error.message);
    if (selectedCaseId) setSelectedCase(selectedCaseId);
  }
});

$('#followupButton').addEventListener('click', async () => {
  if (!selectedCaseId) return;
  try {
    await api(`/api/cases/${encodeURIComponent(selectedCaseId)}/status`, { method: 'POST', body: JSON.stringify({ status: 'follow-up' }) });
    const changedId = selectedCaseId;
    await loadOverview({ quiet: true });
    showToast(`Follow-up recorded for ${changedId}.`);
  } catch (error) { showToast(error.message); }
});

$('#resolveButton').addEventListener('click', async () => {
  const item = appData.cases.find((candidate) => candidate.id === selectedCaseId);
  if (!item) return;
  const status = item.status === 'resolved' ? 'new' : 'resolved';
  $('#resolveButton').disabled = true;
  try {
    await api(`/api/cases/${encodeURIComponent(item.id)}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    await loadOverview({ quiet: true });
    showToast(status === 'resolved' ? `${item.id} resolved. Its active assignment was released.` : `${item.id} reopened for human review.`);
  } catch (error) { showToast(error.message); }
  finally { if (selectedCaseId) $('#resolveButton').disabled = false; }
});

$('#reviewNewFactsButton').addEventListener('click', () => {
  const item = appData.cases.find((candidate) => candidate.id === selectedCaseId);
  if (!item || item.status === 'resolved') return;
  $('#priorityReview').open = true;
  if (!$('#priorityOverrideReason').value.trim()) $('#priorityOverrideSelect').value = item.latestPriority || item.priority;
  $('#priorityOverrideReason').focus();
  $('#priorityReview').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('#priorityOverrideForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const caseId = selectedCaseId;
  if (!caseId) return;
  const reason = $('#priorityOverrideReason').value.trim();
  if (reason.length < 8) {
    $('#priorityOverrideResult').textContent = 'Record a reason of at least 8 characters so other responders can review the decision.';
    return;
  }
  const button = $('#priorityOverrideButton');
  const priority = $('#priorityOverrideSelect').value;
  button.disabled = true;
  $('#priorityOverrideResult').textContent = 'Saving the reviewed priority and reason…';
  try {
    await api(`/api/cases/${encodeURIComponent(caseId)}/priority`, { method: 'POST', body: JSON.stringify({ priority, reason }) });
    $('#priorityOverrideReason').value = '';
    await loadOverview({ quiet: true });
    if (selectedCaseId === caseId) $('#priorityOverrideResult').textContent = 'Reviewed priority saved with your reason.';
    showToast(`${caseId}: reviewed priority and reason saved.`);
  } catch (error) { $('#priorityOverrideResult').textContent = error.message; }
  finally { button.disabled = !selectedCaseId; }
});

$('#signOutButton').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
    lockWorkspace();
    await loadOverview();
  } catch (error) { showToast(error.message); }
});

$('#guardEnrollmentButton').addEventListener('click', async () => {
  const button = $('#guardEnrollmentButton');
  const status = $('#guardEnrollmentStatus');
  button.disabled = true;
  status.textContent = 'Creating a private 24-hour guarded-demo enrollment…';
  $('#guardEnrollmentResult').hidden = true;
  $('#guardEnrollmentUrl').value = '';
  $('#guardEnrollmentOpen').removeAttribute('href');
  try {
    const result = await api('/api/guard/enrollment', { method: 'POST', body: '{}' });
    const url = new URL(result.warningUrl, window.location.href);
    if (url.origin !== window.location.origin || url.pathname !== '/guard.html' || !url.hash) throw new Error('The server returned an unexpected test-phone setup link.');
    $('#guardEnrollmentUrl').value = url.href;
    $('#guardEnrollmentOpen').href = url.href;
    $('#guardEnrollmentResult').hidden = false;
    status.textContent = `Private link ready${result.expiresAt ? ` until ${fullTime(result.expiresAt)}` : ' for 24 hours'}. Open it on the consenting test phone, add it to the Home Screen, then enable notifications before the guarded call. Notification display is not proof that a person read it.`;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

$('#guardEnrollmentCopy').addEventListener('click', async () => {
  const input = $('#guardEnrollmentUrl');
  if (!input.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    $('#guardEnrollmentStatus').textContent = 'Private link copied. Share it only with the consenting test recipient; it expires after 24 hours.';
  } catch {
    input.focus();
    input.select();
    $('#guardEnrollmentStatus').textContent = 'Private link selected. Copy it using your device controls and share only with the consenting test recipient.';
  }
});

$('#responderRegistrationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const result = $('#responderRegistrationResult');
  const areas = [...document.querySelectorAll('input[name="responderArea"]:checked')].map((input) => input.value);
  const capabilities = [...document.querySelectorAll('input[name="responderCapability"]:checked')].map((input) => input.value);
  const body = {
    name: $('#responderNameInput').value.trim(),
    organization: $('#responderOrgInput').value.trim(),
    serviceAreas: areas,
    capabilities,
    available: $('#responderAvailableInput').checked,
    capacity: Number($('#responderCapacityInput').value || 0),
  };
  result.className = 'backend-result visible';
  result.textContent = 'Submitting responder profile…';
  try {
    const response = await api('/api/responders', { method: 'POST', body: JSON.stringify(body) });
    result.innerHTML = `<strong>Profile submitted.</strong> ${escapeHtml(response.note)} It will not be eligible for cases until approved.`;
    form.reset();
    $('#responderCapacityInput').value = '3';
    await loadOverview({ quiet: true });
  } catch (error) {
    result.className = 'backend-result visible error';
    result.textContent = error.message;
  }
});

$('#tryMessageButton').addEventListener('click', () => {
  const tool = $('#messageTool');
  tool.classList.remove('hidden');
  $('#messageInput').value = sampleMessage;
  tool.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#messageInput').focus({ preventScroll: true });
});
$('#closeToolButton').addEventListener('click', () => {
  $('#messageTool').classList.add('hidden');
  $('#analysisOutput').className = 'analysis-output';
});
$('#analyzeButton').addEventListener('click', () => analyzeToServer($('#messageInput').value, $('#analysisOutput')));
function appendGuideMessage(text, role) {
  const message = document.createElement('p');
  message.className = `guide-bubble ${role === 'user' ? 'guide-user' : 'guide-bot'}`;
  message.textContent = text;
  const messages = $('#guideMessages');
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function groundedGuideAnswer(question) {
  const selected = appData.cases.find((item) => item.id === selectedCaseId);
  const open = appData.cases.filter((item) => item.status !== 'resolved');
  const area = appData.zones.find((zone) => zone.id === currentZoneId());
  const review = selectedPressureReview();
  const snapshot = `This desk has ${open.length} open request${open.length === 1 ? '' : 's'}, ${open.filter((item) => item.priority === 'immediate').length} marked immediate, and ${open.filter((item) => !item.zoneId).length} with an unconfirmed service area.`;
  if (/privacy|retain|retention|store|consent|personal data/i.test(question)) return `The Pharos backend receives transcript text after consent. The configured text retention is ${appHealth?.transcriptRetentionHours || 24} hours; the phone providers have their own processing policies. Do not enter real resident information in a fictional demo. I can only see records currently loaded in this desk.`;
  if (/warning|scam|manipulat|pressure|verify|suspicious/i.test(question)) {
    if (!review) return 'No pressure review is loaded yet. Use a fictional message or a routed test call. A warning should identify exact wording and suggest independent verification; it cannot establish the caller’s identity.';
    const signals = (review.signals || []).slice(0, 3).map((signal) => `${signal.label}: “${signal.evidence}”${signal.explanation ? ` — ${signal.explanation}` : ''}`).join('\n');
    return `${review.headline || 'Latest pressure review'}\n${signals || 'No strong content pattern was found.'}\n${review.nextStep || 'Verify through an official contact you find independently.'}\nThese are wording signals, not a probability or proof of fraud.`;
  }
  if (/history|returning|repeat|changed|change over time|latest update/i.test(question)) {
    if (!selected) return 'Select a case first to inspect its linked reports and update history.';
    const history = caseHistoryEntries(selected);
    const latest = latestCallerUpdate(selected);
    return `${selected.id} has ${selected.linkedCallCount || new Set(history.map((entry) => entry.callId).filter(Boolean)).size || 1} linked phone report(s). ${latest ? `Latest phone report: ${fullTime(latest.at)}. ${latest.summary || latest.reason || ''}` : 'No update history is loaded yet.'}${selected.reassessmentRequired ? '\nA new report requires human reassessment.' : ''}\nReports can be linked by the configured phone route; that match does not verify the caller’s identity. Inspect Case update history for the reported progression.`;
  }
  if (/selected|this case|why|priority|rank|urgent/i.test(question)) {
    if (!selected) return 'Select a case in the queue first. I can then explain the reported facts, priority reason, service area, and ownership.';
    const owner = appData.responders.find((responder) => responder.id === (selected.assignedTo || selected.followUpOwner));
    return `${selected.id} · ${priorityLabel(selected.priority)}\n${selected.priorityReason}\nArea: ${selected.zoneName || 'Unassigned; location follow-up needed'}. ${selected.assignedTo ? 'Response owner' : 'Location follow-up owner'}: ${owner ? `${owner.name}, ${owner.organization}` : 'unclaimed'}.${selected.assignmentNeedsReview ? '\nThe response assignment needs review after a location correction.' : ''}${selected.priorityOverride ? `\nHuman review reason: ${selected.priorityOverride.reason}` : ''}\nA responder can review the priority with a recorded reason. Claiming does not send a dispatch.`;
  }
  if (/area|coverage|responder|capacity|assign|claim/i.test(question)) {
    const available = appData.responders.filter((responder) => responder.approved && responder.available && responder.assignedCount < responder.capacity);
    const scope = area ? area.name : currentZoneId() === 'unassigned' ? 'the location-follow-up queue' : 'all service areas';
    return `The desk is filtered to ${scope}. ${available.length} approved responder profile${available.length === 1 ? ' has' : 's have'} remaining capacity across the workspace. A case can be claimed only when service area and capabilities match. ${selected ? `${selected.id} currently lists ${(selected.eligibleResponders || []).length} eligible profile(s).` : 'Select a case to see its eligible responders.'} The area dropdown filters this shared demo desk; it is not an individual access-control boundary.`;
  }
  if (/voice|photon|livekit|transcript|speech|phone|hotline|call/i.test(question)) return appHealth?.voiceRoute === 'ready' ? 'The configured phone route is marked ready. Photon routes calls to LiveKit, which transcribes short spoken answers. Consented text reaches this desk for evidence-based priority and area review. I cannot listen to calls outside that route.' : 'The phone route is not yet marked ready in the backend. Photon → LiveKit → speech recognition → Pharos is the intended path. The transcript workbench already exercises the case-processing backend, but it is not a live audio test.';
  if (/resolve|close|reopen|follow.?up/i.test(question)) return 'Resolve releases the active assignment and keeps the record in the Resolved tab. Reopen returns it to human review. Mark for follow-up records missing work without sending a message or dispatch. Use a priority review with a reason if the reported facts change.';
  if (/queue|snapshot|attention|status|overview|hello|^hi\b/i.test(question)) return `${snapshot} ${area ? `You are viewing ${area.name}.` : 'Use the service-area filter to focus the queue.'} Requests are ordered by reviewed/suggested urgency, then time received. Unknown details stay visible for follow-up.`;
  return `${snapshot} I can explain the selected case’s priority, available responder coverage, phone-route status, or the latest pressure warning. My answers use the records loaded here; I cannot verify outside events or send help.`;
}

function askGuide(question) {
  const cleanQuestion = question.trim().slice(0, 240);
  if (!cleanQuestion) return;
  appendGuideMessage(cleanQuestion, 'user');
  appendGuideMessage(groundedGuideAnswer(cleanQuestion), 'bot');
}



$('#guideLauncher').addEventListener('click', () => {
  const panel = $('#guidePanel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('#guideLauncher').setAttribute('aria-expanded', String(open));
  if (open) $('#guideInput').focus();
});
$('#helpButton').addEventListener('click', () => {
  $('#guidePanel').hidden = false;
  $('#guideLauncher').setAttribute('aria-expanded', 'true');
  $('#guideInput').focus();
});
$('#guideClose').addEventListener('click', () => {
  $('#guidePanel').hidden = true;
  $('#guideLauncher').setAttribute('aria-expanded', 'false');
  $('#guideLauncher').focus();
});
document.querySelectorAll('.guide-topics button').forEach((button) => button.addEventListener('click', () => askGuide(button.dataset.question)));
$('#guideForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#guideInput');
  askGuide(input.value);
  input.value = '';
});

document.querySelectorAll('.nav-link[href^="#"]').forEach((link) => link.addEventListener('click', (event) => {
  const target = document.querySelector(link.getAttribute('href'));
  if (!target) return;
  if (link.getAttribute('href') === '#pressure') $('#messageTool').classList.remove('hidden');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
}));

$('#responderLoginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#responderPasswordInput').value }) });
    $('#responderPasswordInput').value = '';
    await loadOverview();
  } catch (error) { $('#loginError').textContent = error.message; }
});

$('#queueList').addEventListener('click', (event) => {
  const card = event.target.closest('[data-case-id]');
  if (card) setSelectedCase(card.dataset.caseId);
});
$('#followupList').addEventListener('click', (event) => {
  const card = event.target.closest('[data-case-id]');
  if (card) setSelectedCase(card.dataset.caseId);
});

$('#workspaceDate').textContent = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
loadOverview();
window.setInterval(() => loadOverview({ quiet: true }), 12000);
