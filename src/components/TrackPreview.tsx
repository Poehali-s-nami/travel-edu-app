"use client";

import { useState } from "react";
import { Eye } from "lucide-react";
import { TrackModal } from "@/components/TrackModal";
import { ContentModal } from "@/components/ContentModal";
import type { LearningTrack, Material } from "@/types/material";

export function TrackPreview({ track, materials }: { track: LearningTrack; materials: Material[] }) {
  const [open, setOpen] = useState(false);
  const [material, setMaterial] = useState<Material | null>(null);
  const [completed, setCompleted] = useState(new Set<string>());
  return <>
    <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700" onClick={() => { setCompleted(new Set()); setOpen(true); }}>
      <Eye size={16} />Посмотреть глазами сотрудника
    </button>
    {open ? <>
      <TrackModal preview track={track} materials={materials.filter((item) => !item.archived)} completedMaterialIds={completed} onClose={() => setOpen(false)} onOpenMaterial={setMaterial} onOpenTest={(url) => window.open(url, "_blank", "noopener,noreferrer")} />
      <ContentModal material={material} isCompleted={material ? completed.has(material.id) : false} onClose={() => setMaterial(null)} onComplete={(item) => setCompleted((current) => new Set([...current, item.id]))} onOpenTest={(url) => window.open(url, "_blank", "noopener,noreferrer")} />
    </> : null}
  </>;
}
