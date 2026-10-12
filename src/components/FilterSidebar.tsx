"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { categoryKey, getDurationBucket, getSpeakerCompanyLabel } from "@/lib/materials";
import type { ContentTab, FilterState, Material } from "@/types/material";

type FilterSidebarProps = {
  activeTab: ContentTab;
  filters: FilterState;
  options: {
    topics: string[];
    speakers: string[];
    formats: string[];
    durations: string[];
  };
  isOpen: boolean;
  onClose: () => void;
  onChange: (filters: FilterState) => void;
  onReset: () => void;
};

export function filterMaterials(
  materials: Material[],
  filters: FilterState,
  activeTab: ContentTab
) {
  return materials.filter((material) => {
    const matchesTopics =
      filters.topics.length === 0 ||
      filters.topics.some((topic) => material.category.some((name) => categoryKey(name) === categoryKey(topic)));

    const speakerLabel = getSpeakerCompanyLabel(material);
    const matchesSpeakers =
      activeTab !== "webinars" ||
      filters.speakers.length === 0 ||
      filters.speakers.includes(speakerLabel);

    const matchesFormats =
      activeTab !== "knowledge" ||
      filters.formats.length === 0 ||
      filters.formats.includes(material.format);

    const matchesDurations =
      activeTab !== "webinars" ||
      filters.durations.length === 0 ||
      filters.durations.includes(getDurationBucket(material.duration));

    return matchesTopics && matchesSpeakers && matchesFormats && matchesDurations;
  });
}

export function FilterSidebar({
  activeTab,
  filters,
  options,
  isOpen,
  onClose,
  onChange,
  onReset
}: FilterSidebarProps) {
  if (activeTab === "tracks") {
    return null;
  }

  function toggleFilter(group: keyof FilterState, value: string) {
    const currentValues = filters[group];
    const nextValues = currentValues.includes(value)
      ? currentValues.filter((item) => item !== value)
      : [...currentValues, value];

    onChange({
      ...filters,
      [group]: nextValues
    });
  }

  const content = (
    <aside className="h-full w-full bg-white p-5 lg:sticky lg:top-6 lg:h-fit lg:w-72 lg:rounded-xl lg:shadow-sm lg:ring-1 lg:ring-slate-200/70">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-[#ea6a00]" />
          <h2 className="text-base font-semibold text-slate-950">Фильтры</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть фильтры"
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 lg:hidden"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-7">
        <FilterGroup
          title="Темы"
          values={options.topics}
          selectedValues={filters.topics}
          onToggle={(value) => toggleFilter("topics", value)}
        />
        {activeTab === "webinars" ? (
          <FilterGroup
            title="Автор / Организатор"
            values={options.speakers}
            selectedValues={filters.speakers}
            onToggle={(value) => toggleFilter("speakers", value)}
          />
        ) : null}
        {activeTab === "knowledge" ? (
          <FilterGroup
            title="Формат"
            values={options.formats}
            selectedValues={filters.formats}
            onToggle={(value) => toggleFilter("formats", value)}
          />
        ) : null}
        {activeTab === "webinars" ? (
          <FilterGroup
            title="Длительность"
            values={options.durations}
            selectedValues={filters.durations}
            onToggle={(value) => toggleFilter("durations", value)}
          />
        ) : null}
      </div>

      <button
        type="button"
        onClick={onReset}
        className="mt-8 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-[#ea6a00]/30 hover:bg-orange-50 hover:text-[#ea6a00]"
      >
        Сбросить
      </button>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block">{content}</div>
      {isOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Закрыть фильтры"
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/30"
          />
          <div className="absolute bottom-0 left-0 right-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl">
            {content}
          </div>
        </div>
      ) : null}
    </>
  );
}

type FilterGroupProps = {
  title: string;
  values: string[];
  selectedValues: string[];
  onToggle: (value: string) => void;
};

function FilterGroup({
  title,
  values,
  selectedValues,
  onToggle
}: FilterGroupProps) {
  if (values.length === 0) {
    return null;
  }

  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold text-slate-900">
        {title}
      </legend>
      <div className="space-y-3">
        {values.map((value) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 text-sm text-slate-600"
          >
            <input
              type="checkbox"
              checked={selectedValues.includes(value)}
              onChange={() => onToggle(value)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#ea6a00] focus:ring-[#ea6a00]"
            />
            <span className="leading-5">{value}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
