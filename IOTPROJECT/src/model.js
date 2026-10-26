export const SLOT_IDS = ['morning', 'afternoon', 'evening', 'night'];
// Earlier prototype keys contained sample records. Leave them untouched and never import them.
export const STORAGE_KEY = 'smartmed-personal-workspace-v1';
export function createWorkspace(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return {
    slots: [
      {id: 'morning', label: 'Morning', time: null},
      {id: 'afternoon', label: 'Afternoon', time: null},
      {id: 'evening', label: 'Evening', time: null},
      {id: 'night', label: 'Night', time: null},
    ],
    medicines: [], events: [],
    settings: {timezone, grace: 20},
    device: null,
  };
}
export function zonedParts(instant, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return {date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute)};
}
export const minutes = time => time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : Infinity;
export const clockLabel = time => time ? new Date(`2000-01-01T${time}:00`).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}) : 'Time not set';
export const eventTime = (time, zone) => new Date(time).toLocaleString('en-US', {timeZone: zone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
export const slotMedicines = (workspace, id) => workspace.medicines.filter(m => m.slotId === id);
export function validateSlots(slots, grace = 20) {
  if (slots.length !== 4 || new Set(slots.map(s => s.id)).size !== 4 || slots.some(s => !SLOT_IDS.includes(s.id))) throw new Error('Keep the four daily time slots.');
  if (slots.some(s => s.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))) throw new Error('Enter a valid reminder time.');
  const ordered = slots.filter(s => s.time).sort((a, b) => minutes(a.time) - minutes(b.time));
  if (ordered.length < 2) return;
  for (let i = 0; i < ordered.length; i++) {
    const gap = (minutes(ordered[(i + 1) % ordered.length].time) - minutes(ordered[i].time) + 1440) % 1440;
    if (gap <= grace) throw new Error('Leave more than ' + grace + ' minutes between reminder times, including across midnight.');
  }
}
export function validateWorkspace(value) {
  const fail = () => {throw new Error('Your data could not be loaded. Please try again.');};
  if (!value || !Array.isArray(value.slots) || !Array.isArray(value.medicines) || !Array.isArray(value.events) || !value.settings) fail();
  if (typeof value.settings.timezone !== 'string' || !Number.isFinite(value.settings.grace) || value.settings.grace < 1 || value.settings.grace > 180) fail();
  try {new Intl.DateTimeFormat('en', {timeZone: value.settings.timezone}); validateSlots(value.slots, value.settings.grace ?? 20);} catch {fail();}
  if (value.slots.some(s => typeof s.label !== 'string')) fail();
  if (value.medicines.some(m => !m || typeof m.id !== 'string' || !SLOT_IDS.includes(m.slotId) || ['name','strength','quantity'].some(k => typeof m[k] !== 'string' || !m[k].trim()))) fail();
  if (value.events.some(e => !e || typeof e.id !== 'string' || !['BOX_OPENED', 'BOX_CLOSED'].includes(e.type) || !Number.isFinite(Date.parse(e.occurredAt)))) fail();
  return value;
}
export function exportCsv(events, timezone) {
  const rows = [['Occurred at (UTC)', 'Local time', 'Box event', 'Reminder at the time (not verified intake)'], ...events.map(e => [e.occurredAt, eventTime(e.occurredAt, timezone), e.type === 'BOX_OPENED' ? 'Box opened' : 'Box closed', e.reminderContext?.label || 'No associated reminder'])];
  return rows.map(row => row.map(value => {let text = String(value ?? ''); if (/^\s*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"';}).join(',')).join('\r\n');
}
