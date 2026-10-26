import {terminal,hidden} from './terminal.mjs';
import {readConfig} from '../server/config.js';
import {createPool,transaction} from '../server/db.js';
import {hashPassword} from '../server/security.js';
import {email as emailSchema,password as passwordSchema} from '../server/schemas.js';
// Operator-only recovery through database access. This does not bypass browser authentication.
let pool;
try{
  const email=emailSchema.parse((await terminal.question('Patient email to reset: ')).trim());
  const password=passwordSchema.parse(await hidden('New password (12+ characters, hidden): '));
  pool=createPool(readConfig().DATABASE_URL);
  await transaction(pool,async c=>{
    const result=await c.query('UPDATE patients SET password_hash=$2 WHERE email=$1 RETURNING id',[email,await hashPassword(password)]);
    if(!result.rowCount)throw new Error('Account not found.');
    await c.query('DELETE FROM sessions WHERE patient_id=$1',[result.rows[0].id]);
  });
  console.log('Password changed. All existing sessions for that patient were invalidated.');
}catch{console.error('Reset failed. Verify the email, password length, and database access.');process.exitCode=1;}
finally{terminal.close();await pool?.end();}
