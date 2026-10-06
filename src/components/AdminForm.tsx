"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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
import { formatDate, uniqueSorted } from "@/lib/materials";
import { TrackInfoEditor } from "@/components/TrackInfoEditor";
import { TrackPreview } from "@/components/TrackPreview";
import { TrackMaterialPicker } from "@/components/TrackMaterialPicker";
import { UnsavedEditorProvider, useEditorDraft, useEditorNavigation } from "@/components/UnsavedEditor";
import type {
  ContentTab,
  LearningTrack,
  Material,
  MaterialType,
  TrackInfoBlock,
  TrendingStamp
} from "@/types/material";
import type { AccessUser } from "@/types/access-user";

const CRM_IMPORT_BATCH_SIZE = 12;

type AdminFormProps = {
  user: User | null;
  isOpen: boolean;
  onClose: () => void;
  topicOptions: Record<ContentTab, string[]>;
  formatOptions: string[];
  materials: Material[];
  tracks: LearningTrack[];
};

type AddMode = "menu" | "webinar" | "knowledge" | "track";
type ArchiveMode = "webinars" | "knowledge" | "tracks";
type ArchiveFilter = "active" | "archived" | "all";

type ParsedImportUser = {
  crmId: string;
  login: string;
  displayName: string;
  email: string;
  phone: string;
  active: boolean;
  isBlocked: boolean;
};

type ImportPreview = {
  fileName: string;
  totalRows: number;
  validUsers: ParsedImportUser[];
  hasStableIds: boolean;
  skippedMissing: number;
  skippedBlocked: number;
  duplicateIds: number;
  duplicateLogins: number;
};

type ImportHistoryItem = {
  id: string;
  fileName: string;
  actor: string;
  imported: number;
  created: number;
  updated: number;
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
  email: "",
  phone: "",
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
  const records = rows.slice(headerRowIndex + 1).map((values) =>
    Object.fromEntries(
      headers.map((header, index) => [
        header,
        normalizeImportValue(values[index])
      ])
    )
  );
  const users = records.map((record) => {
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
    const login = rawLogin || email || displayName;
    const blocked = getImportValue(record, ["blocked", "заблокирован"]);
    const isBlocked = blocked ? isTruthyImportValue(blocked) : false;

    return {
      crmId,
      login,
      displayName: displayName || login,
      email,
      phone: getImportValue(record, ["phone", "телефон"]),
      active: !isBlocked,
      isBlocked
    };
  });
  const validSourceUsers = users.filter(
    (importUser) => importUser.login && !importUser.isBlocked
  );
  const seenIds = new Set<string>();
  const seenLogins = new Set<string>();
  const validUsers: ParsedImportUser[] = [];
  let duplicateIds = 0;
  let duplicateLogins = 0;

  for (const importUser of validSourceUsers) {
    const normalizedId = importUser.crmId.trim();
    const normalizedLogin = normalizeLogin(importUser.login);

    if (normalizedId && seenIds.has(normalizedId)) {
      duplicateIds += 1;
      continue;
    }

    if (seenLogins.has(normalizedLogin)) {
      duplicateLogins += 1;
      continue;
    }

    if (normalizedId) {
      seenIds.add(normalizedId);
    }
    seenLogins.add(normalizedLogin);
    validUsers.push(importUser);
  }

  return {
    fileName,
    totalRows: users.length,
    validUsers,
    hasStableIds: validUsers.every((importUser) => Boolean(importUser.crmId.trim())),
    skippedMissing: users.filter((importUser) => !importUser.login)
      .length,
    skippedBlocked: users.filter((importUser) => importUser.isBlocked).length,
    duplicateIds,
    duplicateLogins
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
  materials,
  tracks
}: AdminFormProps) {
  const navigate = useEditorNavigation();
  const [loginEmail, setLoginEmail] = useState(ADMIN_EMAIL);
  const [loginPassword, setLoginPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [section, setSection] = useState<"add" | "archive" | "users">("add");
  const [addMode, setAddMode] = useState<AddMode>("menu");
  const [archiveMode, setArchiveMode] = useState<ArchiveMode>("webinars");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("active");
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [materialForm, setMaterialForm] = useState(initialMaterialForm);
  const [trackForm, setTrackForm] = useState(initialTrackForm);
  const [trackMaterialIds, setTrackMaterialIds] = useState<string[]>([]);
  const [accessUsers, setAccessUsers] = useState<AccessUser[]>([]);
  const [manualUserForm, setManualUserForm] = useState(initialManualUserForm);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importAccessCode, setImportAccessCode] = useState("");
  const [importArchiveMissing, setImportArchiveMissing] = useState(false);
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
                email: data.email ?? "",
                phone: data.phone ?? "",
                role: data.role ?? "user",
                active: data.active === true,
                archived: data.archived === true,
                manual: data.manual === true,
                source: data.source ?? "crm",
                passwordResetRequested: data.passwordResetRequested === true,
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
          skipped: Number(data.skipped ?? 0),
          archiveMissing: data.archiveMissing === true,
          createdAt
        });
      },
      () => setLastImport(null)
    );
  }, [isAdmin, isOpen]);

  const allTopicOptions = useMemo(
    () =>
      uniqueSorted([
        ...topicOptions.webinars,
        ...topicOptions.knowledge,
        ...materials.flatMap((material) => material.tags ?? [])
      ]),
    [materials, topicOptions]
  );

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
        title: materialForm.title.trim(),
        hiddenFromLibrary: materialForm.hiddenFromLibrary,
        description: materialForm.description.trim(),
        type: materialForm.type,
        url: materialForm.url.trim(),
        testUrl: materialForm.testUrl.trim(),
        coverUrl: materialForm.coverUrl.trim(),
        category: splitList(materialForm.category),
        tags: splitList(materialForm.tags),
        format: tab === "webinars" ? "Вебинар" : materialForm.format.trim(),
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
        await updateDoc(materialRef, payload);
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

    if (!crmId || !login || accessCode.length < 6) {
      setMessage("Заполните CRM ID, логин/ФИО и актуальный код доступа.");
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
          email: manualUserForm.email.trim(),
          phone: manualUserForm.phone.trim(),
          role: "user",
          active: true,
          archived: false,
          manual: true,
          source: "manual",
          passwordResetRequested: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      setManualUserForm(initialManualUserForm);
      setMessage(
        "Пользователь добавлен вручную. При следующем импорте CRM запись обновится по этому же CRM ID и логину."
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

      setImportPreview(buildImportPreview(file.name, rows));
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

    if (importAccessCode.trim().length < 12) {
      setMessage("Пароль для импорта должен быть не короче 12 символов.");
      return;
    }

    if (importArchiveMissing && !importPreview.hasStableIds) {
      setMessage(
        "В этом файле нет отдельного CRM ID. Архивация отсутствующих отключена, чтобы не потерять доступ и прогресс действующих пользователей."
      );
      return;
    }

    if (
      !window.confirm(
        `Подтвердите импорт ${importPreview.validUsers.length} пользователей. Для них будет установлен указанный пароль. Уже пройденный прогресс сохранится у пользователей, найденных по CRM ID, логину или e-mail.`
      )
    ) {
      return;
    }

    if (
      importArchiveMissing &&
      !window.confirm(
        "Вы включили архивацию пользователей, которых нет в файле. Продолжайте только если это полная CRM-выгрузка, а не тестовая выборка."
      )
    ) {
      return;
    }

    setIsSubmitting(true);
    setMessage("");

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
          importPreview.skippedBlocked +
          importPreview.duplicateIds +
          importPreview.duplicateLogins,
        imported: 0
      };

      for (const [batchIndex, batch] of batches.entries()) {
        setMessage(
          `Импорт пользователей: партия ${batchIndex + 1} из ${batches.length}.`
        );

        const response = await fetch("/api/admin/import-users", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idToken,
            accessCode: importAccessCode.trim(),
            archiveMissing: importArchiveMissing && batchIndex === batches.length - 1,
            allCrmIds:
              importArchiveMissing && batchIndex === batches.length - 1
                ? importPreview.validUsers
                    .map((importUser) => importUser.crmId)
                    .filter(Boolean)
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
        };

        if (!response.ok) {
          throw new Error(batchResult.message ?? "Импорт не выполнен.");
        }

        result.created += batchResult.created ?? 0;
        result.updated += batchResult.updated ?? 0;
        result.skipped += batchResult.skipped ?? 0;
        result.imported += batchResult.imported ?? 0;
      }

      setMessage(
        `Импорт завершен. Импортировано: ${result.imported ?? 0}, создано: ${
          result.created ?? 0
        }, обновлено: ${result.updated ?? 0}, пропущено: ${result.skipped ?? 0}.`
      );
      try {
        if (db) {
          await addDoc(collection(db, "importHistory"), {
            fileName: importPreview.fileName,
            actor: user.email ?? "",
            imported: result.imported ?? 0,
            created: result.created ?? 0,
            updated: result.updated ?? 0,
            skipped: result.skipped ?? 0,
            archiveMissing: importArchiveMissing,
            createdAt: serverTimestamp()
          });
        }
      } catch (historyError) {
        console.warn("CRM import history was not saved:", historyError);
      }
    } catch (error) {
      console.error("Web CRM import failed:", error);
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
            <p className="text-xs font-semibold uppercase tracking-wide text-[#ea6a00]">
              Админ-панель
            </p>
            <h2 className="text-xl font-semibold text-slate-950">
              Управление PSN HUB
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {user ? (
              <button
                type="button"
                onClick={() => navigate(() => void handleLogout())}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <LogOut size={16} />
                Выйти
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
                      title="Добавить вебинар"
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
                    form={materialForm}
                    allTopicOptions={allTopicOptions}
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
              ) : (
                <UsersWorkspace
                  users={accessUsers}
                  onUpdate={updateAccessUser}
                  manualUserForm={manualUserForm}
                  importPreview={importPreview}
                  importAccessCode={importAccessCode}
                  importArchiveMissing={importArchiveMissing}
                  lastImport={lastImport}
                  isSubmitting={isSubmitting}
                  onManualUserChange={setManualUserForm}
                  onManualUserSubmit={handleManualUserSubmit}
                  onImportAccessCodeChange={setImportAccessCode}
                  onImportArchiveMissingChange={setImportArchiveMissing}
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
  allTopicOptions,
  formatDatalist,
  isSubmitting,
  onBack,
  onFormChange,
  onSubmit
}: {
  mode: Exclude<AddMode, "menu" | "track">;
  form: typeof initialMaterialForm;
  allTopicOptions: string[];
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
        title={isWebinar ? "Добавить вебинар" : "Пополнить базу знаний"}
        onBack={onBack}
      />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
          <input type="checkbox" checked={form.hiddenFromLibrary} onChange={(event) => onFormChange({ ...form, hiddenFromLibrary: event.target.checked })} />
          Скрывать из библиотеки
        </label>
        <TextField
          label="Название"
          value={form.title}
          onChange={(value) => onFormChange({ ...form, title: value })}
          required
        />
        <TextField
          label={isWebinar ? "Ссылка на видео" : "Ссылка на файл"}
          value={form.url}
          placeholder="https://..."
          onChange={(value) => onFormChange({ ...form, url: value })}
          required
        />
        <TextField
          label="Ссылка на тестирование"
          value={form.testUrl}
          placeholder="https://testograf-app.pages.dev/#t=..."
          onChange={(value) => onFormChange({ ...form, testUrl: value })}
        />
        <label className="text-sm font-medium text-slate-700">
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
        </label>
        <TextField
          label={isWebinar ? "Формат" : "Формат базы знаний"}
          value={form.format}
          list={isWebinar ? undefined : "knowledge-formats"}
          placeholder="PDF, Документ, Таблица..."
          onChange={(value) => onFormChange({ ...form, format: value })}
          required
          disabled={isWebinar}
        />
        <datalist id="knowledge-formats">
          {formatDatalist.map((format) => (
            <option key={format} value={format} />
          ))}
        </datalist>
        <TextField
          label="Темы / категории"
          value={form.category}
          placeholder="Маркетинг, Продажи"
          list="admin-all-topics"
          onChange={(value) => onFormChange({ ...form, category: value })}
          required
        />
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
        <TextField
          label="Длительность, минут"
          type="number"
          value={String(form.duration)}
          onChange={(value) => onFormChange({ ...form, duration: Number(value) })}
          required
        />
        {isWebinar ? (
          <>
            <TextField
              label="Спикер"
              value={form.speakerName}
              onChange={(value) => onFormChange({ ...form, speakerName: value })}
            />
            <TextField
              label="Компания"
              value={form.speakerCompany}
              onChange={(value) =>
                onFormChange({ ...form, speakerCompany: value })
              }
            />
            <label className="text-sm font-medium text-slate-700">
              Trending Stamp
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
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Описание
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
      </div>
      <SubmitButton isSubmitting={isSubmitting} label="Добавить материал" />
    </form>
  );
}

function TrackCreateForm({
  form,
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
  isSubmitting,
  onFormChange,
  onSubmit
}: {
  form: typeof initialManualUserForm;
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
          label="Актуальный код доступа"
          type="password"
          value={form.accessCode}
          placeholder="Текущий недельный код"
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
  accessCode,
  archiveMissing,
  lastImport,
  isSubmitting,
  onAccessCodeChange,
  onArchiveMissingChange,
  onFile,
  onSubmit
}: {
  preview: ImportPreview | null;
  accessCode: string;
  archiveMissing: boolean;
  lastImport: ImportHistoryItem | null;
  isSubmitting: boolean;
  onAccessCodeChange: (value: string) => void;
  onArchiveMissingChange: (value: boolean) => void;
  onFile: (file: File | null) => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [copiedAccessCode, setCopiedAccessCode] = useState(false);

  async function copyAccessCode() {
    if (!accessCode) return;
    await window.navigator.clipboard.writeText(accessCode);
    setCopiedAccessCode(true);
  }

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
            Загрузите Excel-выгрузку. Система обновит существующих пользователей,
            создаст новых, применит актуальный код доступа и пропустит заблокированных.
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
            {lastImport.archiveMissing ? " · архивация отсутствующих включалась" : ""}
          </p>
          {lastImport.fileName ? (
            <p className="mt-1 break-all text-xs text-emerald-700">
              Файл: {lastImport.fileName}
            </p>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <div className="mt-5 space-y-5">
          <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="break-all text-sm font-semibold text-slate-900">
              {preview.fileName}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <ImportStat label="Всего строк" value={preview.totalRows} />
              <ImportStat label="К импорту" value={preview.validUsers.length} />
              <ImportStat label="Без логина/e-mail" value={preview.skippedMissing} />
              <ImportStat label="Заблокированы" value={preview.skippedBlocked} />
              <ImportStat
                label="Повторы"
                value={preview.duplicateIds + preview.duplicateLogins}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
            <TextField
              label="Пароль для импортируемых пользователей"
              type="password"
              value={accessCode}
              placeholder="Задайте пароль перед импортом"
              onChange={(value) => {
                setCopiedAccessCode(false);
                onAccessCodeChange(value);
              }}
              required
            />

            <button
              type="button"
              onClick={() => void copyAccessCode()}
              disabled={!accessCode}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy size={17} />
              {copiedAccessCode ? "Скопировано" : "Скопировать пароль"}
            </button>

            <button
              type="submit"
              disabled={isSubmitting || preview.validUsers.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ea6a00] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#cf5e00] disabled:cursor-wait disabled:opacity-60"
            >
              <UserCheck size={17} />
              {isSubmitting ? "Импортируем..." : "Импортировать"}
            </button>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={archiveMissing && preview.hasStableIds}
              disabled={!preview.hasStableIds}
              onChange={(event) => onArchiveMissingChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-[#ea6a00] focus:ring-[#ea6a00] disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span>
              Архивировать пользователей, которых нет в этой выгрузке. Включайте
              только если файл точно полный, а не частичная выборка.
              {!preview.hasStableIds ? (
                <span className="mt-1 block text-[#b95200]">
                  В текущем файле нет CRM ID, поэтому архивация отключена для защиты прогресса пользователей.
                </span>
              ) : null}
            </span>
          </label>
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
  importPreview,
  importAccessCode,
  importArchiveMissing,
  lastImport,
  isSubmitting,
  onManualUserChange,
  onManualUserSubmit,
  onImportAccessCodeChange,
  onImportArchiveMissingChange,
  onImportFile,
  onWebImportSubmit
}: {
  users: AccessUser[];
  onUpdate: (id: string, payload: Partial<AccessUser>) => Promise<void>;
  manualUserForm: typeof initialManualUserForm;
  importPreview: ImportPreview | null;
  importAccessCode: string;
  importArchiveMissing: boolean;
  lastImport: ImportHistoryItem | null;
  isSubmitting: boolean;
  onManualUserChange: (form: typeof initialManualUserForm) => void;
  onManualUserSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onImportAccessCodeChange: (value: string) => void;
  onImportArchiveMissingChange: (value: boolean) => void;
  onImportFile: (file: File | null) => Promise<void>;
  onWebImportSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = users.filter((accessUser) => {
    if (status === "active" && (!accessUser.active || accessUser.archived)) {
      return false;
    }

    if (status === "archived" && !accessUser.archived) {
      return false;
    }

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
      <WeeklyCodeGenerator />
      <CrmImportPanel
        preview={importPreview}
        accessCode={importAccessCode}
        archiveMissing={importArchiveMissing}
        lastImport={lastImport}
        isSubmitting={isSubmitting}
        onAccessCodeChange={onImportAccessCodeChange}
        onArchiveMissingChange={onImportArchiveMissingChange}
        onFile={onImportFile}
        onSubmit={onWebImportSubmit}
      />
      <ManualUserCreateForm
        form={manualUserForm}
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
          <div className="relative w-full lg:max-w-sm">
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
  const [email, setEmail] = useState(accessUser.email ?? "");
  const [phone, setPhone] = useState(accessUser.phone ?? "");

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
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Имя" value={displayName} onChange={setDisplayName} />
        <label className="text-sm font-medium text-slate-700">
          Роль
          <span className="mt-2 block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 font-normal text-slate-600">
            Пользователь
          </span>
        </label>
        <TextField label="Контактная почта" value={email} onChange={setEmail} />
        <TextField label="Телефон" value={phone} onChange={setPhone} />
      </div>

      <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
        <div className="flex items-start gap-3">
          <KeyRound size={19} className="mt-0.5 shrink-0 text-slate-400" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Пароль</p>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              Пользователь входит с общим недельным кодом. Код применяется ко
              всем активным учетным записям во время защищенной синхронизации и
              никогда не сохраняется в Firestore.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-5">
        <button
          type="button"
          onClick={() =>
            void onUpdate(accessUser.id, {
              displayName,
              email,
              phone,
              role: "user"
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
            Недельный код доступа
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Сгенерируйте код, примените его защищенной синхронизацией, затем
            опубликуйте в новости CRM. Код показывается только в этом окне.
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
            label="Архив библиотеки вебинаров"
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
                {formatDate(item.createdAt)} · {item.archived ? "архив" : "активно"}
                {"hiddenFromLibrary" in item && item.hiddenFromLibrary ? " · скрыт из библиотеки" : ""}
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
            onUpdate={onUpdateMaterial}
            onDelete={(id) => onDelete("materials", id)}
          />
        ) : selectedTrack ? (
          <TrackEditor
            key={selectedTrack.id}
            track={selectedTrack}
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
  onUpdate,
  onDelete
}: {
  material: Material;
  onUpdate: (id: string, payload: Partial<Material>) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(material.title);
  const [hiddenFromLibrary, setHiddenFromLibrary] = useState(material.hiddenFromLibrary ?? false);
  const [description, setDescription] = useState(material.description);
  const [tags, setTags] = useState((material.tags ?? []).join(", "));
  const [category, setCategory] = useState(material.category.join(", "));
  const [coverUrl, setCoverUrl] = useState(material.coverUrl ?? "");
  const [url, setUrl] = useState(material.url);
  const [testUrl, setTestUrl] = useState(material.testUrl ?? "");
  const [format, setFormat] = useState(material.format);
  const [speakerName, setSpeakerName] = useState(material.author.name);
  const [speakerCompany, setSpeakerCompany] = useState(
    material.author.company ?? ""
  );
  const [trendingStamp, setTrendingStamp] = useState<TrendingStamp | "">(
    material.trendingStamp ?? ""
  );
  const navigate = useEditorNavigation();
  const payload = { hiddenFromLibrary, title, description, url, testUrl, coverUrl, format,
    category: splitList(category), tags: splitList(tags),
    author: { name: speakerName, company: speakerCompany }, trendingStamp: trendingStamp || null };
  const save = useEditorDraft(payload, () => onUpdate(material.id, payload), () => {
    setTitle(material.title); setDescription(material.description); setUrl(material.url);
    setHiddenFromLibrary(material.hiddenFromLibrary ?? false); setTestUrl(material.testUrl ?? "");
    setCoverUrl(material.coverUrl ?? ""); setFormat(material.format);
    setCategory(material.category.join(", ")); setTags((material.tags ?? []).join(", "));
    setSpeakerName(material.author.name); setSpeakerCompany(material.author.company ?? "");
    setTrendingStamp(material.trendingStamp ?? "");
  });

  return (
    <div className="space-y-4">
      <EditorTitle id={material.id} archived={Boolean(material.archived)} />
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={hiddenFromLibrary} onChange={(event) => setHiddenFromLibrary(event.target.checked)} />
        Скрывать из библиотеки
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <TextField label="Название" value={title} onChange={setTitle} />
        <TextField label="Формат" value={format} onChange={setFormat} />
        <TextField label="URL" value={url} onChange={setUrl} />
        <TextField
          label="Ссылка на тестирование"
          value={testUrl}
          onChange={setTestUrl}
        />
        <TextField label="Обложка" value={coverUrl} onChange={setCoverUrl} />
        <TextField label="Темы" value={category} onChange={setCategory} />
        <TextField label="Теги" value={tags} onChange={setTags} />
        {material.tab === "webinars" ? (
          <>
            <TextField
              label="Спикер"
              value={speakerName}
              onChange={setSpeakerName}
            />
            <TextField
              label="Компания"
              value={speakerCompany}
              onChange={setSpeakerCompany}
            />
            <label className="text-sm font-medium text-slate-700">
              Trending Stamp
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
  materials,
  onUpdate,
  onDelete
}: {
  track: LearningTrack;
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
  const [infoBlocks, setInfoBlocks] = useState(track.infoBlocks ?? []);
  const navigate = useEditorNavigation();
  const payload = { title, description, coverUrl, testUrl, tags: splitList(tags), materialIds: selectedIds, infoBlocks };
  const save = useEditorDraft(payload, () => onUpdate(track.id, payload), () => {
    setTitle(track.title); setDescription(track.description); setCoverUrl(track.coverUrl ?? "");
    setTestUrl(track.testUrl ?? ""); setTags((track.tags ?? []).join(", "));
    setSelectedIds(track.materialIds); setInfoBlocks(track.infoBlocks ?? []);
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
