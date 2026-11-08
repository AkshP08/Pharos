self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload;
    try { payload=event.data.json(); } catch { return; }
    if (!payload || typeof payload.id!=='string') return;
    await self.registration.showNotification(payload.title || 'Pharos warning', {
      body:payload.body || 'Pause and verify the request independently.',
      icon:'/guard-icon.svg',badge:'/guard-icon.svg',tag:payload.id,
      renotify:false,data:{url:'/guard.html'},
    });
    if (typeof payload.receiptToken==='string') {
      await fetch('/api/guard/received', {method:'POST',headers:{Authorization:`Bearer ${payload.receiptToken}`,'Content-Type':'application/json'},body:JSON.stringify({id:payload.id})}).catch(()=>{});
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/guard.html'));
});
