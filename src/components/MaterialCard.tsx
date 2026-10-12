"use client";

import {
  Building2,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  Play,
  UserRound
} from "lucide-react";
import Image from "next/image";
import type { Material } from "@/types/material";
import { videoFormat } from "@/lib/materials";

type MaterialCardProps = {
  material: Material;
  isCompleted?: boolean;
  onOpen: (material: Material) => void;
};

export function MaterialCard({
  material,
  isCompleted = false,
  onOpen
}: MaterialCardProps) {
  const CoverIcon = material.type === "video" ? Play : FileText;
  const visibleTags = material.tab === "webinars"
    ? [...material.category.slice(0, 2), ...(material.tags ?? []).slice(0, 2)]
    : [...material.category, ...(material.tags ?? [])].slice(0, 4);

  return (
    <button
      type="button"
      onClick={() => onOpen(material)}
      className={`group flex h-[35rem] flex-col overflow-hidden rounded-xl bg-white text-left shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#ea6a00] ${
        isCompleted ? "opacity-70 saturate-50" : ""
      }`}
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-gradient-to-br from-orange-50 via-white to-slate-100">
        {material.coverUrl ? (
          <Image
            src={material.coverUrl}
            alt={material.title}
            fill
            sizes="(min-width: 1024px) 33vw, 100vw"
            className="object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="h-full bg-gradient-to-br from-orange-200 via-orange-100 to-slate-300" />
        )}

        <div className="absolute inset-0 z-10 bg-black/35" />
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/20 shadow-lg ring-1 ring-white/30 backdrop-blur-md transition-all duration-300 group-hover:scale-110 group-hover:bg-white/35 group-hover:ring-white/50">
            <CoverIcon
              size={34}
              strokeWidth={1.75}
              className="text-white opacity-90 transition-opacity duration-300 group-hover:opacity-100"
            />
          </span>
        </div>
        {material.tab === "webinars" && material.trendingStamp ? (
          <div className="absolute bottom-5 left-5 z-30 -rotate-6 rounded-md border-2 border-white/80 bg-white/10 px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-widest text-white/80 shadow-sm backdrop-blur-[1px]">
            {material.trendingStamp}
          </div>
        ) : null}
        {isCompleted ? (
          <div className="absolute bottom-5 right-5 z-30 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm ring-1 ring-emerald-100">
            <CheckCircle2 size={14} />
            Изучено
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        {material.tab === "webinars" ? (
          <span className="text-xs font-semibold text-[#b85300]">{videoFormat(material.format)}</span>
        ) : null}
        <div className="flex min-h-14 content-start flex-wrap gap-2">
          {visibleTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-[#b85300]"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="space-y-2">
          <h3 className="line-clamp-2 min-h-12 text-lg font-semibold leading-snug text-slate-950">
            {material.title}
          </h3>
          <p className="line-clamp-2 min-h-12 text-sm leading-6 text-slate-500">
            {material.description}
          </p>
        </div>

        <div className="mt-auto flex min-h-[4.25rem] items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="min-w-0 space-y-1">
            {material.tab === "webinars" && (material.author.name || material.author.company) ? (
              <>
                {material.author.name ? <p className="flex items-center gap-1 truncate text-sm font-medium text-slate-800">
                  <UserRound size={14} />
                  {material.author.name}
                </p> : null}
                {material.author.company ? (
                  <p className="flex items-center gap-1 truncate text-xs text-slate-400">
                    <Building2 size={13} />
                    {material.author.company}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600">
                <FileText size={14} />
                {material.format}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <span className="flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-[#ea6a00]">
              <Clock3 size={13} />
              {material.duration} мин
            </span>
            {material.tab === "webinars" && material.views !== undefined ? (
              <span className="flex items-center gap-1 text-xs font-medium text-slate-400">
                <Eye size={13} />
                {material.views}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
