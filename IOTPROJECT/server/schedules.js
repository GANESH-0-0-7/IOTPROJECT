import {randomUUID} from 'node:crypto';
import {DateTime} from 'luxon';
import {validateSlots} from '../src/model.js';
import {digest,HttpError} from './security.js';
export async function snapshot(c,patient){
  const slots=(await c.query("SELECT id,label,time FROM slots WHERE patient_id=$1 ORDER BY CASE id WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 WHEN 'evening' THEN 3 ELSE 4 END",[patient.id])).rows;
  const medicines=(await c.query('SELECT id,name,strength,quantity,instructions,slot_id AS "slotId" FROM medicines WHERE patient_id=$1 ORDER BY created_at,id',[patient.id])).rows;
  return {slots,medicines,settings:{timezone:patient.timezone,grace:patient.grace}};
}
export async function assertSchedule(c,patient){
  const w=await snapshot(c,patient);
  try{validateSlots(w.slots,patient.grace);}catch(e){throw new HttpError(400,e.message);}
  if(w.slots.some(s=>!s.time&&w.medicines.some(m=>m.slotId===s.id)))throw new HttpError(400,'Every section with medicines needs a reminder time.');
  return w;
}
export async function newScheduleVersion(c,patient,initial=false){
  const w=await assertSchedule(c,patient);
  const at=(await c.query('SELECT clock_timestamp() AS at')).rows[0].at;
  let version=patient.schedule_version;
  if(!initial){
    await c.query('UPDATE schedule_versions SET valid_until=$2 WHERE patient_id=$1 AND valid_until IS NULL',[patient.id,at]);
    version=(await c.query('UPDATE patients SET schedule_version=schedule_version+1 WHERE id=$1 RETURNING schedule_version',[patient.id])).rows[0].schedule_version;
  }
  await c.query('INSERT INTO schedule_versions(patient_id,version,valid_from,snapshot) VALUES($1,$2,$3,$4)',[patient.id,version,at,JSON.stringify(w)]);
  return version;
}
export function reminderInstant(date,time,zone){
  if(!time)return null;
  const value=DateTime.fromISO(`${date}T${time}`,{zone});
  // Skip nonexistent local times during a DST jump instead of silently shifting medication times.
  if(!value.isValid||value.toFormat('HH:mm')!==time)return null;
  // For a repeated autumn time, consistently choose its first occurrence.
  return value.getPossibleOffsets().sort((a,b)=>a.toMillis()-b.toMillis())[0]||value;
}
export async function associateEvent(c,patientId,event){
  if(event.type!=='BOX_OPENED')return null;
  const history=(await c.query('SELECT snapshot FROM schedule_versions WHERE patient_id=$1 AND valid_from <= $2 AND (valid_until IS NULL OR valid_until > $2) ORDER BY version DESC LIMIT 1',[patientId,event.occurredAt])).rows[0]?.snapshot;
  if(!history)return null;
  const occurred=DateTime.fromISO(event.occurredAt,{setZone:true});
  const local=occurred.setZone(history.settings.timezone);
  for(const day of [local,local.minus({days:1})])for(const slot of history.slots){
    const medicines=history.medicines.filter(m=>m.slotId===slot.id);
    const scheduled=reminderInstant(day.toISODate(),slot.time,history.settings.timezone);
    const age=scheduled?occurred.toMillis()-scheduled.toMillis():-1;
    if(medicines.length&&scheduled&&age>=0&&age<=history.settings.grace*60000){
      return {slotId:slot.id,label:slot.label,date:day.toISODate(),scheduledTime:slot.time,medicines:medicines.map(({name,strength,quantity})=>({name,strength,quantity}))};
    }
  }
  return null;
}
function stableId(key){const hex=digest(key).slice(0,32).split('');hex[12]='5';hex[16]='a';const h=hex.join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
export async function reminderSnapshot(c,patient,from,to){
  const w=await snapshot(c,patient),reminders=[];
  let day=from.setZone(patient.timezone).startOf('day').minus({days:1});
  const last=to.setZone(patient.timezone).startOf('day').plus({days:1});
  for(;day<=last;day=day.plus({days:1}))for(const slot of w.slots){
    if(!w.medicines.some(m=>m.slotId===slot.id))continue;
    const instant=reminderInstant(day.toISODate(),slot.time,patient.timezone);
    if(!instant||instant<from||instant>=to)continue;
    const id=stableId(`${patient.id}/${patient.schedule_version}/${slot.id}/${day.toISODate()}`);
    const row={id,slotId:slot.id,scheduledAt:instant.toUTC().toISO(),windowEndsAt:instant.plus({minutes:patient.grace}).toUTC().toISO()};
    await c.query('INSERT INTO reminders(id,patient_id,version,slot_id,local_date,scheduled_at,window_ends_at,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[id,patient.id,patient.schedule_version,slot.id,day.toISODate(),row.scheduledAt,row.windowEndsAt,JSON.stringify(w.medicines.filter(m=>m.slotId===slot.id))]);
    reminders.push(row);
  }
  return {scheduleVersion:patient.schedule_version,validFrom:from.toUTC().toISO(),validThrough:to.toUTC().toISO(),reminders:reminders.sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt))};
}
export function defaultDeviceConfig(calibration){
  return {calibrated:Boolean(calibration),sensor:calibration||null,pins:{trigger:18,echo:34,leds:{morning:13,afternoon:14,evening:26,night:27},buzzer:32},repeatReminderMinutes:5};
}
export const newId=randomUUID;
