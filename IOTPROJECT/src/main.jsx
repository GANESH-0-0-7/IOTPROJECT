import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowRight, Bell, Check, Clock3, Download, History, Pill, Plus, RefreshCw, Trash2, X} from 'lucide-react';
import {smartmed, DATA_MODE} from './api/smartmed.js';
import {clockLabel, eventTime, exportCsv, minutes, slotMedicines, validateSlots, zonedParts} from './model.js';
import PatientAccess from './PatientLogin.jsx';
import {dueReminder, readDecisions, recordDecision} from './reminders.js';
import './styles.css';
const LOCAL = DATA_MODE === 'local';
function App({access}) {
  const [workspace, setWorkspace] = useState(null);
  const [page, setPage] = useState('Today');
  const [now, setNow] = useState(new Date());
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [toast, setToast] = useState('');
  const [historyBusy,setHistoryBusy]=useState(false);
  const historyExpanded=useRef(false);
  const decisionKey = 'smartmed-reminders-v1:' + (access.user?.id || 'on-device');
  const [decisions, setDecisions] = useState(() => readDecisions(localStorage, decisionKey));
  const [active, setActive] = useState(() => document.visibilityState === 'visible' && document.hasFocus());
  const generation = useRef(0), writing = useRef(false), loading = useRef(false), timer = useRef();
  async function refresh() {
    if (writing.current || loading.current) return;
    const current = generation.current;
    loading.current = true;
    try {const data = await smartmed.load(); if (current === generation.current) {applyWorkspace(data); setLoadError('');}}
    catch(e) {if (current === generation.current) setLoadError(e.message);}
    finally {loading.current = false;}
  }
  useEffect(() => {
    refresh();
    const clock = setInterval(() => setNow(new Date()), 5000);
    const polling = LOCAL ? null : setInterval(refresh, 10000);
    return () => {clearInterval(clock); clearInterval(polling); clearTimeout(timer.current);};
  }, []);
  useEffect(() => {
    function updateActivity() {setActive(document.visibilityState === 'visible' && document.hasFocus()); setNow(new Date());}
    function updateDecisions(e) {if (e.key === decisionKey) setDecisions(readDecisions(localStorage, decisionKey));}
    window.addEventListener('focus', updateActivity); window.addEventListener('blur', updateActivity);
    document.addEventListener('visibilitychange', updateActivity); window.addEventListener('storage', updateDecisions);
    return () => {window.removeEventListener('focus', updateActivity); window.removeEventListener('blur', updateActivity); document.removeEventListener('visibilitychange', updateActivity); window.removeEventListener('storage', updateDecisions);};
  }, [decisionKey]);
  const reminder = active && !modal && !loadError ? dueReminder(workspace, now, decisions) : null;
  function decideReminder(snooze = false) {
    if (!reminder) return;
    const next = recordDecision(decisions, reminder.key, snooze ? {snoozedUntil: Date.now() + 5*60000} : {dismissed: true});
    setDecisions(next);
    try {localStorage.setItem(decisionKey, JSON.stringify(next));} catch { /* In-memory decisions still prevent repeats in this session. */ }
  }
  function applyWorkspace(data) {
    setWorkspace(previous => {
      if (!historyExpanded.current || !previous) return data;
      const ids = new Set(data.events.map(e => e.id));
      return {...data,events:[...data.events,...previous.events.filter(e => !ids.has(e.id))],nextCursor:previous.nextCursor};
    });
  }
  async function loadOlderHistory() {
    if(historyBusy || !workspace?.nextCursor)return;
    setHistoryBusy(true);
    try {
      const data=await smartmed.loadHistory(workspace.nextCursor);historyExpanded.current=true;
      setWorkspace(previous=>{const ids=new Set(previous.events.map(e=>e.id));return {...previous,events:[...previous.events,...data.events.filter(e=>!ids.has(e.id))],nextCursor:data.nextCursor};});
      setLoadError('');
    } catch(e){setLoadError(e.message);}finally{setHistoryBusy(false);}
  }
  function notify(message) {setToast(message); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''), 5000);}
  function openModal(value) {setSaveError(''); setModal(value);}
  async function mutate(action, message) {
    if (writing.current) return;
    writing.current = true; generation.current++; setBusy(true); setSaveError('');
    try {await action();}
    catch(e) {setSaveError(e.message); writing.current = false; setBusy(false); return;}
    setModal(null); notify(message);
    try {applyWorkspace(await smartmed.load()); setLoadError('');}
    catch {setLoadError('Your changes were saved, but this view could not refresh. Please reload your schedule.');}
    finally {writing.current = false; setBusy(false);}
  }
  const zone = workspace?.settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = zonedParts(now, zone);
  const slots = workspace ? workspace.slots : [];
  const scheduled = slots.filter(s => s.time && slotMedicines(workspace, s.id).length).sort((a,b) => minutes(a.time) - minutes(b.time));
  const currentSlot = scheduled.find(s => today.minute >= minutes(s.time) && today.minute <= minutes(s.time) + workspace.settings.grace);
  const connected = !LOCAL && !loadError && workspace?.device?.online === true && Number.isFinite(Date.parse(workspace.device.lastSeen)) && now.getTime() - Date.parse(workspace.device.lastSeen) >= 0 && now.getTime() - Date.parse(workspace.device.lastSeen) < 90000;
  const events = workspace ? [...workspace.events].sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)) : [];
  const hasMedicines = Boolean(workspace?.medicines.length);
  function download() {
    const url = URL.createObjectURL(new Blob([exportCsv(events, zone)], {type:'text/csv;charset=utf-8'}));
    const a = document.createElement('a'); a.href = url; a.download = 'smartmed-box-history.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="app">
    <header className="app-header"><div className="header-inner"><a className="brand" href="#" onClick={e=>{e.preventDefault();setPage('Today');}}><span className="brand-mark"><Pill size={22}/></span>smart<span>med</span></a><nav aria-label="Main navigation">{['Today','History'].map(label=><button key={label} aria-current={page===label?'page':undefined} onClick={()=>setPage(label)}>{label}</button>)}</nav><div className="patient-account"><span>{access.user?.displayName || 'On this device'}</span><button disabled={access.logoutBusy} onClick={access.onLogout}>{access.logoutBusy?'Please wait…':access.localAccess?'Exit':'Sign out'}</button></div></div></header>
    <main>
      <div className="page-heading"><div><div className="eyebrow">{now.toLocaleDateString('en-US',{timeZone:zone,weekday:'long',month:'long',day:'numeric'})}</div><h1>{page==='Today'?"Today’s medicines":'Box-opening history'}</h1><p>{page==='Today'?'Your medicines, organised by time of day.':'A record of when your medicine box was opened.'}</p></div>{workspace && page==='Today' && <button className="primary" onClick={()=>openModal({type:'medicine'})}><Plus size={17}/>Add medicine</button>}</div>
      {access.logoutError && <div className="error-banner" role="alert">{access.logoutError}</div>}
      {loadError && <div className="error-banner" role="alert"><span>{loadError}</span><button onClick={refresh}><RefreshCw size={15}/>Try again</button></div>}
      {!workspace ? <section className="empty-state"><Clock3 size={29}/><h2>{loadError?'Your schedule is unavailable':'Loading your schedule…'}</h2><p>{loadError?'Your saved information has not been replaced. Please try again.':'This will only take a moment.'}</p></section> : <>
        {LOCAL && <div className="storage-notice"><span className="notice-dot"/><span>Saved on this browser only. Reminders appear while you use the app. Box history is not connected.</span></div>}
        {page==='Today' && <>
          {!hasMedicines && <p className="getting-started">Add your first medicine using <strong>Add medicine</strong> or the + button on a section. Use the details from your prescription.</p>}
          <div className="section-label routine-toolbar"><span>Times shown in {zone}</span><button className="text-button" onClick={()=>openModal({type:'times'})}><Clock3 size={15}/>Edit reminder times</button></div>
          <div className="day-slots">{slots.map(slot=>{
            const list=slotMedicines(workspace,slot.id), isDue=currentSlot?.id===slot.id;
            return <section id={'slot-'+slot.id} aria-labelledby={'heading-'+slot.id} className={'day-slot '+(isDue?'is-due':'')} key={slot.id}>
              <div className="slot-heading"><div><h2 id={'heading-'+slot.id}>{slot.label}</h2><span>{list.length?clockLabel(slot.time):'No medicines scheduled'}</span></div><div className="slot-heading-actions">{isDue && <span className="due-label">Reminder now</span>}<button className="add-to-slot" aria-label={'Add medicine to '+slot.label.toLowerCase()} onClick={()=>openModal({type:'medicine',slotId:slot.id})}><Plus size={19}/></button></div></div>
              <div className="slot-content">{list.length?list.map(m=><MedicineRow key={m.id} medicine={m} actions={<><button className="edit-button" aria-label={'Edit '+m.name} onClick={()=>openModal({type:'medicine',medicine:m})}>Edit</button><button className="delete-button" aria-label={'Remove '+m.name} onClick={()=>openModal({type:'remove',medicine:m})}><Trash2 size={15}/></button></>}/>):<p className="slot-empty">Nothing to take in this section.</p>}</div>
            </section>;
          })}</div>
          <p className="quiet-note">Use the matching labelled section in your box. Refill daily as prescribed. Box openings do not confirm medicine intake.</p>
        </>}
        {page==='History' && <>
          <div className="history-header"><span className="connection-label"><span className={connected?'connected-dot':'notice-dot'}/>{connected?'Box connected':'Box not connected'}{workspace.device?.lastSeen && <small>Last update {eventTime(workspace.device.lastSeen,zone)}</small>}</span>{events.length>0 && <button className="secondary" onClick={download}><Download size={16}/>Export</button>}</div>
          {!events.length ? <section className="empty-state history-empty"><span className="welcome-icon"><History size={30}/></span><h2>No box openings recorded yet.</h2><p>{connected?'Opening records will appear here as your box sends them.':'Once your medicine box is connected, its opening records will appear here.'}</p></section> : <section className="history-list">{events.map(e=><article key={e.id}><span className="event-icon"><History size={18}/></span><div><h2>{e.type==='BOX_OPENED'?'Box opened':'Box closed'}</h2><p>{e.reminderContext?`During the ${e.reminderContext.label.toLowerCase()} reminder`:'No associated reminder'}</p></div><time dateTime={e.occurredAt}>{eventTime(e.occurredAt,zone)}</time></article>)}</section>}
          <div className="history-more">{workspace.nextCursor&&<button className="secondary" disabled={historyBusy} onClick={loadOlderHistory}>{historyBusy?'Loading…':'Load older records'}</button>}</div>
          <p className="quiet-note">The shared lid records box access only. It cannot identify which medicine was selected or whether it was taken.{events.length>0?' Export includes the records currently loaded.':''}</p>
        </>}
      </>}
    </main>
    <footer><span className="footer-brand">smartmed</span><span>A clearer routine, every day.</span></footer>
    {modal && workspace && <Modal busy={busy} onClose={()=>{if(!busy)setModal(null);}} title={modal.type==='medicine'?'Medicine details':modal.type==='times'?'Reminder times':'Remove medicine'}>
      {modal.type==='medicine' && <MedicineForm slots={slots} medicine={modal.medicine} defaultSlotId={modal.slotId} busy={busy} onCancel={()=>setModal(null)} onSave={value=>mutate(()=>smartmed.saveMedicine(value),'Medicine saved')}/>}
      {modal.type==='times' && <TimesForm workspace={workspace} busy={busy} onCancel={()=>setModal(null)} onSave={value=>mutate(()=>smartmed.saveSlots(value),'Reminder times saved')}/>}
      {modal.type==='remove' && <><h2>Remove {modal.medicine.name}?</h2><p>It will be removed from your daily schedule. Existing box history will be kept.</p><div className="form-footer"><button className="secondary" disabled={busy} onClick={()=>setModal(null)}>Keep medicine</button><button className="danger" disabled={busy} onClick={()=>mutate(()=>smartmed.removeMedicine(modal.medicine.id),'Medicine removed')}>{busy?'Removing…':'Remove medicine'}</button></div></>}
      {saveError && <p className="form-error" role="alert">{saveError}</p>}
    </Modal>}
    {reminder && <Modal busy={false} onClose={() => decideReminder()} title="Medicine reminder">
      <div className="reminder-dialog"><span className="reminder-bell"><Bell size={29}/></span><span className="eyebrow">YOUR MEDICINE REMINDER</span><h2>Time for your {reminder.slot.label.toLowerCase()} medicines.</h2><p>Scheduled for {clockLabel(reminder.slot.time)}. Use the section labelled <strong>{reminder.slot.label.toUpperCase()}</strong>.</p><div className="reminder-medicines">{reminder.medicines.map(m => <MedicineRow key={m.id} medicine={m}/>)}</div><p className="reminder-note">Follow your prescribed instructions. Dismissing this reminder does not record medicine intake.</p><div className="reminder-actions"><button className="primary" onClick={() => {setPage('Today'); decideReminder(); requestAnimationFrame(()=>document.getElementById('slot-'+reminder.slot.id)?.scrollIntoView({block:'center'}));}}>View medicines<ArrowRight size={16}/></button><button className="secondary" onClick={() => decideReminder(true)}><Clock3 size={15}/>Remind me in 5 minutes</button><button className="text-button" onClick={() => decideReminder()}>Dismiss reminder</button></div></div>
    </Modal>}
    {toast && <div className="toast" role="status"><Check size={17}/>{toast}<button aria-label="Dismiss message" onClick={()=>setToast('')}><X size={15}/></button></div>}
  </div>;
}
function MedicineRow({medicine:m,actions}) {return <div className="medicine-row"><div className="medicine-details"><strong>{m.name}</strong><span>{m.strength}</span><span className="medicine-dose">Quantity: {m.quantity}</span>{m.instructions && <p className="medicine-instructions">{m.instructions}</p>}</div>{actions && <div className="medicine-actions">{actions}</div>}</div>;}

function Modal({children,title,busy,onClose}) {
  const ref=useRef();
  useEffect(()=>{
    const previous=document.activeElement;
    const focusable=()=>[...ref.current.querySelectorAll('button:not(:disabled),input,select')];
    (ref.current.querySelector('input')||focusable()[0])?.focus();
    function keydown(e){if(e.key==='Escape'&&!busy)onClose();if(e.key==='Tab'){const list=focusable(),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}
    document.addEventListener('keydown',keydown);const previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=previousOverflow;previous?.focus();};
  },[busy]);
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={20}/></button>{children}</section></div>;
}
function MedicineForm({slots,medicine,defaultSlotId,busy,onSave,onCancel}) {
  const [slotId,setSlotId]=useState(medicine?.slotId||defaultSlotId||'morning');
  const [time,setTime]=useState(slots.find(s=>s.id===slotId)?.time||'');
  const [error,setError]=useState('');
  return <form onSubmit={e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget));Object.keys(d).forEach(k=>d[k]=d[k].trim());if(!d.name||!d.strength||!d.quantity||!time){setError('Complete the medicine name, strength, quantity, and reminder time.');return;}try{validateSlots(slots.map(s=>s.id===slotId?{...s,time}:s));setError('');onSave({...d,slotId,reminderTime:time,...(medicine?{id:medicine.id}:{})});}catch(e){setError(e.message);}}}>
    <span className="modal-icon"><Pill size={24}/></span><h2>{medicine?'Edit medicine':'Add a medicine'}</h2><p>Use the details from your prescription.</p>
    <div className="form-fields"><label>Medicine name<input name="name" required maxLength={80} defaultValue={medicine?.name} autoComplete="off"/></label><div className="form-grid"><label>Strength<input name="strength" required maxLength={40} defaultValue={medicine?.strength} placeholder="As on the label"/></label><label>Quantity each time<input name="quantity" required maxLength={40} defaultValue={medicine?.quantity} placeholder="As prescribed"/></label></div><div className="form-grid"><label>Part of the day<select value={slotId} onChange={e=>{setSlotId(e.target.value);setTime(slots.find(s=>s.id===e.target.value)?.time||'');}}>{slots.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label><label>Reminder time<input type="time" required value={time} onChange={e=>setTime(e.target.value)}/></label></div><p className="field-hint">This time applies to all medicines in the {slots.find(s=>s.id===slotId)?.label.toLowerCase()} section.</p><label>Instructions <span className="optional">Optional</span><input name="instructions" maxLength={200} defaultValue={medicine?.instructions} placeholder="From your prescription"/></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="form-footer"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy?'Saving…':'Save medicine'}</button></div>
  </form>;
}
function TimesForm({workspace,busy,onSave,onCancel}) {
  const [error,setError]=useState('');
  return <form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);const slots=workspace.slots.map(s=>({...s,time:d.get(s.id)||null}));try{validateSlots(slots,workspace.settings.grace);if(slots.some(s=>!s.time&&slotMedicines(workspace,s.id).length))throw new Error('Keep a reminder time for every section that has medicines.');setError('');onSave(slots);}catch(e){setError(e.message);}}}><span className="modal-icon"><Clock3 size={24}/></span><h2>Reminder times</h2><p>Choose times that fit your prescribed routine. Unused sections can stay blank.</p><div className="form-fields form-grid">{workspace.slots.map(s=><label key={s.id}>{s.label}<input type="time" name={s.id} defaultValue={s.time||''} required={slotMedicines(workspace,s.id).length>0}/></label>)}</div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-footer"><button className="secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save times'}</button></div></form>;
}
createRoot(document.getElementById('root')).render(<PatientAccess>{access => <App key={access.user?.id || 'on-device'} access={access}/>}</PatientAccess>);
