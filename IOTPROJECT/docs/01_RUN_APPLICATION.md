# 1. Run the application

SmartMed now includes a React frontend, Express backend, and PostgreSQL database. No default users, passwords, medicines, or box events are created.

## Prerequisites

Install:

- [Node.js LTS](https://nodejs.org/) 22 or later.
- [Git](https://git-scm.com/downloads).
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) on Windows/macOS, or Docker Engine with the Compose plugin on Linux. Start Docker before continuing.

Check in a new terminal:

```sh
node --version
npm --version
git --version
docker compose version
```

## First start

```sh
git clone https://github.com/Dhanush-singh-g/IOT-project.git
cd IOT-project
npm ci
npm run setup
docker compose up -d --wait db
npm run db:migrate
npm run dev
```

Open **http://localhost:5173** and keep the terminal running. Vite serves the frontend and proxies `/api` to Express on port 3001. Use `localhost`, matching `APP_ORIGIN`; do not substitute a different origin without changing configuration. Ports 5173, 3001, and 5433 must be available. The PostgreSQL container listens on port 5433 on the host and port 5432 inside Docker; if you change `POSTGRES_PORT`, update the port in `DATABASE_URL` to match.

`npm run setup` generates a random database password in private `.env`, and `.env.local` selects the real backend. Existing files are preserved. If upgrading from local-only mode, set `VITE_DATA_MODE=live` in `.env.local` and restart. Never commit these files or paste their credentials into chat. Local browser-only data is not automatically imported into PostgreSQL.

If you already cloned the repository, stop the old app and use `git pull --ff-only origin main` instead of cloning. Preserve any local source changes before pulling.

## Create your actual account

1. Choose **Create an account** on the patient sign-in page.
2. Enter your name, email, a password of at least 12 characters, and your actual schedule timezone. No email is sent by the current implementation.
3. Create your account; you are signed in to an empty schedule stored in PostgreSQL.
4. Add the medicines, quantities, instructions, and times from your prescription.
5. Sign out and back in, or reload, to verify persistence.

Development setup enables registration with `ALLOW_REGISTRATION=true`. Operators can disable new signups by setting it to `false` in `.env` and restarting the API. Existing accounts can still sign in. Accounts and schedules are isolated per patient.

## Test a medicine popup

Set a medicine's reminder time a minute or two ahead in the timezone shown on Today. Keep the dashboard visible and focused. The popup should appear within about five seconds of the scheduled time.

- **View medicines** opens that part of the day.
- **Remind me in 5 minutes** snoozes it.
- **Dismiss reminder** suppresses that dated slot/time reminder.

These actions do not record intake or fabricate box events. Reminders do not run while signed out, the tab is inactive, or the browser is closed. Physical alarms run on the ESP32 after hardware integration. Pending reminders may appear on returning within the follow-up window; old reminders are not replayed hours later.

History stays empty until an authenticated device sends real events. Developer protocol tests use temporary fixtures; the application never seeds those records.

## Stop, restart, and update

Stop the web/API processes with **Ctrl+C**. The PostgreSQL container and named volume retain data.

```sh
docker compose up -d --wait db
npm run dev
```

For an update:

```sh
git pull --ff-only origin main
npm ci
npm run setup
docker compose up -d --wait db
npm run db:migrate
npm run dev
```

Stop PostgreSQL with `docker compose stop db` if desired. **Do not use `docker compose down -v` as routine shutdown; it deletes the database volume.** Preserve `.env` alongside database backups so the configured credentials remain consistent.

## Checks and recovery

```sh
npm test
npm run test:server
npm run build
```

Server tests use real PostgreSQL in a temporary isolated schema and remove it afterward. They require database access and schema-creation permission; never run them against a production instance. `npm run db:migrate` is repeatable and refuses changed, already-applied migration files.

For a forgotten password, the operator with database access can run:

```sh
npm run account:reset
```

It prompts for email and a hidden new password, changes the password hash, and invalidates existing sessions. There is no email-based recovery flow yet.

| Problem | Action |
| --- | --- |
| Docker/database unavailable | Start Docker, then `docker compose up -d --wait db` |
| PostgreSQL authentication fails | Check that `.env` matches the existing database volume; changing its password does not change an existing PostgreSQL role |
| Account creation link absent | Verify `ALLOW_REGISTRATION=true`, API health, and `VITE_DATA_MODE=live`, then restart |
| CSRF/origin error | Open exactly `http://localhost:5173`; verify `APP_ORIGIN` and refresh the sign-in page |
| Port already in use | Stop the old app. Changing ports requires updating the frontend proxy and `APP_ORIGIN` consistently |
| PowerShell blocks `npm.ps1` | Use `npm.cmd` in place of `npm`, or Command Prompt; no execution-policy change is needed |
| Database schema unavailable | Run `npm run db:migrate` before starting the API |
| Old local data is missing | It remains in the old browser storage; the real account starts separately and does not silently import it |

## Production startup

Build with `npm run build`. Set `NODE_ENV=production`, a real HTTPS `APP_ORIGIN`, `HOST=0.0.0.0`, `PORT`, and the production `DATABASE_URL` through your deployment's secret settings; then run migrations and `npm start`. Express serves the built frontend and API on one origin. The runtime refuses a non-HTTPS production origin. Use a trusted reverse proxy for TLS and set `TRUST_PROXY=1` only when that proxy is actually present.

A multi-stage `Dockerfile` is included. On a corporate/intercepting build proxy, forward its supported proxy settings and supply its trusted PEM CA with BuildKit `--secret id=build_ca,src=PATH_TO_TRUSTED_CA`; never disable TLS checks. If BuildKit cannot resolve the configured proxy hostname, configure the builder DNS/host mapping for that existing proxy. Build with `docker build -t smartmed .`; provide runtime settings securely and a PostgreSQL host reachable from the container. `localhost` inside a container is not your laptop's PostgreSQL service. Run `npm run db:migrate` in the configured runtime before starting an upgraded application.

Use a dedicated least-privilege database application role, run migrations with the required migration privileges, and configure database backups, restricted network exposure, verified database TLS when applicable, and deployment monitoring. No public deployment, email/SMS provider, or physical-device certification is bundled. For hardware setup, continue with [Microcontroller integration](02_MICROCONTROLLER_INTEGRATION.md).
