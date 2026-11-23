export const SCHEDULED_SYNC_COLLECTIONS = [
  "accessUsers",
  "loginEvents",
  "materialViews"
] as const;

export async function runScheduledSync(
  sync: (collection: (typeof SCHEDULED_SYNC_COLLECTIONS)[number]) => Promise<void>,
  onError: (collection: (typeof SCHEDULED_SYNC_COLLECTIONS)[number], error: unknown) => void
) {
  const failures: Array<(typeof SCHEDULED_SYNC_COLLECTIONS)[number]> = [];
  for (const collection of SCHEDULED_SYNC_COLLECTIONS) {
    try {
      await sync(collection);
    } catch (error) {
      failures.push(collection);
      onError(collection, error);
    }
  }
  return failures;
}
