# 2. Integrate the web app with the microcontroller

The Express API is implemented in `server/`, backed by PostgreSQL. The firmware starter is in `firmware/SmartMed/`. The web interface has Today (four visible sections with medicine editing) and History; hardware provisioning and calibration stay in operator tooling.

```text
React dashboard <-- HTTPS --> Express API + PostgreSQL <-- HTTPS / Wi-Fi --> ESP32
                                                                            |
                                                     one lid sensor + four LEDs + one buzzer
```

The one ultrasonic sensor reports whole-box OPENED/CLOSED events, never medicine selection or intake. A caregiver fills the four labelled sections daily. See [Hardware connections](03_HARDWARE_CONNECTIONS.md) and [System architecture](04_SYSTEM_ARCHITECTURE.md).

## 1. Start the real services

Follow [Run the application](01_RUN_APPLICATION.md), create your real patient account, and add the prescribed schedule. Development uses a same-origin Vite proxy to Express; production Express serves the built app directly. `.env.local` contains only public frontend configuration:

```dotenv
VITE_DATA_MODE=live
VITE_API_BASE_URL=/api/v1
```

Server `.env` holds the database URL and origin; firmware `include/secrets.h` holds Wi-Fi/device credentials. Both are ignored by Git. Never place them in `VITE_*` values.

## 2. Provision and calibrate the box

With the web/API running, in another terminal:

```sh
npm run device:provision
```

Enter your patient email and password at the prompts. The password is hidden. The command signs in through the real API and prints a **device ID and token once** for controlled provisioning. Store them securely in the ignored firmware `secrets.h`. The database stores only a hash of the token. One box is supported per patient.

A newly provisioned device is **uncalibrated**. Do not operate it as a reliable medicine monitor until testing the actual enclosure. To save measured calibration, create an untracked JSON file with these fields:

```text
closedBaselineCm: measured closed-lid distance, in cm
openThresholdCm: measured increase above baseline that reliably indicates opening
closeThresholdCm: a lower increase threshold that reliably indicates closed
stabilityMs: required duration of stable valid readings
```

The file must be valid JSON with numeric values, no comments, and `openThresholdCm > closeThresholdCm`. The baseline must be at least 2 cm and within sensor range; baseline plus opening threshold must not exceed 400 cm. These constraints do not establish that your enclosure works—measure and test it.

```sh
npm run device:provision -- --device-id YOUR_DEVICE_ID --calibration PATH_TO_YOUR_JSON
```

To provision a new device with calibration, omit `--device-id` and optionally add `--label "Medicine box"`. Configuration is versioned and firmware reports its applied version.

Rotate or revoke the credential:

```sh
npm run device:provision -- --device-id YOUR_DEVICE_ID --rotate
npm run device:provision -- --device-id YOUR_DEVICE_ID --revoke
```

Rotation invalidates the old token. Revocation stops device API access; history remains. To replace a physical box, rotate the existing device's token and provision that identity on the replacement. Device IDs alone never grant access.

## 3. Configure and build the ESP32 starter

Install PlatformIO, for example the PlatformIO IDE extension for VS Code. Open `firmware/SmartMed`. Copy `include/secrets.example.h` to `include/secrets.h` and set your real:

- 2.4 GHz Wi-Fi SSID and password.
- Public/reachable HTTPS API base URL ending in `/api/v1`.
- Provisioned device ID and token.
- PEM root CA that validates the HTTPS server.
- `USE_RTC=true` only if the optional DS3231 is wired.

Firmware deliberately refuses HTTP or an empty CA and never calls `setInsecure()`. A development server on a private cloud address is not reachable from home Wi-Fi. Provide a properly reachable TLS endpoint or trusted local TLS proxy; do not disable verification to work around this.

From that project folder:

```sh
pio run
pio run -t upload
pio run -t buildfs
pio run -t uploadfs
pio device monitor
```

Initialize the LittleFS image **only for first-time provisioning**. Re-uploading the filesystem erases persisted events, cached schedules, and access acknowledgments. Do not do that as a routine firmware upgrade. On storage corruption the starter stops rather than silently formatting or discarding records. Preserve/recover the storage before continuing.

The starter targets the classic ESP32-WROOM-32 pin map in the wiring guide. It uses ArduinoJson, RTClib, Wi-Fi HTTPS, LittleFS, and separate sensing/network tasks. It includes scheduled LED/buzzer output, persistent reminder cache, shared-lid transition events, upload retries, heartbeat, and a bounded 64-event queue. Queue/storage faults make monitoring unreliable and must be resolved, not interpreted as missed medication. Validate power-loss behavior and queue capacity for your intended offline duration.

**Verification status:** web/API/PostgreSQL integration is exercised with real services. Firmware compilation in the cloud environment was blocked by registry access to `api.registry.platformio.org` and `dl.registry.platformio.org`. The starter is not yet compile-verified or tested on a physical board. Run `pio run` locally and complete the hardware acceptance checks before use.

## 4. Firmware API contract

All routes are under `/api/v1/devices/{deviceId}` and require `Authorization: Bearer YOUR_DEVICE_TOKEN`. Device routes do not accept browser sessions as device credentials.

| Method and suffix | Implemented behavior |
| --- | --- |
| `GET /config` | Measured calibration or `calibrated:false`, pin mapping, repeat interval, timezone, server time, configuration/schedule versions |
| `GET /reminders` | Complete versioned snapshot covering the current reminder window and next 48 hours |
| `POST /events` | Atomic, deduplicated batch upload; acknowledges only committed IDs |
| `POST /heartbeat` | Stores current health/readings/output/version telemetry and server receipt time |

Reminders have stable IDs for a patient/date/slot/schedule version, with UTC `scheduledAt` and `windowEndsAt`. A schedule edit produces a new version; firmware replaces the cached future snapshot. It must not continue an expired schedule or use mismatched configuration/schedule versions. Ambiguous/faulty local clocks must not generate invented timestamps.

A versioned configuration includes `sensor` with calibration, `calibrated`, `pins`, `repeatReminderMinutes`, `followUpMinutes`, and `scheduleVersion`. One slot maps to one LED, not a sensor channel. Calibrating sensors belongs outside the patient dashboard.

### Upload shape

```json
{
  "events": [
    {
      "eventId": "a-device-generated-unique-id",
      "deviceId": "the-provisioned-device-uuid",
      "type": "BOX_OPENED",
      "occurredAt": "2027-01-15T02:34:00Z",
      "sequence": 1042,
      "timeQuality": "RTC_SYNCED",
      "sensorType": "ULTRASONIC",
      "distanceCm": 14.1
    }
  ]
}
```

This illustrates the format only; replace it with actual measurements and timestamps. The device ID must be the provisioned UUID. `type` is `BOX_OPENED` or `BOX_CLOSED`; clock quality is `RTC_SYNCED`, `NTP_SYNCED`, or `SYNCED`. Invalid echo distance may be null. Upload at most 100 events per request. Events can be at most 30 days old, cannot predate provisioning by more than two minutes, and cannot be over two minutes in the future. Bad clocks or rejected events require diagnosis; do not change original event IDs/timestamps merely to make retries pass.

Successful response:

```json
{"acknowledgedEventIds":["a-device-generated-unique-id"]}
```

A unique `(device_id,event_id)` constraint prevents duplicates. Identical retries are acknowledged again; the same ID with different normalized content returns HTTP 409 and rolls back the entire batch. Delete local events only after acknowledgment. SQL transactions preserve all-or-nothing batch writes.

For an opening inside a valid historical reminder window, the backend attaches timing context using the schedule version active at occurrence time. It preserves that context after later prescription edits. There is no detected compartment ID and no TAKEN flag.

Heartbeat JSON fields:

```text
firmwareVersion: string
appliedConfigVersion, appliedScheduleVersion: nonnegative integers
clockHealthy, sensorHealthy, buzzerActive: booleans
queueDepth, lastSequence: nonnegative integers
lidState: OPEN | CLOSED | UNKNOWN
distanceCm: number or null
ledSlotId: morning | afternoon | evening | night | null
```

Send heartbeats about every 30 seconds. The app displays connected only for a recent heartbeat (under 90 seconds); heartbeat receipt is not proof that no events were lost during an earlier offline period.

## 5. Browser API contract

Browser requests use HttpOnly session cookies, not device tokens. Mutations require the exact allowed `Origin` and session-bound `X-CSRF-Token`.

| Endpoint under `/api/v1` | Behavior |
| --- | --- |
| `GET /auth/session` | Anonymous/patient session, CSRF token, registration availability |
| `POST /auth/register` | Creates a real empty patient account if registration is enabled |
| `POST /auth/login` | Verifies the password hash; rotates the session and CSRF token |
| `POST /auth/logout` | Invalidates the server session and expires its cookie |
| `GET /workspace` | Patient-scoped slots, medicines, real events, device summary, next history cursor |
| `POST /medicines` | Atomically creates a medicine and applies its shared slot time |
| `PATCH /medicines/{id}` | Atomically edits the patient's medicine and shared slot time |
| `DELETE /medicines/{id}` | Removes only that patient's entry, retaining event history |
| `PUT /slots` | Validates and updates all four slot times |
| `GET /events?cursor=...` | Patient-scoped cursor pagination, 100 records per page |
| `POST /devices` | Patient-authenticated operator provisioning; returns one-time token |
| `PATCH /devices/{id}/config` | Saves measured calibration with a new version |
| `POST /devices/{id}/rotate-token` | Replaces the device token |
| `DELETE /devices/{id}` | Revokes the device credential |

Registration accepts `displayName`, `email`, `password` (12–128 characters), and real IANA `timezone`. Login accepts `email` and `password`. Session/login/registration responses include `{user:{id,displayName,role:"PATIENT"},csrfToken}`; anonymous session has `user:null`. Tokens/passwords are never stored in browser localStorage. Session IDs are hashed in PostgreSQL; passwords use salted scrypt. Login/registration are rate-limited and sessions expire server-side.

Medicine mutations contain `name`, `strength`, `quantity`, optional `instructions`, `slotId`, `reminderTime` (`HH:mm`), and `id` on edits. Slots are the four fixed daily IDs. Several medicines can share one slot. All medicines in that slot use the same time. Empty slots may have null times; populated slots may not. The server rejects overlapping reminder windows and scopes every query to the authenticated patient.

The workspace matches `src/model.js`: `slots`, `medicines`, `events`, `settings:{timezone,grace}`, and `device` or null. Events have `id`, `type`, UTC `occurredAt`, and optional `reminderContext`. The frontend loads older history with cursors and exports loaded records only.

## 6. Acceptance checks

1. Create two real test accounts; verify schedules and history are isolated.
2. Pair a device, configure measured calibration, and download its stable reminder snapshot.
3. Verify physical closed/open detection without false events from no echo, restart, or medicine packaging.
4. Confirm **physical opening → committed backend record → web History**, within the web polling interval.
5. Retry an identical upload and verify one record; reuse an ID with changed data and verify rejection.
6. Disconnect Wi-Fi, generate events, restart without erasing LittleFS, reconnect, and verify queued delivery.
7. Check the correct LED and one shared buzzer, an expired schedule, invalid time, and an already-open lid at boot.
8. Rotate/revoke a token and confirm the old credential fails.

Backend protocol tests cannot establish reliable physical sensing or confirm medicine intake. Do the enclosure/power/calibration checks in [Hardware connections](03_HARDWARE_CONNECTIONS.md).
