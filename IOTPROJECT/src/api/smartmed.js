import {createWorkspace, STORAGE_KEY, validateSlots, validateWorkspace} from '../model.js';
import {DATA_MODE, BASE_URL} from './config.js';
import {csrfHeaders} from './auth.js';
export {DATA_MODE} from './config.js';

// The browser calls Express, never the board directly.
// Local mode starts empty and stores only user-entered schedules. It cannot create sensor events.
function readLocal() {
  try {const saved = localStorage.getItem(STORAGE_KEY); return saved ? validateWorkspace(JSON.parse(saved)) : createWorkspace();}
  catch {throw new Error('Your saved schedule could not be read. Your browser data has been kept. Please contact support before clearing it.');}
}
function storeLocal(workspace) {
  try {localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));}
  catch {throw new Error('Your changes could not be saved on this browser. Check available storage and try again.');}
}
async function request(path, {method = 'GET', body} = {}) {
  let response;
  try {
    response = await fetch(BASE_URL + path, {
      method, credentials: 'include', signal: AbortSignal.timeout(10000),
      headers: {'Accept': 'application/json', ...csrfHeaders(), ...(body ? {'Content-Type': 'application/json'} : {})},
      body: body ? JSON.stringify(body) : undefined,
      // Session CSRF tokens come from /auth/session and /auth/login.
      // Device credentials and Wi-Fi passwords belong only in backend/firmware provisioning.
    });
  } catch {throw new Error('We could not connect. Check your connection and try again.');}
  if (response.status === 401) {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('smartmed-session-expired'));
    throw new Error('Your session has expired. Please sign in again.');
  }
  if (response.status === 403) throw new Error('You do not have permission to change this schedule.');
  if (!response.ok) {let message; try {message = (await response.json()).error;} catch {} throw new Error(message || 'Your changes could not be completed. Please try again.');}
  if (response.status === 204) return null;
  try {return await response.json();} catch {throw new Error('Your data could not be loaded. Please try again.');}
}
export const smartmed = {
  async load() {
    // The Express API implements the contract in docs/02_MICROCONTROLLER_INTEGRATION.md.
    // Connection failures never insert sample records.
    return DATA_MODE === 'local' ? readLocal() : validateWorkspace(await request('/workspace'));
  },
  async loadHistory(cursor) {
    return request('/events?' + new URLSearchParams({cursor}));
  },
  async saveMedicine(medicine) {
    if (DATA_MODE === 'live') return request(`/medicines${medicine.id ? '/' + encodeURIComponent(medicine.id) : ''}`, {method: medicine.id ? 'PATCH' : 'POST', body: medicine});
    const workspace = readLocal();
    const {reminderTime, ...entry} = medicine;
    if (!entry.name?.trim() || !entry.strength?.trim() || !entry.quantity?.trim() || !workspace.slots.some(s => s.id === entry.slotId)) throw new Error('Complete the medicine details.');
    if (!reminderTime) throw new Error('Choose a reminder time for this part of the day.');
    const slots = workspace.slots.map(s => s.id === entry.slotId ? {...s, time: reminderTime} : s);
    validateSlots(slots, workspace.settings.grace);
    workspace.slots = slots;
    const saved = {...entry, id: entry.id || crypto.randomUUID()};
    workspace.medicines = workspace.medicines.some(m => m.id === saved.id) ? workspace.medicines.map(m => m.id === saved.id ? saved : m) : [...workspace.medicines, saved];
    storeLocal(workspace);
  },
  async removeMedicine(id) {
    if (DATA_MODE === 'live') return request('/medicines/' + encodeURIComponent(id), {method: 'DELETE'});
    const workspace = readLocal(); workspace.medicines = workspace.medicines.filter(m => m.id !== id); storeLocal(workspace);
  },
  async saveSlots(slots) {
    if (DATA_MODE === 'live') return request('/slots', {method: 'PUT', body: {slots}});
    const workspace = readLocal(); validateSlots(slots, workspace.settings.grace);
    if (slots.some(s => !s.time && workspace.medicines.some(m => m.slotId === s.id))) throw new Error('Keep a reminder time for every slot that has medicines.');
    workspace.slots = slots; storeLocal(workspace);
  },
};
