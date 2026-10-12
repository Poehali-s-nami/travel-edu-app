"use client";

import { FormEvent, useState } from "react";
import { User } from "firebase/auth";
import { Eye, EyeOff, KeyRound, LogOut } from "lucide-react";

const PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).{6,}$/u;

export function PasswordChangeGate({
  user,
  displayName,
  onSignOut
}: {
  user: User;
  displayName: string;
  onSignOut: () => void;
}) {
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!PASSWORD_PATTERN.test(password)) {
      setMessage("Пароль должен содержать минимум 6 символов, хотя бы одну букву и одну цифру.");
      return;
    }

    if (password !== confirmation) {
      setMessage("Пароли не совпадают.");
      return;
    }

    setIsSubmitting(true);

    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/access/confirm-password-change", {
        method: "POST",
        headers: {
          authorization: `Bearer ${idToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ password, currentPassword })
      });

      if (!response.ok) {
        const result = (await response.json()) as { message?: string };
        throw new Error(result.message ?? "Не удалось сохранить новый пароль.");
      }

      await user.getIdToken(true).catch(() => undefined);
    } catch (error) {
      console.error("Password change failed", error);
      setMessage(
        error instanceof Error ? error.message : "Не удалось сохранить новый пароль."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-8">
      <section className="w-full max-w-lg rounded-xl bg-white p-6 shadow-lg ring-1 ring-slate-200 sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-50 text-[#ea6a00]">
          <KeyRound size={24} />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-slate-950">
          Создайте личный пароль
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {displayName ? `${displayName}, первоначальный пароль нужно заменить.` : "Первоначальный пароль нужно заменить."}
          После этого новый пароль будет принадлежать только вам и сохранится при следующих обновлениях базы.
        </p>
        <div className="mt-4 rounded-lg border border-orange-100 bg-orange-50 p-4 text-sm leading-6 text-slate-700">
          Используйте не менее 6 символов, минимум одну букву и одну цифру. Продолжить работу без смены пароля нельзя.
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Первоначальный пароль
            <input
              type={showPassword ? "text" : "password"}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Новый пароль
            <span className="relative mt-2 block">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-3 pr-12 outline-none focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-400 hover:text-slate-700"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Повторите новый пароль
            <input
              type={showPassword ? "text" : "password"}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              required
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 outline-none focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
            />
          </label>

          {message ? (
            <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              {message}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex w-full items-center justify-center rounded-lg bg-[#ea6a00] px-5 py-3 text-sm font-semibold text-white hover:bg-[#cf5e00] disabled:cursor-wait disabled:opacity-60"
          >
            {isSubmitting ? "Сохраняем..." : "Сохранить пароль и продолжить"}
          </button>
        </form>

        <button
          type="button"
          onClick={onSignOut}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50"
        >
          <LogOut size={16} />
          Выйти из аккаунта
        </button>
      </section>
    </main>
  );
}
