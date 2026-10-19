"use client";

import { FormEvent, useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { ChevronDown, CircleHelp, Eye, EyeOff } from "lucide-react";
import Image from "next/image";
import AnimatedTravelHero from "@/components/AnimatedTravelHero";
import { loginToFirebaseEmail } from "@/lib/access";
import { auth } from "@/lib/firebase";

type LoginStatus =
  | "active"
  | "admin"
  | "archived"
  | "blocked"
  | "unclaimed"
  | "empty"
  | "not-found"
  | "unknown";

async function getLoginStatus(login: string) {
  try {
    const response = await fetch("/api/access/login-status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login })
    });
    const data = (await response.json()) as { status?: LoginStatus };
    return data.status ?? "unknown";
  } catch {
    return "unknown";
  }
}

function getLoginErrorMessage(status: LoginStatus) {
  if (status === "not-found") {
    return "Пользователь не найден. Проверьте CRM-логин или ФИО как в CRM.";
  }

  if (status === "blocked") {
    return "Доступ заблокирован. Обратитесь к администратору PSN HUB.";
  }

  if (status === "archived") {
    return "Доступ архивирован. Обратитесь к администратору PSN HUB.";
  }

  if (status === "unclaimed") {
    return "Аккаунт ещё не подготовлен. Обратитесь к администратору PSN HUB.";
  }

  if (status === "active" || status === "admin") {
    return "Пароль неверный. Проверьте введенные данные.";
  }

  return "Не удалось войти. Проверьте логин и пароль.";
}

export function UserLogin() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!auth) {
      setMessage("Сервис входа временно недоступен.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    try {
      const email = await loginToFirebaseEmail(login);
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      const status = await getLoginStatus(login);
      setMessage(getLoginErrorMessage(status));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-white [font-family:'Lato',Arial,sans-serif] md:grid-cols-[minmax(0,1.15fr)_minmax(27rem,0.85fr)]">
      <section className="relative hidden h-screen min-h-screen overflow-hidden md:block">
        <AnimatedTravelHero />
      </section>

      <section className="relative flex min-h-screen items-center justify-center bg-white px-6 py-12 sm:px-10 lg:px-14 xl:px-20">
        <div className="w-full max-w-[25rem]">
          <Image
            src="/psn-logo.svg"
            alt="Поехали с нами"
            width={2108}
            height={871}
            priority
            className="mx-auto mb-6 h-16 w-auto object-contain sm:h-[4.5rem]"
          />

          <div className="text-center">
            <h1 className="text-xl font-bold text-[#0b182f]">PSN HUB</h1>
            <p className="mt-1 text-[11px] font-light uppercase leading-5 tracking-[0.2em] text-[#6B7280]">
              Центр экспертных знаний и профессионального развития
            </p>
          </div>

          <form onSubmit={handleSubmit} className="mt-12 space-y-8">
            <label className="relative block border-b-2 border-[#E5E7EB] transition-all duration-300 focus-within:border-[#F26522] focus-within:shadow-[0_7px_10px_-9px_rgba(242,101,34,0.9)]">
              <span className="sr-only">CRM-логин, ФИО или почта администратора</span>
              <input
                type="text"
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                placeholder="Логин"
                autoComplete="username"
                required
                aria-describedby="login-help"
                className="w-full bg-transparent py-3 pl-0 pr-11 text-base text-[#0b182f] caret-[#F26522] outline-none placeholder:text-gray-400"
              />

              <span
                tabIndex={0}
                aria-label="Подсказка для поля логина"
                className="group absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-help items-center justify-center text-slate-400 outline-none transition hover:text-[#F26522] focus-visible:text-[#F26522]"
              >
                <CircleHelp size={18} aria-hidden="true" />
                <span
                  id="login-help"
                  role="tooltip"
                  className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] right-0 z-20 w-72 rounded-md bg-[#0b182f] px-3 py-2 text-left text-xs font-normal leading-5 text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100 group-focus:opacity-100"
                >
                  Введите логин из CRM и пароль. При первом входе используйте
                  временный пароль и затем замените его личным.
                </span>
              </span>
            </label>

            <label className="relative block border-b-2 border-[#E5E7EB] transition-all duration-300 focus-within:border-[#F26522] focus-within:shadow-[0_7px_10px_-9px_rgba(242,101,34,0.9)]">
              <span className="sr-only">Пароль</span>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Пароль"
                autoComplete="current-password"
                required
                className="w-full bg-transparent py-3 pl-0 pr-12 text-base text-[#0b182f] caret-[#F26522] outline-none placeholder:text-gray-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                className="absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-slate-400 transition hover:text-[#0b182f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F26522]"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </label>

            {message ? (
              <p
                role="alert"
                className="rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm text-red-700"
              >
                {message}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-[#F26522] px-6 py-4 text-base font-bold text-white transition-colors duration-200 hover:bg-[#dc5518] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F26522] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? "Подождите..." : "Войти"}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => setShowHelp((current) => !current)}
              aria-expanded={showHelp}
              className="mt-4 inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-[#F26522] transition hover:text-[#dc5518] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F26522] focus-visible:ring-offset-4"
            >
              Забыли пароль?
              <ChevronDown
                size={16}
                className={`transition-transform duration-200 ${showHelp ? "rotate-180" : ""}`}
                aria-hidden="true"
              />
            </button>

            {showHelp ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-left text-sm leading-6 text-slate-500 shadow-sm">
                <p className="mt-1">
                  Обратитесь к администратору PSN HUB. Администратор назначит
                  временный пароль. После входа вы создадите новый личный
                  пароль. Контакты: psnkzeducation@gmail.com,
                  +7 708 491 4880.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
