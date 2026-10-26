// import {readConfig} from './config.js';
// import {createPool} from './db.js';
// import {createApp} from './app.js';

// const config = readConfig();
// const pool = createPool(config.DATABASE_URL);

// try {
//   await pool.query('SELECT 1 FROM patients LIMIT 1');
// } catch {
//   console.error('Database is not ready. Start PostgreSQL and run npm run db:migrate.');
//   await pool.end();
//   process.exit(1);
// }

// const app = await createApp({pool, config});

// const server = app.listen(config.PORT, config.HOST, () => {
//   console.log(`SmartMed API listening on port ${config.PORT}`);
  
//   // --- START THE HARDWARE MONITORING LOOP ---
//   startPillboxListener();
// });

// // --- BACKGROUND HARDWARE POLLING SERVICE ---
// function startPillboxListener() {
//   const ESP32_IP = "10.210.112.177"; // Your ESP32's current local IP address
//   console.log("Pillbox background monitoring service started...");

//   setInterval(async () => {
//     try {
//       // 1. Poll the ESP32 for current distance and lid status
//       const res = await fetch(`http://${ESP32_IP}/status`);
//       if (!res.ok) return;
      
//       const data = await res.json();

//       // 2. If the lid is opened, shut down the alert immediately from the server:
//       if (data.status === "OPENED") {
//         await fetch(`http://${ESP32_IP}/control?led=off&buzzer=OFF`);
//         console.log("Medication taken! Lights and buzzer turned off by server.");
        
//         // Optional: You can trigger your compliance database update query here
//       }
//     } catch (error) {
//       // Silently catches network drops if the ESP32 is temporarily rebooting or offline
//     }
//   }, 2000); // Polls every 2 seconds
// }

// const clean = setInterval(() => pool.query('DELETE FROM sessions WHERE expires_at<now(); DELETE FROM auth_limits WHERE expires_at<now()').catch(() => console.error('Session cleanup failed.')), 3600000);
// clean.unref();

// async function stop() {
//   clearInterval(clean);
//   server.close(async () => {
//     await pool.end();
//     process.exit(0);
//   });
//   setTimeout(() => process.exit(1), 10000).unref();
// }

// process.on('SIGINT', stop);
// process.on('SIGTERM', stop);

import {readConfig} from './config.js';
import {createPool} from './db.js';
import {createApp} from './app.js';

const config = readConfig();
const pool = createPool(config.DATABASE_URL);

try {
  await pool.query('SELECT 1 FROM patients LIMIT 1');
} catch {
  console.error('Database is not ready. Start PostgreSQL and run npm run db:migrate.');
  await pool.end();
  process.exit(1);
}

const app = await createApp({pool, config});

const server = app.listen(config.PORT, config.HOST, () => {
  console.log(`SmartMed API listening on port ${config.PORT}`);
  
  // --- START THE UNIFIED HARDWARE & SCHEDULER LOOP ---
  startPillboxAutomation();
});


// --- BACKGROUND AUTOMATION SERVICE ---
function startPillboxAutomation() {
  const ESP32_IP = "10.210.112.177"; // Your ESP32 local IP address
  console.log("Pillbox automation service started...");

  let lastCheckedMinute = "";
  let reminderActive = false;       
  let previousLidStatus = "CLOSED"; 

  setInterval(async () => {
    try {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const currentTime = `${hours}:${minutes}`; // e.g., "19:26"

      // 1. TIME-BASED SCHEDULER: Check the 'slots' table for matching reminder times
      if (currentTime !== lastCheckedMinute) {
        lastCheckedMinute = currentTime;
        console.log(`[AUTOMATION] Checking slots table for time: ${currentTime}`);
        
        try {
          const slotQuery = await pool.query(
            `SELECT * FROM slots WHERE time = $1`,
            [currentTime]
          );

          console.log(`[AUTOMATION] Found ${slotQuery.rows.length} matching slot(s) for ${currentTime}`);

          if (slotQuery.rows.length > 0) {
            const slot = slotQuery.rows[0];
            // Determine LED color based on slot type (morning slot vs evening/night slot)
            const ledType = (slot.id === 'morning') ? 'morning' : 'evening';
            
            console.log(`[SCHEDULE MATCH] Slot '${slot.id}' matched time ${currentTime}! Triggering ${ledType} alert.`);
            reminderActive = true; 
            
            // Turn on hardware alert (Buzzer + Correct LED)
            const hwRes = await fetch(`http://${ESP32_IP}/control?led=${ledType}&buzzer=ON`);
            console.log(`[HARDWARE] Response status:`, hwRes.status);
          }
        } catch (dbError) {
          console.error("[DATABASE ERROR]:", dbError.message);
        }
      }

      // 2. SENSOR MONITOR: Poll the ESP32 for current distance and lid status
      const res = await fetch(`http://${ESP32_IP}/status`);
      if (!res.ok) return;
      
      const data = await res.json();
      const currentStatus = data.status; // "CLOSED" or "OPENED"

      // 3. LID INTERACTION LOGIC
      if (reminderActive && previousLidStatus === "CLOSED" && currentStatus === "OPENED") {
        console.log("Medication taken! Lid opened, turning off lights and buzzer.");
        
        // Shut down hardware alert
        await fetch(`http://${ESP32_IP}/control?led=off&buzzer=OFF`);
        reminderActive = false;
      }

      previousLidStatus = currentStatus; 
    } catch (error) {
      console.error("[AUTOMATION LOOP ERROR]:", error.message);
    }
  }, 2000); 
}


const clean = setInterval(() => pool.query('DELETE FROM sessions WHERE expires_at<now(); DELETE FROM auth_limits WHERE expires_at<now()').catch(() => console.error('Session cleanup failed.')), 3600000);
clean.unref();

async function stop() {
  clearInterval(clean);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);