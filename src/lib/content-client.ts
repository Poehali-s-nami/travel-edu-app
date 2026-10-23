import { getIdToken, type User } from "firebase/auth";
import type { LearningTrack, Material } from "@/types/material";

type ContentResponse = {
  materials: Array<Record<string, unknown>>;
  tracks: Array<Record<string, unknown>>;
};

const d1ContentApiUrl = process.env.NEXT_PUBLIC_CONTENT_API_URL?.trim();

function normalizeContent(result: ContentResponse) {
  if (!Array.isArray(result.materials) || !Array.isArray(result.tracks)) {
    throw new Error("Content response is malformed");
  }
  return {
    materials: result.materials.map((item) => ({ ...item, createdAt: new Date(String(item.createdAt ?? 0)) })) as Material[],
    tracks: result.tracks.map((item) => ({ ...item, createdAt: new Date(String(item.createdAt ?? 0)) })) as LearningTrack[]
  };
}

async function requestContent(url: string, token: string, timeoutMs?: number) {
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller?.signal
    });
    if (!response.ok) throw new Error(`Content request failed: ${response.status}`);
    return normalizeContent((await response.json()) as ContentResponse);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function loadAccessibleContent(user: User): Promise<{ materials: Material[]; tracks: LearningTrack[] }> {
  const token = await getIdToken(user);

  if (d1ContentApiUrl) {
    try {
      return await requestContent(d1ContentApiUrl, token, 4_000);
    } catch (error) {
      console.warn("D1 content request failed; using Firestore fallback.", error);
    }
  }

  return requestContent("/api/content", token);
}
