"use client";

import { ArrowDown, ArrowUp, Info, Plus, Trash2 } from "lucide-react";
import type { Material, TrackInfoBlock } from "@/types/material";

export function TrackInfoEditor({ blocks, materialIds, materials, onChange }: {
  blocks: TrackInfoBlock[];
  materialIds: string[];
  materials: Material[];
  onChange: (blocks: TrackInfoBlock[]) => void;
}) {
  const update = (id: string, patch: Partial<TrackInfoBlock>) =>
    onChange(blocks.map((block) => block.id === id ? { ...block, ...patch } : block));
  const move = (index: number, offset: number) => {
    const next = [...blocks];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  const inputClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";
  return (
    <section className="mt-5 space-y-3 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">Информационные блоки</h3>
        <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-orange-200 px-3 py-2 text-sm text-orange-700" onClick={() => onChange([...blocks, {
          id: crypto.randomUUID(), title: "Встреча с куратором", text: "", enabled: true,
          afterMaterialId: materialIds.at(-1) ?? ""
        }])}><Plus size={16} />Добавить инфополе</button>
      </div>
      {blocks.map((block, index) => (
        <div key={block.id} className="space-y-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={block.enabled} onChange={(event) => update(block.id, { enabled: event.target.checked })} />
              <Info size={16} className="text-orange-600" />Показывать в треке
            </label>
            <div className="flex gap-1">
              <button type="button" title="Выше среди инфополей" aria-label="Выше среди инфополей" disabled={index === 0} onClick={() => move(index, -1)} className="rounded p-2 hover:bg-orange-100 disabled:opacity-30"><ArrowUp size={16} /></button>
              <button type="button" title="Ниже среди инфополей" aria-label="Ниже среди инфополей" disabled={index === blocks.length - 1} onClick={() => move(index, 1)} className="rounded p-2 hover:bg-orange-100 disabled:opacity-30"><ArrowDown size={16} /></button>
              <button type="button" title="Удалить инфополе" aria-label="Удалить инфополе" onClick={() => onChange(blocks.filter((item) => item.id !== block.id))} className="rounded p-2 text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
            </div>
          </div>
          <label className="block text-sm text-slate-700">Заголовок
            <input value={block.title} onChange={(event) => update(block.id, { title: event.target.value })} className={inputClass} />
          </label>
          <label className="block text-sm text-slate-700">Текст и ссылки
            <textarea rows={3} value={block.text} onChange={(event) => update(block.id, { text: event.target.value })} className={inputClass} />
          </label>
          <label className="block text-sm text-slate-700">Место в треке
            <select value={block.afterMaterialId} onChange={(event) => update(block.id, { afterMaterialId: event.target.value })} className={inputClass}>
              <option value="">Перед первым материалом</option>
              {materialIds.map((id, materialIndex) => <option key={id} value={id}>После {materialIndex + 1}. {materials.find((material) => material.id === id)?.title ?? id}</option>)}
              {block.afterMaterialId && !materialIds.includes(block.afterMaterialId) ? <option value={block.afterMaterialId}>В конце трека (материал удалён)</option> : null}
            </select>
          </label>
        </div>
      ))}
    </section>
  );
}
