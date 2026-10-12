import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { TextDecoder } from "node:util";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

Error.stackTraceLimit = 2;

function printFatalError(error) {
  console.error(
    `Импорт остановлен: ${error?.code ?? ""} ${error?.message ?? error}`
  );
  process.exit(1);
}

process.on("uncaughtException", printFatalError);
process.on("unhandledRejection", printFatalError);

const inputPath = process.argv[2];
const showHelp = process.argv.includes("--help") || process.argv.includes("-h");
const dryRun = process.argv.includes("--dry-run");
const archiveMissing = process.argv.includes("--archive-missing");
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const weeklyAccessCode =
  process.env.PSN_HUB_WEEKLY_CODE ?? process.env.TRAVEL_EDU_WEEKLY_CODE ?? "";
const RETRY_DELAYS_MS = [1500, 3000, 6000, 10000];

if (showHelp) {
  console.log(`
Usage:
  npm run sync:users -- ./users.xlsx [--dry-run]
  npm run sync:users -- ./users.csv [--dry-run]
  npm run sync:users -- ./crm-export-folder [--archive-missing]

Required environment variables:
  GOOGLE_APPLICATION_CREDENTIALS - path to Firebase Admin SDK JSON key
  PSN_HUB_WEEKLY_CODE            - weekly access code, 12+ characters

Supported CSV columns:
  id, login, name, email, phone, status
  ID пользователя, Логин, Имя (Рус.), Фамилия (Рус), e-mail, Телефон, Заблокирован

Notes:
  id is required. If login is empty, the import uses the user's full name as the login.
  If a folder is passed, the newest XLSX/CSV/TSV file in that folder is used.
  --dry-run checks the export without writing anything to Firebase.
  --archive-missing disables users that are absent from the new CRM export.
  Blocked users from the export are skipped and are not created in Firebase.
`);
  process.exit(0);
}

if (!inputPath || (!dryRun && (!serviceAccountPath || weeklyAccessCode.length < 12))) {
  console.error(
    "Set GOOGLE_APPLICATION_CREDENTIALS and PSN_HUB_WEEKLY_CODE (12+ characters), then run the sync script."
  );
  process.exit(1);
}

const normalizeLogin = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

async function resolveInputPath(path) {
  const pathStat = await stat(path);
  if (!pathStat.isDirectory()) {
    return path;
  }

  const files = await readdir(path, { withFileTypes: true });
  const candidates = await Promise.all(
    files
      .filter((item) => item.isFile())
      .map(async (item) => {
        const filePath = join(path, item.name);
        const extension = extname(item.name).toLowerCase();
        if (![".xlsx", ".xls", ".csv", ".tsv", ".txt"].includes(extension)) {
          return null;
        }
        return { path: filePath, modifiedAt: (await stat(filePath)).mtimeMs };
      })
  );
  const newest = candidates
    .filter(Boolean)
    .sort((a, b) => b.modifiedAt - a.modifiedAt)[0];

  if (!newest) {
    throw new Error("No XLSX/CSV/TSV export file was found in the provided folder.");
  }

  return newest.path;
}

const loginToEmail = (login) => {
  const hash = createHash("sha256").update(normalizeLogin(login)).digest("hex");
  return `login-${hash}@users.travel-edu.invalid`;
};

function parseDelimited(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [";", "\t", ","].sort(
    (a, b) => firstLine.split(b).length - firstLine.split(a).length
  )[0];
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function decodeText(buffer) {
  const utf8Text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  const replacementCount = (utf8Text.match(/\uFFFD/g) ?? []).length;

  if (replacementCount <= 2) {
    return utf8Text;
  }

  return new TextDecoder("windows-1251").decode(buffer);
}

async function parseWorkbookRows(filePath) {
  let xlsx;

  try {
    xlsx = await import("xlsx");
  } catch {
    throw new Error(
      "XLSX import requires the xlsx package. Run: npm.cmd install xlsx"
    );
  }

  const workbook = xlsx.read(await readFile(filePath), {
    type: "buffer",
    cellDates: false,
    raw: false
  });

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: "",
      raw: false
    });
    const normalizedRows = rows.map((row) => row.map((value) => String(value ?? "")));

    if (normalizedRows.some(isHeaderRow)) {
      return normalizedRows;
    }
  }

  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return xlsx.utils
    .sheet_to_json(firstSheet, { header: 1, defval: "", raw: false })
    .map((row) => row.map((value) => String(value ?? "")));
}

async function readInputRows(filePath) {
  const extension = extname(filePath).toLowerCase();

  if (extension === ".xlsx" || extension === ".xls") {
    return parseWorkbookRows(filePath);
  }

  const text = decodeText(await readFile(filePath));
  return parseDelimited(text.replace(/^\uFEFF/, ""));
}

function normalizeHeader(value) {
  return normalizeLogin(value).replace(/[\s._()/-]+/g, "");
}

function getValue(record, aliases) {
  for (const alias of aliases) {
    const value = record[normalizeHeader(alias)];
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return "";
}

function parseActive(value) {
  const normalized = normalizeLogin(value);
  return !["0", "нет", "false", "архив", "уволен", "заблокирован", "blocked"].includes(
    normalized
  );
}

function parseTruthy(value) {
  const normalized = normalizeLogin(value);
  return ["1", "да", "true", "yes", "y", "заблокирован", "blocked"].includes(
    normalized
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(error) {
  const code = error?.code ?? error?.cause?.code;
  const message = String(error?.message ?? error?.cause?.message ?? "");

  return (
    code === "app/network-error" ||
    ["ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"].includes(
      code
    ) ||
    /network|timeout|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT/i.test(message)
  );
}

async function withRetry(label, operation) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientNetworkError(error) || attempt === RETRY_DELAYS_MS.length) {
        throw error;
      }

      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `${label}: temporary network error, retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${Math.round(
          delay / 1000
        )}s.`
      );
      await sleep(delay);
    }
  }
}

function rowHasAlias(row, aliases) {
  const normalizedRow = new Set(row.map(normalizeHeader));
  return aliases.some((alias) => normalizedRow.has(normalizeHeader(alias)));
}

const idAliases = ["id", "crm id", "user id", "ид", "код", "id пользователя"];
const loginAliases = ["login", "username", "логин"];

function isHeaderRow(row) {
  return rowHasAlias(row, idAliases) && rowHasAlias(row, loginAliases);
}

function findHeaderRowIndex(rows) {
  const headerIndex = rows.findIndex(isHeaderRow);
  return headerIndex >= 0 ? headerIndex : 0;
}

const resolvedInputPath = await resolveInputPath(inputPath);
const rows = await readInputRows(resolvedInputPath);
const headerRowIndex = findHeaderRowIndex(rows);
const headers = (rows[headerRowIndex] ?? []).map(normalizeHeader);
const records = rows.slice(headerRowIndex + 1).map((values) =>
  Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
);

function extractUserRecord(record, rowNumber) {
  const crmId = getValue(record, [
    "id",
    "crm id",
    "user id",
    "ид",
    "код",
    "id пользователя"
  ]);
  const rawLogin = getValue(record, ["login", "username", "логин"]);
  const firstName = getValue(record, [
    "first name",
    "имя",
    "имя рус",
    "имя (рус.)"
  ]);
  const lastName = getValue(record, [
    "last name",
    "фамилия",
    "фамилия рус",
    "фамилия (рус)"
  ]);
  const displayName =
    getValue(record, ["display name", "name", "фио"]) ||
    [firstName, lastName].filter(Boolean).join(" ");
  const login = rawLogin || displayName;
  const office = getValue(record, ["название офиса", "офис", "office"]);
  const email = getValue(record, ["email", "e-mail", "почта"]);
  const phone = getValue(record, ["phone", "телефон"]);
  const blocked = getValue(record, ["blocked", "заблокирован"]);
  const isBlocked = blocked ? parseTruthy(blocked) : false;
  const active = blocked
    ? !isBlocked
    : parseActive(getValue(record, ["active", "status", "активен", "статус"]));

  return {
    rowNumber,
    crmId,
    login,
    displayName,
    office,
    email,
    phone,
    active,
    isBlocked
  };
}

if (dryRun) {
  const users = records.map((record, index) =>
    extractUserRecord(record, headerRowIndex + index + 2)
  );
  const blockedUsers = users.filter((user) => user.isBlocked);
  const validUsers = users.filter((user) => user.crmId && user.login);
  const skippedUsers = users.filter((user) => !user.crmId || !user.login);
  const duplicateIds = new Set();
  const duplicateLogins = new Set();
  const seenIds = new Set();
  const seenLogins = new Set();

  for (const user of validUsers) {
    const normalizedId = user.crmId.trim();
    const normalizedLogin = normalizeLogin(user.login);

    if (seenIds.has(normalizedId)) duplicateIds.add(normalizedId);
    seenIds.add(normalizedId);

    if (seenLogins.has(normalizedLogin)) duplicateLogins.add(normalizedLogin);
    seenLogins.add(normalizedLogin);
  }

  console.log(`Файл: ${resolvedInputPath}`);
  console.log(`Строка заголовков: ${headerRowIndex + 1}`);
  console.log(`Строк с ID и логином: ${validUsers.length}`);
  console.log(`Уникальных пользователей к импорту: ${seenIds.size}`);
  console.log(`Пропущено без ID или логина/ФИО: ${skippedUsers.length}`);
  console.log(`Будут архивированы как заблокированные: ${blockedUsers.length}`);
  console.log(`Активных: ${validUsers.filter((user) => user.active).length}`);
  console.log(`Архивных по статусу: ${validUsers.filter((user) => !user.active).length}`);
  console.log(`Повторных строк по ID: ${validUsers.length - seenIds.size}`);
  console.log(`ID с повторами: ${duplicateIds.size}`);
  console.log(`Логинов с повторами: ${duplicateLogins.size}`);
  process.exit(0);
}

const serviceAccount = JSON.parse(await readFile(serviceAccountPath, "utf8"));
initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();
const db = getFirestore();
const importedIds = new Set();
const importedLogins = new Set();
let created = 0;
let updated = 0;
let skipped = 0;
let batch = db.batch();
let pendingWrites = 0;

async function flushBatch() {
  if (!pendingWrites) return;
  await withRetry("Firestore batch commit", () => batch.commit());
  batch = db.batch();
  pendingWrites = 0;
}

async function syncAuthUser(crmId, userPayload) {
  try {
    await withRetry(`Firebase Auth get user ${crmId}`, () => auth.getUser(crmId));
    await withRetry(`Firebase Auth update user ${crmId}`, () =>
      auth.updateUser(crmId, userPayload)
    );
    return { status: "updated", uid: crmId };
  } catch (error) {
    if (error?.code !== "auth/user-not-found") {
      throw error;
    }
  }

  try {
    await withRetry(`Firebase Auth create user ${crmId}`, () =>
      auth.createUser({ uid: crmId, ...userPayload })
    );
    return { status: "created", uid: crmId };
  } catch (error) {
    if (error?.code !== "auth/uid-already-exists" && error?.code !== "auth/email-already-exists") {
      throw error;
    }

    const existingUser =
      error?.code === "auth/email-already-exists"
        ? await withRetry(`Firebase Auth find user by email ${userPayload.email}`, () =>
            auth.getUserByEmail(userPayload.email)
          )
        : await withRetry(`Firebase Auth find existing user ${crmId}`, () =>
            auth.getUser(crmId)
          );

    await withRetry(`Firebase Auth update existing user ${existingUser.uid}`, () =>
      auth.updateUser(existingUser.uid, userPayload)
    );
    return { status: "updated", uid: existingUser.uid };
  }
}

for (const [index, record] of records.entries()) {
  const { rowNumber, crmId, login, displayName, office, email, phone, active, isBlocked } =
    extractUserRecord(record, headerRowIndex + index + 2);

  if (!crmId || crmId.length > 128 || !login) {
    skipped += 1;
    console.warn(`Строка ${rowNumber} пропущена: проверьте ID и логин/ФИО.`);
    continue;
  }

  if (importedIds.has(crmId)) {
    skipped += 1;
    console.warn(`Строка ${rowNumber} пропущена: повтор ID ${crmId}.`);
    continue;
  }

  const normalizedLogin = normalizeLogin(login);
  if (importedLogins.has(normalizedLogin)) {
    skipped += 1;
    console.warn(`Строка ${rowNumber} пропущена: повтор логина ${login}.`);
    continue;
  }

  const authEmail = loginToEmail(login);
  const userRef = db.collection("accessUsers").doc(crmId);
  const existingAccessSnapshot = await userRef.get();
  const existingAccess = existingAccessSnapshot.exists
    ? existingAccessSnapshot.data()
    : null;

  if (isBlocked && !existingAccessSnapshot.exists) {
    importedIds.add(crmId);
    importedLogins.add(normalizedLogin);
    skipped += 1;
    console.warn(`Строка ${rowNumber} пропущена: новый пользователь заблокирован в CRM.`);
    continue;
  }

  const needsPasswordMigration =
    active && Number(existingAccess?.passwordPolicyVersion ?? 0) < 1;
  const userPayload = {
    email: authEmail,
    displayName: displayName || login,
    disabled: !active,
    ...(needsPasswordMigration ? { password: weeklyAccessCode } : {})
  };

  let isNewUser = false;
  let userRefId = crmId;

  try {
    const result = await syncAuthUser(crmId, userPayload);
    isNewUser = result.status === "created";
    if (result.status === "created") {
      created += 1;
    } else {
      updated += 1;
    }
    userRefId = result.uid;
  } catch (error) {
    console.error(
      `Строка ${rowNumber}: не удалось синхронизировать пользователя ${crmId}. ${error?.code ?? ""} ${error?.message ?? error}`
    );
    throw error;
  }

  importedIds.add(crmId);
  importedLogins.add(normalizedLogin);
  const resolvedUserRef = db.collection("accessUsers").doc(userRefId);
  batch.set(
    resolvedUserRef,
    {
      crmId,
      login,
      normalizedLogin,
      displayName: displayName || login,
      office,
      email,
      phone,
      active,
      archived: !active,
      manual: false,
      source: "crm",
      passwordResetRequested: needsPasswordMigration
        ? true
        : existingAccess?.passwordResetRequested === true,
      passwordPolicyVersion: Math.max(
        Number(existingAccess?.passwordPolicyVersion ?? 0),
        needsPasswordMigration ? 1 : 0
      ),
      updatedAt: FieldValue.serverTimestamp(),
      ...(isNewUser
        ? { role: "user", createdAt: FieldValue.serverTimestamp() }
        : {})
    },
    { merge: true }
  );
  pendingWrites += 1;

  if (pendingWrites >= 400) await flushBatch();
}

await flushBatch();

if (archiveMissing) {
  const snapshot = await db.collection("accessUsers").get();
  let archiveBatch = db.batch();
  let archiveWrites = 0;

  for (const userDoc of snapshot.docs) {
    const userData = userDoc.data();
    if (userData.source === "manual" || userData.manual === true) continue;
    const importedCrmId = String(userData.crmId ?? userDoc.id);
    if (importedIds.has(importedCrmId)) continue;
    archiveBatch.update(userDoc.ref, {
      active: false,
      archived: true,
      updatedAt: FieldValue.serverTimestamp()
    });
    archiveWrites += 1;

    if (archiveWrites >= 400) {
      await archiveBatch.commit();
      archiveBatch = db.batch();
      archiveWrites = 0;
    }
  }

  if (archiveWrites) await archiveBatch.commit();
}

console.log(
  `Синхронизация завершена. Создано: ${created}, обновлено: ${updated}, пропущено: ${skipped}.`
);
