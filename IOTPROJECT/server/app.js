import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {DateTime} from 'luxon';
import {z,ZodError} from 'zod';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {transaction} from './db.js';
import {randomToken,digest,equal,hashPassword,verifyPassword,HttpError,throttle} from './security.js';
import * as schemas from './schemas.js';
import {snapshot,newScheduleVersion,associateEvent,reminderSnapshot,defaultDeviceConfig,newId} from './schedules.js';
const COOKIE='smartmed_session';
const publicUser=p=>({id:p.id,displayName:p.display_name,role:'PATIENT'});
const uuid=value=>z.uuid().parse(value);
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);

export async function createApp({pool,config}){
  const app=express();
  if(config.TRUST_PROXY==='1')app.set('trust proxy',1);
  app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy:{directives:{'style-src':["'self'","https://fonts.googleapis.com"],'font-src':["'self'","https://fonts.gstatic.com"],'upgrade-insecure-requests':config.production?[]:null}}}));
  app.use('/api',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Too many requests. Please try again shortly.'}}));
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
  app.use(express.json({limit:'128kb',type:'application/json'}));app.use(cookieParser());
  const cookieOptions={httpOnly:true,secure:config.production,sameSite:'lax',path:'/api'};
  const dummyHash=await hashPassword(randomToken());
  async function session(req){
    const token=req.cookies[COOKIE];if(typeof token!=='string'||token.length>128)return null;
    return (await pool.query('SELECT s.*,p.email,p.display_name FROM sessions s LEFT JOIN patients p ON p.id=s.patient_id WHERE token_hash=$1 AND expires_at>now()',[digest(token)])).rows[0]||null;
  }
  async function makeSession(res,patientId,old){
    const token=randomToken(),csrf=randomToken(),seconds=patientId?86400:3600;
    await transaction(pool,async c=>{
      if(old)await c.query('DELETE FROM sessions WHERE token_hash=$1',[old.token_hash]);
      await c.query("INSERT INTO sessions(token_hash,patient_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+($4*interval '1 second'))",[digest(token),patientId,csrf,seconds]);
    });
    res.cookie(COOKIE,token,{...cookieOptions,maxAge:seconds*1000});return csrf;
  }
  const browserSession=asyncRoute(async(req,res,next)=>{req.authSession=await session(req);next();});
  const csrf=asyncRoute(async(req,res,next)=>{
    if(req.get('origin')!==config.origin)throw new HttpError(403,'Request origin is not allowed.');
    if(!req.authSession||!equal(req.get('x-csrf-token'),req.authSession.csrf_token))throw new HttpError(403,'Your session could not be verified. Refresh and try again.');
    next();
  });
  const patient=asyncRoute(async(req,res,next)=>{
    if(!req.authSession?.patient_id)throw new HttpError(401,'Please sign in.');req.patientId=req.authSession.patient_id;next();
  });
  app.get('/api/v1/health',asyncRoute(async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok'});}));
  app.get('/api/v1/auth/session',browserSession,asyncRoute(async(req,res)=>{
    let csrfToken=req.authSession?.csrf_token;
    if(!csrfToken)csrfToken=await makeSession(res,null,null);
    res.json({user:req.authSession?.patient_id?{id:req.authSession.patient_id,displayName:req.authSession.display_name,role:'PATIENT'}:null,csrfToken,registrationEnabled:config.registration});
  }));
  app.post('/api/v1/auth/register',browserSession,csrf,asyncRoute(async(req,res)=>{
    if(!config.registration)throw new HttpError(403,'Account creation is not enabled. Contact your caregiver.');
    await throttle(pool,'register:'+req.ip,10,15);
    const data=schemas.registration.parse(req.body),passwordHash=await hashPassword(data.password);
    const p=await transaction(pool,async c=>{
      const row=(await c.query('INSERT INTO patients(id,email,display_name,password_hash,timezone) VALUES($1,$2,$3,$4,$5) RETURNING *',[newId(),data.email,data.displayName,passwordHash,data.timezone])).rows[0];
      for(const [id,label] of [['morning','Morning'],['afternoon','Afternoon'],['evening','Evening'],['night','Night']])await c.query('INSERT INTO slots(patient_id,id,label) VALUES($1,$2,$3)',[row.id,id,label]);
      await newScheduleVersion(c,row,true);return row;
    });
    const csrfToken=await makeSession(res,p.id,req.authSession);res.status(201).json({user:publicUser(p),csrfToken});
  }));
  app.post('/api/v1/auth/login',browserSession,csrf,asyncRoute(async(req,res)=>{
    const data=schemas.login.parse(req.body);
    await throttle(pool,'login-ip:'+req.ip,50,15);await throttle(pool,'login-email:'+data.email,15,15);
    const p=(await pool.query('SELECT * FROM patients WHERE email=$1',[data.email])).rows[0];
    const valid=await verifyPassword(data.password,p?.password_hash||dummyHash);
    if(!p||!valid)throw new HttpError(401,'The email or password is incorrect.');
    const csrfToken=await makeSession(res,p.id,req.authSession);res.json({user:publicUser(p),csrfToken});
  }));
  app.post('/api/v1/auth/logout',browserSession,csrf,asyncRoute(async(req,res)=>{
    await pool.query('DELETE FROM sessions WHERE token_hash=$1',[req.authSession.token_hash]);res.clearCookie(COOKIE,cookieOptions).status(204).end();
  }));
  const browser=express.Router();browser.use(browserSession,patient);
  browser.use((req,res,next)=>['GET','HEAD','OPTIONS'].includes(req.method)?next():csrf(req,res,next));
  async function eventsPage(patientId,cursor,limit=100){
    let before=null;
    if(cursor){try{const data=JSON.parse(Buffer.from(String(cursor),'base64url').toString());before={time:z.iso.datetime({offset:true}).parse(data.time),id:uuid(data.id)};}catch{throw new HttpError(400,'Invalid history cursor.');}}
    const rows=(await pool.query(`SELECT id,type,occurred_at,reminder_context FROM box_events WHERE patient_id=$1 ${before?'AND (occurred_at,id)<($3::timestamptz,$4::uuid)':''} ORDER BY occurred_at DESC,id DESC LIMIT $2`,before?[patientId,limit+1,before.time,before.id]:[patientId,limit+1])).rows;
    const hasMore=rows.length>limit,items=rows.slice(0,limit);
    const last=items.at(-1);return {events:items.map(e=>({id:e.id,type:e.type,occurredAt:e.occurred_at.toISOString(),reminderContext:e.reminder_context})),nextCursor:hasMore?Buffer.from(JSON.stringify({time:last.occurred_at.toISOString(),id:last.id})).toString('base64url'):null};
  }
  browser.get('/workspace',asyncRoute(async(req,res)=>{
    const w=await transaction(pool,async c=>{
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const p=(await c.query('SELECT * FROM patients WHERE id=$1',[req.patientId])).rows[0];return snapshot(c,p);
    });
    const device=(await pool.query('SELECT id,last_seen FROM devices WHERE patient_id=$1 AND revoked_at IS NULL',[req.patientId])).rows[0];
    const history=await eventsPage(req.patientId);
    res.json({...w,...history,device:device?{id:device.id,online:device.last_seen?Date.now()-device.last_seen.getTime()<90000:false,lastSeen:device.last_seen?.toISOString()||null}:null});
  }));
  browser.get('/events',asyncRoute(async(req,res)=>res.json(await eventsPage(req.patientId,req.query.cursor))));
  async function scheduleChange(patientId,fn){return transaction(pool,async c=>{
    const p=(await c.query('SELECT * FROM patients WHERE id=$1 FOR UPDATE',[patientId])).rows[0];
    const value=await fn(c,p);await newScheduleVersion(c,p);return value;
  });}
  browser.post('/medicines',asyncRoute(async(req,res)=>{
    const data=schemas.medicine.parse(req.body);if(data.id)throw new HttpError(400,'New medicines must not supply an ID.');
    const id=newId();await scheduleChange(req.patientId,async c=>{
      await c.query('UPDATE slots SET time=$3 WHERE patient_id=$1 AND id=$2',[req.patientId,data.slotId,data.reminderTime]);
      await c.query('INSERT INTO medicines(id,patient_id,slot_id,name,strength,quantity,instructions) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,req.patientId,data.slotId,data.name,data.strength,data.quantity,data.instructions]);
    });res.status(201).json({id});
  }));
  browser.patch('/medicines/:id',asyncRoute(async(req,res)=>{
    const id=uuid(req.params.id),data=schemas.medicine.parse(req.body);if(data.id&&data.id!==id)throw new HttpError(400,'Medicine identity does not match.');
    await scheduleChange(req.patientId,async c=>{
      const result=await c.query('UPDATE medicines SET slot_id=$3,name=$4,strength=$5,quantity=$6,instructions=$7 WHERE id=$1 AND patient_id=$2',[id,req.patientId,data.slotId,data.name,data.strength,data.quantity,data.instructions]);
      if(!result.rowCount)throw new HttpError(404,'Medicine not found.');
      await c.query('UPDATE slots SET time=$3 WHERE patient_id=$1 AND id=$2',[req.patientId,data.slotId,data.reminderTime]);
    });res.status(204).end();
  }));
  browser.delete('/medicines/:id',asyncRoute(async(req,res)=>{
    await scheduleChange(req.patientId,async c=>{const result=await c.query('DELETE FROM medicines WHERE id=$1 AND patient_id=$2',[uuid(req.params.id),req.patientId]);if(!result.rowCount)throw new HttpError(404,'Medicine not found.');});res.status(204).end();
  }));
  browser.put('/slots',asyncRoute(async(req,res)=>{
    const data=schemas.slotsBody.parse(req.body);
    await scheduleChange(req.patientId,async c=>{
      if(new Set(data.slots.map(s=>s.id)).size!==4)throw new HttpError(400,'Supply all four distinct slots.');
      for(const slot of data.slots)await c.query('UPDATE slots SET time=$3 WHERE patient_id=$1 AND id=$2',[req.patientId,slot.id,slot.time]);
    });res.status(204).end();
  }));
  browser.post('/devices',asyncRoute(async(req,res)=>{
    const data=schemas.deviceCreate.parse(req.body),id=newId(),token=randomToken();
    await pool.query('INSERT INTO devices(id,patient_id,label,token_hash,config) VALUES($1,$2,$3,$4,$5)',[id,req.patientId,data.label,digest(token),JSON.stringify(defaultDeviceConfig(data.calibration))]);
    res.status(201).json({deviceId:id,deviceToken:token});
  }));
  browser.patch('/devices/:id/config',asyncRoute(async(req,res)=>{
    const data=schemas.deviceUpdate.parse(req.body);
    const result=await pool.query('UPDATE devices SET config=$3,config_version=config_version+1 WHERE id=$1 AND patient_id=$2 AND revoked_at IS NULL',[uuid(req.params.id),req.patientId,JSON.stringify(defaultDeviceConfig(data.calibration))]);
    if(!result.rowCount)throw new HttpError(404,'Device not found.');res.status(204).end();
  }));
  browser.post('/devices/:id/rotate-token',asyncRoute(async(req,res)=>{
    const token=randomToken();const result=await pool.query('UPDATE devices SET token_hash=$3,revoked_at=NULL WHERE id=$1 AND patient_id=$2 RETURNING id',[uuid(req.params.id),req.patientId,digest(token)]);
    if(!result.rowCount)throw new HttpError(404,'Device not found.');res.json({deviceId:req.params.id,deviceToken:token});
  }));
  browser.delete('/devices/:id',asyncRoute(async(req,res)=>{
    const result=await pool.query('UPDATE devices SET revoked_at=now() WHERE id=$1 AND patient_id=$2',[uuid(req.params.id),req.patientId]);if(!result.rowCount)throw new HttpError(404,'Device not found.');res.status(204).end();
  }));
  // Browser authentication and device authentication are deliberately separate routers.
  const device=express.Router();
  const deviceAuth=asyncRoute(async(req,res,next)=>{
    const id=uuid(req.params.id),header=req.get('authorization')||'';
    if(!/^Bearer [A-Za-z0-9_-]{43}$/.test(header))throw new HttpError(401,'Device authentication required.');
    const row=(await pool.query('SELECT * FROM devices WHERE id=$1 AND token_hash=$2 AND revoked_at IS NULL',[id,digest(header.slice(7))])).rows[0];
    if(!row)throw new HttpError(401,'Device authentication failed.');req.device=row;next();
  });
  device.get('/:id/config',deviceAuth,asyncRoute(async(req,res)=>{
    const p=(await pool.query('SELECT timezone,grace,schedule_version FROM patients WHERE id=$1',[req.device.patient_id])).rows[0];
    res.json({deviceId:req.device.id,version:req.device.config_version,timezone:p.timezone,followUpMinutes:p.grace,scheduleVersion:p.schedule_version,...req.device.config,serverTime:new Date().toISOString()});
  }));
  device.get('/:id/reminders',deviceAuth,asyncRoute(async(req,res)=>{
    const from=req.query.from?DateTime.fromISO(z.iso.datetime({offset:true}).parse(req.query.from)):DateTime.utc().minus({minutes:180});
    const to=req.query.to?DateTime.fromISO(z.iso.datetime({offset:true}).parse(req.query.to)):DateTime.utc().plus({hours:48});
    const now=Date.now();if(to<=from||to.toMillis()-from.toMillis()>7*86400000||from.toMillis()<now-86400000||to.toMillis()>now+7*86400000)throw new HttpError(400,'Request a reminder horizon within the past day and next seven days.');
    const result=await transaction(pool,async c=>{
      const p=(await c.query('SELECT * FROM patients WHERE id=$1 FOR SHARE',[req.device.patient_id])).rows[0];return reminderSnapshot(c,p,from,to);
    });res.json(result);
  }));
  device.post('/:id/events',deviceAuth,asyncRoute(async(req,res)=>{
    const data=schemas.eventsBody.parse(req.body),ack=[];
    await transaction(pool,async c=>{
      for(const event of data.events){
        if(event.deviceId!==req.device.id)throw new HttpError(403,'Device identity mismatch.');
        const occurred=Date.parse(event.occurredAt),now=Date.now();
        if(occurred>now+120000||occurred<now-30*86400000||occurred<req.device.created_at.getTime()-120000)throw new HttpError(422,'Event timestamp is outside the accepted monitoring interval.');
        const payload={...event,occurredAt:new Date(occurred).toISOString()},hash=digest(JSON.stringify(payload));
        const context=await associateEvent(c,req.device.patient_id,payload);
        const inserted=await c.query('INSERT INTO box_events(id,device_id,patient_id,event_id,type,occurred_at,payload_hash,payload,reminder_context) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(device_id,event_id) DO NOTHING RETURNING id',[newId(),req.device.id,req.device.patient_id,event.eventId,event.type,payload.occurredAt,hash,JSON.stringify(payload),context?JSON.stringify(context):null]);
        if(!inserted.rowCount){const prior=(await c.query('SELECT payload_hash FROM box_events WHERE device_id=$1 AND event_id=$2',[req.device.id,event.eventId])).rows[0];if(prior.payload_hash!==hash)throw new HttpError(409,'Event ID was reused with a different payload.');}
        ack.push(event.eventId);
      }
    });res.json({acknowledgedEventIds:ack});
  }));
  device.post('/:id/heartbeat',deviceAuth,asyncRoute(async(req,res)=>{
    const data=schemas.heartbeat.parse(req.body);
    await pool.query('UPDATE devices SET last_seen=now(),heartbeat=$2 WHERE id=$1',[req.device.id,JSON.stringify(data)]);res.status(204).end();
  }));
  app.use('/api/v1/devices',device);app.use('/api/v1',browser);
  app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found.'}));
  if(config.production){const dist=fileURLToPath(new URL('../dist/',import.meta.url));app.use(express.static(dist,{index:false}));app.get('/{*path}',(req,res)=>res.sendFile(path.join(dist,'index.html')));}
  app.use((error,req,res,next)=>{
    if(error.type==='entity.parse.failed')return res.status(400).json({error:'Request body must be valid JSON.'});
    if(error.type==='entity.too.large')return res.status(413).json({error:'Request is too large.'});
    if(error instanceof ZodError)return res.status(400).json({error:'Some fields are invalid. Check your entries.'});
    if(error.code==='23505')return res.status(409).json({error:'An account or device with these details already exists.'});
    const status=error.status>=400&&error.status<600?error.status:500;
    if(status===500)console.error('Request failed:',error.code||error.name); // Never log request bodies, tokens, URLs, or database settings.
    res.status(status).json({error:status===500?'Something went wrong. Please try again.':error.message});
  });
  return app;
}
