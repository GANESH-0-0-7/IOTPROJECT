import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace} from '../src/model.js';
import {dueReminder,readDecisions,recordDecision} from '../src/reminders.js';
function fixture(){const w=createWorkspace('Asia/Kolkata');w.slots[0].time='08:00';w.medicines=[{id:'m1',name:'Entered prescription',strength:'5 mg',quantity:'1 tablet',slotId:'morning'}];return w;}
test('no reminder is invented for an empty schedule or before the configured time',()=>{
 assert.equal(dueReminder(createWorkspace('Asia/Kolkata'),new Date('2027-01-15T02:30:00Z')),null);
 assert.equal(dueReminder(fixture(),new Date('2027-01-15T02:29:00Z')),null);
});
test('at the configured local time the popup contains the actual scheduled medicines',()=>{
 const w=fixture(),r=dueReminder(w,new Date('2027-01-15T02:30:00Z'));
 assert.equal(r.slot.id,'morning');assert.equal(r.key,'2027-01-15/morning/08:00');assert.deepEqual(r.medicines,w.medicines);
 assert.equal(w.events.length,0);
});
test('dismiss is specific to this dated reminder and does not confirm intake',()=>{
 const w=fixture(),now=new Date('2027-01-15T02:30:00Z'),r=dueReminder(w,now);
 const decisions=recordDecision({},r.key,{dismissed:true},now);
 assert.equal(dueReminder(w,now,decisions),null);
 assert.ok(dueReminder(w,new Date('2027-01-16T02:30:00Z'),decisions));assert.equal(w.events.length,0);assert.equal(w.medicines[0].status,undefined);
});
test('five-minute snooze survives preference reload and does not repeatedly interrupt',()=>{
 const w=fixture(),now=new Date('2027-01-15T02:30:00Z'),r=dueReminder(w,now);
 const decisions=recordDecision({},r.key,{snoozedUntil:now.getTime()+300000},now);
 const read=readDecisions({getItem:()=>JSON.stringify(decisions)},'key');
 assert.equal(dueReminder(w,new Date('2027-01-15T02:34:59Z'),read),null);
 assert.ok(dueReminder(w,new Date('2027-01-15T02:35:00Z'),read));
});
test('stale reminders expire instead of appearing hours late',()=>{
 assert.equal(dueReminder(fixture(),new Date('2027-01-15T03:30:00Z')),null);
});
test('cross-midnight reminder retains its original date and cannot satisfy tomorrow',()=>{
 const w=fixture();w.slots[0].time='23:55';
 const r=dueReminder(w,new Date('2027-01-15T18:30:00Z'));
 assert.equal(r.key,'2027-01-15/morning/23:55');
});
test('invalid stored preferences do not break reminders and old decisions are pruned',()=>{
 assert.deepEqual(readDecisions({getItem:()=>'{broken'},'key'),{});
 const decisions=recordDecision({'2020-01-01/morning/08:00':{dismissed:true}},'2027-01-15/morning/08:00',{dismissed:true},new Date('2027-01-15T02:30:00Z'));
 assert.equal(Object.keys(decisions).length,1);
});
test('explicit snooze near the window end is honored, but not hours later',()=>{
 const w=fixture(),now=new Date('2027-01-15T02:49:00Z'),r=dueReminder(w,now);
 const decisions=recordDecision({},r.key,{snoozedUntil:now.getTime()+300000},now);
 assert.ok(dueReminder(w,new Date('2027-01-15T02:54:00Z'),decisions));
 assert.equal(dueReminder(w,new Date('2027-01-15T04:00:00Z'),decisions),null);
});
