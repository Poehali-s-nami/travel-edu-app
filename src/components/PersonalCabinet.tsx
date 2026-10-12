"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { EmailAuthProvider, getIdTokenResult, reauthenticateWithCredential, User } from "firebase/auth";
import { ArrowLeft, BookOpen, CheckCircle2, ChevronDown, FolderOpen, KeyRound, LogOut, UserRound } from "lucide-react";
import type { AccessUser } from "@/types/access-user";

export type CabinetMaterial = {
  id: string;
  title: string;
  description: string;
  type: "video" | "file";
};

export type CabinetTrack = {
  id: string;
  title: string;
  description: string;
  materialIds: string[];
};

export type CabinetProgress = {
  materialId: string;
  materialTitle: string;
  completedAt?: Date;
};

const passwordPattern = /^(?=.*\p{L})(?=.*\d).{6,}$/u;

export function PersonalCabinet({
  user,
  profile,
  tracks,
  materials,
  progress,
  studyLoaded,
  studyError,
  onSignOut
}: {
  user: User;
  profile: AccessUser;
  tracks: CabinetTrack[];
  materials: CabinetMaterial[];
  progress: CabinetProgress[];
  studyLoaded: boolean;
  studyError: boolean;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<"profile" | "learning">("profile");
  const [learningTab, setLearningTab] = useState<"tracks" | "materials">("tracks");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [isImpersonating, setIsImpersonating] = useState(false);
  useEffect(() => {
    void getIdTokenResult(user).then((token) => setIsImpersonating(token.claims.psnImpersonation === true))
      .catch(() => setIsImpersonating(false));
  }, [user]);
  const completedIds = new Set(progress.map((item) => item.materialId));
  const completedTracks = tracks.filter(
    (track) => track.materialIds.length > 0 && track.materialIds.every((id) => completedIds.has(id))
  );
  const materialById = new Map(materials.map((material) => [material.id, material]));

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user.email || !currentPassword) {
      setMessage("Введите текущий пароль.");
      return;
    }
    if (!passwordPattern.test(newPassword)) {
      setMessage("Новый пароль: минимум 6 символов, буква и цифра.");
      return;
    }
    if (newPassword !== confirmation) {
      setMessage("Новые пароли не совпадают.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
      const idToken = await user.getIdToken(true);
      const response = await fetch("/api/access/confirm-password-change", {
        method: "POST",
        headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
        body: JSON.stringify({ password: newPassword, currentPassword })
      });
      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        throw new Error(result.message ?? "Не удалось сохранить новый пароль.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      setMessage("Пароль изменен.");
    } catch (error) {
      setMessage(error instanceof Error && !error.message.startsWith("Firebase:")
        ? error.message
        : "Не удалось изменить пароль. Проверьте текущий пароль.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" aria-label="На главную PSN HUB" className="inline-flex items-center gap-3">
            <Image src="/psn-logo.svg" alt="Поехали с нами" width={2108} height={871} className="h-11 w-auto object-contain" />
            <span className="hidden text-sm font-semibold text-slate-800 sm:inline">PSN HUB</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
              <ArrowLeft size={17} /> <span className="hidden sm:inline">К материалам</span>
            </Link>
            <button type="button" onClick={onSignOut} aria-label="Выйти из аккаунта" title="Выйти из аккаунта" className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><LogOut size={18} /></button>
          </div>
        </div>
      </header>

      {isImpersonating ? (
        <div className="border-b border-orange-200 bg-orange-50 px-4 py-2 text-center text-sm text-slate-800">
          Вы вошли как {profile.login} через администратора. Действия сохраняются от имени сотрудника.
          <button type="button" onClick={onSignOut} className="ml-2 font-semibold text-[#c95b00] underline">Завершить сеанс</button>
        </div>
      ) : null}

      <div className="mx-auto max-w-5xl px-4 py-7 sm:px-6 sm:py-10">
        <h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">Личный кабинет</h1>
        <p className="mt-1 text-sm text-slate-500">{profile.displayName}</p>

        <nav aria-label="Разделы личного кабинета" className="mt-7 flex gap-6 border-b border-slate-200">
          <button type="button" onClick={() => setTab("profile")} aria-current={tab === "profile" ? "page" : undefined} className={`inline-flex min-h-12 items-center gap-2 border-b-2 px-1 text-sm font-semibold ${tab === "profile" ? "border-[#ea6a00] text-[#c95b00]" : "border-transparent text-slate-500 hover:text-slate-900"}`}><UserRound size={17} /> Профиль</button>
          <button type="button" onClick={() => setTab("learning")} aria-current={tab === "learning" ? "page" : undefined} className={`inline-flex min-h-12 items-center gap-2 border-b-2 px-1 text-sm font-semibold ${tab === "learning" ? "border-[#ea6a00] text-[#c95b00]" : "border-transparent text-slate-500 hover:text-slate-900"}`}><BookOpen size={17} /> Моё обучение</button>
        </nav>

        {tab === "profile" ? (
          <div className="grid gap-10 py-8 lg:grid-cols-[1fr_22rem]">
            <section>
              <h2 className="text-base font-semibold text-slate-950">Личная информация</h2>
              <dl className="mt-4 grid gap-x-7 gap-y-4 sm:grid-cols-2">
                {[
                  ["Имя", profile.displayName],
                  ["Логин CRM", profile.login],
                  ["Название офиса", profile.office],
                  ["Телефон", profile.phone],
                  ["Контактная почта", profile.email]
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 border-b border-slate-200 pb-3">
                    <dt className="text-xs font-medium text-slate-500">{label}</dt>
                    <dd className="mt-1 break-words text-sm font-medium text-slate-900">{value || "Не указано"}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section className="lg:border-l lg:border-slate-200 lg:pl-8">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950"><KeyRound size={18} /> Сменить пароль</h2>
              <form onSubmit={(event) => void changePassword(event)} className="mt-4 space-y-3">
                <label className="block text-xs font-medium text-slate-600">Текущий пароль<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#ea6a00]" /></label>
                <label className="block text-xs font-medium text-slate-600">Новый пароль<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#ea6a00]" /></label>
                <label className="block text-xs font-medium text-slate-600">Повторите новый пароль<input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#ea6a00]" /></label>
                <p className="text-xs text-slate-500">Минимум 6 символов, одна буква и одна цифра.</p>
                {message ? <p role="status" className="text-sm text-slate-700">{message}</p> : null}
                <button type="submit" disabled={saving} className="w-full rounded-lg bg-[#ea6a00] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#cf5e00] disabled:opacity-60">{saving ? "Сохраняем..." : "Сохранить пароль"}</button>
              </form>
            </section>
          </div>
        ) : (
          <section className="py-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Моё обучение</h2>
                <p className="mt-1 text-sm text-slate-500">Завершенные треки и изученные материалы</p>
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1" role="group" aria-label="Тип изученного">
                <button type="button" onClick={() => setLearningTab("tracks")} className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${learningTab === "tracks" ? "bg-orange-50 text-[#c95b00]" : "text-slate-600 hover:bg-slate-50"}`}><FolderOpen size={16} /> Треки {studyLoaded ? completedTracks.length : ""}</button>
                <button type="button" onClick={() => setLearningTab("materials")} className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${learningTab === "materials" ? "bg-orange-50 text-[#c95b00]" : "text-slate-600 hover:bg-slate-50"}`}><BookOpen size={16} /> Материалы {studyLoaded ? progress.length : ""}</button>
              </div>
            </div>

            {!studyLoaded ? <p className="mt-8 text-sm text-slate-500">Загружаем историю обучения...</p> : null}
            {studyError ? <p role="status" className="mt-4 text-sm text-red-700">Не удалось загрузить часть истории обучения. Обновите страницу.</p> : null}
            {studyLoaded && learningTab === "tracks" ? (
              completedTracks.length ? <div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
                {completedTracks.map((track) => (
                  <details key={track.id} className="group py-1">
                    <summary className="flex cursor-pointer list-none items-center gap-3 py-4 text-left [&::-webkit-details-marker]:hidden">
                      <CheckCircle2 size={19} className="shrink-0 text-emerald-600" />
                      <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{track.title}</span>
                      <ChevronDown size={18} className="shrink-0 text-slate-400 transition group-open:rotate-180" />
                    </summary>
                    <div className="pb-5 pl-8 text-sm text-slate-600">
                      {track.description ? <p className="leading-6">{track.description}</p> : null}
                      <p className="mt-3 text-xs font-semibold uppercase text-slate-500">Материалы трека</p>
                      <ol className="mt-2 space-y-2">
                        {track.materialIds.map((id, index) => <li key={id}>{index + 1}. {materialById.get(id)?.title ?? progress.find((item) => item.materialId === id)?.materialTitle ?? "Материал"}</li>)}
                      </ol>
                      <Link href={`/?track=${encodeURIComponent(track.id)}`} className="mt-4 inline-flex font-semibold text-[#c95b00] hover:underline">Открыть трек</Link>
                    </div>
                  </details>
                ))}
              </div> : <p className="mt-8 text-sm text-slate-500">Завершенных треков пока нет.</p>
            ) : null}
            {studyLoaded && learningTab === "materials" ? (
              progress.length ? <div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
                {progress.map((item) => {
                  const material = materialById.get(item.materialId);
                  return <details key={item.materialId} className="group py-1">
                    <summary className="flex cursor-pointer list-none items-center gap-3 py-4 text-left [&::-webkit-details-marker]:hidden">
                      <CheckCircle2 size={19} className="shrink-0 text-emerald-600" />
                      <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{material?.title ?? item.materialTitle ?? "Материал"}</span>
                      <ChevronDown size={18} className="shrink-0 text-slate-400 transition group-open:rotate-180" />
                    </summary>
                    <div className="pb-5 pl-8 text-sm text-slate-600">
                      {material?.description ? <p className="leading-6">{material.description}</p> : null}
                      <p className="mt-2">{material?.type === "file" ? "Файл" : "Материал"}{item.completedAt ? ` · Изучен ${item.completedAt.toLocaleDateString("ru-RU")}` : ""}</p>
                      {material ? <Link href={`/?material=${encodeURIComponent(material.id)}`} className="mt-4 inline-flex font-semibold text-[#c95b00] hover:underline">Открыть материал</Link> : null}
                    </div>
                  </details>;
                })}
              </div> : <p className="mt-8 text-sm text-slate-500">Изученных материалов пока нет.</p>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
