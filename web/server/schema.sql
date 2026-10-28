-- Schema version 1. Every syncable row: uid (crypto.randomUUID) + updated_at (ISO UTC ms).
-- Statements are split on ';' at line end by db.js: no triggers, no ';' inside literals.
CREATE TABLE IF NOT EXISTS halls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  seats TEXT NOT NULL,
  seat_plan TEXT NOT NULL DEFAULT '{}',
  price_schema TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  hall_id INTEGER NOT NULL REFERENCES halls(id),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  event_id INTEGER NOT NULL REFERENCES events(id),
  date TEXT NOT NULL,
  tickets_dict TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('sales','baskan','superuser')),
  disabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  day_id INTEGER NOT NULL REFERENCES days(id),
  event_id INTEGER NOT NULL REFERENCES events(id),
  row TEXT NOT NULL,
  num TEXT NOT NULL,
  price INTEGER NOT NULL,
  category INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 0 CHECK (status IN (0,1,2)),
  owner INTEGER REFERENCES users(id),
  last_modified_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (day_id, row, num)
);
CREATE INDEX IF NOT EXISTS tickets_day_status ON tickets(day_id, status);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  day_id INTEGER NOT NULL REFERENCES days(id),
  action TEXT NOT NULL CHECK (action IN ('satış','satış iptal')),
  username TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS logs_day_at ON logs(day_id, at);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS tombstones (
  uid TEXT NOT NULL,
  tbl TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (tbl, uid)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  username TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL
);
