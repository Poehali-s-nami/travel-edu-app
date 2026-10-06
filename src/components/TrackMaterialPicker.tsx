"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical, Search } from "lucide-react";
import type { Material } from "@/types/material";

export function TrackMaterialPicker({
  materials,
  selectedIds,
  onToggle,
  onMove
}: {
  materials: Material[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onMove: (from: number, to: number) => void;
}) {
  const [search, setSearch] = useState("");
  const matchingMaterials = materials.filter((material) =>
    material.title.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))
  );
  const move = (from: number, to: number) => {
    if (Number.isInteger(from) && from >= 0 && from < selectedIds.length && to >= 0 && to < selectedIds.length && from !== to) onMove(from, to);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          Материалы платформы
        </h3>
        <label className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <Search size={16} className="shrink-0 text-slate-400" />
          <input type="search" aria-label="Поиск материалов по названию" placeholder="Поиск по названию" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 w-full text-sm outline-none" />
        </label>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {matchingMaterials.map((material) => (
            <label
              key={material.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(material.id)}
                onChange={() => onToggle(material.id)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-[#ea6a00] focus:ring-[#ea6a00]"
              />
              <span className="min-w-0 break-words">
                <span className="block font-medium text-slate-800">
                  {material.title}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {material.type === "video" ? "Видео" : "Файл"}
                  {material.hiddenFromLibrary ? " · Скрыт из библиотеки" : ""}
                  {material.archived ? " · В архиве" : ""}
                </span>
              </span>
            </label>
          ))}
          {matchingMaterials.length === 0 ? <p className="py-3 text-sm text-slate-500">Материалы не найдены.</p> : null}
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          Порядок в треке
        </h3>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {selectedIds.map((id, index) => {
            const material = materials.find((item) => item.id === id);
            return (
            <div
              key={id}
              draggable
              onDragStart={(event) =>
                event.dataTransfer.setData("text/plain", String(index))
              }
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = event.dataTransfer.getData("text/plain");
                if (from !== "") move(Number(from), index);
              }}
              className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
            >
              <GripVertical size={16} className="mt-1 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1 break-words">
                <p className="text-sm font-medium text-slate-800">
                  {index + 1}. {material?.title ?? "Материал недоступен"}
                </p>
                <p className="mt-1 font-mono text-xs text-slate-400">
                  {material ? (material.type === "video" ? "Видео" : "Файл") : id}
                </p>
              </div>
              <div className="flex shrink-0 flex-col">
                <button type="button" title="Переместить материал выше" aria-label="Переместить материал выше" disabled={index === 0} onClick={() => move(index, index - 1)} className="rounded p-1 disabled:opacity-30"><ArrowUp size={16} /></button>
                <button type="button" title="Переместить материал ниже" aria-label="Переместить материал ниже" disabled={index === selectedIds.length - 1} onClick={() => move(index, index + 1)} className="rounded p-1 disabled:opacity-30"><ArrowDown size={16} /></button>
              </div>
            </div>
          ); })}
          {selectedIds.length === 0 ? <p className="py-3 text-sm text-slate-500">Материалы не выбраны.</p> : null}
        </div>
      </div>
    </div>
  );
}
