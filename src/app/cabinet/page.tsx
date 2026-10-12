"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { collection, doc, onSnapshot, query, Timestamp, where } from "firebase/firestore";
import { PasswordChangeGate } from "@/components/PasswordChangeGate";
import {
  PersonalCabinet,
  type CabinetMaterial,
  type CabinetProgress,
  type CabinetTrack
} from "@/components/PersonalCabinet";
import { UserLogin } from "@/components/UserLogin";
import { ADMIN_EMAIL, auth, db } from "@/lib/firebase";
import type { AccessUser } from "@/types/access-user";

export default function CabinetPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [profile, setProfile] = useState<AccessUser | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [materials, setMaterials] = useState<CabinetMaterial[]>([]);
  const [tracks, setTracks] = useState<CabinetTrack[]>([]);
  const [progress, setProgress] = useState<CabinetProgress[]>([]);
  const [studyLoaded, setStudyLoaded] = useState(false);
  const [studyError, setStudyError] = useState(false);

  useEffect(() => {
    if (!auth) {
      setAuthLoaded(true);
      return;
    }
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!user || !db || user.email === ADMIN_EMAIL) {
      setProfile(null);
      setProfileLoaded(true);
      return;
    }
    setProfileLoaded(false);
    return onSnapshot(
      doc(db, "accessUsers", user.uid),
      (snapshot) => {
        if (!snapshot.exists()) {
          setProfile(null);
        } else {
          const data = snapshot.data();
          const toDate = (value: unknown) => value instanceof Timestamp ? value.toDate() : undefined;
          setProfile({
            id: snapshot.id,
            crmId: data.crmId ?? snapshot.id,
            login: data.login ?? "",
            normalizedLogin: data.normalizedLogin ?? "",
            displayName: data.displayName ?? data.login ?? "Пользователь",
            office: data.office ?? "",
            email: data.email ?? "",
            phone: data.phone ?? "",
            role: data.role ?? "user",
            active: data.active === true,
            archived: data.archived === true,
            manual: data.manual === true,
            source: data.source ?? "crm",
            passwordResetRequested: data.passwordResetRequested === true,
            passwordPolicyVersion: Number(data.passwordPolicyVersion ?? 0),
            passwordChangedAt: toDate(data.passwordChangedAt),
            createdAt: toDate(data.createdAt) ?? new Date(),
            updatedAt: toDate(data.updatedAt),
            lastLoginAt: toDate(data.lastLoginAt)
          });
        }
        setProfileLoaded(true);
      },
      () => {
        setProfile(null);
        setProfileLoaded(true);
      }
    );
  }, [user]);

  useEffect(() => {
    if (!user || !db || !profile?.active || profile.archived || profile.passwordResetRequested) {
      setStudyLoaded(false);
      return;
    }
    const firestore = db;
    const loadedSources = new Set<string>();
    const markLoaded = (source: string) => {
      loadedSources.add(source);
      if (loadedSources.size === 3) setStudyLoaded(true);
    };
    setStudyError(false);
    setStudyLoaded(false);
    const onError = (source: string) => () => {
      setStudyError(true);
      markLoaded(source);
    };
    const unsubProgress = onSnapshot(
      query(collection(firestore, "learningProgress"), where("userId", "==", user.uid)),
      (snapshot) => {
        setProgress(snapshot.docs.map((item) => {
          const data = item.data();
          return {
            materialId: String(data.materialId ?? ""),
            materialTitle: String(data.materialTitle ?? ""),
            completedAt: data.completedAt instanceof Timestamp ? data.completedAt.toDate() : undefined
          };
        }));
        markLoaded("progress");
      },
      onError("progress")
    );
    const unsubMaterials = onSnapshot(
      collection(firestore, "materials"),
      (snapshot) => {
        setMaterials(snapshot.docs.map((item) => {
          const data = item.data();
          return {
            id: item.id,
            title: String(data.title ?? "Материал"),
            description: String(data.description ?? ""),
            type: data.type === "file" ? "file" as const : "video" as const
          };
        }));
        markLoaded("materials");
      },
      onError("materials")
    );
    const unsubTracks = onSnapshot(
      collection(firestore, "tracks"),
      (snapshot) => {
        setTracks(snapshot.docs.map((item) => {
          const data = item.data();
          return {
            id: item.id,
            title: String(data.title ?? "Обучающий трек"),
            description: String(data.description ?? ""),
            materialIds: Array.isArray(data.materialIds)
              ? data.materialIds.filter((id: unknown): id is string => typeof id === "string")
              : []
          };
        }));
        markLoaded("tracks");
      },
      onError("tracks")
    );
    return () => {
      unsubProgress();
      unsubMaterials();
      unsubTracks();
    };
  }, [user, profile?.active, profile?.archived, profile?.passwordResetRequested]);

  if (!authLoaded || (user && !profileLoaded)) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">Загружаем кабинет...</main>;
  }
  if (!user) return <UserLogin />;
  if (user.email === ADMIN_EMAIL) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="text-center"><p className="text-lg font-semibold text-slate-900">Кабинет сотрудника</p><Link href="/" className="mt-4 inline-block text-[#c95b00]">На главную</Link></div></main>;
  }
  if (!profile || !profile.active || profile.archived) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4"><div className="text-center"><p className="text-lg font-semibold text-slate-900">Доступ приостановлен</p><Link href="/" className="mt-4 inline-block text-[#c95b00]">На главную</Link></div></main>;
  }
  if (profile.passwordResetRequested) {
    return <PasswordChangeGate user={user} displayName={profile.displayName} onSignOut={() => auth && void signOut(auth)} />;
  }
  return (
    <PersonalCabinet
      user={user}
      profile={profile}
      tracks={tracks}
      materials={materials}
      progress={progress}
      studyLoaded={studyLoaded}
      studyError={studyError}
      onSignOut={() => auth && void signOut(auth)}
    />
  );
}
