import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendWarningSms } from '../pharos-notify.ts';
const alert={id:'AL-test-high',callId:'test',headline:'Pressure',level:'high',signals:[],nextStep:'Verify',createdAt:new Date().toISOString(),synthetic:true,deliveryStatus:'available'};
const config={enabled:'true',projectId:'pho_prj_test',apiKey:'dummy',senderNumber:'+14695550101',recipient:'+14695550102'};
test('disabled or incomplete SMS configuration cannot contact a provider',async()=>{
 let calls=0;const mock=async()=>{calls++;throw new Error('unexpected');};
 assert.equal((await sendWarningSms(alert,{},mock)).status,'not-configured');
 assert.equal((await sendWarningSms(alert,{...config,recipient:'not-a-number'},mock)).status,'failed');assert.equal(calls,0);
});
test('SMS uses canonical User IDs, stable idempotency, and a private single-part message',async()=>{
 const seen=[];
 const mock=async(url,init)=>{const path=new URL(url).pathname.split('/').pop();const body=JSON.parse(init.body);seen.push({path,body,init});return Response.json({id:path==='users'?(body.handle===config.senderNumber?'sender-user':'recipient-user'):path==='spaces'?'space':'message',status:path==='messages'?'accepted':undefined},{status:path==='messages'?202:201});};
 assert.equal((await sendWarningSms(alert,config,mock)).status,'accepted');
 assert.deepEqual(seen.map(x=>x.path),['users','users','spaces','messages']);
 assert.deepEqual(seen[2].body.participantIds,['sender-user','recipient-user']);
 assert.equal(seen[3].body.senderId,'sender-user');assert.equal(seen[3].body.content.type,'text');assert.equal(seen[3].body.content.format,'plain');
 assert.ok(seen[3].body.content.text.length<160);assert.ok(/^[\x00-\x7f]+$/.test(seen[3].body.content.text));assert.ok(!seen[3].body.content.text.includes(config.recipient));assert.equal(seen[3].init.redirect,'error');assert.equal(seen[3].init.headers['Idempotency-Key'],`${alert.id}:warning`);
});
test('explicit failed provider status is not accepted even with HTTP 202',async()=>{
 const mock=async(url)=>Response.json({id:'canonical',status:'failed'},{status:url.endsWith('/messages')?202:200});
 assert.deepEqual(await sendWarningSms(alert,config,mock),{status:'failed',reason:'provider-rejected-message'});
});
test('transient retries preserve idempotency; campaign/configuration failures do not retry',async()=>{
 const ids=[];let attempts=0;const mock=async(url,init)=>{if(url.endsWith('/messages')){attempts++;ids.push(init.headers['Idempotency-Key']);if(attempts===1)return new Response('',{status:503});}return Response.json({id:'canonical',status:'accepted'},{status:url.endsWith('/messages')?202:200});};
 assert.equal((await sendWarningSms(alert,config,mock)).status,'accepted');assert.equal(attempts,2);assert.equal(new Set(ids).size,1);
 let blocked=0;const refusal=async()=>{blocked++;return new Response('',{status:409});};assert.equal((await sendWarningSms(alert,config,refusal)).status,'failed');assert.equal(blocked,1);
});
