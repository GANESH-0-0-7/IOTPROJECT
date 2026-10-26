import pg from 'pg';
import {readFileSync} from 'node:fs';
export function createPool(connectionString){
  let url;try{url=new URL(connectionString);}catch{throw new Error('DATABASE_URL must be a PostgreSQL connection URI.');}
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('DATABASE_URL must be a PostgreSQL connection URI.');
  const mode=url.searchParams.get('sslmode')||process.env.PGSSLMODE||'';
  if(mode&&!['disable','require','verify-ca','verify-full'].includes(mode))throw new Error('Use verified PostgreSQL TLS or an explicitly local/private non-TLS database.');
  const caFile=process.env.PGSSLROOTCERT||url.searchParams.get('sslrootcert');
  const enabled=Boolean(caFile)||['require','verify-ca','verify-full'].includes(mode)||url.searchParams.get('ssl')==='true';
  // Remove URI SSL switches so pg cannot override the verified TLS configuration.
  for(const key of ['ssl','sslmode','sslrootcert'])url.searchParams.delete(key);
  const ssl=enabled?{rejectUnauthorized:true,...(caFile?{ca:readFileSync(caFile,'utf8')}:{})}:false;
  return new pg.Pool({connectionString:url.toString(),ssl,max:10,connectionTimeoutMillis:5000,idleTimeoutMillis:30000});
}
export async function transaction(pool,fn){
  const client=await pool.connect();
  try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}
  catch(error){await client.query('ROLLBACK');throw error;}
  finally{client.release();}
}
