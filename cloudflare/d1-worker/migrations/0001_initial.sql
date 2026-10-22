PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS migration_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'firestore',
  collection_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  initiated_by TEXT NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_migration_runs_collection_started
  ON migration_runs(collection_name, started_at);

-- Exact Firestore copy retained for rollback checks and lossless reprocessing.
CREATE TABLE IF NOT EXISTS firestore_documents (
  collection_name TEXT NOT NULL,
  document_id TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  firestore_create_time TEXT,
  firestore_update_time TEXT,
  checksum TEXT NOT NULL,
  migration_run_id TEXT NOT NULL,
  migrated_at TEXT NOT NULL,
  PRIMARY KEY (collection_name, document_id),
  FOREIGN KEY (migration_run_id) REFERENCES migration_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_firestore_documents_collection
  ON firestore_documents(collection_name);
CREATE INDEX IF NOT EXISTS idx_firestore_documents_run
  ON firestore_documents(migration_run_id);

CREATE TABLE IF NOT EXISTS access_users (
  id TEXT PRIMARY KEY,
  crm_id TEXT,
  login TEXT NOT NULL DEFAULT '',
  normalized_login TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user',
  training_role TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  claim_state TEXT,
  source TEXT,
  password_reset_requested INTEGER NOT NULL DEFAULT 0 CHECK (password_reset_requested IN (0, 1)),
  office_ids_json TEXT NOT NULL DEFAULT '[]',
  group_ids_json TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_access_users_crm_id ON access_users(crm_id);
CREATE INDEX IF NOT EXISTS idx_access_users_login ON access_users(normalized_login);
CREATE INDEX IF NOT EXISTS idx_access_users_active ON access_users(active, archived);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  tab TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  audience_json TEXT NOT NULL DEFAULT '{"mode":"everyone","roles":[],"groupIds":[]}',
  data_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_materials_catalog ON materials(archived, tab);

CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  material_ids_json TEXT NOT NULL DEFAULT '[]',
  audience_json TEXT NOT NULL DEFAULT '{"mode":"everyone","roles":[],"groupIds":[]}',
  data_json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tracks_archived ON tracks(archived);

CREATE TABLE IF NOT EXISTS training_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'manual',
  office_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  material_ids_json TEXT NOT NULL DEFAULT '[]',
  track_ids_json TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_training_groups_office ON training_groups(office_id);

CREATE TABLE IF NOT EXISTS learning_progress (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  material_title TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_user_material
  ON learning_progress(user_id, material_id);
CREATE INDEX IF NOT EXISTS idx_progress_user ON learning_progress(user_id);

CREATE TABLE IF NOT EXISTS material_views (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  data_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_material_views_material ON material_views(material_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT,
  data_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_type_time
  ON audit_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS reference_documents (
  collection_name TEXT NOT NULL,
  id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (collection_name, id)
);

