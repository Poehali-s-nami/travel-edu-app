"use client";

import { FormEvent, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { Archive, FolderPlus, Search, Users } from "lucide-react";
import { auth, db, ADMIN_EMAIL } from "@/lib/firebase";
import { belongsToGroup, officeGroupId } from "@/lib/training-groups";
import type { AccessUser } from "@/types/access-user";
import type { Material, LearningTrack } from "@/types/material";
import type { TrainingGroup } from "@/types/training-group";

export function TrainingGroupsWorkspace({ groups, users, materials, tracks }: {
  groups: TrainingGroup[];
  users: AccessUser[];
  materials: Material[];
  tracks: LearningTrack[];
}) {
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = groups.find((group) => group.id === selectedId);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    const nextName = name.trim();
    if (!db || auth?.currentUser?.email !== ADMIN_EMAIL || !nextName || saving) return;
    if (groups.some((group) => group.kind === "manual" && group.name.toLowerCase() === nextName.toLowerCase())) {
      setMessage("Группа с таким названием уже существует.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const created = await addDoc(collection(db, "trainingGroups"), {
        name: nextName, kind: "manual", trackIds: [], materialIds: [], archived: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      setName("");
      setSelectedId(created.id);
      setMessage("Группа создана.");
    } catch {
      setMessage("Не удалось создать группу. Проверьте правила Firestore.");
    } finally {
      setSaving(false);
    }
  }

  async function syncOffices() {
    if (!db || auth?.currentUser?.email !== ADMIN_EMAIL || saving) return;
    const offices = new Map<string, string>();
    for (const user of users) {
      for (const link of user.officeLinks ?? []) {
        if (link.id?.trim()) offices.set(link.id.trim(), link.name?.trim() || `Офис ${link.id.trim()}`);
      }
      for (const id of user.officeIds ?? []) {
        if (!offices.has(id)) offices.set(id, `Офис ${id}`);
      }
    }
    setSaving(true);
    setMessage("");
    try {
      for (const [id, officeName] of offices) {
        await setDoc(doc(db, "trainingGroups", officeGroupId(id)), {
          name: officeName, kind: "office", officeId: id, updatedAt: serverTimestamp()
        }, { merge: true });
      }
      setMessage(`Группы офисов обновлены: ${offices.size}. Назначения сохранены.`);
    } catch {
      setMessage("Не удалось сформировать все офисные группы. Повторный запуск безопасен.");
    } finally {
      setSaving(false);
    }
  }

  const ordered = [...groups].sort((a, b) => a.archived === b.archived
    ? a.name.localeCompare(b.name, "ru") : Number(a.archived) - Number(b.archived));

  return <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
    <aside className="space-y-4">
      <form onSubmit={(event) => void createGroup(event)} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <label className="block text-sm font-semibold text-slate-800">Новая группа
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120}
            placeholder="Название группы" className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm" required />
        </label>
        <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#ea6a00] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><FolderPlus size={16} /> Создать</button>
      </form>
      <button type="button" onClick={() => void syncOffices()} disabled={saving}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        Сформировать группы по офисам CRM
      </button>
      <div className="max-h-[32rem] overflow-y-auto rounded-lg border border-slate-200 bg-white">
        {ordered.map((group) => <button key={group.id} type="button" onClick={() => setSelectedId(group.id)}
          className={`block w-full border-b border-slate-100 px-4 py-3 text-left text-sm ${selectedId === group.id ? "bg-orange-50" : "hover:bg-slate-50"}`}>
          <span className="block font-semibold text-slate-900">{group.name}{group.archived ? " · архив" : ""}</span>
          <span className="mt-1 block text-xs text-slate-500">{group.kind === "office" ? "Офис CRM" : "Ручная группа"} · {users.filter((user) => belongsToGroup(user, group)).length} участников</span>
        </button>)}
        {!ordered.length ? <p className="p-4 text-sm text-slate-500">Групп пока нет.</p> : null}
      </div>
    </aside>
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
      {selected ? <GroupEditor key={selected.id} group={selected} users={users} materials={materials} tracks={tracks} />
        : <p className="text-sm text-slate-500">Выберите группу или создайте новую.</p>}
      {message ? <p role="status" className="mt-4 text-sm text-slate-700">{message}</p> : null}
    </section>
  </div>;
}

function GroupEditor({ group, users, materials, tracks }: {
  group: TrainingGroup;
  users: AccessUser[];
  materials: Material[];
  tracks: LearningTrack[];
}) {
  const [name, setName] = useState(group.name);
  const [trackIds, setTrackIds] = useState(group.trackIds);
  const [materialIds, setMaterialIds] = useState(group.materialIds);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const members = users.filter((user) => belongsToGroup(user, group));
  const matching = users.filter((user) => !belongsToGroup(user, group) &&
    `${user.displayName} ${user.login} ${user.crmId ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 25);

  async function save() {
    if (!db || auth?.currentUser?.email !== ADMIN_EMAIL || saving || !name.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      await updateDoc(doc(db, "trainingGroups", group.id), {
        ...(group.kind === "manual" ? { name: name.trim() } : {}),
        trackIds, materialIds, updatedAt: serverTimestamp()
      });
      setMessage("Назначения сохранены.");
    } catch {
      setMessage("Не удалось сохранить группу.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleMember(user: AccessUser) {
    if (!db || auth?.currentUser?.email !== ADMIN_EMAIL || saving) return;
    setSaving(true);
    setMessage("");
    const current = user.groupIds ?? [];
    const next = current.includes(group.id) ? current.filter((id) => id !== group.id) : [...current, group.id];
    try {
      await updateDoc(doc(db, "accessUsers", user.id), { groupIds: next, updatedAt: serverTimestamp() });
    } catch {
      setMessage("Не удалось изменить состав группы.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    if (!db || auth?.currentUser?.email !== ADMIN_EMAIL || saving) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "trainingGroups", group.id), { archived: !group.archived, updatedAt: serverTimestamp() });
      setMessage(group.archived ? "Группа восстановлена." : "Группа архивирована. Назначения больше не показываются сотрудникам.");
    } catch {
      setMessage("Не удалось изменить статус группы.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <label className="block text-sm font-semibold text-slate-800">Название группы
          <input value={name} onChange={(event) => setName(event.target.value)} disabled={group.kind === "office"} maxLength={120}
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm disabled:bg-slate-50" />
        </label>
        {group.kind === "office" ? <p className="mt-1 text-xs text-slate-500">CRM ID офиса: {group.officeId}. Название обновляется при импорте.</p> : null}
      </div>
      <button type="button" onClick={() => void toggleArchive()} disabled={saving}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50">
        <Archive size={16} /> {group.archived ? "Восстановить" : "В архив"}
      </button>
    </div>
    <div className="grid gap-5 xl:grid-cols-2">
      <AssignmentList title="Обучающие треки" items={tracks.filter((item) => !item.archived)} selected={trackIds} onChange={setTrackIds} />
      <AssignmentList title="Материалы" items={materials.filter((item) => !item.archived)} selected={materialIds} onChange={setMaterialIds} />
    </div>
    <button type="button" onClick={() => void save()} disabled={saving || group.archived || !name.trim()}
      className="rounded-lg bg-[#ea6a00] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Сохраняем..." : "Сохранить назначения"}</button>
    <div className="border-t border-slate-200 pt-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Users size={17} /> Участники: {members.length}</h3>
      <div className="mt-3 max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
        {members.map((user) => {
          const automatic = group.kind === "office" && Boolean(group.officeId && user.officeIds?.includes(group.officeId));
          return <div key={user.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{user.displayName} <span className="text-slate-500">· {user.login}</span></span>
            {automatic ? <span className="shrink-0 text-xs text-slate-500">CRM</span> : <button type="button" disabled={saving} onClick={() => void toggleMember(user)} className="shrink-0 text-xs font-medium text-[#c95b00]">Убрать</button>}
          </div>;
        })}
        {!members.length ? <p className="p-3 text-sm text-slate-500">Участников пока нет.</p> : null}
      </div>
      <div className="relative mt-4"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти сотрудника для добавления"
          className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm" />
      </div>
      {search.trim() ? <div className="mt-2 max-h-40 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
        {matching.map((user) => <div key={user.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{user.displayName} · {user.login}</span>
          <button type="button" disabled={saving} onClick={() => void toggleMember(user)} className="shrink-0 text-xs font-semibold text-[#c95b00]">Добавить</button>
        </div>)}
        {!matching.length ? <p className="p-3 text-sm text-slate-500">Ничего не найдено.</p> : null}
      </div> : null}
    </div>
    {message ? <p role="status" className="text-sm text-slate-700">{message}</p> : null}
  </div>;
}

function AssignmentList({ title, items, selected, onChange }: {
  title: string;
  items: Array<{ id: string; title: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return <fieldset className="min-w-0">
    <legend className="text-sm font-semibold text-slate-900">{title}</legend>
    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
      {items.map((item) => <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50">
        <input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => onChange(event.target.checked
          ? [...selected, item.id] : selected.filter((id) => id !== item.id))} className="mt-0.5 accent-[#ea6a00]" />
        <span className="min-w-0 break-words">{item.title}</span>
      </label>)}
      {!items.length ? <p className="px-2 py-1 text-sm text-slate-500">Нет доступных материалов.</p> : null}
    </div>
  </fieldset>;
}
