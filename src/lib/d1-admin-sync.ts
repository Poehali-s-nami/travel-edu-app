import type { User } from "firebase/auth";

export type D1SyncCollection = "materials" | "tracks" | "trainingGroups";
export type D1SyncDocument = { collection: D1SyncCollection; id: string };

const contentApiUrl = process.env.NEXT_PUBLIC_CONTENT_API_URL?.trim();

function syncApiUrl() {
  if (!contentApiUrl) return null;
  return new URL("/admin/sync-documents", contentApiUrl).toString();
}

export async function syncD1Documents(user: User | null, documents: D1SyncDocument[]) {
  const url = syncApiUrl();
  if (!url || documents.length === 0) return { enabled: false, synced: 0 };
  if (!user) throw new Error("Firebase administrator session is unavailable");

  let synced = 0;
  for (let index = 0; index < documents.length; index += 100) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await user.getIdToken()}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ documents: documents.slice(index, index + 100) })
    });
    if (!response.ok) {
      throw new Error(`D1 synchronization failed: ${response.status}`);
    }
    const result = (await response.json()) as { synced?: number };
    synced += result.synced ?? 0;
  }
  return { enabled: true, synced };
}
