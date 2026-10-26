import {minutes, slotMedicines, zonedParts} from './model.js';
// Display reminders only; these decisions never create intake or box-access records.
export function dueReminder(workspace, instant, decisions = {}) {
  if (!workspace) return null;
  const now = new Date(instant);
  const local = zonedParts(now, workspace.settings.timezone);
  for (const daysBack of [0, 1]) {
    const date = new Date(Date.parse(local.date+'T00:00:00Z') - daysBack*86400000).toISOString().slice(0,10);
    for (const slot of workspace.slots) {
      const medicines = slotMedicines(workspace,slot.id);
      const age = local.minute + daysBack*1440 - minutes(slot.time);
      if (!slot.time || !medicines.length || age < 0) continue;
      const key = `${date}/${slot.id}/${slot.time}`;
      const decision = decisions[key];
      if (decision?.dismissed || decision?.snoozedUntil > now.getTime()) continue;
      // Honor an explicit five-minute snooze even if it crosses the original window,
      // but never surface an old snooze hours after the patient returns.
      if (decision?.snoozedUntil) {
        if (now.getTime() - decision.snoozedUntil > workspace.settings.grace*60000) continue;
      } else if (age > workspace.settings.grace) continue;
      return {key, date, slot, medicines};
    }
  }
  return null;
}
export function readDecisions(storage, key) {
  try {const value = JSON.parse(storage.getItem(key)); return value && typeof value === 'object' && !Array.isArray(value) ? value : {};} catch {return {};}
}
export function recordDecision(decisions, key, decision, instant = new Date()) {
  // Retain only recent decisions so persistent state does not grow indefinitely.
  const cutoff = new Date(instant).getTime() - 3*86400000;
  const retained = Object.fromEntries(Object.entries(decisions).filter(([id]) => Date.parse(id.slice(0,10)+'T00:00:00Z') >= cutoff));
  return {...retained,[key]:decision};
}
