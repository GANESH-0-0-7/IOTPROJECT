# SmartMed

A medicine schedule and box-access app for four daily sections—Morning, Afternoon, Evening, Night—under one shared lid. The user interface has a patient sign-in page and two dashboard pages: Today and History. Today shows four always-visible sections with medicine and reminder-time editing in place.

## Documentation

| Guide | Contents |
| --- | --- |
| [1. Run the application](docs/01_RUN_APPLICATION.md) | Laptop prerequisites, clone/install/start commands, updating, checks, and troubleshooting |
| [2. Integrate the web app with the microcontroller](docs/02_MICROCONTROLLER_INTEGRATION.md) | Express endpoints, provisioning, API payloads, firmware communication, event syncing, and security |
| [3. Hardware connections](docs/03_HARDWARE_CONNECTIONS.md) | Parts, ESP32 pins, sensor voltage protection, LEDs, buzzer, optional clock, and assembly checks |
| [4. System architecture](docs/04_SYSTEM_ARCHITECTURE.md) | System diagram, responsibilities, data flow, database tables, and implementation status |

The app now includes **Express and PostgreSQL**, real patient registration/login, persistent prescriptions/history, active-dashboard reminder popups, and authenticated ESP32 APIs. It starts with no users, medicines, or simulated records.

## Run the full app

Install Node.js 22+, Git, and Docker, then:

```sh
npm ci
npm run setup
docker compose up -d --wait db
npm run db:migrate
npm run dev
```

Open **http://localhost:5173** and choose **Create an account**. Full clone/update instructions are in guide 1. Setup generates private database credentials; never commit `.env` or the firmware's `secrets.h`.

Checks: `npm test`, `npm run test:server` (requires PostgreSQL), and `npm run build`.

An ESP32 starter and provisioning/recovery tools are included. Firmware compilation is currently unverified because the cloud network blocks PlatformIO registry downloads; physical wiring/calibration/testing is still required. No public deployment or email/SMS provider is configured. The one shared lid cannot verify which medicine was selected or taken.
