"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getIdTokenResult,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  User
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where
} from "firebase/firestore";
import {
  BookOpen,
  CalendarDays,
  Crown,
  ExternalLink,
  FolderOpen,
  GraduationCap,
  LogOut,
  Mail,
  Menu,
  Phone,
  Search,
  ShieldCheck,
  UserRound,
  X
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AdminForm } from "@/components/AdminForm";
import { ContentModal } from "@/components/ContentModal";
import {
  FilterSidebar,
  filterMaterials
} from "@/components/FilterSidebar";
import { MaterialCard } from "@/components/MaterialCard";
import { TrackCard } from "@/components/TrackCard";
import { TrackModal } from "@/components/TrackModal";
import { UserLogin } from "@/components/UserLogin";
import { PasswordChangeGate } from "@/components/PasswordChangeGate";
import { ADMIN_EMAIL, auth, db } from "@/lib/firebase";
import {
  demoMaterials,
  demoTracks,
  durationOptions,
  getSpeakerCompanyLabel,
  uniqueSorted,
  videoFormat,
  videoFormats
} from "@/lib/materials";
import type {
  ContentTab,
  FilterState,
  LearningTrack,
  Material
} from "@/types/material";
import type { AccessUser } from "@/types/access-user";

const PAGE_SIZE = 12;
const MIN_DEMO_ITEMS_PER_SECTION = 6;
const CALENDAR_URL =
  process.env.NEXT_PUBLIC_CALENDAR_URL ?? "https://learningagenda.netlify.app/";
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

type AppTab = ContentTab | "calendar";

const emptyFilters: FilterState = {
  topics: [],
  speakers: [],
  formats: [],
  durations: []
};

const tabs: Array<{ id: AppTab; label: string; icon: typeof GraduationCap }> =
  [
    { id: "webinars", label: "Видеотека", icon: GraduationCap },
    { id: "knowledge", label: "База знаний", icon: BookOpen },
    { id: "tracks", label: "Обучающий трек", icon: FolderOpen },
    { id: "calendar", label: "Календарь", icon: CalendarDays }
  ];

function addDemoMaterialsToMinimum(sourceMaterials: Material[]) {
  const result = [...sourceMaterials];
  const existingIds = new Set(sourceMaterials.map((material) => material.id));

  (["webinars", "knowledge"] as const).forEach((tab) => {
    let activeCount = result.filter(
      (material) => material.tab === tab && !material.archived
    ).length;

    for (const demoMaterial of demoMaterials) {
      if (
        activeCount >= MIN_DEMO_ITEMS_PER_SECTION ||
        demoMaterial.tab !== tab ||
        existingIds.has(demoMaterial.id)
      ) {
        continue;
      }

      result.push(demoMaterial);
      existingIds.add(demoMaterial.id);
      activeCount += 1;
    }
  });

  return result;
}

export default function Home() {
  const [materials, setMaterials] = useState<Material[]>(demoMaterials);
  const [tracks, setTracks] = useState<LearningTrack[]>(demoTracks);
  const [activeTab, setActiveTab] = useState<AppTab>("webinars");
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(
    null
  );
  const [selectedTrack, setSelectedTrack] = useState<LearningTrack | null>(null);
  const [selectedTestUrl, setSelectedTestUrl] = useState<string | null>(null);
  const [completedMaterialIds, setCompletedMaterialIds] = useState<Set<string>>(
    () => new Set()
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [isAccessLoading, setIsAccessLoading] = useState(true);
  const [accessLoadError, setAccessLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [videoFormatFilter, setVideoFormatFilter] = useState("Все видео");
  const [videoSort, setVideoSort] = useState("newest");
  const [videoCategories, setVideoCategories] = useState<string[]>([]);

  useEffect(() => {
    if (!auth) {
      setIsAuthLoading(false);
      setIsAccessLoading(false);
      return;
    }

    getRedirectResult(auth)
      .then((result) => {
        if (result?.user?.email === ADMIN_EMAIL) {
          setUser(result.user);
          setIsAdminOpen(true);
          window.sessionStorage.removeItem("travelEduAdminLogin");
        } else if (result?.user) {
          setIsAdminOpen(false);
          window.sessionStorage.removeItem("travelEduAdminLogin");
        }
      })
      .catch((error) => {
        console.error("Google sign-in redirect failed", error);
        setIsAdminOpen(true);
      });

    let active = true;
    let authRevision = 0;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      const revision = ++authRevision;
      setUser(nextUser);
      setIsAuthLoading(false);
      if (nextUser?.email !== ADMIN_EMAIL) setIsAccessLoading(Boolean(nextUser));

      if (nextUser) {
        void getIdTokenResult(nextUser)
          .then((token) => {
            if (active && revision === authRevision) setIsImpersonating(token.claims.psnImpersonation === true);
          })
          .catch(() => { if (active && revision === authRevision) setIsImpersonating(false); });
      }

      if (!nextUser) {
        setIsAuthLoading(false);
        setIsImpersonating(false);
        setAccessUser(null);
        setAccessLoadError(false);
        setIsAccessLoading(false);
        window.localStorage.removeItem("travel-edu-session-start");
        setIsAdminOpen(false);
      }

      if (
        nextUser?.email === ADMIN_EMAIL &&
        window.sessionStorage.getItem("travelEduAdminLogin")
      ) {
        setIsAdminOpen(true);
        window.sessionStorage.removeItem("travelEduAdminLogin");
      } else if (nextUser?.email !== ADMIN_EMAIL) {
        setIsAdminOpen(false);
        window.sessionStorage.removeItem("travelEduAdminLogin");
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const isAdmin = user?.email === ADMIN_EMAIL;
  const hasAccess =
    isAdmin || Boolean(accessUser?.active && !accessUser.archived && accessUser.claimState === "claimed");
  const canUsePlatform = hasAccess &&
    (isAdmin || accessUser?.passwordResetRequested !== true);

  useEffect(() => {
    if (!db || !canUsePlatform) return;
    return onSnapshot(collection(db, "videoCategories"), (snapshot) => {
      setVideoCategories(uniqueSorted(snapshot.docs.map((item) => String(item.data().name ?? ""))));
    }, () => setVideoCategories([]));
  }, [canUsePlatform]);

  useEffect(() => {
    if (!user) {
      return;
    }

    if (isAdmin) {
      setAccessUser(null);
      setIsAccessLoading(false);
      return;
    }

    if (!db) {
      setIsAccessLoading(false);
      return;
    }

    setIsAccessLoading(true);

    return onSnapshot(
      doc(db, "accessUsers", user.uid),
      (snapshot) => {
        setAccessLoadError(false);
        if (!snapshot.exists()) {
          setAccessUser(null);
          setIsAccessLoading(false);
          return;
        }

        const data = snapshot.data();
        const toDate = (value: unknown) =>
          value instanceof Timestamp ? value.toDate() : undefined;

        setAccessUser({
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
          claimState: data.claimState ?? "claimed",
          passwordPolicyVersion: Number(data.passwordPolicyVersion ?? 0),
          passwordChangedAt: toDate(data.passwordChangedAt),
          createdAt: toDate(data.createdAt) ?? new Date(),
          updatedAt: toDate(data.updatedAt),
          lastLoginAt: toDate(data.lastLoginAt)
        });
        setIsAccessLoading(false);
      },
      () => {
        setAccessUser(null);
        setAccessLoadError(true);
        setIsAccessLoading(false);
      }
    );
  }, [isAdmin, user]);

  useEffect(() => {
    if (!user || !hasAccess || !auth) {
      return;
    }

    const storageKey = "travel-edu-session-start";
    const currentStart = Number(window.localStorage.getItem(storageKey));
    const sessionStart = currentStart || Date.now();
    window.localStorage.setItem(storageKey, String(sessionStart));

    const checkSession = () => {
      if (Date.now() - sessionStart >= SESSION_DURATION_MS && auth) {
        void signOut(auth);
      }
    };

    checkSession();
    const interval = window.setInterval(checkSession, 60_000);
    return () => window.clearInterval(interval);
  }, [hasAccess, user]);

  useEffect(() => {
    if (!user || !canUsePlatform || !db) {
      setCompletedMaterialIds(new Set());
      return;
    }

    const progressQuery = query(
      collection(db, "learningProgress"),
      where("userId", "==", user.uid)
    );

    return onSnapshot(
      progressQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        setCompletedMaterialIds(
          new Set(
            snapshot.docs
              .filter((progressDoc) => !progressDoc.metadata.hasPendingWrites)
              .map((progressDoc) => progressDoc.data().materialId)
              .filter(
                (materialId): materialId is string =>
                  typeof materialId === "string"
              )
          )
        );
      },
      (error) => {
        console.warn("Learning progress could not be loaded:", error.message);
        setCompletedMaterialIds(new Set());
      }
    );
  }, [canUsePlatform, user]);

  useEffect(() => {
    if (!user || !canUsePlatform || !db) {
      return;
    }

    const eventKey = `travel-edu-login-event-${user.uid}`;

    if (window.sessionStorage.getItem(eventKey)) {
      return;
    }

    window.sessionStorage.setItem(eventKey, "1");
    void addDoc(collection(db, "loginEvents"), {
      uid: user.uid,
      login: accessUser?.login ?? user.email ?? "",
      createdAt: serverTimestamp(),
      userAgent: window.navigator.userAgent.slice(0, 300)
    }).catch(() => window.sessionStorage.removeItem(eventKey));
  }, [accessUser?.login, canUsePlatform, user]);

  useEffect(() => {
    if (!db || !canUsePlatform) {
      return;
    }

    const materialsQuery = query(
      collection(db, "materials"),
      orderBy("createdAt", "desc")
    );

    return onSnapshot(
      materialsQuery,
      (snapshot) => {
        const firestoreMaterials = snapshot.docs.map((doc) => {
          const data = doc.data();
          const createdAt =
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate()
              : new Date(0);

          return {
            id: doc.id,
            title: data.title ?? "",
            description: data.description ?? "",
            type: data.type ?? "file",
            url: data.url ?? "",
            coverUrl: data.coverUrl ?? "",
            category: data.category ?? [],
            tags: data.tags ?? [],
            format: data.format ?? (data.tab === "webinars" || data.type === "video" ? "Вебинар" : "Документ"),
            author: {
              name: data.author?.name ?? "",
              company: data.author?.company ?? ""
            },
            duration: Number(data.duration ?? 0),
            trendingStamp: data.trendingStamp || undefined,
            hiddenFromLibrary: data.hiddenFromLibrary === true,
            views: typeof data.views === "number" ? data.views : undefined,
            testUrl: data.testUrl ?? "",
            createdAt,
            tab: data.tab ?? (data.type === "video" ? "webinars" : "knowledge"),
            archived: Boolean(data.archived)
          } as Material;
        });

        setMaterials(addDemoMaterialsToMinimum(firestoreMaterials));
      },
      (error) => {
        console.warn("Materials are shown from demo data:", error.message);
        setMaterials(demoMaterials);
      }
    );
  }, [canUsePlatform]);

  useEffect(() => {
    if (!db || !canUsePlatform) {
      return;
    }

    const tracksQuery = query(
      collection(db, "tracks"),
      orderBy("createdAt", "desc")
    );

    return onSnapshot(
      tracksQuery,
      (snapshot) => {
        const firestoreTracks = snapshot.docs.map((doc) => {
          const data = doc.data();
          const createdAt =
            data.createdAt instanceof Timestamp
              ? data.createdAt.toDate()
              : new Date();

          return {
            id: doc.id,
            title: data.title ?? "",
            description: data.description ?? "",
            materialIds: data.materialIds ?? [],
            infoBlocks: data.infoBlocks ?? [],
            tags: data.tags ?? [],
            coverUrl: data.coverUrl ?? "",
            testUrl: data.testUrl ?? "",
            createdAt,
            archived: Boolean(data.archived)
          } as LearningTrack;
        });

        setTracks(firestoreTracks.length > 0 ? firestoreTracks : demoTracks);
      },
      (error) => {
        console.warn("Tracks are shown from demo data:", error.message);
        setTracks(demoTracks);
      }
    );
  }, [canUsePlatform]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const materialId = params.get("material");
    const trackId = params.get("track");

    if (materialId) {
      const material = materials.find((item) => item.id === materialId);
      if (material) {
        setSelectedMaterial(material);
        setActiveTab(material.tab);
      }
    }

    if (trackId) {
      const track = tracks.find((item) => item.id === trackId);
      if (track) {
        setSelectedTrack(track);
        setActiveTab("tracks");
      }
    }
  }, [materials, tracks]);

  function updateUrl(params: Record<string, string | null>) {
    const nextParams = new URLSearchParams(window.location.search);

    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        nextParams.set(key, value);
      } else {
        nextParams.delete(key);
      }
    });

    const queryString = nextParams.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}`
    );
  }

  function handleTabChange(tab: AppTab) {
    setActiveTab(tab);
    setFilters(emptyFilters);
    setVideoFormatFilter("Все видео");
    setIsFilterOpen(false);
    setPage(1);
  }

  async function registerUniqueWebinarView(material: Material) {
    if (material.tab !== "webinars") {
      return;
    }

    const storageKey = `travel-edu-viewed-${material.id}`;

    if (window.localStorage.getItem(storageKey)) {
      return;
    }

    window.localStorage.setItem(storageKey, "1");
    setMaterials((current) =>
      current.map((item) =>
        item.id === material.id
          ? { ...item, views: (item.views ?? 0) + 1 }
          : item
      )
    );

    if (!db || material.id.startsWith("demo-")) {
      return;
    }

    const firestore = db;

    let deviceId = window.localStorage.getItem("travel-edu-device-id");

    if (!deviceId) {
      deviceId = window.crypto.randomUUID();
      window.localStorage.setItem("travel-edu-device-id", deviceId);
    }

    try {
      await runTransaction(firestore, async (transaction) => {
        const viewRef = doc(
          firestore,
          "materialViews",
          `${material.id}_${deviceId}`
        );
        const materialRef = doc(firestore, "materials", material.id);
        const existingView = await transaction.get(viewRef);

        if (existingView.exists()) {
          return;
        }

        transaction.set(viewRef, {
          materialId: material.id,
          deviceId,
          createdAt: serverTimestamp()
        });
        transaction.update(materialRef, { views: increment(1) });
      });
    } catch (error) {
      console.warn("The webinar view could not be saved:", error);
    }
  }

  function openMaterial(material: Material) {
    void registerUniqueWebinarView(material);
    setSelectedMaterial(material);
    updateUrl({ material: material.id });
  }

  function closeMaterial() {
    setSelectedMaterial(null);
    updateUrl({ material: null });
  }

  async function completeMaterial(material: Material) {
    if (!user || !canUsePlatform) {
      throw new Error("Сначала войдите в свой аккаунт.");
    }

    if (!db) {
      throw new Error("База данных временно недоступна. Попробуйте позже.");
    }

    try {
      await setDoc(
        doc(db, "learningProgress", `${user.uid}_${material.id}`),
        {
          userId: user.uid,
          materialId: material.id,
          materialTitle: material.title,
          completedAt: serverTimestamp()
        },
        { merge: true }
      );
      setCompletedMaterialIds((current) => new Set(current).add(material.id));
    } catch (error) {
      console.warn("Learning progress could not be saved:", error);
      throw new Error("Не удалось сохранить прогресс. Проверьте соединение и повторите попытку.");
    }
  }

  function openTest(url: string) {
    const normalizedUrl = url.trim();

    if (normalizedUrl) {
      setSelectedTestUrl(normalizedUrl);
    }
  }

  function openTrack(track: LearningTrack) {
    setSelectedTrack(track);
    updateUrl({ track: track.id, material: null });
  }

  function closeTrack() {
    setSelectedTrack(null);
    updateUrl({ track: null });
  }

  const activeMaterials = useMemo(
    () => materials.filter((material) => !material.archived),
    [materials]
  );

  const activeTracks = useMemo(
    () => tracks.filter((track) => !track.archived),
    [tracks]
  );

  const materialsByTab = useMemo(
    () => ({
      webinars: activeMaterials.filter((material) => material.tab === "webinars" && !material.hiddenFromLibrary),
      knowledge: activeMaterials.filter((material) => material.tab === "knowledge" && !material.hiddenFromLibrary)
    }),
    [activeMaterials]
  );

  const topicOptions = useMemo(
    () => ({
      webinars: uniqueSorted(
        [...videoCategories, ...materialsByTab.webinars.flatMap((material) => material.category)]
      ),
      knowledge: uniqueSorted(
        materialsByTab.knowledge.flatMap((material) => material.category)
      ),
      tracks: []
    }),
    [materialsByTab, videoCategories]
  );

  const knowledgeFormatOptions = useMemo(
    () => uniqueSorted(materialsByTab.knowledge.map((material) => material.format)),
    [materialsByTab]
  );

  const filterOptions = useMemo(() => {
    if (activeTab === "tracks" || activeTab === "calendar") {
      return {
        topics: [],
        speakers: [],
        formats: [],
        durations: []
      };
    }

    const tabMaterials = materialsByTab[activeTab];

    return {
      topics: topicOptions[activeTab],
      speakers:
        activeTab === "webinars"
          ? uniqueSorted(tabMaterials.map(getSpeakerCompanyLabel))
          : [],
      formats: activeTab === "knowledge" ? knowledgeFormatOptions : [],
      durations: activeTab === "webinars" ? durationOptions : []
    };
  }, [activeTab, knowledgeFormatOptions, materialsByTab, topicOptions]);

  const visibleMaterials = useMemo(() => {
    if (activeTab === "tracks" || activeTab === "calendar") {
      return [];
    }

    const tabMaterials = materialsByTab[activeTab];
    const filteredMaterials = filterMaterials(tabMaterials, filters, activeTab);
    const normalizedSearch = search.trim().toLowerCase();

    const searched = filteredMaterials.filter((material) => {
      if (!normalizedSearch) return true;
      const searchable = [
        material.title,
        material.description,
        material.author.name,
        material.author.company,
        material.format,
        ...material.category,
        ...(material.tags ?? [])
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedSearch);
    });
    if (activeTab !== "webinars") return searched;
    return searched
      .filter((material) => videoFormatFilter === "Все видео" || videoFormat(material.format) === videoFormatFilter)
      .sort((a, b) => {
        if (videoSort === "oldest") return a.createdAt.getTime() - b.createdAt.getTime();
        if (videoSort === "views") return (b.views ?? 0) - (a.views ?? 0);
        if (videoSort === "duration") return b.duration - a.duration;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
  }, [activeTab, filters, materialsByTab, search, videoFormatFilter, videoSort]);

  const visibleTracks = useMemo(() => {
    if (activeTab !== "tracks") {
      return [];
    }

    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return activeTracks;
    }

    return activeTracks.filter((track) =>
      [track.title, track.description, ...(track.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [activeTab, activeTracks, search]);

  const visibleItemsCount =
    activeTab === "tracks"
      ? visibleTracks.length
      : activeTab === "calendar"
        ? 0
        : visibleMaterials.length;
  const totalPages = Math.max(1, Math.ceil(visibleItemsCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedMaterials = visibleMaterials.slice(
    startIndex,
    startIndex + PAGE_SIZE
  );
  const paginatedTracks = visibleTracks.slice(startIndex, startIndex + PAGE_SIZE);
  const isTrackCompleted = (track: LearningTrack) => {
    const trackMaterials = track.materialIds.filter((id) =>
      activeMaterials.some((material) => material.id === id)
    );

    return (
      trackMaterials.length > 0 &&
      trackMaterials.every((id) => completedMaterialIds.has(id))
    );
  };

  if (isAuthLoading || (user && isAccessLoading)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm font-medium text-slate-500">Проверяем доступ...</p>
      </main>
    );
  }

  if (!user) {
    return <UserLogin />;
  }

  if (!hasAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <section className="w-full max-w-md rounded-xl bg-white p-7 text-center shadow-md ring-1 ring-slate-200/70">
          <ShieldCheck className="mx-auto text-slate-300" size={34} />
          <h1 className="mt-4 text-xl font-semibold text-slate-950">
             {accessLoadError ? "Не удалось проверить доступ" : "Доступ приостановлен"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
             {accessLoadError
               ? "Сервис данных временно недоступен. Ваш пароль мог быть принят, но профиль сейчас не загрузился. Повторите попытку позже."
               : "Учетная запись не активна или еще не добавлена в PSN HUB. Обратитесь к администратору."}
          </p>
          <div className="mt-5 rounded-lg bg-slate-50 p-4 text-left text-sm leading-6 text-slate-600 ring-1 ring-slate-200">
            <p className="font-semibold text-slate-900">Что делать дальше</p>
            <p className="mt-1">
              Напишите администратору и укажите свой CRM-логин или ФИО.
            </p>
            <div className="mt-3 space-y-2">
              <p className="flex items-center gap-2">
                <Mail size={16} className="text-[#ea6a00]" />
                psnkzeducation@gmail.com
              </p>
              <p className="flex items-center gap-2">
                <Phone size={16} className="text-[#ea6a00]" />
                +7 708 491 4880
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => auth && void signOut(auth)}
            aria-label="Выйти из аккаунта"
            title="Выйти"
            className="mt-6 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <LogOut size={19} />
          </button>
        </section>
      </main>
    );
  }

  if (!isAdmin && accessUser?.passwordResetRequested) {
    return (
      <PasswordChangeGate
        user={user}
        displayName={accessUser.displayName}
        onSignOut={() => auth && void signOut(auth)}
      />
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      {isImpersonating ? (
        <div className="border-b border-orange-200 bg-orange-50 px-4 py-2 text-center text-sm text-slate-800">
          Вы вошли как {accessUser?.login || "сотрудник"} через администратора. Действия сохраняются от имени сотрудника.
          <button type="button" onClick={() => auth && void signOut(auth)} className="ml-2 font-semibold text-[#c95b00] underline">Завершить сеанс</button>
        </div>
      ) : null}
      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="mb-6 flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200/70 sm:px-5 lg:grid lg:grid-cols-[10rem_minmax(0,1fr)_auto]">
          <Image
            src="/psn-logo.svg"
            alt="Поехали с нами"
            width={2108}
            height={871}
            priority
            className="h-12 w-auto shrink-0 object-contain sm:h-14"
          />

          <nav
            aria-label="Разделы PSN HUB"
            className="order-3 inline-flex w-full flex-wrap rounded-lg bg-slate-100 p-1 lg:order-none lg:w-fit lg:justify-self-center"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition lg:flex-none lg:px-4 ${
                    isActive
                      ? "bg-[#ea6a00] text-white shadow-sm"
                      : "text-slate-500 hover:bg-white hover:text-slate-900"
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex min-w-0 items-center gap-1 lg:ml-0 lg:justify-self-end">
            {isAdmin ? (
              <button type="button" onClick={() => setIsAdminOpen(true)} title="Управление PSN HUB"
                aria-label={`Открыть управление PSN HUB: ${user.email ?? "администратор"}`}
                className="inline-flex h-11 min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[#ea6a00] hover:bg-orange-50">
                <Crown size={19} className="shrink-0" />
                <span className="max-w-[10rem] truncate text-sm font-semibold">{user.email?.split("@")[0] ?? "Администратор"}</span>
              </button>
            ) : (
              <Link href="/cabinet" title="Личный кабинет" aria-label={`Открыть кабинет: ${accessUser?.login || user.email || "пользователь"}`}
                className="inline-flex h-11 min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[#ea6a00] hover:bg-orange-50">
                <UserRound size={19} className="shrink-0" />
                <span className="max-w-[10rem] truncate text-sm font-semibold">{accessUser?.login || user.email || "Пользователь"}</span>
              </Link>
            )}
            <button type="button" onClick={() => auth && void signOut(auth)} title="Выйти" aria-label="Выйти из аккаунта"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-[#ea6a00]">
              <LogOut size={19} />
            </button>
          </div>
        </header>

        {activeTab !== "calendar" ? (
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Поиск материалов"
              className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
            />
          </div>
          {activeTab !== "tracks" ? (
            <button
              type="button"
              onClick={() => setIsFilterOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-200/70 lg:hidden"
            >
              <Menu size={17} />
              Фильтры
            </button>
          ) : null}
          </div>
        ) : null}

        {activeTab === "calendar" ? (
          <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <CalendarDays size={20} className="shrink-0 text-[#ea6a00]" />
                <h1 className="truncate text-base font-semibold text-slate-950">
                  Календарь обучения
                </h1>
              </div>
              <a
                href={CALENDAR_URL}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-sm font-medium text-[#ea6a00] transition hover:text-[#c95b00]"
              >
                Открыть отдельно
              </a>
            </div>
            <iframe
              src={CALENDAR_URL}
              title="Календарь обучения"
              className="h-[calc(100vh-12rem)] min-h-[42rem] w-full bg-white"
              allow="clipboard-read; clipboard-write"
            />
          </section>
        ) : (
          <div
            className={
              activeTab === "tracks"
                ? "grid gap-6"
                : "grid gap-6 lg:grid-cols-[22rem_1fr]"
            }
          >
          <FilterSidebar
            activeTab={activeTab}
            filters={filters}
            options={filterOptions}
            isOpen={isFilterOpen}
            onClose={() => setIsFilterOpen(false)}
            onChange={(nextFilters) => {
              setFilters(nextFilters);
              setPage(1);
            }}
            onReset={() => {
              setFilters(emptyFilters);
              setVideoFormatFilter("Все видео");
              setVideoSort("newest");
              setPage(1);
            }}
          />

          <section className="space-y-5">
            {activeTab === "webinars" ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="Формат видео" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-white p-1 ring-1 ring-slate-200">
                  {["Все видео", ...videoFormats].map((format) => (
                    <button key={format} type="button" aria-pressed={videoFormatFilter === format}
                      onClick={() => { setVideoFormatFilter(format); setPage(1); }}
                      className={`shrink-0 rounded-md px-3 py-2 text-sm font-medium ${videoFormatFilter === format ? "bg-[#ea6a00] text-white" : "text-slate-600 hover:bg-orange-50"}`}>
                      {format === "Вебинар" ? "Вебинары" : format === "Видеоурок" ? "Видеоуроки" : format === "Практический разбор" ? "Практические разборы" : format === "Инструкция" ? "Инструкции" : format}
                    </button>
                  ))}
                </div>
                <select aria-label="Сортировка видео" value={videoSort} onChange={(event) => { setVideoSort(event.target.value); setPage(1); }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <option value="newest">Сначала новые</option>
                  <option value="oldest">Сначала старые</option>
                  <option value="views">По просмотрам</option>
                  <option value="duration">По длительности</option>
                </select>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">
                Найдено: {visibleItemsCount}
              </p>
            </div>

            {visibleItemsCount > 0 ? (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {activeTab === "tracks"
                  ? paginatedTracks.map((track) => (
                      <TrackCard
                        key={track.id}
                        track={track}
                        count={
                          track.materialIds.filter((id) =>
                            activeMaterials.some((material) => material.id === id)
                          ).length
                        }
                        isCompleted={isTrackCompleted(track)}
                        onOpen={openTrack}
                      />
                    ))
                  : paginatedMaterials.map((material) => (
                      <MaterialCard
                        key={material.id}
                        material={material}
                        isCompleted={completedMaterialIds.has(material.id)}
                        onOpen={openMaterial}
                      />
                    ))}
              </div>
            ) : (
              <div className="rounded-xl bg-white p-10 text-center shadow-sm ring-1 ring-slate-200/70">
                <h2 className="text-lg font-semibold text-slate-950">
                  Материалы не найдены
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Попробуйте изменить фильтры или поисковый запрос.
                </p>
              </div>
            )}

            {totalPages > 1 ? (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {Array.from({ length: totalPages }, (_, index) => index + 1).map(
                  (pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      onClick={() => setPage(pageNumber)}
                      className={`h-9 min-w-9 rounded-lg px-3 text-sm font-medium transition ${
                        currentPage === pageNumber
                          ? "bg-[#ea6a00] text-white"
                          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {pageNumber}
                    </button>
                  )
                )}
              </div>
            ) : null}
          </section>

          </div>
        )}
      </div>

      <AdminForm
        user={user}
        isOpen={isAdmin && isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        topicOptions={topicOptions}
        formatOptions={knowledgeFormatOptions}
        videoCategories={videoCategories}
        materials={materials}
        tracks={tracks}
      />

      <TrackModal
        track={selectedTrack}
        materials={activeMaterials}
        completedMaterialIds={completedMaterialIds}
        onClose={closeTrack}
        onOpenMaterial={openMaterial}
        onOpenTest={openTest}
      />

      <ContentModal
        material={selectedMaterial}
        isCompleted={
          selectedMaterial ? completedMaterialIds.has(selectedMaterial.id) : false
        }
        onClose={closeMaterial}
        onComplete={completeMaterial}
        onOpenTest={openTest}
      />

      {selectedTestUrl ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-0 sm:p-4">
          <div className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[calc(100vh-2rem)] sm:rounded-xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-950">
                  Тестирование
                </p>
                <p className="truncate text-xs text-slate-400">
                  {selectedTestUrl}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a
                  href={selectedTestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-[#ea6a00]/30 hover:bg-orange-50 hover:text-[#ea6a00] sm:inline-flex"
                >
                  <ExternalLink size={16} />
                  Открыть отдельно
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedTestUrl(null)}
                  aria-label="Закрыть тестирование"
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
            <iframe
              src={selectedTestUrl}
              title="Тестирование"
              className="min-h-0 flex-1 bg-white"
              allow="clipboard-read; clipboard-write"
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}
