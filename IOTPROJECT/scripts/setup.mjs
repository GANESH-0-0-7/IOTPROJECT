import {existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
const password=randomBytes(24).toString('hex');
if(!existsSync('.env')) {
  writeFileSync('.env',`PORT=3001\nHOST=127.0.0.1\nAPP_ORIGIN=http://localhost:5173\nPOSTGRES_PORT=5433\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://smartmed:${password}@127.0.0.1:5433/smartmed\nALLOW_REGISTRATION=true\n`,{mode:0o600,flag:'wx'});
  console.log('Created private .env with a generated database password.');
} else console.log('Kept existing .env.');
if(!existsSync('.env.local')) {writeFileSync('.env.local','VITE_DATA_MODE=live\nVITE_API_BASE_URL=/api/v1\n',{flag:'wx'});console.log('Configured the frontend for the real API.');}
else console.log('Kept existing .env.local; ensure VITE_DATA_MODE=live to use the backend.');
console.log('Next: docker compose up -d --wait db, npm run db:migrate, npm run dev.');
