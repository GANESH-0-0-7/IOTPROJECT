import 'dotenv/config';
import {terminal as rl,hidden as secret} from './terminal.mjs';
import {readFile} from 'node:fs/promises';
// Run locally: token is printed ONCE for the operator, never written to tracked files.
const origin=process.env.APP_ORIGIN||'http://localhost:5173';
const base=new URL('/api/v1/',origin).href;
const args=process.argv.slice(2),flag=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
let cookie='',csrf='';
async function call(route,method='GET',body){
  const res=await fetch(base+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const setCookie=res.headers.getSetCookie();if(setCookie.length)cookie=setCookie.map(c=>c.split(';')[0]).join('; ');
  if(!res.ok)throw new Error('Device operation failed. Check your account, configuration, and API response status '+res.status+'.');
  if(res.status===204)return null;const data=await res.json();if(data.csrfToken)csrf=data.csrfToken;return data;
}
try{
  const email=await rl.question('Patient account email: ');
  const label=flag('--label')||'Medicine box';
  const calibrationFile=flag('--calibration');
  const calibration=calibrationFile?JSON.parse(await readFile(calibrationFile,'utf8')):undefined;
  const password=await secret('Password (hidden): ');
  await call('auth/session');await call('auth/login','POST',{email,password});
  const id=flag('--device-id');let result;
  if(args.includes('--revoke')){if(!id)throw new Error('--device-id is required.');await call('devices/'+encodeURIComponent(id),'DELETE');console.log('Device revoked.');}
  else if(args.includes('--rotate')){if(!id)throw new Error('--device-id is required.');result=await call('devices/'+encodeURIComponent(id)+'/rotate-token','POST',{});}
  else if(id&&calibration){await call('devices/'+encodeURIComponent(id)+'/config','PATCH',{calibration});console.log('Calibration saved; device will download it on the next poll.');}
  else result=await call('devices','POST',{label,...(calibration?{calibration}:{})});
  if(result)console.log('Store securely in the untracked firmware secrets file. This credential is shown once:\n'+JSON.stringify(result,null,2));
} catch(e){console.error(e.message);process.exitCode=1;}finally{if(cookie)await call('auth/logout','POST',{}).catch(()=>{});rl.close();}
