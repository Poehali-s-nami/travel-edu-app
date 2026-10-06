"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Draft = { dirty: boolean; save: () => Promise<boolean>; discard: () => void };
const Context = createContext<{
  register: (draft: Draft) => () => void;
  navigate: (action: () => void) => void;
} | null>(null);

export function UnsavedEditorProvider({ children }: { children: ReactNode }) {
  const current = useRef<Draft | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const register = useCallback((draft: Draft) => {
    current.current = draft;
    return () => { if (current.current === draft) current.current = null; };
  }, []);
  const navigate = useCallback((action: () => void) => {
    if (!current.current?.dirty) action();
    else { setError(""); setPending(() => action); }
  }, []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (current.current?.dirty) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  return (
    <Context.Provider value={{ register, navigate }}>
      {children}
      {pending ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
          <div className="w-full max-w-md space-y-4 rounded-lg bg-white p-5 shadow-xl">
            <h3 id="unsaved-title" className="text-lg font-semibold">Сохранить изменения?</h3>
            <p className="text-sm text-slate-600">В редакторе остались несохранённые правки.</p>
            {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={saving} className="rounded-lg bg-orange-600 px-3 py-2 text-sm text-white disabled:opacity-50" onClick={async () => {
                setSaving(true);
                try {
                  if (await current.current?.save()) { setPending(null); pending(); }
                  else setError("Не удалось сохранить. Проверьте поля и повторите попытку.");
                } catch { setError("Не удалось сохранить. Правки остались в редакторе."); }
                finally { setSaving(false); }
              }}>{saving ? "Сохранение…" : "Сохранить и продолжить"}</button>
              <button type="button" disabled={saving} className="rounded-lg border px-3 py-2 text-sm" onClick={() => { current.current?.discard(); setPending(null); pending(); }}>Не сохранять</button>
              <button autoFocus type="button" disabled={saving} className="rounded-lg border px-3 py-2 text-sm" onClick={() => setPending(null)}>Остаться</button>
            </div>
          </div>
        </div>
      ) : null}
    </Context.Provider>
  );
}

export function useEditorNavigation() {
  const context = useContext(Context);
  if (!context) throw new Error("Missing UnsavedEditorProvider");
  return context.navigate;
}

export function useEditorDraft(value: unknown, persist: () => Promise<boolean>, discard: () => void, resetValue?: unknown) {
  const context = useContext(Context);
  if (!context) throw new Error("Missing UnsavedEditorProvider");
  const signature = JSON.stringify(value);
  const latest = useRef(signature);
  latest.current = signature;
  const [baseline, setBaseline] = useState(signature);
  const inflight = useRef<Promise<boolean> | null>(null);
  const save = useCallback(() => {
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        const success = await persist();
        if (success) setBaseline(resetValue === undefined ? signature : JSON.stringify(resetValue));
        return success && (resetValue !== undefined || latest.current === signature);
      } finally { inflight.current = null; }
    })();
    return inflight.current;
  }, [persist, resetValue, signature]);
  useEffect(() => context.register({ dirty: signature !== baseline, save, discard }), [context, signature, baseline, save, discard]);
  return save;
}
