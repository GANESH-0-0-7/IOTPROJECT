import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace, validateWorkspace, validateSlots, exportCsv, clockLabel} from '../src/model.js';

test('new workspace has no invented patients, medicines, opening events, times, or device readings', () => {
  const w = createWorkspace('Asia/Kolkata');
  assert.equal(w.medicines.length, 0);
  assert.equal(w.events.length, 0);
  assert.equal(w.device, null);
  assert.ok(w.slots.every(s => s.time === null));
  assert.equal(w.settings.patient, undefined);
  assert.equal(w.settings.caregiver, undefined);
  assert.deepEqual(w.slots.map(s => s.label), ['Morning', 'Afternoon', 'Evening', 'Night']);
  assert.equal(clockLabel(null), 'Time not set');
  assert.doesNotThrow(() => validateWorkspace(w));
});
test('unused slots may remain unconfigured; overlapping reminders are rejected', () => {
  const w = createWorkspace('Asia/Kolkata');
  assert.doesNotThrow(() => validateSlots(w.slots));
  w.slots[0].time = '08:00';
  assert.doesNotThrow(() => validateSlots(w.slots));
  w.slots[1].time = '08:10';
  assert.throws(() => validateSlots(w.slots), /minutes between/);
  w.slots[1].time = '13:00';
  assert.doesNotThrow(() => validateSlots(w.slots));
});
test('reminder-window validation also handles midnight', () => {
  const w = createWorkspace('Asia/Kolkata');
  w.slots[0].time = '00:05'; w.slots[3].time = '23:50';
  assert.throws(() => validateSlots(w.slots), /midnight/);
});
test('invalid backend shapes, timezone, and fabricated event types fail without crashing the UI', () => {
  assert.throws(() => validateWorkspace({}), /could not be loaded/);
  const w = createWorkspace('not-a-timezone');
  assert.throws(() => validateWorkspace(w), /could not be loaded/);
  w.settings.timezone = 'Asia/Kolkata';
  w.events = [{id:'1',type:'MEDICINE_TAKEN',occurredAt:'2027-01-15T02:34:00Z'}];
  assert.throws(() => validateWorkspace(w), /could not be loaded/);
});
test('real event export preserves access meaning and escapes spreadsheet formulas', () => {
  const events = [{id:'e1',type:'BOX_OPENED',occurredAt:'2027-01-15T02:34:00Z',reminderContext:{label:'=1+1'}},{id:'e2',type:'BOX_CLOSED',occurredAt:'2027-01-15T02:35:00Z',reminderContext:{label:'a,"b"'}}];
  const csv = exportCsv(events,'Asia/Kolkata');
  assert.match(csv, /not verified intake/);
  assert.match(csv, /Box opened/);
  assert.match(csv, /"'=1\+1"/);
  assert.match(csv, /"a,""b"""/);
});
