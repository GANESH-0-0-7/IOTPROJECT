import test from 'node:test';
import assert from 'node:assert/strict';
import {reminderInstant} from '../schedules.js';
import {timezone} from '../schemas.js';
test('DST nonexistent reminder times are skipped and repeated times choose a stable first occurrence',()=>{
 assert.equal(reminderInstant('2027-03-14','02:30','America/New_York'),null);
 assert.equal(reminderInstant('2027-11-07','01:30','America/New_York').toUTC().toISO(),'2027-11-07T05:30:00.000Z');
 assert.equal(reminderInstant('2027-01-15','08:00','Asia/Kolkata').toUTC().toISO(),'2027-01-15T02:30:00.000Z');
});
test('registration only accepts zones renderable by the patient dashboard',()=>{
 assert.equal(timezone.safeParse('UTC+5').success,false);
 assert.equal(timezone.safeParse('Asia/Kolkata').success,true);
});
