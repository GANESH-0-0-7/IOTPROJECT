import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readConfig} from './config.js';
import {createPool,transaction} from './db.js';
export async function migrate(pool){
  await transaction(pool,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(731457001)');
    await c.query('CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const folder=new URL('./migrations/',import.meta.url);
    for(const name of (await readdir(folder)).filter(f=>f.endsWith('.sql')).sort()){
      const sql=await readFile(new URL(name,folder),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
      const prior=(await c.query('SELECT checksum FROM migrations WHERE name=$1',[name])).rows[0];
      if(prior){if(prior.checksum!==checksum)throw new Error('An applied migration changed. Add a new migration instead.');continue;}
      await c.query(sql);await c.query('INSERT INTO migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
    }
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const pool=createPool(readConfig().DATABASE_URL);
  try{await migrate(pool);console.log('Database migrations applied.');}catch{console.error('Migration failed. Verify PostgreSQL connectivity and migration history.');process.exitCode=1;}finally{await pool.end();}
}
