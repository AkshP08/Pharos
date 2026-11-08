const $ = selector => document.querySelector(selector);
const storageKey = 'pharos-warning-enrollment';
let token = location.hash.slice(1) || localStorage.getItem(storageKey) || '';
let registration = null;
let pollTimer;
let lastAlert = '';
let refreshSequence = 0;
let disconnecting = false;
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/;
if (location.hash) history.replaceState(null, '', '/guard.html');
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(options.body ? {'Content-Type':'application/json'} : {}) } });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw Object.assign(new Error(data.error || 'Connection unavailable'), {status:response.status});
  return data;
}
function clearAlert() {
  $('#warningCard').hidden = true;
  $('#warningCard').classList.remove('warn');
  $('#waitingCard').hidden = false;
  $('#evidence').replaceChildren();
  for (const selector of ['#warningTitle', '#warningConfidence', '#warningTime', '#nextStep']) $(selector).textContent = '';
  lastAlert = '';
}
function startPolling() {
  clearInterval(pollTimer);
  if (tokenPattern.test(token) && !disconnecting) pollTimer = setInterval(refresh, 2500);
}
function showReviewStatus(data) {
  let message = '';
  const callKnown = typeof data.currentCallId === 'string';
  const currentWarnings = callKnown ? (data.alerts || []).filter(alert => alert.callId === data.currentCallId) : data.alerts || [];
  const hasEarlierWarning = callKnown && (data.alerts || []).some(alert => alert.callId && alert.callId !== data.currentCallId);
  if (data.analysisMode === 'semantic') {
    if (data.reviewStatus === 'pending') message = 'Reviewing the latest call wording…';
    else if (data.reviewStatus === 'unavailable') message = 'Context review unavailable. This does not verify the caller. Check unexpected money, code, or access requests independently; continue immediate physical safety instructions.';
    else if (data.reviewStatus === 'completed') message = currentWarnings.length
      ? 'Contextual transcript review completed. Review the warning below; caller identity and safety are not verified.'
      : hasEarlierWarning
        ? 'No warning identified in the latest call review. An earlier call warning is retained below. Caller identity and safety are not verified.'
        : 'No warning identified in this review. Caller identity and safety are not verified.';
    if (hasEarlierWarning && ['pending', 'unavailable'].includes(data.reviewStatus)) message += ' An earlier call warning is retained below.';
  }
  $('#reviewCard').hidden = !message;
  $('#reviewStatus').textContent = message;
}
function showAlert(alert, currentCallId) {
  const earlierCall = Boolean(currentCallId && alert.callId && alert.callId !== currentCallId);
  $('#warningCard').hidden = false;
  $('#warningCard').classList.add('warn');
  $('#waitingCard').hidden = true;
  $('#warningTitle').textContent = `${earlierCall ? 'Earlier call warning: ' : ''}${alert.headline || 'Pause and verify'}`;
  $('#warningConfidence').textContent = alert.confidence || 'A wording pattern deserves independent verification; this is not a fraud probability.';
  const sourceLabel = alert.analysisSource === 'caller-id-history' ? 'Prior caller-ID reports · identity unverified' : alert.analysisSource === 'context-model' ? 'Contextual transcript review' : 'Call wording review';
  const timestamp = new Date(alert.createdAt).toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  $('#warningTime').textContent = `${earlierCall ? 'Earlier call · ' : ''}${sourceLabel} · ${timestamp}`;
  $('#evidence').replaceChildren();
  for (const signal of alert.signals || []) {
    const row = document.createElement('li');
    for (const [tag,text] of [['b',signal.psychology || signal.label],['q',signal.evidence],['small',signal.explanation || signal.label]]) {
      const node = document.createElement(tag);node.textContent=text;row.append(node);
    }
    $('#evidence').append(row);
  }
  $('#nextStep').textContent = alert.nextStep;
  if (!earlierCall && alert.id !== lastAlert && lastAlert) navigator.vibrate?.([120,60,120]);
  lastAlert = alert.id;
}
async function refresh() {
  if (!tokenPattern.test(token) || disconnecting) return;
  const requestToken = token;
  const sequence = ++refreshSequence;
  try {
    const data = await api('/api/guard/status');
    if (sequence !== refreshSequence || token !== requestToken || disconnecting) return;
    localStorage.setItem(storageKey, token);
    $('#pairing').hidden = true;
    $('#disconnectPhone').hidden = false;
    $('#connection').classList.add('active');
    $('#connectionStatus').textContent = data.status === 'in-progress' ? 'Protected call in progress' : data.status === 'ringing' ? 'Call connected · waiting for consent' : 'This phone is enrolled';
    $('#connectionDetail').textContent = `Only guarded test calls for this enrolled recipient are shown. Enrollment ends ${new Date(data.expiresAt).toLocaleString()}.`;
    $('#enableNotifications').disabled = !data.pushPublicKey;
    $('#enableNotifications').dataset.publicKey = data.pushPublicKey || '';
    if (!data.pushPublicKey) $('#notificationStatus').textContent = 'Phone push is not configured yet. This screen can show warnings while open.';
    showReviewStatus(data);
    // Returned alerts remain authoritative, including earlier warnings retained after a later review.
    if (data.alerts?.length) showAlert(data.alerts.find(alert => alert.callId === data.currentCallId) || data.alerts[0], data.currentCallId);
    else clearAlert();
  } catch (error) {
    if (sequence !== refreshSequence || token !== requestToken || disconnecting) return;
    $('#connectionStatus').textContent = error.status === 404 ? 'Enrollment expired' : 'Connection needs attention';
    $('#connectionDetail').textContent = error.message;
    if ([401,404].includes(error.status)) {
      localStorage.removeItem(storageKey);token='';$('#pairing').hidden=false;$('#enableNotifications').disabled=true;clearInterval(pollTimer);
      $('#disconnectPhone').hidden=true;$('#connection').classList.remove('active');clearAlert();showReviewStatus({});
    }
  }
}
$('#pairButton').addEventListener('click', async () => {
  if (disconnecting) return;
  const value = $('#pairingInput').value.trim();
  const nextToken = value.includes('#') ? value.split('#').pop() : value;
  if (!tokenPattern.test(nextToken)) { $('#connectionDetail').textContent = 'Use the complete private link or its 43-character code.'; return; }
  ++refreshSequence;token=nextToken;clearAlert();showReviewStatus({});
  $('#pairingInput').value=''; await refresh();
  startPolling();
});
$('#enableNotifications').addEventListener('click', async () => {
  if (disconnecting) return;
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Install this page on your Home Screen and open it there to enable phone notifications.');
    // Permission is requested only after this explicit user action.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications are not enabled. You can keep this screen open or change the phone notification setting.');
    registration = await navigator.serviceWorker.register('/guard-worker.js');
    await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const key = $('#enableNotifications').dataset.publicKey;
      const raw = atob(key.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(key.length/4)*4,'='));
      subscription = await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
    }
    await api('/api/guard/subscribe', {method:'POST',body:JSON.stringify({subscription:subscription.toJSON()})});
    $('#notificationStatus').textContent='Phone notifications are registered. Display still depends on your phone’s notification and Focus settings.';
    $('#enableNotifications').textContent='Notifications registered';
  } catch (error) { $('#notificationStatus').textContent=error.message; }
});
$('#disconnectPhone').addEventListener('click', async () => {
  if (disconnecting) return;
  disconnecting = true;
  ++refreshSequence;
  clearInterval(pollTimer);
  $('#disconnectPhone').disabled = true;
  const notificationsDisabled = $('#enableNotifications').disabled;
  $('#enableNotifications').disabled = true;
  let serverRemoved = false;
  let browserUnsubscribed = false;
  try {
    const ready = registration || await navigator.serviceWorker?.getRegistration('/');
    const subscription = await ready?.pushManager.getSubscription();
    if (subscription) {
      // Remove the recipient-bound server record before ending this browser's subscription.
      try {
        const result = await api('/api/guard/unsubscribe', {method:'POST',body:JSON.stringify({endpoint:subscription.endpoint})});
        serverRemoved = result.removed === true;
      } catch {}
      try { browserUnsubscribed = await subscription.unsubscribe() === true; } catch {}
    } else browserUnsubscribed = true;
  } catch {}
  if (serverRemoved || browserUnsubscribed) {
    localStorage.removeItem(storageKey);token='';clearAlert();showReviewStatus({});location.reload();
    return;
  }
  disconnecting = false;
  $('#disconnectPhone').disabled = false;
  $('#enableNotifications').disabled = notificationsDisabled;
  $('#notificationStatus').textContent = 'Could not confirm disconnection. Check your connection and try Disconnect this phone again.';
  startPolling();
});
refresh();startPolling();
