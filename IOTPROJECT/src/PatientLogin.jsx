import React, {useEffect, useState} from 'react';
import {ArrowRight, Eye, EyeOff, LoaderCircle, Pill} from 'lucide-react';
import {auth} from './api/auth.js';
import {DATA_MODE} from './api/config.js';
const LOCAL = DATA_MODE === 'local';
export default function PatientAccess({children}) {
  const [user,setUser]=useState(null),[localAccess,setLocalAccess]=useState(false);
  const [checking,setChecking]=useState(!LOCAL),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[showPassword,setShowPassword]=useState(false);
  const [register,setRegister]=useState(false),[registrationAllowed,setRegistrationAllowed]=useState(false);
  async function checkSession(){
    setChecking(true);setError('');
    try{setUser(await auth.session());setRegistrationAllowed(auth.registrationEnabled());}
    catch(e){setError(e.message);}finally{setChecking(false);}
  }
  useEffect(()=>{
    if(!LOCAL)checkSession();
    const expire=()=>{setUser(null);setError('Your session has expired. Please sign in again.');};
    window.addEventListener('smartmed-session-expired',expire);
    return()=>window.removeEventListener('smartmed-session-expired',expire);
  },[]);
  async function logout(){
    setBusy(true);setError('');
    try{await auth.logout();setUser(null);setLocalAccess(false);setRegister(false);}
    catch{setError('We could not sign you out. Please try again.');}finally{setBusy(false);}
  }
  async function submit(e){
    e.preventDefault();const form=e.currentTarget,d=new FormData(form);setError('');
    if(register&&d.get('password')!==d.get('confirmPassword')){setError('Passwords do not match.');return;}
    setBusy(true);
    try{
      const signedIn=register?await auth.register({displayName:d.get('displayName').trim(),email:d.get('email').trim(),password:d.get('password'),timezone:d.get('timezone')}):await auth.login(d.get('email'),d.get('password'));
      form.reset();setUser(signedIn);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  if(user||localAccess)return children({user,localAccess,onLogout:logout,logoutBusy:busy,logoutError:error});
  return <div className="login-page">
    <section className="login-intro">
      <a className="brand" href="#"><span className="brand-mark"><Pill size={23}/></span>smart<span>med</span></a>
      <div className="login-message"><span className="eyebrow">YOUR ROUTINE, A LITTLE SIMPLER</span><h1>A gentle reminder.<br/>A little peace of mind.</h1><p>Your prescribed medicines, daily schedule, and box history—all in one place.</p><div className="login-day-labels"><span>Morning</span><span>Afternoon</span><span>Evening</span><span>Night</span></div></div>
      <p className="login-bottom">Made for the moments that matter, every day.</p>
    </section>
    <main className="login-main"><div className="login-form-card">
      <span className="modal-icon"><Pill size={25}/></span><h2>{register?'Create your account':'Patient sign in'}</h2><p>{register?'Start with an empty schedule, ready for your prescription.':'Welcome back. Sign in to see your medicine routine.'}</p>
      {checking?<div className="session-check" role="status"><LoaderCircle className="spinning" size={21}/>Checking your session…</div>:<form key={register?'register':'login'} onSubmit={submit}>
        <div className="form-fields">
          {register&&<label>Your name<input name="displayName" autoComplete="name" required maxLength={80}/></label>}
          <label>Email address<input name="email" type="email" autoComplete="username" required maxLength={254}/></label>
          <label>Password<div className="password-field"><input name="password" type={showPassword?'text':'password'} autoComplete={register?'new-password':'current-password'} required minLength={register?12:undefined} maxLength={128}/><button type="button" aria-label={showPassword?'Hide password':'Show password'} onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
          {register&&<><p className="field-hint">Use at least 12 characters. Do not reuse a password from another account.</p><label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label><label>Schedule timezone<input name="timezone" defaultValue={Intl.DateTimeFormat().resolvedOptions().timeZone} required maxLength={80}/></label></>}
        </div>
        {error&&<p className="form-error" role="alert">{error}</p>}
        <button className="primary login-submit" disabled={busy} type="submit">{busy?'Please wait…':register?'Create account':'Sign in'}<ArrowRight size={17}/></button>
        {registrationAllowed&&!LOCAL?<p className="login-help">{register?'Already have an account? ':'New to SmartMed? '}<button className="text-button" type="button" disabled={busy} onClick={()=>{setRegister(!register);setError('');}}>{register?'Sign in':'Create an account'}</button></p>:<p className="login-help">Need account access? Please contact your caregiver.</p>}
      </form>}
      {LOCAL&&<div className="local-access"><button className="secondary" disabled={busy} onClick={()=>{setError('');setLocalAccess(true);}}>Continue on this device<ArrowRight size={16}/></button><p>No account required. Your schedule stays in this browser.</p></div>}
      {!LOCAL&&!checking&&error&&<button className="text-button session-retry" onClick={checkSession}>Try checking your session again</button>}
    </div></main>
  </div>;
}
