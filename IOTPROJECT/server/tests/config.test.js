import test from 'node:test';
import assert from 'node:assert/strict';
import {createPool} from '../db.js';
import {readConfig} from '../config.js';
test('production requires HTTPS and registration is disabled unless explicitly enabled',()=>{
 const env={DATABASE_URL:'postgresql://localhost/smartmed',NODE_ENV:'production',APP_ORIGIN:'http://localhost'};
 assert.throws(()=>readConfig(env),/HTTPS/);
 const config=readConfig({...env,APP_ORIGIN:'https://smartmed.example'});assert.equal(config.registration,false);assert.equal(config.production,true);
});
test('PostgreSQL require mode keeps verification enabled and no-verify is rejected',async()=>{
 const pool=createPool('postgresql://localhost/smartmed?sslmode=require');assert.equal(pool.options.ssl.rejectUnauthorized,true);await pool.end();
 assert.throws(()=>createPool('postgresql://localhost/smartmed?sslmode=no-verify'),/verified/);
});
