import 'dotenv/config';
import {z} from 'zod';
const schema=z.object({
  DATABASE_URL:z.string().min(1),
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  PORT:z.coerce.number().int().min(1).max(65535).default(3001),
  HOST:z.string().default('127.0.0.1'),
  APP_ORIGIN:z.url().default('http://localhost:5173'),
  ALLOW_REGISTRATION:z.enum(['true','false']).default('false'),
  TRUST_PROXY:z.enum(['0','1']).default('0'),
});
export function readConfig(env=process.env){
  const parsed=schema.safeParse(env);
  if(!parsed.success)throw new Error('Invalid server settings. Check DATABASE_URL, APP_ORIGIN, PORT, and environment options.');
  const c=parsed.data;
  if(c.NODE_ENV==='production'&&!c.APP_ORIGIN.startsWith('https://'))throw new Error('Production APP_ORIGIN must use HTTPS.');
  return {...c,registration:c.ALLOW_REGISTRATION==='true',production:c.NODE_ENV==='production',origin:new URL(c.APP_ORIGIN).origin};
}
