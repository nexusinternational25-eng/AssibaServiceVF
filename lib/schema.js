// Schéma PostgreSQL. Idempotent : peut être rejoué sans perte de données.
// Augmenter SCHEMA_VERSION à chaque modification pour qu'il soit réappliqué.
const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (version int NOT NULL);

CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id int,
  kind text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL,
  data_b64 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('client','prestataire','admin')),
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  email text,
  phone text NOT NULL,
  address text,
  city text,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','suspended')),
  photo_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  token_version int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uq ON users (phone);

CREATE TABLE IF NOT EXISTS providers (
  user_id int PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  business_name text,
  experience_years text,
  certification text,
  description text,
  categories text[] NOT NULL DEFAULT '{}',
  other_category text,
  plan text NOT NULL DEFAULT 'standard',
  plan_expires_at timestamptz,
  registration_paid boolean NOT NULL DEFAULT false,
  id_document_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  verified_at timestamptz,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS service_requests (
  id serial PRIMARY KEY,
  client_id int NOT NULL REFERENCES users(id),
  category text NOT NULL,
  other_detail text,
  title text NOT NULL,
  description text NOT NULL,
  address text NOT NULL,
  city text,
  latitude double precision,
  longitude double precision,
  service_type text NOT NULL,
  commission_rate numeric(5,4) NOT NULL DEFAULT 0,
  preferred_date date,
  preferred_time text,
  is_urgent boolean NOT NULL DEFAULT false,
  budget_min int,
  budget_max int,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN
    ('awaiting_payment','open','accepted','in_progress','done','completed','dispute','refunded','cancelled')),
  provider_id int REFERENCES users(id),
  accepted_offer_id int,
  agreed_amount int,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS sr_status_idx ON service_requests (status, category);
CREATE INDEX IF NOT EXISTS sr_client_idx ON service_requests (client_id);
CREATE INDEX IF NOT EXISTS sr_provider_idx ON service_requests (provider_id);

CREATE TABLE IF NOT EXISTS request_photos (
  request_id int NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (request_id, file_id)
);

CREATE TABLE IF NOT EXISTS offers (
  id serial PRIMARY KEY,
  request_id int NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_id int NOT NULL REFERENCES users(id),
  amount int NOT NULL CHECK (amount > 0),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, provider_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id serial PRIMARY KEY,
  ref text NOT NULL UNIQUE,
  user_id int REFERENCES users(id),
  purpose text NOT NULL CHECK (purpose IN ('mise_en_relation','prestation','inscription','abonnement','assurance')),
  amount int NOT NULL CHECK (amount > 0),
  method text,
  payer_phone text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','submitted','confirmed','rejected','refunded')),
  gateway text NOT NULL DEFAULT 'manual',
  external_ref text,
  related_id int,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by int REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status);
CREATE UNIQUE INDEX IF NOT EXISTS payments_external_uq ON payments (method, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS ledger (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id),
  amount int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('gain','retrait','annulation_retrait','ajustement')),
  request_id int REFERENCES service_requests(id),
  withdrawal_id int,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger (user_id);

CREATE TABLE IF NOT EXISTS withdrawals (
  id serial PRIMARY KEY,
  provider_id int NOT NULL REFERENCES users(id),
  amount int NOT NULL CHECK (amount > 0),
  method text NOT NULL,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','rejected')),
  external_ref text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS disputes (
  id serial PRIMARY KEY,
  request_id int NOT NULL REFERENCES service_requests(id),
  opened_by int NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  decision text,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS reviews (
  id serial PRIMARY KEY,
  request_id int NOT NULL UNIQUE REFERENCES service_requests(id),
  client_id int NOT NULL REFERENCES users(id),
  provider_id int NOT NULL REFERENCES users(id),
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id serial PRIMARY KEY,
  user_id int REFERENCES users(id),
  plan text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  details jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','cancelled')),
  payment_id int REFERENCES payments(id),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS insurance_partners (
  id text PRIMARY KEY,
  name text NOT NULL,
  logo text,
  description text,
  active boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS insurance_subscriptions (
  id serial PRIMARY KEY,
  user_id int REFERENCES users(id),
  insurance_type text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  business_type text,
  details jsonb NOT NULL DEFAULT '{}',
  amount int NOT NULL,
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment','active','cancelled')),
  payment_id int REFERENCES payments(id),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_resets (
  id serial PRIMARY KEY,
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text,
  expires_at timestamptz,
  used_at timestamptz,
  requested_by_user boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id bigserial PRIMARY KEY,
  key text NOT NULL,
  success boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_key_idx ON login_attempts (key, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  actor_id int,
  action text NOT NULL,
  target text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS training_progress (
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id int NOT NULL,
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','completed')),
  attempts int NOT NULL DEFAULT 0,
  best_score numeric(4,3) NOT NULL DEFAULT 0,
  certificate_code text UNIQUE,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (user_id, course_id)
);

INSERT INTO insurance_partners (id, name, logo, description, sort) VALUES
  ('nsia_togo', 'NSIA Assurances Togo', 'NSIA', 'Leader de l''assurance au Togo', 1),
  ('saham_togo', 'Saham Assurance Togo', 'SAHAM', 'Assurance de confiance', 2),
  ('colina_togo', 'Colina Assurance', 'COLINA', 'Solutions adaptées aux professionnels', 3)
ON CONFLICT (id) DO NOTHING;
`;

module.exports = { SCHEMA, SCHEMA_VERSION };
