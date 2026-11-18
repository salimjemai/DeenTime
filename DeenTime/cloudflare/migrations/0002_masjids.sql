-- Masjid admin data for the site at jemaiinnovations.com/masjid.
-- Accounts (sign-up / sign-in) live in the shared Jemai Innovations auth service;
-- these tables only store the user's id from that service (owner_user_id / user_id).
-- Numbered 0002 so it can sit beside the shared service's 0001_init.sql if both ever
-- share one D1. In a separate D1 there is no foreign key to users(id), so deleting an
-- account there leaves its masjids here until a cleanup is added.

CREATE TABLE IF NOT EXISTS masjids (
  id                 TEXT PRIMARY KEY,
  slug               TEXT NOT NULL UNIQUE,
  owner_user_id      TEXT NOT NULL,
  name               TEXT NOT NULL,
  address_line       TEXT NOT NULL DEFAULT '',
  city               TEXT NOT NULL DEFAULT '',
  region             TEXT NOT NULL DEFAULT '',
  postal_code        TEXT NOT NULL DEFAULT '',
  country            TEXT NOT NULL DEFAULT 'US',
  latitude           REAL,
  longitude          REAL,
  timezone           TEXT NOT NULL,
  website_url        TEXT NOT NULL DEFAULT '',
  phone              TEXT NOT NULL DEFAULT '',
  email              TEXT NOT NULL DEFAULT '',
  about              TEXT NOT NULL DEFAULT '',
  calculation_method TEXT NOT NULL DEFAULT 'ISNA',
  asr_method         TEXT NOT NULL DEFAULT 'Standard',
  -- {"fajr":{"mode":"offset","minutes":20}, "dhuhr":{"mode":"fixed","time":"13:30"}, ...}
  iqama_json         TEXT NOT NULL DEFAULT '{}',
  -- ["13:30","14:30"]
  jumuah_json        TEXT NOT NULL DEFAULT '[]',
  -- {"theme":"light","accent":"#0f766e","showIqama":true,"showMessages":true,"showJumuah":true}
  widget_json        TEXT NOT NULL DEFAULT '{}',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS masjids_owner ON masjids(owner_user_id);

-- Who may manage a masjid. The owner is always listed as 'owner'.
CREATE TABLE IF NOT EXISTS masjid_admins (
  masjid_id  TEXT NOT NULL REFERENCES masjids(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL,
  PRIMARY KEY (masjid_id, user_id)
);

CREATE INDEX IF NOT EXISTS masjid_admins_user ON masjid_admins(user_id);

-- Announcements and messages shown on the masjid page, TV and widgets.
CREATE TABLE IF NOT EXISTS masjid_messages (
  id         TEXT PRIMARY KEY,
  masjid_id  TEXT NOT NULL REFERENCES masjids(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  starts_on  TEXT,
  ends_on    TEXT,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS masjid_messages_masjid ON masjid_messages(masjid_id);
