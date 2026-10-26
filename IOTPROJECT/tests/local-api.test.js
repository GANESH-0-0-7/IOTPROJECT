import test from 'node:test';
import assert from 'node:assert/strict';
import {STORAGE_KEY} from '../src/model.js';
const entries = new Map([['smartmed-shared-lid-v1', JSON.stringify({medicines:[{name:'Old sample data'}]})]]);
Object.defineProperty(globalThis,'localStorage',{value:{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)},configurable:true});
process.env.VITE_DATA_MODE='local';
const {smartmed,DATA_MODE} = await import('../src/api/smartmed.js');
test('local mode ignores prior prototype samples and exposes no event simulation', async () => {
  assert.equal(DATA_MODE,'local');
  assert.equal((await smartmed.load()).medicines.length,0);
  assert.equal(smartmed.simulate,undefined);
  assert.ok(entries.has('smartmed-shared-lid-v1'));
});
test('user-entered medicines share a slot and update its time atomically', async () => {
  const entry={name:'User prescription',strength:'5 mg',quantity:'1 tablet',instructions:'',slotId:'morning',reminderTime:'08:00'};
  await smartmed.saveMedicine(entry);await smartmed.saveMedicine({...entry,name:'Second prescription'});
  let w=await smartmed.load();
  assert.equal(w.medicines.length,2);assert.equal(w.slots[0].time,'08:00');assert.equal(w.events.length,0);assert.equal(w.device,null);
  const first=w.medicines[0];
  await smartmed.saveMedicine({...first,quantity:'2 tablets',reminderTime:'09:00'});
  w=await smartmed.load();assert.equal(w.medicines.length,2);assert.equal(w.medicines[0].quantity,'2 tablets');assert.equal(w.slots[0].time,'09:00');
  assert.ok(entries.has(STORAGE_KEY));
});
test('invalid medicine save cannot partially update the schedule', async () => {
  const before=await smartmed.load();
  await assert.rejects(()=>smartmed.saveMedicine({name:'Third',strength:'5 mg',quantity:'1 tablet',slotId:'afternoon',reminderTime:'09:10'}),/minutes between/);
  assert.deepEqual(await smartmed.load(),before);
});
test('cannot unset a time used by medicines; deleting medicine preserves backend event history', async () => {
  let w=await smartmed.load();
  await assert.rejects(()=>smartmed.saveSlots(w.slots.map(s=>({...s,time:null}))),/Keep a reminder time/);
  w.events=[{id:'real-event',type:'BOX_OPENED',occurredAt:'2027-01-15T02:34:00Z'}];entries.set(STORAGE_KEY,JSON.stringify(w));
  await smartmed.removeMedicine(w.medicines[0].id);
  const after=await smartmed.load();assert.equal(after.medicines.length,1);assert.equal(after.events.length,1);
});
