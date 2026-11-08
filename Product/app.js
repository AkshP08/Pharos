const cases = [
  {
    id: 'SB-024',
    title: 'Water rising inside home',
    location: 'Riverbend neighborhood · Zone 3',
    time: 'Received 2 minutes ago',
    reporter: 'Anonymous resident',
    initials: 'AN',
    message: 'Water is coming up the stairs. We can’t get out safely. There are four of us, and my grandmother uses powered oxygen equipment. We’re near the Riverbend footbridge.',
    label: 'Immediate safety concern',
    reason: 'Reported rising water, no safe exit, and a time-sensitive powered medical device. These facts make this request time-critical; the resident’s tone or number of messages did not affect placement.',
    tags: ['Reported: rising water', 'Reported: cannot exit', '4 people'],
    priority: 'immediate',
  },
  {
    id: 'SB-019',
    title: 'Power loss · medical device',
    location: 'Northbank neighborhood · Zone 2',
    time: 'Received 7 minutes ago',
    reporter: 'Anonymous resident',
    initials: 'AN',
    message: 'Power has been out for three hours. My dad’s oxygen concentrator needs power. We are inside and can leave if there is a safe ride.',
    label: 'Time-sensitive essential need',
    reason: 'The resident reports an essential powered device and a possible evacuation need. There is no report of immediate water entry or injury, so a responder should clarify remaining power and transport options promptly.',
    tags: ['Reported: power outage', 'Powered device', 'Transport may help'],
    priority: 'immediate',
  },
  {
    id: 'SB-021',
    title: 'Shelter request · location unclear',
    location: 'Location not confirmed',
    time: 'Received 11 minutes ago',
    reporter: 'Anonymous resident',
    initials: 'AN',
    message: 'We need a ride to a shelter. I don’t know the street name, but we are next to a large blue water tower.',
    label: 'Needs follow-up · priority unknown',
    reason: 'The request lacks a confirmed location and does not state whether anyone is in immediate danger. Keep it visible and ask for a nearby landmark or safe callback path; missing information is not a reason to lower priority.',
    tags: ['Location incomplete', 'Ride requested', 'Follow-up needed'],
    priority: 'followup',
  },
];

const queueList = document.querySelector('#queueList');
const queueCards = [...document.querySelectorAll('.request-card')];
const toast = document.querySelector('#toast');
let toastTimer;
let activeFilter = 'all';
let activeCaseIndex = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function showCase(index) {
  const item = cases[index];
  if (!item) return;
  activeCaseIndex = index;
  document.querySelector('#caseId').textContent = item.id;
  document.querySelector('#caseTitle').textContent = item.title;
  document.querySelector('#caseLocation').textContent = item.location;
  document.querySelector('#caseTime').textContent = item.time;
  document.querySelector('#reporterName').textContent = item.reporter;
  document.querySelector('#reporterAvatar').textContent = item.initials;
  document.querySelector('#caseMessage').textContent = item.message;
  document.querySelector('#priorityLabel').textContent = item.label;
  document.querySelector('#priorityReason').textContent = item.reason;
  document.querySelector('.reported-chip-row').innerHTML = item.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('');
  document.querySelectorAll('.request-card').forEach((card) => card.classList.toggle('selected', Number(card.dataset.case) === index));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function applyFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('.queue-tab').forEach((tab) => {
    const selected = tab.dataset.filter === filter;
    tab.classList.toggle('selected', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  queueCards.forEach((card) => {
    const show = filter === 'all' || (filter === 'immediate' && card.dataset.priority === 'immediate') || (filter === 'followup' && card.dataset.priority === 'followup');
    card.hidden = !show;
  });
}

queueCards.forEach((card) => card.addEventListener('click', () => showCase(Number(card.dataset.case))));
document.querySelectorAll('.queue-tab').forEach((tab) => tab.addEventListener('click', () => applyFilter(tab.dataset.filter)));

document.querySelector('#assignButton').addEventListener('click', () => {
  showToast(`${cases[activeCaseIndex].id} marked for responder review. No dispatch was sent.`);
});

document.querySelector('#followupButton').addEventListener('click', () => {
  const item = cases[activeCaseIndex];
  showToast(`Follow-up requested for ${item.id}: confirm location and immediate danger.`);
});

document.querySelector('#refreshButton').addEventListener('click', () => {
  showToast('Demo queue refreshed. No live Photon connection is configured.');
});

document.querySelector('#simulateButton').addEventListener('click', () => {
  const followup = document.querySelector('#followupCard');
  followup.classList.add('pulse-card');
  window.setTimeout(() => followup.classList.remove('pulse-card'), 900);
  showToast('Sample request received in demo mode and kept visible for responder review.');
});

document.querySelector('#showMoreButton').addEventListener('click', (event) => {
  const expanded = event.currentTarget.dataset.expanded === 'true';
  event.currentTarget.dataset.expanded = String(!expanded);
  event.currentTarget.innerHTML = expanded ? 'View 4 more requests <span>↓</span>' : 'Showing 3 of 8 · sample data only <span>↑</span>';
  showToast(expanded ? 'Collapsed the additional sample requests.' : 'The remaining four queue rows are represented by synthetic demo counts.');
});

const sampleMessage = 'County Rescue Office: Your evacuation seat expires in 5 minutes. Pay a $40 fee by gift card to reserve it. Do not call the county or your request will be cancelled.';
document.querySelector('#tryMessageButton').addEventListener('click', () => {
  const tool = document.querySelector('#messageTool');
  tool.classList.remove('hidden');
  document.querySelector('#messageInput').value = sampleMessage;
  tool.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.querySelector('#messageInput').focus({ preventScroll: true });
});
document.querySelector('#closeToolButton').addEventListener('click', () => {
  document.querySelector('#messageTool').classList.add('hidden');
  document.querySelector('#analysisOutput').className = 'analysis-output';
});

function analyzeMessage(message) {
  const text = message.toLowerCase();
  const signals = [];
  const patterns = [
    { name: 'Authority claim to verify', match: /(county|rescue|fema|official|government|sheriff|police|utility|relief office)/i, note: 'A claimed organization is not authenticated by the wording.' },
    { name: 'Deadline or immediate pressure', match: /(\bwithin\b|\bexpires?\b|\bact now\b|\bright now\b|\bimmediately\b|\b\d+\s*(minutes?|hours?)\b|\bbefore\s\w+)/i, note: 'Pressure to act quickly is present; urgency by itself is not proof of a scam.' },
    { name: 'Payment or valuable information request', match: /(gift card|wire transfer|crypto|cryptocurrency|payment app|pay\b|fee\b|password|verification code|one[- ]time code|social security|bank account)/i, note: 'The message asks for money or sensitive information.' },
    { name: 'Discourages independent verification', match: /(don't call|do not call|don't tell|do not tell|keep this secret|only contact|don't contact|do not contact)/i, note: 'The message discourages checking with another trusted source.' },
    { name: 'Link or download request', match: /(https?:\/\/|click (the )?link|download (the )?app|open this link)/i, note: 'A link or download is being used as the next step.' },
  ];

  for (const pattern of patterns) {
    if (pattern.match.test(text)) signals.push(pattern);
  }

  const highRisk = signals.some((signal) => signal.name === 'Payment or valuable information request') && signals.length >= 2;
  const mediumRisk = signals.length >= 2 || signals.some((signal) => signal.name === 'Payment or valuable information request');
  const level = highRisk ? 'high' : mediumRisk ? 'medium' : 'low';
  const headline = level === 'high' ? 'Several high-pressure signals found' : level === 'medium' ? 'Some wording deserves a closer look' : 'Few pressure signals found';
  const caveat = 'This demo checks words and requests; it cannot verify the sender or determine intent. Urgency alone does not prove fraud.';
  return { signals, level, headline, caveat };
}

document.querySelector('#analyzeButton').addEventListener('click', () => {
  const input = document.querySelector('#messageInput').value.trim();
  const output = document.querySelector('#analysisOutput');
  if (!input) {
    output.className = 'analysis-output visible medium';
    output.innerHTML = '<strong>Add a synthetic message to review.</strong>Use a fictional example; do not paste a real person’s private message.';
    return;
  }
  const result = analyzeMessage(input);
  const signalSummary = result.signals.length
    ? result.signals.map((signal) => `<li><strong>${escapeHtml(signal.name)}</strong> — ${escapeHtml(signal.note)}</li>`).join('')
    : '<li>No strong pressure pattern found in this simple demo check. The sender is still unverified.</li>';
  output.className = `analysis-output visible ${result.level}`;
  output.innerHTML = `<strong>${result.headline}</strong><ul>${signalSummary}</ul><span>${result.caveat}</span>`;
});

document.querySelectorAll('.nav-link[href^="#"]').forEach((link) => link.addEventListener('click', (event) => {
  const target = document.querySelector(link.getAttribute('href'));
  if (!target) return;
  if (link.getAttribute('href') === '#pressure') document.querySelector('#messageTool').classList.remove('hidden');
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
}));

// Keep the demo honest: every record is fictional and no live source is connected.
document.querySelector('#queueBadge').textContent = '8';
