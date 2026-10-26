import {randomBytes,createHash,scrypt as rawScrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(rawScrypt);
export const randomToken=()=>randomBytes(32).toString('base64url');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function equal(a,b){return typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export async function hashPassword(password){const salt=randomBytes(16).toString('hex');const derived=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return `scrypt$${salt}$${derived.toString('hex')}`;}
export async function verifyPassword(password,encoded){const [,salt,expected]=encoded.split('$');if(!salt||!expected)return false;const derived=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return equal(derived.toString('hex'),expected);}
export class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
export async function throttle(pool,key,limit,minutes){
  const bucket=Math.floor(Date.now()/(minutes*60000));
  const result=await pool.query(`INSERT INTO auth_limits(key,attempts,expires_at) VALUES($1,1,now()+($2*interval '1 minute')) ON CONFLICT(key) DO UPDATE SET attempts=auth_limits.attempts+1 RETURNING attempts`,[digest(key+':'+bucket),minutes*2]);
  if(result.rows[0].attempts>limit)throw new HttpError(429,'Too many attempts. Please wait and try again.');
}
