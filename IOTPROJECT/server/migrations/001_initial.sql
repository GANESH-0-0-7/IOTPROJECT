CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  display_name text NOT NULL,
  password_hash text NOT NULL,
  timezone text NOT NULL,
  grace integer NOT NULL DEFAULT 20 CHECK(grace BETWEEN 1 AND 180),
  schedule_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS slots (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  id text NOT NULL CHECK(id IN ('morning','afternoon','evening','night')),
  label text NOT NULL,
  time text CHECK(time IS NULL OR time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  PRIMARY KEY(patient_id,id)
);
CREATE TABLE IF NOT EXISTS medicines (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  slot_id text NOT NULL,
  name text NOT NULL,
  strength text NOT NULL,
  quantity text NOT NULL,
  instructions text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(patient_id,slot_id) REFERENCES slots(patient_id,id)
);
CREATE INDEX IF NOT EXISTS medicines_patient ON medicines(patient_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS auth_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_versions (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  version integer NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  snapshot jsonb NOT NULL,
  PRIMARY KEY(patient_id,version)
);
CREATE INDEX IF NOT EXISTS schedule_history ON schedule_versions(patient_id,valid_from,valid_until);
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL UNIQUE REFERENCES patients(id) ON DELETE CASCADE,
  label text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  config jsonb NOT NULL,
  config_version integer NOT NULL DEFAULT 1,
  last_seen timestamptz,
  heartbeat jsonb NOT NULL DEFAULT '{}',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY,
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  version integer NOT NULL,
  slot_id text NOT NULL,
  local_date date NOT NULL,
  scheduled_at timestamptz NOT NULL,
  window_ends_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL,
  UNIQUE(patient_id,version,slot_id,local_date),
  FOREIGN KEY(patient_id,version) REFERENCES schedule_versions(patient_id,version)
);
CREATE TABLE IF NOT EXISTS box_events (
  id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  event_id text NOT NULL,
  type text NOT NULL CHECK(type IN ('BOX_OPENED','BOX_CLOSED')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  reminder_context jsonb,
  UNIQUE(device_id,event_id)
);
CREATE INDEX IF NOT EXISTS event_history ON box_events(patient_id,occurred_at DESC,id DESC);
