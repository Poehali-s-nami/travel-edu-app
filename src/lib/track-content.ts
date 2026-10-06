import type { LearningTrack, Material, TrackInfoBlock } from "@/types/material";

export type TrackEntry =
  | { kind: "material"; material: Material }
  | { kind: "info"; block: TrackInfoBlock };

export function getTrackEntries(track: LearningTrack, materials: Material[]): TrackEntry[] {
  const blocks = (track.infoBlocks ?? []).filter((block) => block.enabled);
  const entries: TrackEntry[] = [];
  const appendBlocks = (afterMaterialId: string) => {
    blocks.filter((block) => block.afterMaterialId === afterMaterialId)
      .forEach((block) => entries.push({ kind: "info", block }));
  };
  appendBlocks("");
  for (const id of track.materialIds) {
    const material = materials.find((item) => item.id === id);
    if (material) entries.push({ kind: "material", material });
    appendBlocks(id);
  }
  // Keep notes visible if the material they followed has been removed.
  blocks.filter((block) => block.afterMaterialId && !track.materialIds.includes(block.afterMaterialId))
    .forEach((block) => entries.push({ kind: "info", block }));
  return entries;
}
