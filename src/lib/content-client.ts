import { getIdToken, type User } from "firebase/auth";
import type { LearningTrack, Material } from "@/types/material";

export async function loadAccessibleContent(user: User): Promise<{ materials: Material[]; tracks: LearningTrack[] }> {
  const token = await getIdToken(user);
  const response = await fetch("/api/content", {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Content request failed: ${response.status}`);
  const result = (await response.json()) as { materials: Array<Record<string, unknown>>; tracks: Array<Record<string, unknown>> };
  return {
    materials: result.materials.map((item) => ({ ...item, createdAt: new Date(String(item.createdAt ?? 0)) })) as Material[],
    tracks: result.tracks.map((item) => ({ ...item, createdAt: new Date(String(item.createdAt ?? 0)) })) as LearningTrack[]
  };
}
