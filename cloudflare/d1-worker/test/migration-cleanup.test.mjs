import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DELETE_STALE_MIGRATION_DOCUMENTS_SQL } from "../src/migration-cleanup.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE migration_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL
    );
    CREATE TABLE firestore_documents (
      collection_name TEXT NOT NULL,
      document_id TEXT NOT NULL,
      migration_run_id TEXT NOT NULL,
      migrated_at TEXT NOT NULL,
      PRIMARY KEY (collection_name, document_id)
    );
  `);
  return db;
}

test("cleanup removes stale rows but preserves live sync after the migration started", () => {
  const db = database();
  db.prepare("INSERT INTO migration_runs (id, started_at) VALUES (?, ?)")
    .run("migration-A", "2026-11-02T10:00:00.000Z");
  const insert = db.prepare(`INSERT INTO firestore_documents
    (collection_name, document_id, migration_run_id, migrated_at) VALUES (?, ?, ?, ?)`);
  insert.run("materials", "stale", "migration-old", "2026-11-02T09:59:59.000Z");
  insert.run("materials", "current", "migration-A", "2026-11-02T10:00:01.000Z");
  insert.run("materials", "live", "live-sync:materials", "2026-11-02T10:00:02.000Z");
  insert.run("tracks", "unrelated", "migration-old", "2026-11-02T09:00:00.000Z");

  db.prepare(DELETE_STALE_MIGRATION_DOCUMENTS_SQL)
    .run("materials", "migration-A", "migration-A");

  const rows = db.prepare(`SELECT collection_name, document_id
    FROM firestore_documents ORDER BY collection_name, document_id`).all()
    .map((row) => ({ collection_name: row.collection_name, document_id: row.document_id }));
  assert.deepEqual(rows, [
    { collection_name: "materials", document_id: "current" },
    { collection_name: "materials", document_id: "live" },
    { collection_name: "tracks", document_id: "unrelated" }
  ]);
});

test("cleanup conservatively preserves rows written at the exact start time", () => {
  const db = database();
  db.prepare("INSERT INTO migration_runs (id, started_at) VALUES (?, ?)")
    .run("migration-A", "2026-11-02T10:00:00.000Z");
  db.prepare(`INSERT INTO firestore_documents
    (collection_name, document_id, migration_run_id, migrated_at) VALUES (?, ?, ?, ?)`)
    .run("materials", "same-millisecond", "live-sync:materials", "2026-11-02T10:00:00.000Z");

  db.prepare(DELETE_STALE_MIGRATION_DOCUMENTS_SQL)
    .run("materials", "migration-A", "migration-A");

  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM firestore_documents").get().count, 1);
});
