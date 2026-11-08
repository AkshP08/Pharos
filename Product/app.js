const $ = (selector) => document.querySelector(selector);
const toast = $('#toast');
let toastTimer;
let appData = { incidents: [], zones: [], responders: [], cases: [], calls: [], scamReviews: [], mode: 'demo-only' };
appData.role = 'demo';
let activeFilter = 'all';
let selectedCaseId = null;
let appHealth = null;

const sampleMessage = 'County Rescue Office: Your evacuation seat expires in 5 minutes. Pay a $40 fee by gift card to reserve it. Do not call the county or your request will be cancelled.';

const guideAnswers = [
  { match: /help|request|flare|submit|call|phone/i, answer: 'Residents call the Pharos voice line. The agent discloses transcription, asks a few short questions, reads back a summary, and only then sends a case to the human responder queue. The live Photon line is not configured yet; the backend currently has synthetic call fixtures.' },
  { match: /warning|real|scam|message|verify/i, answer: 'Pharos checks exact wording for pressure tactics such as payment demands, codes, secrecy, and artificial deadlines. It can analyze only text or call transcripts that reach Pharos. It cannot inspect a separate call on your regular phone.' },
  { match: /beacon|responder|triage|queue|priority|area/i, answer: 'Beacon uses a persistent backend queue. It matches a known location to a configured response area, sorts by explainable urgency tiers, and keeps unknown details visible. Approved responders claim only cases in their service areas and capabilities; a human owns dispatch.' },
  { match: /voice|photon|transcript|speech/i, answer: 'The live path is Photon SIP → LiveKit voice agent → speech-to-text → Pharos transcript analysis and location/urgency rules → Beacon. LiveKit performs the transcription; Photon routes the call. The account still needs a provisioned voice route and credentials before real calls can reach it.' },
  { match: /data|private|store|send/i, answer: 'The deployed demo stores only synthetic examples. Live intake stays disabled until the responder workspace is password protected and a private ingest token is configured. The planned live pipeline stores text after consent, does not record raw audio, and expires transcripts after 24 hours by default.' },
];

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

function setAudience(audience) {
  const isFlare = audience === 'flare';
  $('#flareView').hidden = !isFlare;
  $('#beaconView').hidden = isFlare;
  $('#flareModeButton').classList.toggle('selected', isFlare);
  $('#flareModeButton').setAttribute('aria-pressed', String(isFlare));
  $('#beaconModeButton').classList.toggle('selected', !isFlare);
  $('#beaconModeButton').setAttribute('aria-pressed', String(!isFlare));
  document.body.classList.toggle('flare-mode', isFlare);
  $('#breadcrumbSection').textContent = isFlare ? 'Pharos' : 'Incidents';
  $('#breadcrumbCurrent').textContent = isFlare ? 'Flare · Resident support' : appData.incidents.find((incident) => incident.status === 'active')?.name || 'Response desk';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#flareModeButton').addEventListener('click', () => setAudience('flare'));
$('#beaconModeButton').addEventListener('click', () => setAudience('beacon'));

$('#callDemoButton').addEventListener('click', () => {
  const panel = $('#callPreview');
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening);
  $('#callDemoButton').innerHTML = opening ? 'Hide sample call <span>↑</span>' : 'Preview a sample call <span>→</span>';
  if (opening) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('#closeCallPreview').addEventListener('click', () => {
  $('#callPreview').classList.add('hidden');
  $('#callDemoButton').innerHTML = 'Preview a sample call <span>→</span>';
  $('#callDemoButton').focus();
});

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

function visibleCases() {
  const zone = currentZoneId();
  return appData.cases.filter((item) => (zone === 'all' || item.zoneId === zone) && item.status !== 'resolved');
}

function filteredCases() {
  const items = visibleCases();
  if (activeFilter === 'immediate') return items.filter((item) => item.priority === 'immediate');
  if (activeFilter === 'followup') return items.filter((item) => item.priority === 'follow-up' || item.followUp);
  return items;
}

function renderCaseCard(item) {
  const excerpt = caseExcerpt(item);
  const responseState = item.assignedTo ? `Claimed by ${appData.responders.find((responder) => responder.id === item.assignedTo)?.name || 'responder'}` : `${(item.eligibleResponders || []).length} eligible responder${(item.eligibleResponders || []).length === 1 ? '' : 's'}`;
  const warning = item.followUp && item.priority !== 'follow-up' ? ' · Location/details need follow-up' : '';
  return `<button class="request-card${item.id === selectedCaseId ? ' selected' : ''}" data-case-id="${escapeHtml(item.id)}" data-priority="${escapeHtml(item.priority)}">
    <span class="priority-rail ${priorityRail(item.priority)}"></span>
    <span class="request-main"><span class="request-topline"><strong>${escapeHtml(item.title)}</strong><time>${escapeHtml(formatAge(item.createdAt))}</time></span>
    <span class="request-meta"><span class="case-id">${escapeHtml(item.id)}</span><span>·</span><span>${escapeHtml(item.zoneName || 'Unassigned area')}</span>${item.synthetic ? '<span class="synthetic-case-label">SYNTHETIC</span>' : ''}</span>
    <span class="request-excerpt">“${escapeHtml(excerpt)}”</span>
    <span class="request-bottom"><span class="tag ${item.priority === 'immediate' ? 'tag-critical' : item.priority === 'time-sensitive' ? 'tag-time' : 'tag-review'}">${escapeHtml(priorityLabel(item.priority))}${escapeHtml(warning)}</span><span class="response-state"><i></i>${escapeHtml(responseState)}</span></span></span>
  </button>`;
}

function renderFollowupCard(item) {
  return `<button class="followup-card" data-case-id="${escapeHtml(item.id)}"><span class="followup-icon">?</span><div><strong>${escapeHtml(item.zoneId ? 'Priority/details need confirmation' : 'Location not matched')}</strong><p>${escapeHtml(item.id)} · ${escapeHtml(item.title)} · Keep visible for responder follow-up.</p></div><span class="chevron">›</span></button>`;
}

function updateCounts() {
  const cases = visibleCases();
  const immediate = cases.filter((item) => item.priority === 'immediate').length;
  const followup = cases.filter((item) => item.priority === 'follow-up' || item.followUp).length;
  const open = appData.cases.filter((item) => item.status !== 'resolved').length;
  $('#activeCount').textContent = String(open).padStart(2, '0');
  $('#urgentCount').textContent = String(immediate).padStart(2, '0');
  $('#scamCount').textContent = String(appData.scamReviews.length).padStart(2, '0');
  $('#queueBadge').textContent = String(cases.length);
  $('#allTabCount').textContent = String(cases.length);
  $('#immediateTabCount').textContent = String(immediate);
  $('#followupTabCount').textContent = String(followup);
  $('#followupSectionCount').textContent = `${followup} CASE${followup === 1 ? '' : 'S'}`;
  $('#callCount').textContent = String(appData.calls.length);
}

function setSelectedCase(caseId) {
  selectedCaseId = caseId;
  const item = appData.cases.find((candidate) => candidate.id === caseId);
  if (!item) return;
  $('#caseId').textContent = item.id;
  $('#caseTitle').textContent = item.title;
  $('#caseLocation').textContent = `${item.locationText || 'Location not confirmed'} · ${item.zoneName || 'Unassigned area'}`;
  $('#caseTime').textContent = `Received ${fullTime(item.createdAt)}`;
  $('#reporterName').textContent = 'Anonymous caller';
  $('#reporterAvatar').textContent = 'AN';
  $('#caseSource').textContent = `${item.sourceLabel || 'Phone intake'} · ${item.status === 'claimed' ? 'Claimed for response' : 'Human review required'}`;
  $('#caseMessage').textContent = item.transcript || caseExcerpt(item);
  $('#caseTranscriptCaption').textContent = `${item.synthetic ? 'Synthetic scenario' : 'Caller-consented transcript'} · ${item.callId ? `Call ${item.callId}` : 'No call ID'}`;
  $('#priorityLabel').textContent = priorityLabel(item.priority);
  $('#priorityReason').textContent = item.priorityReason || 'Review the recorded facts and confirm the operational priority.';
  const tags = [
    item.immediateDanger === 'yes' ? 'Caller reported immediate danger' : item.immediateDanger === 'no' ? 'No immediate danger reported' : 'Immediate danger unknown',
    item.locationStatus === 'matched' ? `Area matched: ${item.zoneName}` : 'Location needs follow-up',
    item.peopleCount ? `${item.peopleCount} people` : null,
    ...(item.needs || []).map((need) => `Need: ${need}`),
    item.scamSignals?.length ? `Possible pressure wording · ${item.scamSignals.length} signal${item.scamSignals.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  $('.reported-chip-row').innerHTML = tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  const select = $('#responderSelect');
  const eligible = appData.responders.filter((responder) => (item.eligibleResponders || []).includes(responder.id));
  select.innerHTML = '<option value="">Choose eligible responder</option>' + eligible.map((responder) => `<option value="${escapeHtml(responder.id)}"${item.assignedTo === responder.id ? ' selected' : ''}>${escapeHtml(responder.name)} · ${escapeHtml(responder.organization)}</option>`).join('');
  select.disabled = !eligible.length || Boolean(item.assignedTo);
  $('#assignButton').disabled = !eligible.length || Boolean(item.assignedTo);
  $('#assignButton').textContent = item.assignedTo ? 'Case claimed' : 'Claim for responder →';
  document.querySelectorAll('[data-case-id]').forEach((card) => card.classList.toggle('selected', card.dataset.caseId === item.id));
}

function renderQueue() {
  const items = filteredCases();
  const queue = $('#queueList');
  const followups = $('#followupList');
  const area = appData.zones.find((zone) => zone.id === currentZoneId());
  $('#queueSortLabel').textContent = area ? area.name.toUpperCase() : 'ALL SERVICE AREAS';
  document.querySelectorAll('.queue-tab').forEach((tab) => {
    const selected = tab.dataset.filter === activeFilter;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  const actionCases = activeFilter === 'all' ? items.filter((item) => item.priority !== 'follow-up') : activeFilter === 'followup' ? [] : items;
  const followupCases = activeFilter === 'all' ? items.filter((item) => item.priority === 'follow-up') : activeFilter === 'followup' ? items : [];
  queue.innerHTML = actionCases.length ? actionCases.map(renderCaseCard).join('') : `<div class="queue-loading">${activeFilter === 'followup' ? 'Follow-up cases are shown below.' : 'No matching requests in this area.'}</div>`;
  followups.innerHTML = followupCases.length ? followupCases.map(renderFollowupCard).join('') : `<div class="queue-loading">${activeFilter === 'immediate' ? 'Immediate cases stay in the ranked queue above.' : 'No follow-up cases in this area.'}</div>`;
  updateCounts();
  if (!selectedCaseId || !appData.cases.some((item) => item.id === selectedCaseId)) {
    selectedCaseId = [...items].sort((a, b) => a.priorityRank - b.priorityRank || a.createdAt.localeCompare(b.createdAt))[0]?.id || null;
  }
  if (selectedCaseId) setSelectedCase(selectedCaseId);
  else showEmptyCase();
}

function showEmptyCase() {
  $('#caseId').textContent = '—';
  $('#caseTitle').textContent = 'No case selected';
  $('#caseLocation').textContent = 'Waiting for a request in this area';
  $('#caseTime').textContent = 'No recent call';
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
  $('#riskSource').textContent = review ? (review.synthetic ? 'synthetic data' : 'caller-consented transcript') : 'waiting for data';
  $('#suspiciousText').textContent = review?.text || 'Select a scam review or analyze a synthetic message to see transcript evidence.';
  $('#traceCount').textContent = String(review?.signals?.length || 0);
  const list = $('#traceSignalList');
  if (!review?.signals?.length) {
    list.innerHTML = '<div class="signal-row"><span class="signal-number">—</span><span class="signal-copy"><strong>No strong pressure pattern found</strong><small>Wording cannot authenticate a sender; urgency alone is not proof.</small></span><span class="signal-strength">REVIEW</span></div>';
  } else {
    list.innerHTML = review.signals.map((signal, index) => `<div class="signal-row"><span class="signal-number">${String(index + 1).padStart(2, '0')}</span><span class="signal-copy"><strong>${escapeHtml(signal.label)}</strong><small>“${escapeHtml(signal.evidence)}”</small></span><span class="signal-strength">${risk === 'high' ? 'STRONG' : 'CHECK'}</span></div>`).join('');
  }
  const action = $('.trace-results .safe-action p');
  if (action && review) action.innerHTML = `<strong>Safer next step</strong><br />${escapeHtml(review.nextStep)}`;
}

function renderResponderCoverage() {
  const selectedAreas = new Set(appData.zones.map((zone) => zone.id));
  $('#responderAreaOptions').innerHTML = appData.zones.length ? appData.zones.map((zone) => `<label><input type="checkbox" name="responderArea" value="${escapeHtml(zone.id)}" /> ${escapeHtml(zone.name)}</label>`).join('') : 'No response areas configured.';
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
    ? `<ul>${review.signals.map((signal) => `<li><strong>${escapeHtml(signal.label)}</strong> — “${escapeHtml(signal.evidence)}”</li>`).join('')}</ul>`
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
  $('#flareIntro').textContent = voiceReady
    ? 'In a disaster, you shouldn’t have to navigate a website. The Pharos test line routes calls to a short voice intake for human review.'
    : 'In a disaster, you shouldn’t have to navigate a website. Pharos is designed around a short phone call; this demo’s phone line is not connected yet.';
  if (appData.mode === 'secured') {
    modePill.textContent = 'SECURED · FIXTURES VISIBLE';
    status.textContent = voiceReady ? 'Protected data · Photon voice route ready' : 'Protected data · Live call route not configured';
  } else {
    modePill.textContent = 'SYNTHETIC DEMO';
    status.textContent = appHealth?.persistentStorage === 'sqlite-durable-object' ? 'Synthetic data · persistent backend active · no live call route' : 'Synthetic data · backend unavailable';
  }
}

async function loadOverview(options = {}) {
  try {
    const auth = await api('/api/auth/status');
    if (auth.required && !auth.authenticated) {
      $('#responderLogin').hidden = false;
      $('#beaconView').hidden = true;
      $('#flareView').hidden = true;
      return;
    }
    appData.role = auth.role || 'demo';
    $('#responderLogin').hidden = true;
    const [overview, health] = await Promise.all([api('/api/overview'), api('/api/health')]);
    appData = { ...appData, ...overview };
    appHealth = health;
    const isFlare = document.body.classList.contains('flare-mode');
    $('#flareView').hidden = !isFlare;
    $('#beaconView').hidden = isFlare;
    fillZoneFilter();
    renderResponderCoverage();
    renderQueue();
    renderCalls();
    renderPressureTrace(appData.scamReviews[0]);
    updateDataMode();
    const activeIncident = appData.incidents.find((incident) => incident.status === 'active');
    if (activeIncident) {
      $('.incident-mini strong').textContent = activeIncident.name;
      $('#breadcrumbCurrent').textContent = activeIncident.name;
    }
    if (!options.quiet) return true;
    return true;
  } catch (error) {
    if (error.status === 401 || error.body?.authRequired) {
      $('#responderLogin').hidden = false;
      $('#beaconView').hidden = true;
      $('#flareView').hidden = true;
      return false;
    }
    $('#dataModeStatus').textContent = 'Backend unavailable · open through the DeepSpace app or run its Worker locally';
    $('#queueList').innerHTML = `<div class="queue-loading">${escapeHtml(error.message)}. The static file preview cannot reach the persistent Worker backend.</div>`;
    return false;
  }
}

let zoneOptionsLoaded = false;
function fillZoneFilter() {
  const selector = $('#zoneFilter');
  const current = selector.value || 'all';
  selector.innerHTML = '<option value="all">All service areas</option>' + appData.zones.map((zone) => `<option value="${escapeHtml(zone.id)}">${escapeHtml(zone.name)}</option>`).join('');
  selector.value = appData.zones.some((zone) => zone.id === current) ? current : 'all';
  zoneOptionsLoaded = true;
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
      selectedCaseId = result.caseRecord.id;
      setSelectedCase(selectedCaseId);
      output.innerHTML = `<strong>Call processed and stored.</strong><br />Call ${escapeHtml(result.call.id)} → case ${escapeHtml(result.caseRecord.id)} · ${escapeHtml(priorityLabel(result.caseRecord.priority))} · ${escapeHtml(result.caseRecord.zoneName)} · ${escapeHtml((result.caseRecord.eligibleResponders || []).length)} eligible responder(s). Human review is required; no dispatch was sent.`;
    } else {
      output.innerHTML = `<strong>Call processed and stored.</strong><br />The call was classified as ${escapeHtml(result.callKind)}; no disaster-help case was created.${result.scamReview ? ` ${escapeHtml(result.scamReview.headline)} with ${escapeHtml(result.scamReview.signals.length)} evidence signal(s).` : ''}`;
    }
    output.className = 'backend-result visible';
    renderPressureTrace(result.scamReview || appData.scamReviews[0]);
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
    setSelectedCase(jumpLink.dataset.jumpCase);
    $('#response').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  const responderId = $('#responderSelect').value;
  if (!selectedCaseId || !responderId) return showToast('Choose an eligible responder for this response area.');
  try {
    const result = await api(`/api/cases/${encodeURIComponent(selectedCaseId)}/claim`, { method: 'POST', body: JSON.stringify({ responderId }) });
    await loadOverview({ quiet: true });
    setSelectedCase(result.caseRecord.id);
    showToast(`${result.caseRecord.id} claimed by ${result.responder.name}. No external dispatch was sent.`);
  } catch (error) { showToast(error.message); }
});

$('#followupButton').addEventListener('click', async () => {
  if (!selectedCaseId) return;
  try {
    await api(`/api/cases/${encodeURIComponent(selectedCaseId)}/status`, { method: 'POST', body: JSON.stringify({ status: 'follow-up' }) });
    await loadOverview({ quiet: true });
    showToast(`Follow-up recorded for ${selectedCaseId}.`);
  } catch (error) { showToast(error.message); }
});

$('#responderRegistrationForm').addEventListener('submit', async (event) => {
  event.preventDefault();
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
    event.currentTarget.reset();
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
$('#residentAnalyzeButton').addEventListener('click', () => analyzeToServer($('#residentMessage').value, $('#residentAnalysis')));

$('#helpRequestForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const needs = form.getAll('need');
  const location = String(form.get('locationHint') || '').trim() || 'Not provided — follow-up needed';
  const statusMap = { yes: 'Immediate danger reported', no: 'No immediate danger reported', 'not-sure': 'Immediate danger not confirmed — follow-up needed' };
  const count = form.get('peopleCount') === 'unknown' ? 'Not provided' : form.get('peopleCount');
  const detail = $('#helpDetails').value.trim();
  const preview = $('#requestPreview');
  const lines = [
    `<li><strong>Safety:</strong> ${escapeHtml(statusMap[form.get('safetyStatus')])}</li>`,
    `<li><strong>Location:</strong> ${escapeHtml(location)}</li>`,
    `<li><strong>People:</strong> ${escapeHtml(String(count))}</li>`,
    `<li><strong>Needs:</strong> ${needs.length ? needs.map(escapeHtml).join(', ') : 'Not selected — follow-up needed'}</li>`,
  ];
  if (detail) lines.push(`<li><strong>Extra detail:</strong> ${escapeHtml(detail)}</li>`);
  preview.className = 'request-preview visible';
  preview.innerHTML = `<strong>Backup form preview · not sent</strong><ul>${lines.join('')}</ul><span>The deployed demo’s persistent intake path is the synthetic voice transcript processor; this page form remains a local preview.</span>`;
  preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

function appendGuideMessage(text, role) {
  const message = document.createElement('p');
  message.className = `guide-bubble ${role === 'user' ? 'guide-user' : 'guide-bot'}`;
  message.textContent = text;
  const messages = $('#guideMessages');
  messages.append(message);
  messages.scrollTop = messages.scrollHeight;
}

function askGuide(question) {
  const cleanQuestion = question.trim().slice(0, 240);
  if (!cleanQuestion) return;
  appendGuideMessage(cleanQuestion, 'user');
  const match = guideAnswers.find((entry) => entry.match.test(cleanQuestion));
  appendGuideMessage(match ? match.answer : 'I can explain the call pipeline, Beacon queue, responder areas, or scam wording checks. I cannot send help, check a live warning, or inspect a separate phone call.', 'bot');
}

$('#guideLauncher').addEventListener('click', () => {
  const panel = $('#guidePanel');
  const open = panel.hidden;
  panel.hidden = !open;
  $('#guideLauncher').setAttribute('aria-expanded', String(open));
  if (open) $('#guideInput').focus();
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

loadOverview();
window.setInterval(() => loadOverview({ quiet: true }), 12000);
