"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signInWithRedirect,
  signOut,
  updateProfile,
  User
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc
} from "firebase/firestore";
import {
  Archive,
  BookOpen,
  Copy,
  FileSpreadsheet,
  FolderOpen,
  GraduationCap,
  LogIn,
  LogOut,
  KeyRound,
  PlusCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  UserCheck,
  Users,
  UserX,
  X
} from "lucide-react";
import {
  ADMIN_EMAIL,
  auth,
  createTemporaryAuth,
  db,
  googleProvider
} from "@/lib/firebase";
import { loginToFirebaseEmail, normalizeLogin } from "@/lib/access";
import { categoryKey, formatDate, normalizeCategory, uniqueSorted, videoFormat, videoFormats } from "@/lib/materials";
import { TrackInfoEditor } from "@/components/TrackInfoEditor";
import { TrackPreview } from "@/components/TrackPreview";
import { TrackMaterialPicker } from "@/components/TrackMaterialPicker";
import { TrainingGroupsWorkspace } from "@/components/TrainingGroupsWorkspace";
import { AUDIENCE_ROLES } from "@/lib/content-access";
import { UnsavedEditorProvider, useEditorDraft, useEditorNavigation } from "@/components/UnsavedEditor";
import type {
  ContentTab,
  ContentAudience,
  LearningTrack,
  Material,
  MaterialType,
  TrackInfoBlock,
  TrendingStamp
} from "@/types/material";
import type { AccessUser, TrainingRole } from "@/types/access-user";
import type { TrainingGroup } from "@/types/training-group";

const CRM_IMPORT_BATCH_SIZE = 12;
const PERSONAL_PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).{6,}$/u;
const TRAINING_ROLE_LABELS: Record<TrainingRole, string> = {
  HEAD: "Руководитель",
  MANAGER: "Менеджер",
  EMPLOYEE: "Сотрудник",
  PARTNER: "Партнёр",
  MANUAL_REVIEW: "Нужна проверка",
  ADMIN: "Администратор"
};

type AdminFormProps = {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  topicOptions: Record<ContentTab, string[]>;
  formatOptions: string[];
  videoCategories: string[];
  materials: Material[];
  tracks: LearningTrack[];
};

type AddMode = "menu" | "webinar" | "knowledge" | "track";
type ArchiveMode = "webinars" | "knowledge" | "tracks";
type ArchiveFilter = "active" | "archived" | "all";

type ParsedImportUser = {
  crmId: string;
  login: string;
  loginSource?: "name_fallback";
  displayName: string;
  office: string;
  officeIds: string[];
  offices: string[];
  officeLinks: Array<{ id: string; name: string; city: string }>;
  city: string;
  position: string;
  crmUserTypes: string[];
  email: string;
  phone: string;
  active: boolean;
  isBlocked: boolean;
};

type ImportPreview = {
  fileName: string;
  totalRows: number;
  isActiveUsersReport: boolean;
  validUsers: ParsedImportUser[];
  skippedMissing: number;
  skippedBlocked: number;
  duplicateIds: number;
  duplicateLogins: number;
  conflictingIds: number;
  officeLinks: number;
  blockedCrmIdsWithoutLogin: string[];
  usersForManualBinding: Array<{ crmId: string; displayName: string; crmUserTypes: string[]; isBlocked: boolean; conflictingAccess: boolean }>;
  nameFallbackCount: number;
};

type ImportConflict = {
  crmId: string;
  displayName: string;
  login: string;
  reason: string;
};

type ImportHistoryItem = {
  id: string;
  fileName: string;
  actor: string;
  imported: number;
  created: number;
  updated: number;
  rotatedPasswords?: number;
  skipped: number;
  archiveMissing: boolean;
  createdAt: Date;
};

const trendingStampOptions: TrendingStamp[] = [
  "Must read",
  "Полезно знать",
  "Горячий выпуск"
];

const initialMaterialForm = {
  audience: { mode: "everyone", roles: [], groupIds: [] } as ContentAudience,
  hiddenFromLibrary: false,
  title: "",
  description: "",
  type: "video" as MaterialType,
  url: "",
  testUrl: "",
  coverUrl: "",
  category: "",
  tags: "",
  format: "Вебинар",
  speakerName: "",
  speakerCompany: "",
  trendingStamp: "" as TrendingStamp | "",
  duration: 30
};

const initialTrackForm = {
  audience: { mode: "everyone", roles: [], groupIds: [] } as ContentAudience,
  infoBlocks: [] as TrackInfoBlock[],
  title: "",
  description: "",
  coverUrl: "",
  testUrl: "",
  tags: ""
};

const initialManualUserForm = {
  crmId: "",
  login: "",
  displayName: "",
  office: "",
  email: "",
  phone: "",
  trainingRole: "" as "" | "HEAD" | "MANAGER" | "EMPLOYEE" | "PARTNER",
  groupIds: [] as string[],
  accessCode: ""
};

function normalizeImportValue(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeImportHeader(value: unknown) {
  return normalizeLogin(normalizeImportValue(value)).replace(/[\s._()/-]+/g, "");
}

function getImportValue(
  record: Record<string, string>,
  aliases: string[]
) {
  for (const alias of aliases) {
    const value = record[normalizeImportHeader(alias)];
    if (value !== undefined && value.trim()) return value.trim();
  }

  return "";
}

function rowHasImportHeader(row: unknown[], aliases: string[]) {
  const normalizedRow = new Set(row.map(normalizeImportHeader));
  return aliases.some((alias) => normalizedRow.has(normalizeImportHeader(alias)));
}

function findImportHeaderRow(rows: unknown[][]) {
  const idAliases = ["id", "crm id", "user id", "ид", "код", "id пользователя"];
  const loginAliases = ["login", "username", "логин", "e-mail", "email", "почта"];
  const nameAliases = ["display name", "name", "фио", "пользователь", "сотрудник"];
  const headerIndex = rows.findIndex(
    (row) =>
      (rowHasImportHeader(row, idAliases) || rowHasImportHeader(row, nameAliases)) &&
      rowHasImportHeader(row, loginAliases)
  );

  return headerIndex >= 0 ? headerIndex : 0;
}

function isTruthyImportValue(value: string) {
  const normalized = normalizeLogin(value);
  return ["1", "да", "true", "yes", "y", "заблокирован", "blocked"].includes(
    normalized
  );
}

function buildImportPreview(fileName: string, rows: unknown[][]): ImportPreview {
  const headerRowIndex = findImportHeaderRow(rows);
  const headers = (rows[headerRowIndex] ?? []).map(normalizeImportHeader);
  const hasStableIds = headers.includes(normalizeImportHeader("ID пользователя"));
  const records = rows.slice(headerRowIndex + 1).map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [
        header,
        normalizeImportValue(values[index])
      ])
    )
  );
  const nonEmptyRecords = records.filter((record) => Object.values(record).some(Boolean));
  const users: ParsedImportUser[] = nonEmptyRecords.map((record) => {
    const crmId = getImportValue(record, [
      "id",
      "crm id",
      "user id",
      "ид",
      "код",
      "id пользователя",
      "crm id пользователя",
      "crm_id"
    ]);
    const rawLogin = getImportValue(record, ["login", "username", "логин"]);
    const firstName = getImportValue(record, [
      "first name",
      "имя",
      "имя рус",
      "имя (рус.)"
    ]);
    const lastName = getImportValue(record, [
      "last name",
      "фамилия",
      "фамилия рус",
      "фамилия (рус)"
    ]);
    const displayName =
      getImportValue(record, ["display name", "name", "фио", "пользователь", "сотрудник"]) ||
      [firstName, lastName].filter(Boolean).join(" ");
    const email = getImportValue(record, ["email", "e-mail", "почта"]);
    const login = hasStableIds ? rawLogin : rawLogin || email || displayName;
    const blocked = getImportValue(record, ["blocked", "заблокирован"]);
    const crmAccess = getImportValue(record, ["Доступ в CRM"]);
    const isBlocked = (blocked ? isTruthyImportValue(blocked) : false) || crmAccess === "0";
    const office = getImportValue(record, ["название офиса", "офис", "office"]);
    const officeId = getImportValue(record, ["ID офиса"]);
    const city = getImportValue(record, ["Город офиса"]);
    const crmUserType = getImportValue(record, ["Тип пользователя"]);

    return {
      crmId,
      login,
      displayName: displayName || login,
      office,
      officeIds: officeId ? [officeId] : [],
      offices: office ? [office] : [],
      officeLinks: officeId || office ? [{ id: officeId, name: office, city }] : [],
      city,
      position: getImportValue(record, ["Должность"]),
      crmUserTypes: crmUserType ? [crmUserType] : [],
      email,
      phone: getImportValue(record, ["phone", "телефон"]),
      active: !isBlocked,
      isBlocked
    };
  });
  const idCounts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  const explicitLogins = new Set(users.map((user) => normalizeLogin(user.login)).filter(Boolean));
  const fallbackNames = nonEmptyRecords.map((record) => {
    const first = getImportValue(record, ["first name", "имя", "имя рус", "имя (рус.)"]);
    const last = getImportValue(record, ["last name", "фамилия", "фамилия рус", "фамилия (рус)"]);
    return first && last ? `${first} ${last}` : "";
  });
  users.forEach((user, index) => {
    if (user.crmId) idCounts.set(user.crmId, (idCounts.get(user.crmId) ?? 0) + 1);
    const name = normalizeLogin(fallbackNames[index]);
    if (name) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  });
  let nameFallbackCount = 0;
  if (hasStableIds) {
    users.forEach((user, index) => {
      const name = fallbackNames[index];
      const normalizedName = normalizeLogin(name);
      if (!user.login && user.crmId && name &&
          idCounts.get(user.crmId) === 1 &&
          nameCounts.get(normalizedName) === 1 &&
          !explicitLogins.has(normalizedName)) {
        user.login = name;
        user.loginSource = "name_fallback";
        nameFallbackCount += 1;
      }
    });
  }
  const validSourceUsers = users.filter((importUser) => importUser.login && (!hasStableIds || importUser.crmId));
  const grouped = new Map<string, ParsedImportUser>();
  const conflictingKeys = new Set<string>();
  const loginOwners = new Map<string, string>();
  let duplicateIds = 0;
  let duplicateLogins = 0;

  for (const importUser of validSourceUsers) {
    const normalizedId = importUser.crmId.trim() || `login:${normalizeLogin(importUser.login)}`;
    const normalizedLogin = normalizeLogin(importUser.login);
    const owner = loginOwners.get(normalizedLogin);
    if (owner && owner !== normalizedId) {
      conflictingKeys.add(owner);
      conflictingKeys.add(normalizedId);
      duplicateLogins += 1;
    } else {
      loginOwners.set(normalizedLogin, normalizedId);
    }
    const existing = grouped.get(normalizedId);
    if (existing) {
      duplicateIds += 1;
      if (normalizeLogin(existing.login) !== normalizedLogin ||
          normalizeLogin(existing.displayName) !== normalizeLogin(importUser.displayName) ||
          existing.isBlocked !== importUser.isBlocked) {
        conflictingKeys.add(normalizedId);
        continue;
      }
      for (const officeId of importUser.officeIds) {
        if (!existing.officeIds.includes(officeId)) existing.officeIds.push(officeId);
      }
      for (const office of importUser.offices) {
        if (!existing.offices.includes(office)) existing.offices.push(office);
      }
      for (const link of importUser.officeLinks) {
        if (!existing.officeLinks.some((item) => link.id ? item.id === link.id : item.name === link.name)) {
          existing.officeLinks.push(link);
        }
      }
      for (const userType of importUser.crmUserTypes) {
        if (!existing.crmUserTypes.includes(userType)) existing.crmUserTypes.push(userType);
      }
      continue;
    }
    grouped.set(normalizedId, importUser);
  }
  const validUsers = [...grouped].filter(([key]) => !conflictingKeys.has(key)).map(([, user]) => user);
  const importedIds = new Set(validUsers.map((user) => user.crmId));
  const manualGroups = new Map<string, { crmId: string; displayName: string; crmUserTypes: string[]; accessStates: Set<boolean> }>();
  for (const user of users) {
    if (!hasStableIds || !user.crmId || user.login || importedIds.has(user.crmId)) continue;
    const group = manualGroups.get(user.crmId) ?? {
      crmId: user.crmId, displayName: user.displayName, crmUserTypes: [], accessStates: new Set<boolean>()
    };
    group.accessStates.add(user.isBlocked);
    for (const value of user.crmUserTypes) {
      if (!group.crmUserTypes.includes(value)) group.crmUserTypes.push(value);
    }
    manualGroups.set(user.crmId, group);
  }
  const usersForManualBinding = [...manualGroups.values()].map((group) => ({
    crmId: group.crmId,
    displayName: group.displayName,
    crmUserTypes: group.crmUserTypes,
    isBlocked: group.accessStates.size === 1 && group.accessStates.has(true),
    conflictingAccess: group.accessStates.size > 1
  }));
  const blockedCrmIdsWithoutLogin = usersForManualBinding.filter((user) => user.isBlocked).map((user) => user.crmId);

  return {
    fileName,
    totalRows: users.length,
    isActiveUsersReport: hasStableIds,
    validUsers,
    skippedMissing: users.filter((importUser) => !importUser.login || (hasStableIds && !importUser.crmId))
      .length,
    skippedBlocked: validUsers.filter((importUser) => importUser.isBlocked).length,
    duplicateIds,
    duplicateLogins,
    conflictingIds: conflictingKeys.size,
    officeLinks: validUsers.reduce((count, user) => count + user.officeLinks.length, 0),
    blockedCrmIdsWithoutLogin,
    usersForManualBinding,
    nameFallbackCount
  };
}

export function AdminForm(props: AdminFormProps) {
  return <UnsavedEditorProvider><AdminWorkspace {...props} /></UnsavedEditorProvider>;
}

function AdminWorkspace({
  user,
  isOpen,
  onClose,
  topicOptions,
  formatOptions,
  videoCategories,
  materials,
  tracks
}: AdminFormProps) {
  const navigate = useEditorNavigation();
  const [loginEmail, setLoginEmail] = useState(ADMIN_EMAIL);
  const [loginPassword, setLoginPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [section, setSection] = useState<"add" | "archive" | "users" | "groups">("add");
  const [addMode, setAddMode] = useState<AddMode>("menu");
  const [archiveMode, setArchiveMode] = useState<ArchiveMode>("webinars");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("active");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [materialForm, setMaterialForm] = useState(initialMaterialForm);
  const [trackForm, setTrackForm] = useState(initialTrackForm);
  const [trackMaterialIds, setTrackMaterialIds] = useState<string[]>([]);
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([]);
  const [trainingGroups, setTrainingGroups] = useState<TrainingGroup[]>([]);
  const [manualUserForm, setManualUserForm] = useState(initialManualUserForm);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [importArchiveMissing, setImportArchiveMissing] = useState(false);
  const [importTemporaryPassword, setImportTemporaryPassword] = useState("");
  const [lastImport, setLastImport] = useState<ImportHistoryItem | null>(null);

  const isAdmin = user?.email === ADMIN_EMAIL;

  useEffect(() => {
    if (!isOpen || !isAdmin || !db) {
      setAccessUsers([]);
      return;
    }

    return onSnapshot(
      collection(db, "accessUsers"),
      (snapshot) => {
        const toDate = (value: unknown) =>
          value instanceof Timestamp ? value.toDate() : undefined;

        setAccessUsers(
          snapshot.docs
            .map((userDoc) => {
              const data = userDoc.data();

              return {
                id: userDoc.id,
                crmId: data.crmId ?? userDoc.id,
                login: data.login ?? "",
                normalizedLogin: data.normalizedLogin ?? "",
                displayName: data.displayName ?? data.login ?? "Пользователь",
                office: data.office ?? "",
                officeIds: Array.isArray(data.officeIds) ? data.officeIds : [],
                officeLinks: Array.isArray(data.officeLinks) ? data.officeLinks : [],
                groupIds: Array.isArray(data.groupIds) ? data.groupIds : [],
                email: data.email ?? "",
                phone: data.phone ?? "",
                role: data.role ?? "user",
                trainingRole: data.trainingRole,
                trainingRoleManual: data.trainingRoleManual === true,
                crmUserTypes: Array.isArray(data.crmUserTypes) ? data.crmUserTypes : [],
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
              } as AccessUser;
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"))
        );
      },
      (error) => {
        setAccessUsers([]);
        setMessage(
          error.code === "permission-denied"
            ? "Firestore отклонил доступ к пользователям. Опубликуйте актуальные правила и войдите под почтой администратора."
            : `Не удалось загрузить пользователей: ${error.message}`
        );
      }
    );
  }, [isAdmin, isOpen]);

  useEffect(() => {
    if (!isOpen || !isAdmin || !db) {
      setTrainingGroups([]);
      return;
    }
    return onSnapshot(collection(db, "trainingGroups"), (snapshot) => {
      setTrainingGroups(snapshot.docs.map((item) => {
        const data = item.data();
        return {
          id: item.id,
          name: String(data.name ?? "Группа"),
          kind: data.kind === "office" ? "office" : "manual",
          officeId: typeof data.officeId === "string" ? data.officeId : undefined,
          trackIds: Array.isArray(data.trackIds) ? data.trackIds : [],
          materialIds: Array.isArray(data.materialIds) ? data.materialIds : [],
          archived: data.archived === true
        };
      }));
    }, (error) => setMessage(`Не удалось загрузить группы: ${error.message}`));
  }, [isAdmin, isOpen]);

  useEffect(() => {
    if (!isOpen || !isAdmin || !db) {
      setLastImport(null);
      return;
    }

    return onSnapshot(
      query(collection(db, "importHistory"), orderBy("createdAt", "desc"), limit(1)),
      (snapshot) => {
        const latest = snapshot.docs[0];

        if (!latest) {
          setLastImport(null);
          return;
        }

        const data = latest.data();
        const createdAt =
          data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date();

        setLastImport({
          id: latest.id,
          fileName: data.fileName ?? "",
          actor: data.actor ?? "",
          imported: Number(data.imported ?? 0),
          created: Number(data.created ?? 0),
          updated: Number(data.updated ?? 0),
          rotatedPasswords: Number(data.rotatedPasswords ?? 0),
          skipped: Number(data.skipped ?? 0),
          archiveMissing: data.archiveMissing === true,
          createdAt
        });
      },
      () => setLastImport(null)
    );
  }, [isAdmin, isOpen]);

  const allTopicOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const value of [...videoCategories, ...materials.flatMap((material) => material.category), ...topicOptions.knowledge]) {
      const name = normalizeCategory(value);
      if (name && !options.has(categoryKey(name))) options.set(categoryKey(name), name);
    }
    return uniqueSorted([...options.values()]);
  }, [materials, topicOptions, videoCategories]);

  async function addVideoCategory(input: string): Promise<string | null> {
    const name = normalizeCategory(input);
    if (!name || !db || !isAdmin) return null;
    const existing = allTopicOptions.find((item) => categoryKey(item) === categoryKey(name));
    if (existing) return existing;
    try {
      const categoryRef = doc(db, "videoCategories", encodeURIComponent(categoryKey(name)));
      const categoryDoc = await getDoc(categoryRef);
      if (categoryDoc.exists()) return String(categoryDoc.data().name ?? name);
      await setDoc(categoryRef, { name });
      return name;
    } catch {
      setMessage("Не удалось добавить категорию. Проверьте права Firestore.");
      return null;
    }
  }

  const formatDatalist = useMemo(
    () =>
      uniqueSorted([
        "PDF",
        "Документ",
        "Презентация",
        "Таблица",
        ...formatOptions
      ]),
    [formatOptions]
  );

  if (!isOpen) {
    return null;
  }

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!auth) {
      setMessage("Firebase не настроен для входа.");
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      setMessage("Вход выполнен.");
    } catch {
      setMessage("Не удалось войти. Проверьте почту и пароль.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleLogin() {
    if (!auth) {
      setMessage("Firebase не настроен для входа.");
      return;
    }

    try {
      window.sessionStorage.setItem("travelEduAdminLogin", "1");
      await signInWithRedirect(auth, googleProvider);
    } catch {
      setMessage("Google-вход не открылся. Используйте вход по почте.");
    }
  }

  async function handleLogout() {
    if (!auth) {
      return;
    }

    await signOut(auth);
    setMessage("");
  }

  function chooseAddMode(mode: Exclude<AddMode, "menu">) {
    setAddMode(mode);
    setMessage("");

    if (mode === "webinar") {
      setMaterialForm({
        ...initialMaterialForm,
        type: "video",
        format: "Вебинар"
      });
    }

    if (mode === "knowledge") {
      setMaterialForm({
        ...initialMaterialForm,
        type: "file",
        format: "PDF"
      });
    }

    if (mode === "track") {
      setTrackForm(initialTrackForm);
      setTrackMaterialIds([]);
    }
  }

  async function handleMaterialSubmit() {

    if (!isAdmin || !db) {
      setMessage("Доступ разрешен только администратору.");
      return false;
    }

    const tab = addMode === "webinar" ? "webinars" : "knowledge";

    setIsSubmitting(true);
    setMessage("");

    try {
      await addDoc(collection(db, "materials"), {
        audience: materialForm.audience,
        title: materialForm.title.trim(),
        hiddenFromLibrary: materialForm.hiddenFromLibrary,
        description: materialForm.description.trim(),
        type: tab === "webinars" ? "video" : materialForm.type,
        url: materialForm.url.trim(),
        testUrl: materialForm.testUrl.trim(),
        coverUrl: materialForm.coverUrl.trim(),
        category: splitCategories(materialForm.category, allTopicOptions),
        tags: splitList(materialForm.tags),
        format: materialForm.format.trim(),
        author: {
          name: tab === "webinars" ? materialForm.speakerName.trim() : "",
          company: tab === "webinars" ? materialForm.speakerCompany.trim() : ""
        },
        duration: Number(materialForm.duration),
        trendingStamp:
          tab === "webinars" ? materialForm.trendingStamp || null : null,
        views: 0,
        tab,
        archived: false,
        createdAt: serverTimestamp()
      });

      setMaterialForm({
        ...initialMaterialForm,
        type: tab === "webinars" ? "video" : "file",
        format: tab === "webinars" ? "Вебинар" : "PDF"
      });
      setMessage("Материал добавлен.");
      return true;
    } catch {
      setMessage("Не удалось сохранить материал. Проверьте права Firestore.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTrackSubmit() {

    if (!isAdmin || !db) {
      setMessage("Доступ разрешен только администратору.");
      return false;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      await addDoc(collection(db, "tracks"), {
        audience: trackForm.audience,
        title: trackForm.title.trim(),
        description: trackForm.description.trim(),
        coverUrl: trackForm.coverUrl.trim(),
        testUrl: trackForm.testUrl.trim(),
        tags: splitList(trackForm.tags),
        materialIds: trackMaterialIds,
        infoBlocks: trackForm.infoBlocks,
        archived: false,
        createdAt: serverTimestamp()
      });

      setTrackForm(initialTrackForm);
      setTrackMaterialIds([]);
      setMessage("Обучающий трек добавлен.");
      return true;
    } catch {
      setMessage("Не удалось сохранить трек. Проверьте права Firestore.");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateMaterial(id: string, payload: Partial<Material>) {
    if (!db) {
      return false;
    }

    try {
      const materialRef = doc(db, "materials", id);
      const materialSnapshot = await getDoc(materialRef);

      if (materialSnapshot.exists()) {
        const { author, ...fields } = payload;
        await updateDoc(materialRef, {
          ...fields,
          ...(author ? { "author.name": author.name, "author.company": author.company ?? "" } : {})
        });
      } else {
        const source = materials.find((material) => material.id === id);

        if (!source) {
          throw new Error(`Material ${id} was not found`);
        }

        await setDoc(materialRef, {
          title: source.title,
          description: source.description,
          type: source.type,
          hiddenFromLibrary: source.hiddenFromLibrary ?? false,
          url: source.url,
          testUrl: source.testUrl ?? "",
          coverUrl: source.coverUrl ?? "",
          category: source.category,
          tags: source.tags ?? [],
          format: source.format,
          author: {
            name: source.author.name,
            company: source.author.company ?? ""
          },
          duration: source.duration,
          createdAt: source.createdAt,
          tab: source.tab,
          archived: Boolean(source.archived),
          trendingStamp: source.trendingStamp ?? null,
          views: Number(source.views ?? 0),
          ...payload
        });
      }

      setMessage("Материал обновлен.");
      return true;
    } catch (error) {
      console.error("Failed to update material:", error);
      setMessage("Не удалось обновить материал. Проверьте права Firestore.");
      return false;
    }
  }

  async function updateTrack(id: string, payload: Partial<LearningTrack>) {
    if (!db) {
      return false;
    }

    try {
      const trackRef = doc(db, "tracks", id);
      const trackSnapshot = await getDoc(trackRef);

      if (trackSnapshot.exists()) {
        await updateDoc(trackRef, payload);
      } else {
        const source = tracks.find((track) => track.id === id);

        if (!source) {
          throw new Error(`Track ${id} was not found`);
        }

        await setDoc(trackRef, {
          title: source.title,
          description: source.description,
          materialIds: source.materialIds,
          infoBlocks: source.infoBlocks ?? [],
          tags: source.tags ?? [],
          coverUrl: source.coverUrl ?? "",
          testUrl: source.testUrl ?? "",
          createdAt: source.createdAt,
          archived: Boolean(source.archived),
          ...payload
        });
      }

      setMessage("Трек обновлен.");
      return true;
    } catch (error) {
      console.error("Failed to update track:", error);
      setMessage("Не удалось обновить трек. Проверьте права Firestore.");
      return false;
    }
  }

  async function deleteEntity(collectionName: "materials" | "tracks", id: string) {
    if (!db) {
      return;
    }

    await deleteDoc(doc(db, collectionName, id));
    setMessage("Запись удалена.");
  }

  async function updateAccessUser(
    id: string,
    payload: Partial<AccessUser>
  ) {
    if (!db || !isAdmin) {
      return;
    }

    try {
      await updateDoc(doc(db, "accessUsers", id), {
        ...payload,
        updatedAt: serverTimestamp()
      });
      setMessage("Данные пользователя обновлены.");
    } catch (error) {
      console.error("Failed to update access user:", error);
      setMessage("Не удалось обновить пользователя. Проверьте правила Firestore.");
    }
  }

  async function handleManualUserSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!db || !isAdmin) {
      setMessage("Доступ разрешен только администратору.");
      return;
    }

    const crmId = manualUserForm.crmId.trim();
    const login = manualUserForm.login.trim() || manualUserForm.displayName.trim();
    const displayName = manualUserForm.displayName.trim() || login;
    const accessCode = manualUserForm.accessCode.trim();

    if (!crmId || !login || !manualUserForm.trainingRole || !PERSONAL_PASSWORD_PATTERN.test(accessCode)) {
      setMessage(
        "Заполните CRM ID, логин/ФИО, учебную роль и первоначальный пароль: минимум 6 символов, буква и цифра."
      );
      return;
    }
    if (manualUserForm.groupIds.some((id) => !trainingGroups.some((group) => group.id === id && !group.archived))) {
      setMessage("Одна из выбранных групп больше не доступна. Обновите выбор.");
      return;
    }

    const temporary = createTemporaryAuth();
    setIsSubmitting(true);
    setMessage("");

    try {
      const authEmail = await loginToFirebaseEmail(login);
      const credential = await createUserWithEmailAndPassword(
        temporary.auth,
        authEmail,
        accessCode
      );

      if (displayName) {
        await updateProfile(credential.user, { displayName });
      }

      await setDoc(
        doc(db, "accessUsers", credential.user.uid),
        {
          crmId,
          login,
          normalizedLogin: normalizeLogin(login),
          displayName,
          office: manualUserForm.office.trim(),
          groupIds: manualUserForm.groupIds,
          email: manualUserForm.email.trim(),
          phone: manualUserForm.phone.trim(),
          role: "user",
          trainingRole: manualUserForm.trainingRole,
          trainingRoleManual: true,
          active: true,
          archived: false,
          manual: true,
          source: "manual",
          passwordResetRequested: true,
          passwordPolicyVersion: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      setManualUserForm(initialManualUserForm);
      setMessage(
        "Пользователь добавлен. При первом входе он обязательно создаст личный пароль; следующие импорты его не изменят."
      );

    } catch (error) {
      console.error("Failed to create manual access user:", error);
      setMessage(
        "Не удалось добавить пользователя. Проверьте, не существует ли уже такой логин, и включен ли Email/Password вход в Firebase."
      );
    } finally {
      await temporary.dispose().catch(() => undefined);
      setIsSubmitting(false);
    }
  }

  async function handleImportFile(file: File | null) {
    if (!file) {
      return;
    }

    setMessage("");
    setImportPreview(null);
    setImportConflicts([]);

    try {
      const xlsx = await import("xlsx");
      const workbook = xlsx.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: false,
        raw: false
      });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: "",
        raw: false
      });

      const preview = buildImportPreview(file.name, rows);
      setImportPreview(preview);
      setImportArchiveMissing(false);
      setImportTemporaryPassword("");
    } catch (error) {
      console.error("Failed to parse CRM import file:", error);
      setMessage("Не удалось прочитать Excel-файл. Проверьте, что это .xlsx выгрузка CRM.");
    }
  }

  async function handleWebImportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user || !isAdmin || !importPreview) {
      setMessage("Для импорта нужно войти под администратором и выбрать файл.");
      return;
    }

    if (!PERSONAL_PASSWORD_PATTERN.test(importTemporaryPassword) ||
        importTemporaryPassword.length > 128) {
      setMessage("Задайте общий временный пароль: минимум 6 символов, буква и цифра.");
      return;
    }

    if (
      !window.confirm(
        `Подтвердите обработку ${importPreview.validUsers.length} записей. Новые пользователи получат общий временный пароль. У импортированных сотрудников, которые ещё не установили личный пароль, прежний временный пароль заменится новым. Личные пароли, пароли после сброса администратором, пароли ручных аккаунтов и прогресс сохранятся.`
      )
    ) {
      return;
    }

    if (
      importArchiveMissing && !importPreview.isActiveUsersReport &&
      !window.confirm(
        "Вы включили архивацию пользователей, которых нет в файле. Продолжайте только если это полная CRM-выгрузка, а не тестовая выборка."
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    setImportConflicts([]);

    try {
      const idToken = await user.getIdToken();
      const batches: ParsedImportUser[][] = [];

      for (
        let index = 0;
        index < importPreview.validUsers.length;
        index += CRM_IMPORT_BATCH_SIZE
      ) {
        batches.push(
          importPreview.validUsers.slice(index, index + CRM_IMPORT_BATCH_SIZE)
        );
      }

      const result = {
        created: 0,
        updated: 0,
        skipped:
          importPreview.skippedMissing +
          importPreview.duplicateLogins +
          importPreview.conflictingIds,
        imported: 0,
        rotatedPasswords: 0,
        archivedWithoutLogin: 0
      };
      const conflicts: ImportConflict[] = [];

      for (const [batchIndex, batch] of batches.entries()) {
        setMessage(
          `Импорт пользователей: партия ${batchIndex + 1} из ${batches.length}.`
        );

        const response = await fetch("/api/admin/import-users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idToken,
            temporaryPassword: importTemporaryPassword,
            blockedCrmIdsWithoutLogin: batchIndex === batches.length - 1
              ? importPreview.blockedCrmIdsWithoutLogin
              : undefined,
            archiveMissing: !importPreview.isActiveUsersReport && importArchiveMissing && batchIndex === batches.length - 1,
            allCrmIds:
              !importPreview.isActiveUsersReport && importArchiveMissing && batchIndex === batches.length - 1
                ? importPreview.validUsers
                    .map((importUser) => importUser.crmId)
                    .filter(Boolean)
                : undefined,
            allUserKeys:
              !importPreview.isActiveUsersReport && importArchiveMissing && batchIndex === batches.length - 1
                ? Array.from(
                    new Set(
                      importPreview.validUsers.flatMap((importUser) => [
                        importUser.crmId.trim()
                          ? `crm:${importUser.crmId.trim()}`
                          : "",
                        `login:${normalizeLogin(importUser.login)}`,
                      ]).filter(Boolean)
                    )
                  )
                : undefined,
            users: batch
          })
        });
        const batchResult = (await response.json()) as {
          message?: string;
          created?: number;
          updated?: number;
          skipped?: number;
          imported?: number;
          rotatedPasswords?: number;
          archivedWithoutLogin?: number;
          conflicts?: ImportConflict[];
        };

        if (!response.ok) {
          setImportConflicts(conflicts);
          setMessage(
            `Импорт остановлен на партии ${batchIndex + 1} из ${batches.length}: ${batchResult.message ?? "Не удалось выполнить импорт."} Уже обработано: ${result.imported} пользователей.`
          );
          return;
        }

        result.created += batchResult.created ?? 0;
        result.updated += batchResult.updated ?? 0;
        result.skipped += batchResult.skipped ?? 0;
        result.imported += batchResult.imported ?? 0;
        result.rotatedPasswords += batchResult.rotatedPasswords ?? 0;
        result.archivedWithoutLogin += batchResult.archivedWithoutLogin ?? 0;
        conflicts.push(...(batchResult.conflicts ?? []));
      }

      setImportConflicts(conflicts);
      setMessage(
        `Импорт завершен. Импортировано: ${result.imported ?? 0}, создано: ${
          result.created ?? 0
        }, обновлено: ${result.updated ?? 0}, временных паролей заменено: ${result.rotatedPasswords}, архивировано по ID без логина: ${result.archivedWithoutLogin}, пропущено: ${result.skipped ?? 0}. Конфликтных аккаунтов для ручной проверки: ${conflicts.length}.`
      );
      setImportTemporaryPassword("");
      try {
        if (db) {
          await addDoc(collection(db, "importHistory"), {
            fileName: importPreview.fileName,
            actor: user.email ?? "",
            imported: result.imported ?? 0,
            created: result.created ?? 0,
            updated: result.updated ?? 0,
            rotatedPasswords: result.rotatedPasswords,
            skipped: result.skipped ?? 0,
            archiveMissing: !importPreview.isActiveUsersReport && importArchiveMissing,
            createdAt: serverTimestamp()
          });
        }
      } catch (historyError) {
        console.warn("CRM import history was not saved:", historyError);
      }
    } catch (error) {
      console.warn("Web CRM import failed:", error);
      setMessage(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить импорт пользователей."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleTrackMaterial(id: string) {
    setTrackMaterialIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  function moveTrackMaterial(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) {
      return;
    }

    setTrackMaterialIds((current) => {
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">
              Управление PSN HUB
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <button
                type="button"
                onClick={() => navigate(() => void handleLogout())}
                aria-label="Выйти из аккаунта"
                title="Выйти"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <LogOut size={18} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => navigate(onClose)}
              aria-label="Закрыть"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={22} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-50 px-5 py-6">
          {!user ? (
            <LoginPanel
              email={loginEmail}
              password={loginPassword}
              message={message}
              isSubmitting={isSubmitting}
              onEmailChange={setLoginEmail}
              onPasswordChange={setLoginPassword}
              onSubmit={handleEmailLogin}
              onGoogle={handleGoogleLogin}
            />
          ) : !isAdmin ? (
            <div className="mx-auto max-w-xl rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-600">
                Аккаунт {user.email} не совпадает с ADMIN_EMAIL.
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-7xl space-y-6">
              <div className="flex flex-wrap gap-2">
                <PillButton
                  active={section === "add"}
                  icon={<PlusCircle size={16} />}
                  label="Добавление"
                  onClick={() => navigate(() => {
                    setSection("add");
                    setSelectedEntityId(null);
                  })}
                />
                <PillButton
                  active={section === "archive"}
                  icon={<Archive size={16} />}
                  label="Архив и управление"
                  onClick={() => navigate(() => {
                    setSection("archive");
                    setSelectedEntityId(null);
                  })}
                />
                <PillButton
                  active={section === "users"}
                  icon={<Users size={16} />}
                  label="Пользователи"
                  onClick={() => navigate(() => {
                    setSection("users");
                    setSelectedEntityId(null);
                  })}
                />
                <PillButton
                  active={section === "groups"}
                  icon={<Users size={16} />}
                  label="Группы"
                  onClick={() => navigate(() => {
                    setSection("groups");
                    setSelectedEntityId(null);
                  })}
                />
              </div>

              {section === "add" ? (
                addMode === "menu" ? (
                  <div className="grid gap-5 md:grid-cols-3">
                    <AddChoice
                      icon={<FolderOpen size={28} />}
                      title="Добавить обучающий трек"
                      description="Собрать материалы в нужном порядке."
                      onClick={() => chooseAddMode("track")}
                    />
                    <AddChoice
                      icon={<GraduationCap size={28} />}
                      title="Добавить видеоматериал"
                      description="Видео, спикер, темы и описание."
                      onClick={() => chooseAddMode("webinar")}
                    />
                    <AddChoice
                      icon={<BookOpen size={28} />}
                      title="Пополнить базу знаний"
                      description="PDF, документ, таблица или презентация."
                      onClick={() => chooseAddMode("knowledge")}
                    />
                  </div>
                ) : addMode === "track" ? (
                  <TrackCreateForm
                    form={trackForm}
                    groups={trainingGroups}
                    materials={materials}
                    selectedIds={trackMaterialIds}
                    isSubmitting={isSubmitting}
                    onBack={() => navigate(() => setAddMode("menu"))}
                    onReset={() => { setTrackForm(initialTrackForm); setTrackMaterialIds([]); }}
                    onFormChange={setTrackForm}
                    onSubmit={handleTrackSubmit}
                    onToggleMaterial={toggleTrackMaterial}
                    onMoveMaterial={moveTrackMaterial}
                  />
                ) : (
                  <MaterialCreateForm
                    mode={addMode}
                    groups={trainingGroups}
                    form={materialForm}
                    allTopicOptions={allTopicOptions}
                    onAddCategory={addVideoCategory}
                    formatDatalist={formatDatalist}
                    isSubmitting={isSubmitting}
                    onBack={() => navigate(() => setAddMode("menu"))}
                    onFormChange={setMaterialForm}
                    onSubmit={handleMaterialSubmit}
                  />
                )
              ) : section === "archive" ? (
                <ArchiveWorkspace
                  mode={archiveMode}
                  filter={archiveFilter}
                  selectedId={selectedEntityId}
                  materials={materials}
                  tracks={tracks}
                  groups={trainingGroups}
                  allTopicOptions={allTopicOptions}
                  onAddCategory={addVideoCategory}
                  onModeChange={(mode) => navigate(() => {
                    setArchiveMode(mode);
                    setSelectedEntityId(null);
                  })}
                  onFilterChange={(filter) => navigate(() => {
                    setArchiveFilter(filter);
                    setSelectedEntityId(null);
                  })}
                  onSelect={(id) => { if (id !== selectedEntityId) navigate(() => setSelectedEntityId(id)); }}
                  onUpdateMaterial={updateMaterial}
                  onUpdateTrack={updateTrack}
                  onDelete={deleteEntity}
                />
              ) : section === "groups" ? (
                <TrainingGroupsWorkspace
                  groups={trainingGroups}
                  users={accessUsers}
                  materials={materials}
                  tracks={tracks}
                />
              ) : (
                <UsersWorkspace
                  users={accessUsers}
                  onUpdate={updateAccessUser}
                  manualUserForm={manualUserForm}
                  trainingGroups={trainingGroups}
                  importPreview={importPreview}
                  importConflicts={importConflicts}
                  importArchiveMissing={importArchiveMissing}
                  importTemporaryPassword={importTemporaryPassword}
                  lastImport={lastImport}
                  isSubmitting={isSubmitting}
                  onManualUserChange={setManualUserForm}
                  onManualUserSubmit={handleManualUserSubmit}
                  onImportArchiveMissingChange={setImportArchiveMissing}
                  onImportTemporaryPasswordChange={setImportTemporaryPassword}
                  onImportFile={handleImportFile}
                  onWebImportSubmit={handleWebImportSubmit}
                />
              )}

              {message ? (
                <p className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
                  {message}
                </p>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function LoginPanel({
  email,
  password,
  message,
  isSubmitting,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onGoogle
}: {
  email: string;
  password: string;
  message: string;
  isSubmitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onGoogle: () => void;
}) {
  return (
    <div className="mx-auto max-w-xl rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <form onSubmit={onSubmit} className="space-y-4">
        <TextField
          label="Почта администратора"
          type="email"
          value={email}
          onChange={onEmailChange}
          required
        />
        <TextField
          label="Пароль"
          type="password"
          value={password}
          onChange={onPasswordChange}
          required
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#ea6a00] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#d85f00] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <LogIn size={17} />
          {isSubmitting ? "Вход..." : "Войти по почте"}
        </button>
      </form>
      <button
        type="button"
        onClick={onGoogle}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
      >
        <LogIn size={17} />
        Войти через Google
      </button>
      {message ? (
        <p className="mt-3 text-sm font-medium text-slate-500">{message}</p>
      ) : null}
    </div>
  );
}

function AddChoice({
  icon,
  title,
  description,
  onClick
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl bg-white p-6 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-[#ea6a00]/40"
    >
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-orange-50 text-[#ea6a00]">
        {icon}
      </span>
      <span className="block text-lg font-semibold text-slate-950">{title}</span>
      <span className="mt-2 block text-sm leading-6 text-slate-500">
        {description}
      </span>
    </button>
  );
}

function MaterialCreateForm({
  mode,
  form,
  groups,
  allTopicOptions,
  onAddCategory,
  formatDatalist,
  isSubmitting,
  onBack,
  onFormChange,
  onSubmit
}: {
  mode: Exclude<AddMode, "menu" | "track">;
  form: typeof initialMaterialForm;
  groups: TrainingGroup[];
  allTopicOptions: string[];
  onAddCategory: (name: string) => Promise<string | null>;
  formatDatalist: string[];
  isSubmitting: boolean;
  onBack: () => void;
  onFormChange: (form: typeof initialMaterialForm) => void;
  onSubmit: () => Promise<boolean>;
}) {
  const isWebinar = mode === "webinar";
  const formRef = useRef<HTMLFormElement>(null);
  const emptyForm = { ...initialMaterialForm, type: (isWebinar ? "video" : "file") as MaterialType, format: isWebinar ? "Вебинар" : "PDF" };
  const save = useEditorDraft(form, async () => {
    if (!formRef.current?.reportValidity()) return false;
    return onSubmit();
  }, () => onFormChange(emptyForm), emptyForm);

  return (
    <form
      ref={formRef}
      inert={isSubmitting}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <FormHeader
        title={isWebinar ? "Добавить видеоматериал" : "Пополнить базу знаний"}
        onBack={onBack}
      />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {isWebinar ? <h3 className="text-sm font-semibold text-slate-900 md:col-span-2">Основное</h3> : null}
        <TextField
          label="Название"
          value={form.title}
          onChange={(value) => onFormChange({ ...form, title: value })}
          required
        />
        {isWebinar ? (
          <label className="text-sm font-medium text-slate-700">Формат
            <select required value={form.format} onChange={(event) => onFormChange({ ...form, format: event.target.value })}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900">
              {videoFormats.map((format) => <option key={format} value={format}>{format}</option>)}
            </select>
          </label>
        ) : <TextField label="Формат базы знаний" value={form.format} list="knowledge-formats"
          placeholder="PDF, Документ, Таблица..." onChange={(value) => onFormChange({ ...form, format: value })} required />}
        <TextField
          label={isWebinar ? "Ссылка на видео" : "Ссылка на файл"}
          value={form.url}
          placeholder="https://..."
          onChange={(value) => onFormChange({ ...form, url: value })}
          required
        />
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Описание
          <textarea value={form.description} onChange={(event) => onFormChange({ ...form, description: event.target.value })}
            required rows={4}
            className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100" />
        </label>
        {!isWebinar ? <label className="text-sm font-medium text-slate-700">
          Тип материала
          <select
            value={form.type}
            onChange={(event) =>
              onFormChange({ ...form, type: event.target.value as MaterialType })
            }
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
          >
            <option value="video">Видео</option>
            <option value="file">Файл</option>
          </select>
        </label> : null}
        {isWebinar ? <h3 className="text-sm font-semibold text-slate-900 md:col-span-2">Классификация</h3> : null}
        <datalist id="knowledge-formats">
          {formatDatalist.map((format) => (
            <option key={format} value={format} />
          ))}
        </datalist>
        {isWebinar ? <CategoryPicker value={form.category} options={allTopicOptions}
          onChange={(category) => onFormChange({ ...form, category })} onAdd={onAddCategory} /> : <TextField
          label="Темы / категории"
          value={form.category}
          placeholder="Маркетинг, Продажи"
          list="admin-all-topics"
          onChange={(value) => onFormChange({ ...form, category: value })}
          required
        />}
        <datalist id="admin-all-topics">
          {allTopicOptions.map((topic) => (
            <option key={topic} value={topic} />
          ))}
        </datalist>
        <TextField
          label="Теги"
          value={form.tags}
          placeholder="новичкам, чек-лист, b2b"
          list="admin-all-tags"
          onChange={(value) => onFormChange({ ...form, tags: value })}
        />
        {isWebinar ? <h3 className="text-sm font-semibold text-slate-900 md:col-span-2">Дополнительное</h3> : null}
        <TextField
          label="Длительность, минут"
          type="number"
          value={String(form.duration)}
          onChange={(value) => onFormChange({ ...form, duration: Number(value) })}
          required
        />
        <TextField
          label="Ссылка на тестирование"
          value={form.testUrl}
          placeholder="https://testograf-app.pages.dev/#t=..."
          onChange={(value) => onFormChange({ ...form, testUrl: value })}
        />
        {isWebinar ? (
          <>
            <TextField
              label="Автор / Спикер"
              value={form.speakerName}
              onChange={(value) => onFormChange({ ...form, speakerName: value })}
            />
            <TextField
              label="Компания / Организатор"
              value={form.speakerCompany}
              onChange={(value) =>
                onFormChange({ ...form, speakerCompany: value })
              }
            />
            <label className="text-sm font-medium text-slate-700">
              Метка на обложке
              <select
                value={form.trendingStamp}
                onChange={(event) =>
                  onFormChange({
                    ...form,
                    trendingStamp: event.target.value as TrendingStamp | ""
                  })
                }
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
              >
                <option value="">Без штампа</option>
                {trendingStampOptions.map((stamp) => (
                  <option key={stamp} value={stamp}>
                    {stamp}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <TextField
          label="Обложка"
          value={form.coverUrl}
          placeholder="https://..."
          onChange={(value) => onFormChange({ ...form, coverUrl: value })}
        />
        {isWebinar ? <h3 className="text-sm font-semibold text-slate-900 md:col-span-2">Публикация</h3> : null}
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input type="checkbox" checked={form.hiddenFromLibrary} onChange={(event) => onFormChange({ ...form, hiddenFromLibrary: event.target.checked })} />
          {isWebinar ? "Скрывать из Видеотеки" : "Скрывать из библиотеки"}
        </label>
        <AudiencePicker audience={form.audience} groups={groups} onChange={(audience) => onFormChange({ ...form, audience })} />
      </div>
      <SubmitButton isSubmitting={isSubmitting} label="Добавить материал" />
    </form>
  );
}

function TrackCreateForm({
  form,
  groups,
  materials,
  selectedIds,
  isSubmitting,
  onBack,
  onFormChange,
  onSubmit,
  onReset,
  onToggleMaterial,
  onMoveMaterial
}: {
  form: typeof initialTrackForm;
  groups: TrainingGroup[];
  materials: Material[];
  selectedIds: string[];
  isSubmitting: boolean;
  onBack: () => void;
  onFormChange: (form: typeof initialTrackForm) => void;
  onSubmit: () => Promise<boolean>;
  onReset: () => void;
  onToggleMaterial: (id: string) => void;
  onMoveMaterial: (from: number, to: number) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const save = useEditorDraft({ form, selectedIds }, async () => {
    if (!formRef.current?.reportValidity()) return false;
    return onSubmit();
  }, onReset, { form: initialTrackForm, selectedIds: [] });

  return (
    <form
      ref={formRef}
      inert={isSubmitting}
      onSubmit={(event) => { event.preventDefault(); void save(); }}
      className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <FormHeader title="Добавить обучающий трек" onBack={onBack} />
      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
          <TextField
            label="Название трека"
            value={form.title}
            onChange={(value) => onFormChange({ ...form, title: value })}
            required
          />
          <TextField
            label="Обложка трека"
            value={form.coverUrl}
            placeholder="https://..."
            onChange={(value) => onFormChange({ ...form, coverUrl: value })}
          />
          <TextField
            label="Ссылка на тестирование"
            value={form.testUrl}
            placeholder="https://testograf-app.pages.dev/#t=..."
            onChange={(value) => onFormChange({ ...form, testUrl: value })}
          />
          <TextField
            label="Теги трека"
            value={form.tags}
            placeholder="старт, продажи, новички"
            onChange={(value) => onFormChange({ ...form, tags: value })}
          />
          <label className="text-sm font-medium text-slate-700">
            Описание трека
            <textarea
              value={form.description}
              onChange={(event) =>
                onFormChange({ ...form, description: event.target.value })
              }
              required
              rows={4}
              className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <AudiencePicker audience={form.audience} groups={groups} onChange={(audience) => onFormChange({ ...form, audience })} />
        </div>

        <TrackMaterialPicker materials={materials} selectedIds={selectedIds} onToggle={onToggleMaterial} onMove={onMoveMaterial} />
      </div>
      <TrackInfoEditor blocks={form.infoBlocks} materialIds={selectedIds} materials={materials} onChange={(infoBlocks) => onFormChange({ ...form, infoBlocks })} />
      <div className="mt-4">
        <TrackPreview track={{ ...form, id: "preview", materialIds: selectedIds, tags: splitList(form.tags), createdAt: new Date() }} materials={materials} />
      </div>
      <SubmitButton isSubmitting={isSubmitting} label="Добавить трек" />
    </form>
  );
}

function ManualUserCreateForm({
  form,
  groups,
  isSubmitting,
  onFormChange,
  onSubmit
}: {
  form: typeof initialManualUserForm;
  groups: TrainingGroup[];
  isSubmitting: boolean;
  onFormChange: (form: typeof initialManualUserForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold text-slate-950">
          Добавить пользователя вручную
        </h3>
        <p className="max-w-3xl text-sm leading-6 text-slate-500">
          Используйте это для новых сотрудников между CRM-импортами. CRM ID нужен,
          чтобы следующий импорт обновил эту запись, а не создал дубль.
        </p>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <TextField
          label="CRM ID"
          value={form.crmId}
          placeholder="ID пользователя из CRM"
          onChange={(value) => onFormChange({ ...form, crmId: value })}
          required
        />
        <TextField
          label="Логин или ФИО для входа"
          value={form.login}
          placeholder="Например: Миронова Марина"
          onChange={(value) => onFormChange({ ...form, login: value })}
          required
        />
        <TextField
          label="Имя в списке"
          value={form.displayName}
          placeholder="Как показывать в админке"
          onChange={(value) => onFormChange({ ...form, displayName: value })}
        />
        <TextField
          label="Название офиса"
          value={form.office}
          onChange={(value) => onFormChange({ ...form, office: value })}
        />
        <label className="text-sm font-medium text-slate-700">Учебная роль
          <select value={form.trainingRole} onChange={(event) => onFormChange({ ...form, trainingRole: event.target.value as typeof form.trainingRole })}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" required>
            <option value="">Выберите роль</option>
            <option value="HEAD">Руководитель</option>
            <option value="MANAGER">Менеджер</option>
            <option value="EMPLOYEE">Сотрудник</option>
            <option value="PARTNER">Партнёр</option>
          </select>
        </label>
        <fieldset className="min-w-0 text-sm font-medium text-slate-700">
          <legend>Группы</legend>
          <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 p-2">
            {groups.filter((group) => !group.archived).map((group) => <label key={group.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 font-normal hover:bg-slate-50">
              <input type="checkbox" checked={form.groupIds.includes(group.id)} className="mt-0.5 accent-[#ea6a00]"
                onChange={(event) => onFormChange({ ...form, groupIds: event.target.checked
                  ? [...form.groupIds, group.id] : form.groupIds.filter((id) => id !== group.id) })} />
              <span className="min-w-0 break-words">{group.name} <span className="text-xs text-slate-500">{group.kind === "office" ? "· офис CRM" : ""}</span></span>
            </label>)}
            {!groups.some((group) => !group.archived) ? <p className="px-2 py-1.5 text-xs font-normal text-slate-500">Группы пока не созданы.</p> : null}
          </div>
        </fieldset>
        <TextField
          label="Почта"
          type="email"
          value={form.email}
          onChange={(value) => onFormChange({ ...form, email: value })}
        />
        <TextField
          label="Телефон"
          value={form.phone}
          onChange={(value) => onFormChange({ ...form, phone: value })}
        />
        <TextField
          label="Первоначальный пароль"
          type="password"
          value={form.accessCode}
          placeholder="Пользователь сменит его при первом входе"
          onChange={(value) => onFormChange({ ...form, accessCode: value })}
          required
        />
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center gap-2 rounded-lg bg-[#ea6a00] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#cf5e00] disabled:cursor-wait disabled:opacity-60"
        >
          <UserCheck size={17} />
          {isSubmitting ? "Создаем..." : "Дать доступ"}
        </button>
      </div>
    </form>
  );
}

function CrmImportPanel({
  preview,
  conflicts,
  archiveMissing,
  temporaryPassword,
  lastImport,
  isSubmitting,
  onArchiveMissingChange,
  onTemporaryPasswordChange,
  onFile,
  onSubmit
}: {
  preview: ImportPreview | null;
  conflicts: ImportConflict[];
  archiveMissing: boolean;
  temporaryPassword: string;
  lastImport: ImportHistoryItem | null;
  isSubmitting: boolean;
  onArchiveMissingChange: (value: boolean) => void;
  onTemporaryPasswordChange: (value: string) => void;
  onFile: (file: File | null) => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[#ea6a00]">
            <FileSpreadsheet size={20} />
            <h3 className="text-lg font-semibold text-slate-950">
              Импорт пользователей из CRM
            </h3>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Загрузите полную Excel-выгрузку. Система обновит сотрудников, создаст
            новых и архивирует заблокированных. Личные пароли и прогресс действующих
            пользователей сохранятся.
          </p>
        </div>

        <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <FileSpreadsheet size={17} />
          Выбрать .xlsx
          <input
            type="file"
            accept=".xlsx,.xls"
            className="sr-only"
            onChange={(event) => void onFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {lastImport ? (
        <div className="mt-5 rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Последний импорт завершен</p>
          <p className="mt-1 leading-6">
            {formatDate(lastImport.createdAt)} · {lastImport.actor || "администратор"} ·
            импортировано: {lastImport.imported}, создано: {lastImport.created},
            обновлено: {lastImport.updated}, пропущено: {lastImport.skipped}
            {lastImport.rotatedPasswords ? ` · временных паролей заменено: ${lastImport.rotatedPasswords}` : ""}
            {lastImport.archiveMissing ? " · архивация отсутствующих включалась" : ""}
          </p>
          {lastImport.fileName ? (
            <p className="mt-1 break-all text-xs text-emerald-700">
              Файл: {lastImport.fileName}
            </p>
          ) : null}
        </div>
      ) : null}

      {conflicts.length ? (
        <details open className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-900">
            Требуют ручной проверки: {conflicts.length}
          </summary>
          <p className="mt-2 text-xs text-slate-600">
            Эти записи не изменены. Сверьте CRM ID и логин с существующими аккаунтами перед повторным импортом.
          </p>
          <div className="mt-3 max-h-64 overflow-auto text-sm">
            {conflicts.map((item, index) => (
              <p key={`${item.crmId}:${index}`} className="border-t border-amber-200 py-2">
                <span className="font-mono">{item.crmId || "Без CRM ID"}</span> · {item.displayName || "Без ФИО"} · {item.login} · {item.reason}
              </p>
            ))}
          </div>
        </details>
      ) : null}

      {preview ? (
        <div className="mt-5 space-y-5">
          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="break-all text-sm font-semibold text-slate-900">
              {preview.fileName}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <ImportStat label="Всего строк" value={preview.totalRows} />
              <ImportStat label="К обработке" value={preview.validUsers.length} />
              <ImportStat label="Без ID или логина" value={preview.skippedMissing} />
              <ImportStat label="Без доступа CRM / заблокированы" value={preview.skippedBlocked + preview.blockedCrmIdsWithoutLogin.length} />
              <ImportStat
                label="Строки других офисов"
                value={preview.duplicateIds}
              />
            </div>
            <p className="mt-3 text-xs text-slate-600">
              Офисных привязок: {preview.officeLinks}. Автологин по имени и фамилии: {preview.nameFallbackCount}. Конфликтных записей: {preview.conflictingIds}.
              {preview.isActiveUsersReport ? " Отсутствующих в этой выборке пользователей не архивируем." : ""}
            </p>
          </div>

          {preview.usersForManualBinding.length ? (
            <details className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                Без логина: {preview.usersForManualBinding.length} пользователей для ручной привязки
              </summary>
              <p className="mt-2 text-xs text-slate-600">
                Аккаунты для них не создаются. Сверьте CRM ID и назначьте логины вручную до следующего импорта.
              </p>
              <div className="mt-3 max-h-64 overflow-auto text-sm">
                {preview.usersForManualBinding.map((item) => (
                  <p key={item.crmId} className="border-t border-amber-200 py-2">
                    <span className="font-mono">{item.crmId}</span> · {item.displayName || "Без ФИО"} · {item.crmUserTypes.join("; ") || "Тип не указан"}
                    {item.isBlocked ? " · доступ в CRM отключён" : ""}
                    {item.conflictingAccess ? " · конфликт доступа между строками" : ""}
                  </p>
                ))}
              </div>
            </details>
          ) : null}

          <label className="block max-w-md text-sm font-medium text-slate-800">
            Общий временный пароль для новых пользователей
            <input
              type="password"
              value={temporaryPassword}
              onChange={(event) => onTemporaryPasswordChange(event.target.value)}
              autoComplete="new-password"
              minLength={6}
              maxLength={128}
              required
              placeholder="Минимум 6 символов, буква и цифра"
              className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none focus:border-[#ea6a00]"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Пароль не сохраняется в истории импорта. Действующие пароли не изменятся.
            </span>
          </label>

          {!preview.isActiveUsersReport ? <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={archiveMissing}
              onChange={(event) => onArchiveMissingChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-[#ea6a00] focus:ring-[#ea6a00] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>
              Архивировать пользователей, которых нет в этой выгрузке. Их прогресс
              не удаляется. Оставляйте включенным только для полной CRM-выгрузки,
              а не частичной выборки.
            </span>
          </label> : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || preview.validUsers.length === 0 || !temporaryPassword}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ea6a00] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#cf5e00] disabled:cursor-wait disabled:opacity-60"
            >
              <UserCheck size={17} />
              {isSubmitting ? "Импортируем..." : "Импортировать"}
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function ImportStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white px-3 py-3 ring-1 ring-slate-200">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function UsersWorkspace({
  users,
  onUpdate,
  manualUserForm,
  trainingGroups,
  importPreview,
  importConflicts,
  importArchiveMissing,
  importTemporaryPassword,
  lastImport,
  isSubmitting,
  onManualUserChange,
  onManualUserSubmit,
  onImportArchiveMissingChange,
  onImportTemporaryPasswordChange,
  onImportFile,
  onWebImportSubmit
}: {
  users: AccessUser[];
  onUpdate: (id: string, payload: Partial<AccessUser>) => Promise<void>;
  manualUserForm: typeof initialManualUserForm;
  trainingGroups: TrainingGroup[];
  importPreview: ImportPreview | null;
  importConflicts: ImportConflict[];
  importArchiveMissing: boolean;
  importTemporaryPassword: string;
  lastImport: ImportHistoryItem | null;
  isSubmitting: boolean;
  onManualUserChange: (form: typeof initialManualUserForm) => void;
  onManualUserSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onImportArchiveMissingChange: (value: boolean) => void;
  onImportTemporaryPasswordChange: (value: string) => void;
  onImportFile: (file: File | null) => Promise<void>;
  onWebImportSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [roleFilter, setRoleFilter] = useState<"all" | "missing" | TrainingRole>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = users.filter((accessUser) => {
    if (status === "active" && (!accessUser.active || accessUser.archived)) {
      return false;
    }

    if (status === "archived" && !accessUser.archived) {
      return false;
    }

    if (roleFilter === "missing" && accessUser.trainingRole) return false;
    if (roleFilter !== "all" && roleFilter !== "missing" && accessUser.trainingRole !== roleFilter) return false;

    if (!normalizedSearch) {
      return true;
    }

    return [
      accessUser.displayName,
      accessUser.login,
      accessUser.normalizedLogin,
      accessUser.crmId,
      accessUser.email,
      accessUser.phone,
      accessUser.id
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });
  const selectedUser = users.find((accessUser) => accessUser.id === selectedId);

  return (
    <div className="space-y-5">
      <CrmImportPanel
        preview={importPreview}
        conflicts={importConflicts}
        archiveMissing={importArchiveMissing}
        temporaryPassword={importTemporaryPassword}
        lastImport={lastImport}
        isSubmitting={isSubmitting}
        onArchiveMissingChange={onImportArchiveMissingChange}
        onTemporaryPasswordChange={onImportTemporaryPasswordChange}
        onFile={onImportFile}
        onSubmit={onWebImportSubmit}
      />
      <WeeklyCodeGenerator />
      <ManualUserCreateForm
        form={manualUserForm}
        groups={trainingGroups}
        isSubmitting={isSubmitting}
        onFormChange={onManualUserChange}
        onSubmit={onManualUserSubmit}
      />

      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-950">
              Пользователи
            </h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Всего в реестре: {users.length}. Пароли не отображаются и не
              сохраняются в Firestore.
            </p>
            {users.length === 0 ? (
              <p className="mt-2 text-sm font-medium text-[#b95200]">
                Список появится после первой защищенной синхронизации с CRM.
              </p>
            ) : null}
          </div>
          <div className="flex w-full flex-wrap gap-2 lg:w-auto">
            <div className="relative min-w-0 flex-1 lg:w-72">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Имя, логин, телефон или ID"
                className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)}
              aria-label="Фильтр по учебной роли"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700"
            >
              <option value="all">Все роли</option>
              <option value="missing">Без роли</option>
              {Object.entries(TRAINING_ROLE_LABELS).filter(([role]) => role !== "ADMIN").map(([role, label]) => (
                <option key={role} value={role}>{label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {([
            ["active", "Активные"],
            ["archived", "Архив"],
            ["all", "Все"]
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                status === value
                  ? "bg-[#ea6a00] text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[23rem_1fr]">
        <aside className="max-h-[65vh] overflow-y-auto rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          {filteredUsers.length ? (
            <div className="space-y-2">
              {filteredUsers.map((accessUser) => (
                <button
                  key={accessUser.id}
                  type="button"
                  onClick={() => setSelectedId(accessUser.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedId === accessUser.id
                      ? "border-[#ea6a00] bg-orange-50"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {accessUser.displayName}
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-500">
                        {accessUser.login}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-slate-500">
                        {accessUser.trainingRole ? TRAINING_ROLE_LABELS[accessUser.trainingRole] : "Без учебной роли"}
                        {accessUser.trainingRoleManual ? " · вручную" : ""}
                      </span>
                      {accessUser.manual ? (
                        <span className="mt-2 inline-flex rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-[#b95200]">
                          Ручной доступ
                        </span>
                      ) : null}
                    </span>
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                        accessUser.active && !accessUser.archived
                          ? "bg-emerald-500"
                          : "bg-slate-300"
                      }`}
                    />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="p-4 text-sm text-slate-500">Пользователи не найдены.</p>
          )}
        </aside>

        <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          {selectedUser ? (
            <UserEditor
              key={selectedUser.id}
              accessUser={selectedUser}
              onUpdate={onUpdate}
            />
          ) : (
            <p className="text-sm text-slate-500">
              Выберите пользователя в списке слева.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function UserEditor({
  accessUser,
  onUpdate
}: {
  accessUser: AccessUser;
  onUpdate: (id: string, payload: Partial<AccessUser>) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(accessUser.displayName);
  const [office, setOffice] = useState(accessUser.office ?? "");
  const [email, setEmail] = useState(accessUser.email ?? "");
  const [phone, setPhone] = useState(accessUser.phone ?? "");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetting, setResetting] = useState(false);
  const [impersonationMessage, setImpersonationMessage] = useState("");
  const [impersonating, setImpersonating] = useState(false);
  const [trainingRole, setTrainingRole] = useState<"auto" | "HEAD" | "MANAGER" | "EMPLOYEE" | "PARTNER">(
    accessUser.trainingRoleManual && ["HEAD", "MANAGER", "EMPLOYEE", "PARTNER"].includes(accessUser.trainingRole ?? "")
      ? accessUser.trainingRole as "HEAD" | "MANAGER" | "EMPLOYEE" | "PARTNER"
      : "auto"
  );
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleMessage, setRoleMessage] = useState("");
  const passwordInputRef = useRef<HTMLInputElement>(null);

  async function saveTrainingRole() {
    if (!auth?.currentUser || roleSaving) return;
    setRoleSaving(true);
    setRoleMessage("");
    try {
      const idToken = await auth.currentUser.getIdToken(true);
      const response = await fetch("/api/admin/set-training-role", {
        method: "POST",
        headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
        body: JSON.stringify({ uid: accessUser.id, role: trainingRole }),
        cache: "no-store"
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Не удалось сохранить учебную роль.");
      setRoleMessage("Учебная роль сохранена.");
    } catch (error) {
      setRoleMessage(error instanceof Error ? error.message : "Не удалось сохранить учебную роль.");
    } finally {
      setRoleSaving(false);
    }
  }

  async function impersonate() {
    if (!auth?.currentUser || !accessUser.active || accessUser.archived ||
        accessUser.passwordResetRequested || accessUser.claimState === "unclaimed" ||
        accessUser.claimState === "claiming" || accessUser.claimState === "manual_review") return;
    if (!window.confirm(`Войти под ${accessUser.displayName}? Все действия будут сохранены от имени сотрудника. Для возврата к админке потребуется войти снова.`)) return;
    setImpersonating(true);
    setImpersonationMessage("");
    try {
      const idToken = await auth.currentUser.getIdToken(true);
      const response = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
        body: JSON.stringify({ uid: accessUser.id }),
        cache: "no-store"
      });
      const result = (await response.json()) as { token?: string; message?: string };
      if (!response.ok || !result.token) throw new Error(result.message ?? "Не удалось войти под сотрудником.");
      await signInWithCustomToken(auth, result.token);
      window.localStorage.removeItem("travel-edu-session-start");
      window.location.assign("/");
    } catch (error) {
      setImpersonationMessage(error instanceof Error ? error.message : "Не удалось войти под сотрудником.");
      setImpersonating(false);
    }
  }

  async function resetPassword() {
    if (!PERSONAL_PASSWORD_PATTERN.test(temporaryPassword)) {
      setResetMessage("Введите минимум 6 символов, букву и цифру.");
      return;
    }
    if (!window.confirm(`Сбросить пароль сотрудника ${accessUser.displayName}?`)) return;
    setResetting(true);
    setResetMessage("");
    try {
      const idToken = await auth?.currentUser?.getIdToken();
      const response = await fetch("/api/admin/reset-user-password", {
        method: "POST",
        headers: {
          authorization: `Bearer ${idToken ?? ""}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ uid: accessUser.id, password: temporaryPassword })
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Не удалось сбросить пароль.");
      setResetMessage("Пароль сброшен. Передайте временный пароль сотруднику лично; при входе он создаст новый.");
    } catch (error) {
      setResetMessage(error instanceof Error ? error.message : "Не удалось сбросить пароль.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-950">{accessUser.login}</h3>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              accessUser.active && !accessUser.archived
                ? "bg-emerald-50 text-emerald-700"
                : "bg-slate-100 text-slate-500"
            }`}
          >
            {accessUser.archived
              ? "В архиве"
              : accessUser.claimState === "unclaimed"
                ? "Ожидает активации"
              : accessUser.claimState === "manual_review"
                ? "Нужна проверка"
              : accessUser.active
                ? "Активен"
                : "Заблокирован"}
          </span>
        </div>
        <p className="mt-2 break-all font-mono text-xs text-slate-400">
          CRM ID: {accessUser.crmId ?? accessUser.id}
        </p>
        <p className="mt-1 break-all font-mono text-xs text-slate-400">
          Firebase UID: {accessUser.id}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void impersonate()}
            disabled={impersonating || !accessUser.active || accessUser.archived || accessUser.passwordResetRequested || accessUser.claimState !== "claimed"}
            className="inline-flex items-center gap-2 rounded-lg bg-[#ea6a00] px-3 py-2 text-sm font-semibold text-white hover:bg-[#cf5e00] disabled:cursor-not-allowed disabled:opacity-50">
            <LogIn size={16} />{impersonating ? "Входим..." : "Войти под пользователем"}
          </button>
          <button type="button" onClick={() => passwordInputRef.current?.focus()}
            disabled={accessUser.claimState !== "claimed"}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <KeyRound size={16} />Сбросить пароль
          </button>
        </div>
        {impersonationMessage ? <p role="alert" className="mt-2 text-sm text-red-700">{impersonationMessage}</p> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Имя" value={displayName} onChange={setDisplayName} />
        <TextField label="Название офиса" value={office} onChange={setOffice} />
        <div className="text-sm font-medium text-slate-700">
          <label htmlFor={`training-role-${accessUser.id}`}>Учебная роль</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              id={`training-role-${accessUser.id}`}
              value={trainingRole}
              onChange={(event) => setTrainingRole(event.target.value as typeof trainingRole)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal text-slate-900"
            >
              <option value="auto" disabled={!accessUser.crmUserTypes?.length}>По данным CRM</option>
              <option value="HEAD">Руководитель</option>
              <option value="MANAGER">Менеджер</option>
              <option value="EMPLOYEE">Сотрудник</option>
              <option value="PARTNER">Партнёр</option>
            </select>
            <button
              type="button"
              onClick={() => void saveTrainingRole()}
              disabled={roleSaving || (trainingRole === "auto" && !accessUser.crmUserTypes?.length)}
              className="rounded-lg border border-[#ea6a00] px-3 py-2.5 font-semibold text-[#c95b00] hover:bg-orange-50 disabled:opacity-50"
            >
              {roleSaving ? "Сохраняем..." : "Применить"}
            </button>
          </div>
          <p className="mt-1 text-xs font-normal text-slate-500">
            Текущая: {accessUser.trainingRole ? TRAINING_ROLE_LABELS[accessUser.trainingRole] : "Не назначена"}
            {accessUser.trainingRoleManual ? " · назначена вручную" : " · по CRM"}
          </p>
          {roleMessage ? <p role="status" className="mt-1 text-xs font-normal text-slate-700">{roleMessage}</p> : null}
        </div>
        <TextField label="Контактная почта" value={email} onChange={setEmail} />
        <TextField label="Телефон" value={phone} onChange={setPhone} />
      </div>

      <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
        <div className="flex items-start gap-3">
          <KeyRound size={19} className="mt-0.5 shrink-0 text-slate-400" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Пароль</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Новые пользователи входят с общим временным паролем и обязательно
              заменяют его личным. Пароль действующих сотрудников импорт не меняет.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <p className="text-sm font-semibold text-slate-800">Сбросить пароль сотрудника</p>
        <p className="mt-1 text-sm text-slate-500">Назначьте временный пароль. При следующем входе сотрудник обязательно заменит его личным.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            ref={passwordInputRef}
            type="password"
            value={temporaryPassword}
            onChange={(event) => setTemporaryPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Временный пароль"
            aria-label="Временный пароль сотрудника"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#ea6a00]"
          />
          <button
            type="button"
            onClick={() => void resetPassword()}
            disabled={resetting || !accessUser.active || accessUser.archived || accessUser.claimState !== "claimed"}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#ea6a00] px-4 py-2.5 text-sm font-semibold text-[#c95b00] hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <KeyRound size={16} />
            {resetting ? "Сбрасываем..." : "Сбросить пароль"}
          </button>
        </div>
        {resetMessage ? <p role="status" className="mt-2 text-sm text-slate-600">{resetMessage}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-5">
        <button
          type="button"
          onClick={() =>
            void onUpdate(accessUser.id, {
              displayName,
              office,
              email,
              phone
            })
          }
          className="inline-flex items-center gap-2 rounded-lg bg-[#ea6a00] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#cf5e00]"
        >
          <Save size={17} />
          Сохранить
        </button>
        <button
          type="button"
          onClick={() =>
            void onUpdate(accessUser.id, {
              active: !accessUser.active,
              archived: false
            })
          }
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {accessUser.active ? <UserX size={17} /> : <UserCheck size={17} />}
          {accessUser.active ? "Заблокировать" : "Активировать"}
        </button>
        <button
          type="button"
          onClick={() =>
            void onUpdate(accessUser.id, {
              archived: !accessUser.archived,
              active: accessUser.archived
            })
          }
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {accessUser.archived ? <RotateCcw size={17} /> : <Archive size={17} />}
          {accessUser.archived ? "Вернуть из архива" : "В архив"}
        </button>
      </div>
    </div>
  );
}

function WeeklyCodeGenerator() {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  function generateCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const randomValues = window.crypto.getRandomValues(new Uint8Array(12));
    const groups = [0, 4, 8].map((start) =>
      Array.from(randomValues.slice(start, start + 4))
        .map((value) => alphabet[value % alphabet.length])
        .join("")
    );

    setCode(`EDU-${groups.join("-")}`);
    setCopied(false);
  }

  async function copyCode() {
    if (!code) return;
    await window.navigator.clipboard.writeText(code);
    setCopied(true);
  }

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">
            Генератор временного пароля
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Сгенерированный пароль можно использовать для импорта или ручного
            добавления. После первого входа сотрудник заменит его личным.
          </p>
        </div>
        <button
          type="button"
          onClick={generateCode}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={17} />
          Сгенерировать
        </button>
      </div>

      {code ? (
        <div className="mt-4 flex flex-col gap-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all text-lg font-semibold text-slate-950">
            {code}
          </code>
          <button
            type="button"
            onClick={() => void copyCode()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#ea6a00] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#cf5e00]"
          >
            <Copy size={17} />
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ArchiveWorkspace({
  mode,
  filter,
  selectedId,
  materials,
  tracks,
  groups,
  allTopicOptions,
  onAddCategory,
  onModeChange,
  onFilterChange,
  onSelect,
  onUpdateMaterial,
  onUpdateTrack,
  onDelete
}: {
  mode: ArchiveMode;
  filter: ArchiveFilter;
  selectedId: string | null;
  materials: Material[];
  tracks: LearningTrack[];
  groups: TrainingGroup[];
  allTopicOptions: string[];
  onAddCategory: (name: string) => Promise<string | null>;
  onModeChange: (mode: ArchiveMode) => void;
  onFilterChange: (filter: ArchiveFilter) => void;
  onSelect: (id: string | null) => void;
  onUpdateMaterial: (id: string, payload: Partial<Material>) => Promise<boolean>;
  onUpdateTrack: (id: string, payload: Partial<LearningTrack>) => Promise<boolean>;
  onDelete: (collectionName: "materials" | "tracks", id: string) => Promise<void>;
}) {
  const list =
    mode === "tracks"
      ? tracks
      : materials.filter((material) => material.tab === mode);

  const filteredList = list.filter((item) => {
    if (filter === "active") return !item.archived;
    if (filter === "archived") return Boolean(item.archived);
    return true;
  });

  const selectedTrack =
    mode === "tracks"
      ? tracks.find((track) => track.id === selectedId)
      : undefined;
  const selectedMaterial =
    mode !== "tracks"
      ? materials.find((material) => material.id === selectedId)
      : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
      <aside className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-2">
          <PillButton
            active={mode === "webinars"}
            icon={<GraduationCap size={16} />}
            label="Архив Видеотеки"
            onClick={() => onModeChange("webinars")}
          />
          <PillButton
            active={mode === "knowledge"}
            icon={<BookOpen size={16} />}
            label="Архив базы знаний"
            onClick={() => onModeChange("knowledge")}
          />
          <PillButton
            active={mode === "tracks"}
            icon={<FolderOpen size={16} />}
            label="Архив обучающих треков"
            onClick={() => onModeChange("tracks")}
          />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            ["active", "Активные"],
            ["archived", "Архив"],
            ["all", "Все"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value as ArchiveFilter)}
              className={`rounded-lg px-3 py-2 text-xs font-medium ${
                filter === value
                  ? "bg-[#ea6a00] text-white"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 max-h-[60vh] space-y-2 overflow-y-auto">
          {filteredList.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                selectedId === item.id
                  ? "border-[#ea6a00] bg-orange-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <span className="block text-sm font-semibold text-slate-900">
                {item.title}
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                {item.createdAt.getTime() > 0 ? formatDate(item.createdAt) : "Дата не указана"} · {item.archived ? "архив" : "активно"}
                {"hiddenFromLibrary" in item && item.hiddenFromLibrary ? mode === "webinars" ? " · скрыт из Видеотеки" : " · скрыт из библиотеки" : ""}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {selectedMaterial ? (
          <MaterialEditor
            key={selectedMaterial.id}
            material={selectedMaterial}
            groups={groups}
            allTopicOptions={allTopicOptions}
            onAddCategory={onAddCategory}
            onUpdate={onUpdateMaterial}
            onDelete={(id) => onDelete("materials", id)}
          />
        ) : selectedTrack ? (
          <TrackEditor
            key={selectedTrack.id}
            track={selectedTrack}
            groups={groups}
            materials={materials}
            onUpdate={onUpdateTrack}
            onDelete={(id) => onDelete("tracks", id)}
          />
        ) : (
          <p className="text-sm text-slate-500">
            Выберите материал или трек в списке слева.
          </p>
        )}
      </section>
    </div>
  );
}

function MaterialEditor({
  material,
  groups,
  allTopicOptions,
  onAddCategory,
  onUpdate,
  onDelete
}: {
  material: Material;
  groups: TrainingGroup[];
  allTopicOptions: string[];
  onAddCategory: (name: string) => Promise<string | null>;
  onUpdate: (id: string, payload: Partial<Material>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(material.title);
  const [hiddenFromLibrary, setHiddenFromLibrary] = useState(material.hiddenFromLibrary ?? false);
  const [audience, setAudience] = useState<ContentAudience>(material.audience ?? { mode: "everyone", roles: [], groupIds: [] });
  const [description, setDescription] = useState(material.description);
  const [tags, setTags] = useState((material.tags ?? []).join(", "));
  const [category, setCategory] = useState(material.category.join(", "));
  const [coverUrl, setCoverUrl] = useState(material.coverUrl ?? "");
  const [url, setUrl] = useState(material.url);
  const [testUrl, setTestUrl] = useState(material.testUrl ?? "");
  const [format, setFormat] = useState(material.tab === "webinars" ? videoFormat(material.format) : material.format);
  const [duration, setDuration] = useState(material.duration);
  const [speakerName, setSpeakerName] = useState(material.author.name);
  const [speakerCompany, setSpeakerCompany] = useState(
    material.author.company ?? ""
  );
  const [trendingStamp, setTrendingStamp] = useState<TrendingStamp | "">(
    material.trendingStamp ?? ""
  );
  const navigate = useEditorNavigation();
  const payload = { hiddenFromLibrary, audience, title, description, url, testUrl, coverUrl, format, duration,
    category: material.tab === "webinars" ? splitCategories(category, allTopicOptions) : splitList(category), tags: splitList(tags),
    ...(material.tab === "webinars" ? { author: { name: speakerName, company: speakerCompany }, trendingStamp: trendingStamp || null } : {}) };
  const save = useEditorDraft(payload, () => onUpdate(material.id, payload), () => {
    setTitle(material.title); setDescription(material.description); setUrl(material.url);
    setHiddenFromLibrary(material.hiddenFromLibrary ?? false); setTestUrl(material.testUrl ?? "");
    setAudience(material.audience ?? { mode: "everyone", roles: [], groupIds: [] });
    setCoverUrl(material.coverUrl ?? ""); setFormat(material.tab === "webinars" ? videoFormat(material.format) : material.format);
    setDuration(material.duration);
    setCategory(material.category.join(", ")); setTags((material.tags ?? []).join(", "));
    setSpeakerName(material.author.name); setSpeakerCompany(material.author.company ?? "");
    setTrendingStamp(material.trendingStamp ?? "");
  });

  return (
    <div className="space-y-4">
      <EditorTitle id={material.id} archived={Boolean(material.archived)} />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={hiddenFromLibrary} onChange={(event) => setHiddenFromLibrary(event.target.checked)} />
        {material.tab === "webinars" ? "Скрывать из Видеотеки" : "Скрывать из библиотеки"}
      </label>
      <AudiencePicker audience={audience} groups={groups} onChange={setAudience} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Название" value={title} onChange={setTitle} />
        {material.tab === "webinars" ? (
          <label className="text-sm font-medium text-slate-700">Формат
            <select value={format || "Вебинар"} onChange={(event) => setFormat(event.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900">
              {format && !videoFormats.includes(format as (typeof videoFormats)[number]) ? <option value={format}>{format} (старый формат)</option> : null}
              {videoFormats.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        ) : <TextField label="Формат" value={format} onChange={setFormat} />}
        <TextField label="Длительность, минут" type="number" value={String(duration)}
          onChange={(value) => setDuration(Number(value))} required />
        <TextField label="URL" value={url} onChange={setUrl} />
        <TextField
          label="Ссылка на тестирование"
          value={testUrl}
          onChange={setTestUrl}
        />
        <TextField label="Обложка" value={coverUrl} onChange={setCoverUrl} />
        {material.tab === "webinars" ? <CategoryPicker value={category} options={allTopicOptions}
          onChange={setCategory} onAdd={onAddCategory} /> : <TextField label="Темы" value={category} onChange={setCategory} />}
        <TextField label="Теги" value={tags} onChange={setTags} />
        {material.tab === "webinars" ? (
          <>
            <TextField
              label="Автор / Спикер"
              value={speakerName}
              onChange={setSpeakerName}
            />
            <TextField
              label="Компания / Организатор"
              value={speakerCompany}
              onChange={setSpeakerCompany}
            />
            <label className="text-sm font-medium text-slate-700">
              Метка на обложке
              <select
                value={trendingStamp}
                onChange={(event) =>
                  setTrendingStamp(event.target.value as TrendingStamp | "")
                }
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
              >
                <option value="">Без штампа</option>
                {trendingStampOptions.map((stamp) => (
                  <option key={stamp} value={stamp}>
                    {stamp}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Описание
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={5}
            className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
          />
        </label>
      </div>
      <EditorActions
        archived={Boolean(material.archived)}
        onSave={() => void save()}
        onArchive={() => navigate(() => void onUpdate(material.id, { archived: !material.archived }))}
        onDelete={() => navigate(() => void onDelete(material.id))}
      />
    </div>
  );
}

function TrackEditor({
  track,
  groups,
  materials,
  onUpdate,
  onDelete
}: {
  track: LearningTrack;
  groups: TrainingGroup[];
  materials: Material[];
  onUpdate: (id: string, payload: Partial<LearningTrack>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(track.title);
  const [description, setDescription] = useState(track.description);
  const [tags, setTags] = useState((track.tags ?? []).join(", "));
  const [coverUrl, setCoverUrl] = useState(track.coverUrl ?? "");
  const [testUrl, setTestUrl] = useState(track.testUrl ?? "");
  const [selectedIds, setSelectedIds] = useState(track.materialIds);
  const [audience, setAudience] = useState<ContentAudience>(track.audience ?? { mode: "everyone", roles: [], groupIds: [] });
  const [infoBlocks, setInfoBlocks] = useState(track.infoBlocks ?? []);
  const navigate = useEditorNavigation();
  const payload = { title, description, coverUrl, testUrl, tags: splitList(tags), materialIds: selectedIds, infoBlocks, audience };
  const save = useEditorDraft(payload, () => onUpdate(track.id, payload), () => {
    setTitle(track.title); setDescription(track.description); setCoverUrl(track.coverUrl ?? "");
    setTestUrl(track.testUrl ?? ""); setTags((track.tags ?? []).join(", "));
    setSelectedIds(track.materialIds); setInfoBlocks(track.infoBlocks ?? []);
    setAudience(track.audience ?? { mode: "everyone", roles: [], groupIds: [] });
  });

  function toggleMaterial(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }

  function moveMaterial(from: number, to: number) {
    setSelectedIds((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <EditorTitle id={track.id} archived={Boolean(track.archived)} />
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Название" value={title} onChange={setTitle} />
        <TextField label="Обложка" value={coverUrl} onChange={setCoverUrl} />
        <TextField
          label="Ссылка на тестирование"
          value={testUrl}
          onChange={setTestUrl}
        />
        <TextField label="Теги" value={tags} onChange={setTags} />
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Описание
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100"
          />
        </label>
      </div>
      <AudiencePicker audience={audience} groups={groups} onChange={setAudience} />
      <TrackMaterialPicker
        materials={materials}
        selectedIds={selectedIds}
        onToggle={toggleMaterial}
        onMove={moveMaterial}
      />
      <TrackInfoEditor blocks={infoBlocks} materialIds={selectedIds} materials={materials} onChange={setInfoBlocks} />
      <TrackPreview track={{ ...track, ...payload }} materials={materials} />
      <EditorActions
        archived={Boolean(track.archived)}
        onSave={() => void save()}
        onArchive={() => navigate(() => void onUpdate(track.id, { archived: !track.archived }))}
        onDelete={() => navigate(() => void onDelete(track.id))}
      />
    </div>
  );
}


function AudiencePicker({ audience, groups, onChange }: {
  audience: ContentAudience;
  groups: TrainingGroup[];
  onChange: (audience: ContentAudience) => void;
}) {
  return <fieldset className="min-w-0 rounded-lg border border-slate-200 p-4">
    <legend className="px-1 text-sm font-semibold text-slate-800">Доступ к контенту</legend>
    <label className="block text-sm text-slate-700">Показывать
      <select value={audience.mode} onChange={(event) => onChange({ ...audience, mode: event.target.value as ContentAudience["mode"] })}
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-900">
        <option value="everyone">Всем сотрудникам</option>
        <option value="restricted">Выбранным ролям или группам</option>
      </select>
    </label>
    {audience.mode === "restricted" ? <div className="mt-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-slate-700">Роли</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {AUDIENCE_ROLES.map((role) => <label key={role} className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={audience.roles.includes(role)} className="accent-[#ea6a00]"
              onChange={(event) => onChange({ ...audience, roles: event.target.checked
                ? [...audience.roles, role] : audience.roles.filter((item) => item !== role) })} />
            {TRAINING_ROLE_LABELS[role]}
          </label>)}
        </div>
      </div>
      {groups.length ? <div>
        <p className="text-sm font-medium text-slate-700">Группы</p>
        <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">
          {groups.map((group) => <label key={group.id} className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={audience.groupIds.includes(group.id)} disabled={group.archived}
              className="accent-[#ea6a00]" onChange={(event) => onChange({ ...audience, groupIds: event.target.checked
                ? [...audience.groupIds, group.id] : audience.groupIds.filter((id) => id !== group.id) })} />
            {group.name}{group.archived ? " · архив" : ""}
          </label>)}
        </div>
      </div> : null}
      <p className="text-xs text-slate-500">Достаточно совпадения одной роли или группы. Если ничего не выбрать, контент увидит только администратор. Трек не показывается сотруднику, если хотя бы один его материал ему недоступен; проверьте аудиторию материалов отдельно.</p>
    </div> : null}
  </fieldset>;
}

function FormHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Назад
      </button>
    </div>
  );
}

function EditorTitle({ id, archived }: { id: string; archived: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-mono text-xs text-slate-400">{id}</p>
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
          archived
            ? "bg-amber-100 text-amber-700"
            : "bg-emerald-100 text-emerald-700"
        }`}
      >
        {archived ? "В архиве" : "Активно"}
      </span>
    </div>
  );
}

function EditorActions({
  archived,
  onSave,
  onArchive,
  onDelete
}: {
  archived: boolean;
  onSave: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
      <ActionButton icon={<Save size={15} />} label="Сохранить" onClick={onSave} />
      <ActionButton
        icon={archived ? <RotateCcw size={15} /> : <Archive size={15} />}
        label={archived ? "Вернуть" : "В архив"}
        onClick={onArchive}
      />
      <ActionButton
        danger
        icon={<Trash2 size={15} />}
        label="Удалить"
        onClick={onDelete}
      />
    </div>
  );
}

function SubmitButton({
  isSubmitting,
  label
}: {
  isSubmitting: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      disabled={isSubmitting}
      className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-[#ea6a00] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#d85f00] disabled:cursor-not-allowed disabled:opacity-60"
    >
      <PlusCircle size={16} />
      {isSubmitting ? "Сохранение..." : label}
    </button>
  );
}

function PillButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
        active
          ? "bg-[#ea6a00] text-white shadow-sm"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  danger
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
        danger
          ? "bg-red-50 text-red-700 hover:bg-red-100"
          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCategories(value: string, options: string[]) {
  const canonical = new Map(options.map((name) => [categoryKey(name), name]));
  const selected = new Map<string, string>();
  for (const item of splitList(value)) {
    const name = normalizeCategory(item);
    if (name) selected.set(categoryKey(name), canonical.get(categoryKey(name)) ?? name);
  }
  return [...selected.values()];
}

function CategoryPicker({ value, options, onChange, onAdd }: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  onAdd: (name: string) => Promise<string | null>;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const selected = splitCategories(value, options);

  function toggle(name: string) {
    const next = selected.some((item) => categoryKey(item) === categoryKey(name))
      ? selected.filter((item) => categoryKey(item) !== categoryKey(name))
      : [...selected, name];
    onChange(next.join(", "));
  }

  async function add() {
    if (!normalizeCategory(newName)) return;
    setAdding(true);
    try {
      const name = await onAdd(newName);
      if (name && !selected.some((item) => categoryKey(item) === categoryKey(name))) {
        onChange([...selected, name].join(", "));
      }
      if (name) setNewName("");
    } finally {
      setAdding(false);
    }
  }

  return (
    <fieldset className="min-w-0 rounded-lg border border-slate-200 p-3 md:col-span-2">
      <legend className="px-1 text-sm font-medium text-slate-700">Тематики / категории</legend>
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {options.map((name) => (
          <label key={categoryKey(name)} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700">
            <input type="checkbox" checked={selected.some((item) => categoryKey(item) === categoryKey(name))}
              onChange={() => toggle(name)} className="accent-[#ea6a00]" />{name}
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input value={newName} onChange={(event) => setNewName(event.target.value)}
          placeholder="Новая категория" maxLength={100} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <button type="button" onClick={() => void add()} disabled={adding || !newName.trim()}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-[#b85300] disabled:opacity-50">Добавить</button>
      </div>
    </fieldset>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  list?: string;
  required?: boolean;
  disabled?: boolean;
};

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  list,
  required,
  disabled
}: TextFieldProps) {
  return (
    <label className="text-sm font-medium text-slate-700">
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        list={list}
        required={required}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 outline-none transition focus:border-[#ea6a00] focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </label>
  );
}
