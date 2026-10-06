"use client";

import { CheckCircle2, ExternalLink, FileText, Info, LockKeyhole, Share2, X } from "lucide-react";
import { getTrackEntries } from "@/lib/track-content";
import type { LearningTrack, Material } from "@/types/material";

type TrackModalProps = {
  track: LearningTrack | null;
  materials: Material[];
  completedMaterialIds: Set<string>;
  onClose: () => void;
  onOpenMaterial: (material: Material) => void;
  onOpenTest?: (url: string) => void;
  preview?: boolean;
};

async function shareLink(url: string, title: string) {
  if (navigator.share) {
    await navigator.share({ title, url });
    return;
  }

  await navigator.clipboard?.writeText(url);
}

export function TrackModal({
  track,
  materials,
  completedMaterialIds,
  onClose,
  onOpenMaterial,
  onOpenTest,
  preview = false
}: TrackModalProps) {
  if (!track) {
    return null;
  }

  const orderedMaterials = track.materialIds
    .map((id) => materials.find((material) => material.id === id))
    .filter((material): material is Material => Boolean(material));
  const completedCount = orderedMaterials.filter((material) =>
    completedMaterialIds.has(material.id)
  ).length;
  const isTrackCompleted =
    orderedMaterials.length > 0 && completedCount === orderedMaterials.length;

  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname}?track=${track.id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-0 sm:p-4">
      <div className="flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 p-4 sm:gap-4 sm:p-5">
          <div className="min-w-0">
            <p className="mb-1 text-sm font-medium text-orange-600">
              {preview ? "Предпросмотр · Обучающий трек" : "Обучающий трек"}
            </p>
            <h2 className="line-clamp-3 text-xl font-semibold leading-tight text-slate-950 sm:line-clamp-none">
              {track.title}
            </h2>
            <p className="mt-2 line-clamp-3 max-w-3xl text-sm leading-6 text-slate-500 sm:line-clamp-none">
              {track.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="space-y-3">
            {getTrackEntries(track, materials).map((entry) => {
              if (entry.kind === "info") {
                return (
                  <aside key={`info-${entry.block.id}`} className="flex gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
                    <Info size={24} className="shrink-0 text-orange-600" />
                    <div className="min-w-0 flex-1 break-words">
                      <h3 className="text-sm font-semibold text-slate-950">{entry.block.title}</h3>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                        {entry.block.text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) =>
                          /^https?:\/\//.test(part) ? (
                            <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-orange-700 underline">{part}</a>
                          ) : part
                        )}
                      </p>
                    </div>
                  </aside>
                );
              }
              const { material } = entry;
              const index = orderedMaterials.findIndex((item) => item.id === material.id);
              const isCompleted = completedMaterialIds.has(material.id);

              return (
                <button
                  key={material.id}
                  type="button"
                  onClick={() => onOpenMaterial(material)}
                  className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition hover:border-[#ea6a00]/30 hover:bg-orange-50 sm:gap-4 sm:p-4 ${
                    material.type === "file"
                      ? `border-orange-200 bg-orange-50 ${isCompleted ? "opacity-75" : ""}`
                      : isCompleted
                        ? "border-emerald-100 bg-emerald-50/50 opacity-75 saturate-50"
                        : "border-slate-200 bg-white"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#ea6a00] text-sm font-semibold text-white">
                    {index + 1}
                  </span>
                  {material.type === "file" ? <FileText size={28} className="shrink-0 text-orange-500" /> : null}
                  <span className="min-w-0 flex-1">
                    {material.type === "file" ? <span className="mb-1 block text-xs font-medium text-orange-700">Материал для скачивания</span> : null}
                    <span className="line-clamp-2 block text-sm font-semibold text-slate-950">
                      {material.title}
                    </span>
                    <span className="mt-1 line-clamp-2 block text-sm leading-6 text-slate-500">
                      {material.description}
                    </span>
                  </span>
                  {isCompleted ? (
                    <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100 sm:inline-flex">
                      <CheckCircle2 size={14} />
                      Изучено
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="mt-1 text-xs font-medium text-slate-500">
              Завершено материалов: {completedCount} из {orderedMaterials.length}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {track.testUrl ? (
              <button
                type="button"
                onClick={() => onOpenTest?.(track.testUrl ?? "")}
                disabled={!isTrackCompleted}
                className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition sm:min-h-0 ${
                  isTrackCompleted
                    ? "bg-[#ea6a00] text-white hover:bg-[#d85f00]"
                    : "cursor-not-allowed bg-slate-100 text-slate-400"
                }`}
              >
                {isTrackCompleted ? (
                  <ExternalLink size={16} />
                ) : (
                  <LockKeyhole size={16} />
                )}
                Перейти к тестированию
              </button>
            ) : null}
            {!preview ? <button
              type="button"
              onClick={() => void shareLink(shareUrl, track.title)}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-[#ea6a00]/30 hover:bg-orange-50 hover:text-[#ea6a00] sm:min-h-0"
            >
              <Share2 size={16} />
              Поделиться
            </button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
