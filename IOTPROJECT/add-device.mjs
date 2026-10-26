import { readConfig } from './server/config.js';
import { createPool } from './server/db.js';
import { randomToken, digest } from './server/security.js';
import { defaultDeviceConfig, newId } from './server/schedules.js';

async function run() {
    const config = readConfig();
    const pool = createPool(config.DATABASE_URL);
    try {
        // Fetch your patient account from the database
        const patientRes = await pool.query('SELECT id, email FROM patients LIMIT 1');
        if (patientRes.rows.length === 0) {
            console.error('No patient accounts found in the database. Please sign up in the app first.');
            process.exit(1);
        }
        
        const patient = patientRes.rows[0];
        const deviceId = newId();
        const rawToken = randomToken();
        const tokenHash = digest(rawToken);
        const label = 'ESP32 Pillbox';

        // Insert the device directly into PostgreSQL
        await pool.query(
            'INSERT INTO devices(id, patient_id, label, token_hash, config) VALUES($1, $2, $3, $4, $5)',
            [deviceId, patient.id, label, tokenHash, JSON.stringify(defaultDeviceConfig())]
        );

        console.log('\n==================================================');
        console.log('✅ DEVICE CREATED SUCCESSFULLY!');
        console.log('Patient Email:', patient.email);
        console.log('--------------------------------------------------');
        console.log('Copy these exact values into your ESP32 main.cpp:');
        console.log('const char* deviceId = "' + deviceId + '";');
        console.log('const char* deviceToken = "' + rawToken + '";');
        console.log('==================================================\n');
    } catch (err) {
        console.error('Error creating device:', err);
    } finally {
        await pool.end();
    }
}

run();