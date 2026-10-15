"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Share2, X } from "lucide-react";
import { getYouTubeEmbedUrl } from "@/lib/youtube";
import type { Material } from "@/types/material";

type ContentModalProps = {
  material: Material | null;
  isCompleted?: boolean;
  onClose: () => void;
  onComplete?: (material: Material) => void | Promise<void>;
  onOpenTest?: (url: string) => void;
};

function getGoogleDrivePreviewUrl(url: string) {
  try {
    const parsedUrl = new URL(url.trim());
    const driveFileMatch = parsedUrl.pathname.match(/^\/file\/d\/([^/]+)/);

    if (parsedUrl.hostname === "drive.google.com" && driveFileMatch) {
      return `https://drive.google.com/file/d/${driveFileMatch[1]}/preview`;
    }
  } catch {
    return null;
  }

  return null;
}

function getVideoPreviewUrl(url: string) {
  return getGoogleDrivePreviewUrl(url) ?? getYouTubeEmbedUrl(url);
}

function getFilePreviewUrl(url: string, format: string) {
  const sourceUrl = url.trim();

  try {
    const parsedUrl = new URL(sourceUrl);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (
      hostname === "docs.google.com" &&
      parsedUrl.pathname.startsWith("/viewer")
    ) {
      return sourceUrl;
    }

    const drivePreviewUrl = getGoogleDrivePreviewUrl(sourceUrl);
    if (drivePreviewUrl) {
      return drivePreviewUrl;
    }

    const googleDocumentMatch = parsedUrl.pathname.match(
      /^\/(document|spreadsheets|presentation)\/d\/([^/]+)/
    );
    if (hostname === "docs.google.com" && googleDocumentMatch) {
      return `https://docs.google.com/${googleDocumentMatch[1]}/d/${googleDocumentMatch[2]}/preview`;
    }

    if (
      format.toLowerCase().includes("pdf") ||
      parsedUrl.pathname.toLowerCase().endsWith(".pdf")
    ) {
      return sourceUrl;
    }
  } catch {
    return sourceUrl;
  }

  return `https://docs.google.com/viewer?url=${encodeURIComponent(
    sourceUrl
  )}&embedded=true`;
}

async function shareLink(url: string, title: string) {
  if (navigator.share) {
    await navigator.share({ title, url });
    return;
  }

  await navigator.clipboard?.writeText(url);
}

export function ContentModal({
  material,
  isCompleted = false,
  onClose,
  onComplete,
  onOpenTest
}: ContentModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    setIsSaving(false);
    setSaveError("");
  }, [material?.id]);

  if (!material) {
    return null;
  }

  async function handleComplete() {
    if (!material || !onComplete || isSaving) return;
    setIsSaving(true);
    setSaveError("");
    try {
      await onComplete(material);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить прогресс. Повторите попытку.");
    } finally {
      setIsSaving(false);
    }
  }

  const previewUrl =
    material.type === "video"
      ? getVideoPreviewUrl(material.url)
      : getFilePreviewUrl(material.url, material.format);

  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname}?material=${material.id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-0 sm:p-4">
      <div className="flex h-[100dvh] w-full max-w-5xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[calc(100vh-2rem)] sm:max-h-[92vh] sm:rounded-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 p-4 sm:gap-4 sm:p-5">
          <div className="min-w-0">
            <p className="mb-1 text-sm font-medium text-[#ea6a00]">
              {material.format}
            </p>
            <h2 className="line-clamp-3 text-xl font-semibold leading-tight text-slate-950 sm:line-clamp-none">
              {material.title}
            </h2>
            <p className="mt-2 line-clamp-3 max-w-3xl text-sm leading-6 text-slate-500 sm:line-clamp-none">
              {material.description}
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

        <div className="h-[30dvh] min-h-[12rem] shrink-0 bg-slate-100 p-3 sm:min-h-0 sm:flex-1 sm:p-5">
          <div className="h-full min-h-0 overflow-hidden rounded-xl bg-white shadow-sm">
            <iframe
              src={previewUrl}
              title={material.title}
              className="h-full w-full"
              allow={
                material.type === "video"
                  ? "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  : undefined
              }
              allowFullScreen
            />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t border-slate-100 p-4 sm:shrink-0 sm:flex-none sm:overflow-visible sm:p-5">
          <div className="flex max-h-20 flex-wrap gap-2 overflow-hidden sm:max-h-none">
            {[...material.category, ...(material.tags ?? [])].map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <button
                type="button"
                onClick={() => void handleComplete()}
                disabled={isCompleted || isSaving}
                className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition sm:min-h-0 ${
                  isCompleted
                    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"
                    : "border border-slate-200 text-slate-700 hover:border-[#ea6a00]/30 hover:bg-orange-50 hover:text-[#ea6a00]"
                }`}
              >
                <CheckCircle2 size={16} />
                {isCompleted ? "Материал изучен" : isSaving ? "Сохраняем..." : "Завершить изучение"}
              </button>
              {material.testUrl ? (
                <button
                  type="button"
                  onClick={() => onOpenTest?.(material.testUrl ?? "")}
                  disabled={!isCompleted}
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition sm:min-h-0 ${
                    isCompleted
                      ? "bg-[#ea6a00] text-white hover:bg-[#d85f00]"
                      : "cursor-not-allowed bg-slate-100 text-slate-400"
                  }`}
                >
                  <ExternalLink size={16} />
                  Перейти к тестированию
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void shareLink(shareUrl, material.title)}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-[#ea6a00]/30 hover:bg-orange-50 hover:text-[#ea6a00] sm:min-h-0"
              >
                <Share2 size={16} />
                Поделиться
              </button>
              <a
                href={material.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#ea6a00] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#d85f00] sm:min-h-0"
              >
                <ExternalLink size={16} />
                Открыть источник
              </a>
            </div>
          </div>
          {saveError ? <p role="alert" className="text-sm text-red-700">{saveError}</p> : null}
        </div>
      </div>
    </div>
  );
}
