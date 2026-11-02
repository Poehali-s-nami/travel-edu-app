export const DELETE_STALE_MIGRATION_DOCUMENTS_SQL = `DELETE FROM firestore_documents
  WHERE collection_name = ?
    AND migration_run_id != ?
    AND migrated_at < (
      SELECT started_at FROM migration_runs WHERE id = ?
    )`;
