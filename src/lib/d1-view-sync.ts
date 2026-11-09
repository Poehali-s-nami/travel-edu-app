import type { User } from "firebase/auth";

const contentApiUrl = process.env.NEXT_PUBLIC_CONTENT_API_URL?.trim()
  || "https://api.psnhub.kz/v1/catalog";

function confirmedViewApiUrl() {
  if (!contentApiUrl) return null;
  return new URL("/v1/confirmed-view", contentApiUrl).toString();
}

export async function syncConfirmedView(user: User, materialId: string, deviceId: string) {
  const url = confirmedViewApiUrl();
  if (!url) return { enabled: false, views: null };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await user.getIdToken()}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ materialId, deviceId })
  });
  if (!response.ok) throw new Error(`D1 view synchronization failed: ${response.status}`);
  const result = (await response.json()) as { views?: number };
  return { enabled: true, views: typeof result.views === "number" ? result.views : null };
}
