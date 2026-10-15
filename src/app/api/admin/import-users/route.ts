import { NextRequest, NextResponse } from "next/server";
import { classifyTrainingRole } from "@/lib/training-role";
import { officeGroupId } from "@/lib/training-groups";

export const runtime = "edge";

type ImportUser = {
  crmId?: string;
  login: string;
  loginSource?: "name_fallback";
  displayName: string;
  office?: string;
  officeIds?: string[];
  offices?: string[];
  officeLinks?: Array<{ id: string; name: string; city: string }>;
  city?: string;
  position?: string;
  crmUserTypes?: string[];
  email?: string;
  phone?: string;
  active: boolean;
  isBlocked?: boolean;
};

type ImportConflict = {
  crmId: string;
  displayName: string;
  login: string;
  reason: string;
};

class ImportIdentityConflict extends Error {}

type ImportRequest = {
  idToken?: string;
  temporaryPassword?: string;
  archiveMissing?: boolean;
  allCrmIds?: string[];
  allUserKeys?: string[];
  blockedCrmIdsWithoutLogin?: string[];
  users?: ImportUser[];
};

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

const ADMIN_EMAIL =
  process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "psnkzeducation@gmail.com";
const FIREBASE_API_KEY =
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
  "AIzaSyBvX9x2IFLzG5nf8akzWmzLuv7r442XiKY";
const FIREBASE_PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";
const USER_EMAIL_DOMAIN = "users.travel-edu.invalid";
const TEMP_PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).{6,}$/u;

function normalizeLogin(login: string) {
  return login.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function base64Url(input: ArrayBuffer | string) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

async function loginToEmail(login: string) {
  const normalized = normalizeLogin(login);
  if (normalized.includes("@")) return normalized;
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `login-${hash}@${USER_EMAIL_DOMAIN}`;
}

async function stableUidFromLogin(login: string) {
  const bytes = new TextEncoder().encode(normalizeLogin(login));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `crm_${hash.slice(0, 30)}`;
}

function getServiceAccount(): ServiceAccount {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ??
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    "";

  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured.");
  }

  const decoded = raw.trim().startsWith("{") ? raw : atob(raw);
  const serviceAccount = JSON.parse(decoded) as ServiceAccount;

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error("Firebase service account JSON is incomplete.");
  }

  return {
    ...serviceAccount,
    project_id: serviceAccount.project_id ?? FIREBASE_PROJECT_ID
  };
}

async function getAccessToken(serviceAccount: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope:
      "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(
    JSON.stringify(claim)
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    throw new Error(`OAuth token request failed: ${await response.text()}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function verifyAdmin(idToken: string) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );

  if (!response.ok) {
    return false;
  }

  const data = (await response.json()) as {
    users?: Array<{ email?: string; disabled?: boolean }>;
  };
  const firebaseUser = data.users?.[0];

  return (
    firebaseUser?.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
    firebaseUser.disabled !== true
  );
}

async function identityToolkit(
  token: string,
  action: "lookup" | "update" | "signUp" | "delete",
  body: Record<string, unknown>
) {
  const url =
    action === "signUp"
      ? `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts`
      : `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:${action}`;

  const response = await fetch(
    url,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Identity Toolkit ${action} failed: ${details}`);
  }

  return response.json() as Promise<{
    users?: Array<{ localId: string }>;
    localId?: string;
  }>;
}

async function findAuthUserById(token: string, uid: string) {
  const data = await identityToolkit(token, "lookup", { localId: [uid] });
  return data.users?.[0]?.localId;
}

async function findAuthUserByEmail(token: string, email: string) {
  const data = await identityToolkit(token, "lookup", { email: [email] });
  return data.users?.[0]?.localId;
}

async function syncExistingAuthUser(
  token: string,
  uid: string,
  authEmail: string,
  displayName: string,
  disabled: boolean,
  preserveEmail = false
) {
  const existingById = await findAuthUserById(token, uid);
  if (!existingById) return false;
  await identityToolkit(token, "update", {
    localId: existingById,
    ...(!preserveEmail ? { email: authEmail } : {}),
    displayName,
    disabled
  });
  return true;
}

function firestoreValue(value: unknown): Record<string, unknown> {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  return { stringValue: String(value ?? "") };
}

function firestoreStringArray(values: string[]): Record<string, unknown> {
  return { arrayValue: { values: values.map((value) => ({ stringValue: value })) } };
}

function firestoreOfficeLinks(links: NonNullable<ImportUser["officeLinks"]>): Record<string, unknown> {
  return { arrayValue: { values: links.map((link) => ({ mapValue: { fields: {
    id: firestoreValue(link.id),
    name: firestoreValue(link.name),
    city: firestoreValue(link.city)
  } } })) } };
}

async function commitFirestoreWrites(
  token: string,
  writes: Array<Record<string, unknown>>
) {
  if (!writes.length) return;

  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ writes })
    }
  );

  if (!response.ok) {
    throw new Error(`Firestore commit failed: ${await response.text()}`);
  }
}

function accessUserWrite(
  uid: string,
  user: ImportUser,
  passwordResetRequested: boolean,
  passwordPolicyVersion: number,
  isNewUser: boolean,
  trainingRoleManual: boolean,
  provisionedAuth: boolean
) {
  const normalizedLogin = normalizeLogin(user.login);
  const fields: Record<string, Record<string, unknown>> = {
    crmId: firestoreValue(user.crmId),
    login: firestoreValue(user.login),
    normalizedLogin: firestoreValue(normalizedLogin),
    displayName: firestoreValue(user.displayName || user.login),
    office: firestoreValue(user.office ?? ""),
    email: firestoreValue(user.email ?? ""),
    phone: firestoreValue(user.phone ?? ""),
    active: firestoreValue(user.active),
    archived: firestoreValue(!user.active),
    passwordResetRequested: firestoreValue(provisionedAuth ? true : passwordResetRequested),
    passwordPolicyVersion: firestoreValue(provisionedAuth ? 0 : passwordPolicyVersion),
    updatedAt: { timestampValue: new Date().toISOString() }
  };
  if (user.officeIds) fields.officeIds = firestoreStringArray(user.officeIds);
  if (user.offices) fields.offices = firestoreStringArray(user.offices);
  if (user.officeLinks) fields.officeLinks = firestoreOfficeLinks(user.officeLinks);
  if (user.city !== undefined) fields.city = firestoreValue(user.city);
  if (user.position !== undefined) fields.position = firestoreValue(user.position);
  if (user.crmUserTypes) fields.crmUserTypes = firestoreStringArray(user.crmUserTypes);
  if (!trainingRoleManual) {
    fields.trainingRole = firestoreValue(classifyTrainingRole(user.crmUserTypes ?? []).role);
    fields.trainingRoleManual = firestoreValue(false);
  }
  if (isNewUser) {
    fields.role = firestoreValue("user");
    fields.manual = firestoreValue(false);
    fields.source = firestoreValue("crm");
    fields.claimState = firestoreValue(
      classifyTrainingRole(user.crmUserTypes ?? []).role === "MANUAL_REVIEW"
        ? "manual_review"
        : "claimed"
    );
    fields.createdAt = { timestampValue: new Date().toISOString() };
  } else if (provisionedAuth) {
    fields.claimState = firestoreValue("claimed");
  }

  return {
    update: {
      name: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/accessUsers/${uid}`,
      fields
    },
    updateMask: {
      fieldPaths: Object.keys(fields)
    }
  };
}

type AccessUserRecord = {
  name: string;
  uid: string;
  crmId: string;
  login: string;
  normalizedLogin: string;
  email: string;
  source: string;
  passwordResetRequested: boolean;
  passwordPolicyVersion: number;
  trainingRoleManual: boolean;
  claimState: string;
};

type AccessUserDocument = {
  name: string;
  fields?: {
    crmId?: { stringValue?: string };
    login?: { stringValue?: string };
    normalizedLogin?: { stringValue?: string };
    email?: { stringValue?: string };
    source?: { stringValue?: string };
    manual?: { booleanValue?: boolean };
    passwordResetRequested?: { booleanValue?: boolean };
    passwordPolicyVersion?: { integerValue?: string };
    trainingRoleManual?: { booleanValue?: boolean };
    claimState?: { stringValue?: string };
  };
};

function accessUserRecord(document: AccessUserDocument): AccessUserRecord {
  const fallbackId = document.name.split("/").pop() ?? "";
  return {
    name: document.name,
    uid: fallbackId,
    crmId: document.fields?.crmId?.stringValue ?? fallbackId,
    login: document.fields?.login?.stringValue ?? "",
    normalizedLogin: document.fields?.normalizedLogin?.stringValue ?? "",
    email: (document.fields?.email?.stringValue ?? "").toLowerCase(),
    source: document.fields?.source?.stringValue ??
      (document.fields?.manual?.booleanValue ? "manual" : "crm"),
    passwordResetRequested: document.fields?.passwordResetRequested?.booleanValue === true,
    passwordPolicyVersion: Number(document.fields?.passwordPolicyVersion?.integerValue ?? 0),
    trainingRoleManual: document.fields?.trainingRoleManual?.booleanValue === true,
    claimState: document.fields?.claimState?.stringValue ?? "claimed"
  };
}

async function listAccessUsers(token: string) {
  const result: AccessUserRecord[] = [];
  let pageToken = "";

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/accessUsers`
    );
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`Firestore list failed: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      documents?: AccessUserDocument[];
      nextPageToken?: string;
    };

    for (const document of data.documents ?? []) result.push(accessUserRecord(document));

    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  return result;
}

async function listMatchingAccessUsers(token: string, users: ImportUser[]) {
  const records = new Map<string, AccessUserRecord>();
  const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
  const crmIds = [...new Set(users.map((user) => user.crmId?.trim()).filter((id): id is string => Boolean(id)))];
  const logins = [...new Set(users.map((user) => normalizeLogin(user.login)).filter(Boolean))];

  for (const [fieldPath, values] of [["crmId", crmIds], ["normalizedLogin", logins]] as const) {
    for (let index = 0; index < values.length; index += 30) {
      const response = await fetch(`${base}/documents:runQuery`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ structuredQuery: {
          from: [{ collectionId: "accessUsers" }],
          where: { fieldFilter: {
            field: { fieldPath },
            op: "IN",
            value: { arrayValue: { values: values.slice(index, index + 30).map((value) => ({ stringValue: value })) } }
          } }
        } })
      });
      if (!response.ok) throw new Error(`Firestore lookup failed: ${await response.text()}`);
      const rows = (await response.json()) as Array<{ document?: AccessUserDocument }>;
      for (const row of rows) {
        if (row.document) records.set(row.document.name, accessUserRecord(row.document));
      }
    }
  }

  // Older profiles may use the CRM ID as their document ID without a crmId field.
  for (let index = 0; index < crmIds.length; index += 100) {
    const response = await fetch(`${base}/documents:batchGet`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        documents: crmIds.slice(index, index + 100).map((id) => `${base}/documents/accessUsers/${id}`)
      })
    });
    if (!response.ok) throw new Error(`Firestore ID lookup failed: ${await response.text()}`);
    const rows = (await response.json()) as Array<{ found?: AccessUserDocument }>;
    for (const row of rows) {
      if (row.found) records.set(row.found.name, accessUserRecord(row.found));
    }
  }

  return [...records.values()];
}

async function resolveImportIdentity(
  user: ImportUser,
  existingUsers: AccessUserRecord[]
) {
  const providedCrmId = user.crmId?.trim() ?? "";
  const normalizedLogin = normalizeLogin(user.login);
  const byId = existingUsers.filter((item) => providedCrmId && item.crmId === providedCrmId);
  const byLogin = existingUsers.filter((item) => item.normalizedLogin === normalizedLogin);
  if (user.loginSource === "name_fallback" && byLogin[0] &&
      (!byId[0] || byLogin[0].uid !== byId[0].uid)) {
    throw new ImportIdentityConflict("Автологин по ФИО занят другим аккаунтом.");
  }
  if (byId.length > 1 || byLogin.length > 1 ||
      (byId[0] && byLogin[0] && byId[0].uid !== byLogin[0].uid)) {
    throw new ImportIdentityConflict("CRM ID и логин указывают на разные аккаунты.");
  }
  const existing = byId[0] ?? byLogin[0];
  if (existing && providedCrmId && existing.crmId !== providedCrmId &&
      !(existing.crmId === existing.uid && existing.uid.startsWith("crm_"))) {
    throw new ImportIdentityConflict("Логин уже связан с другим CRM ID.");
  }
  const crmId = providedCrmId || existing?.crmId || existing?.uid || await stableUidFromLogin(user.login);

  return {
    uid: existing?.uid || crmId,
    crmId,
    existing
  };
}

function getUserKeys(user: Pick<AccessUserRecord, "crmId" | "normalizedLogin">) {
  return [
    user.crmId ? `crm:${user.crmId.trim()}` : "",
    user.normalizedLogin ? `login:${user.normalizedLogin}` : ""
  ].filter(Boolean);
}

function archiveWrite(documentName: string) {
  const fields = {
    active: firestoreValue(false),
    archived: firestoreValue(true),
    updatedAt: { timestampValue: new Date().toISOString() }
  };

  return {
    update: { name: documentName, fields },
    updateMask: { fieldPaths: Object.keys(fields) }
  };
}

function officeGroupWrite(officeId: string, name: string) {
  const fields = {
    kind: firestoreValue("office"),
    officeId: firestoreValue(officeId),
    name: firestoreValue(name || `Офис ${officeId}`),
    updatedAt: { timestampValue: new Date().toISOString() }
  };
  return {
    update: {
      name: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/trainingGroups/${officeGroupId(officeId)}`,
      fields
    },
    updateMask: { fieldPaths: Object.keys(fields) }
  };
}

export async function POST(request: NextRequest) {
  let rollbackToken = "";
  const pendingAuthIds: string[] = [];
  try {
    const body = (await request.json()) as ImportRequest;

    if (!body.idToken || !(await verifyAdmin(body.idToken))) {
      return json({ message: "Нет прав администратора." }, 403);
    }

    const temporaryPassword = body.temporaryPassword;
    if (typeof temporaryPassword !== "string" ||
        temporaryPassword.length > 128 ||
        !TEMP_PASSWORD_PATTERN.test(temporaryPassword)) {
      return json({ message: "Укажите временный пароль от 6 символов с буквой и цифрой." }, 400);
    }

    const inputUsers = Array.isArray(body.users) ? body.users : [];
    const validUsers = inputUsers.filter((user) => user.login);

    if (!validUsers.length) {
      return json({ message: "В файле нет пользователей для импорта." }, 400);
    }

    const serviceAccount = getServiceAccount();
    const accessToken = await getAccessToken(serviceAccount);
    rollbackToken = accessToken;
    const needsFullList = Boolean(body.archiveMissing) ||
      Boolean(body.blockedCrmIdsWithoutLogin?.length);
    const existingAccessUsers = needsFullList
      ? await listAccessUsers(accessToken)
      : await listMatchingAccessUsers(accessToken, validUsers);
    const importedCrmIds = new Set<string>();
    const importedLogins = new Set<string>();
    const processedOfficeGroups = new Set<string>();
    const writes: Array<Record<string, unknown>> = [];
    let created = 0;
    let updated = 0;
    let skipped = inputUsers.length - validUsers.length;
    let archivedWithoutLogin = 0;
    const conflicts: ImportConflict[] = [];

    for (const user of validUsers) {
      let identity: Awaited<ReturnType<typeof resolveImportIdentity>>;
      try {
        identity = await resolveImportIdentity(user, existingAccessUsers);
      } catch (error) {
        if (!(error instanceof ImportIdentityConflict)) throw error;
        conflicts.push({
          crmId: user.crmId?.trim() ?? "",
          displayName: user.displayName,
          login: user.login,
          reason: error.message
        });
        skipped += 1;
        continue;
      }
      const classification = classifyTrainingRole(user.crmUserTypes ?? []);
      for (const token of classification.unknownTokens) {
        console.warn("Unknown CRM user type", { crmId: user.crmId, token });
      }
      const crmId = identity.crmId;
      // A generated fallback must not replace an existing user's established login.
      const effectiveLogin = user.loginSource === "name_fallback" && identity.existing
        ? identity.existing.login || identity.existing.normalizedLogin || user.login
        : user.login;
      const normalizedLogin = normalizeLogin(effectiveLogin);

      if (importedCrmIds.has(crmId) || importedLogins.has(normalizedLogin)) {
        skipped += 1;
        continue;
      }

      if (user.isBlocked && !identity.existing) {
        skipped += 1;
        importedCrmIds.add(crmId);
        importedLogins.add(normalizedLogin);
        continue;
      }

      const authEmail = user.loginSource === "name_fallback" && identity.existing?.email
        ? identity.existing.email
        : await loginToEmail(effectiveLogin);
      const provisionedAuth = user.active &&
        classification.role !== "MANUAL_REVIEW" &&
        (!identity.existing || identity.existing.claimState === "unclaimed");
      if (!identity.existing) {
        if (await findAuthUserById(accessToken, identity.uid) ||
            await findAuthUserByEmail(accessToken, authEmail)) {
          conflicts.push({
            crmId,
            displayName: user.displayName,
            login: user.login,
            reason: "Firebase Auth ID или логин уже занят."
          });
          skipped += 1;
          continue;
        }
        created += 1;
      } else {
        if (provisionedAuth &&
            (await findAuthUserById(accessToken, identity.uid) ||
              await findAuthUserByEmail(accessToken, authEmail))) {
          conflicts.push({
            crmId,
            displayName: user.displayName,
            login: user.login,
            reason: "Для неактивированного профиля уже существует Firebase Auth аккаунт."
          });
          skipped += 1;
          continue;
        }
        if (identity.existing.claimState !== "unclaimed" &&
            identity.existing.claimState !== "manual_review") {
          const authUpdated = await syncExistingAuthUser(
            accessToken,
            identity.uid,
            authEmail,
            user.displayName || user.login,
            !user.active,
            user.loginSource === "name_fallback"
          );
          if (!authUpdated) {
            conflicts.push({
              crmId,
              displayName: user.displayName,
              login: user.login,
              reason: "Профиль найден, но его Firebase Auth аккаунт отсутствует."
            });
            skipped += 1;
            continue;
          }
        }
        updated += 1;
      }

      if (provisionedAuth) {
        await identityToolkit(accessToken, "signUp", {
          localId: identity.uid,
          email: authEmail,
          password: temporaryPassword,
          displayName: user.displayName || user.login,
          disabled: false
        });
        pendingAuthIds.push(identity.uid);
      }

      importedCrmIds.add(crmId);
      importedLogins.add(normalizedLogin);
      writes.push(
        accessUserWrite(
          identity.uid,
          { ...user, crmId, login: effectiveLogin },
          identity.existing?.passwordResetRequested ?? false,
          identity.existing?.passwordPolicyVersion ?? 0,
          !identity.existing,
          identity.existing?.trainingRoleManual ?? false,
          provisionedAuth
        )
      );

      const offices = new Map<string, string>();
      for (const officeId of user.officeIds ?? []) {
        if (officeId.trim()) offices.set(officeId.trim(), "");
      }
      for (const link of user.officeLinks ?? []) {
        if (link.id?.trim()) offices.set(link.id.trim(), link.name?.trim() ?? "");
      }
      for (const [officeId, officeName] of offices) {
        if (!officeId || processedOfficeGroups.has(officeId)) continue;
        processedOfficeGroups.add(officeId);
        writes.push(officeGroupWrite(officeId, officeName));
      }

      if (writes.length >= 400) {
        await commitFirestoreWrites(accessToken, writes.splice(0));
        pendingAuthIds.length = 0;
      }
    }

    const blockedIds = Array.isArray(body.blockedCrmIdsWithoutLogin)
      ? body.blockedCrmIdsWithoutLogin
      : [];
    for (const crmId of new Set(blockedIds)) {
      if (typeof crmId !== "string" || !crmId.trim() || importedCrmIds.has(crmId.trim())) continue;
      const matches = existingAccessUsers.filter((item) => item.crmId === crmId.trim());
      if (matches.length !== 1) {
        skipped += 1;
        console.warn("Blocked CRM ID without unique access profile", { crmId });
        continue;
      }
      const account = matches[0];
      if (await findAuthUserById(accessToken, account.uid)) {
        await identityToolkit(accessToken, "update", { localId: account.uid, disabled: true });
      }
      writes.push(archiveWrite(account.name));
      archivedWithoutLogin += 1;
    }

    if (body.archiveMissing) {
      const suppliedKeys = Array.isArray(body.allUserKeys)
        ? body.allUserKeys.map((key) => key.trim()).filter(Boolean)
        : [];
      const presentUserKeys = new Set(
        suppliedKeys.length
          ? suppliedKeys
          : (Array.isArray(body.allCrmIds) && body.allCrmIds.length
              ? body.allCrmIds
              : Array.from(importedCrmIds)
            )
              .map((crmId) => crmId.trim())
              .filter(Boolean)
              .map((crmId) => `crm:${crmId}`)
      );
      for (const user of existingAccessUsers) {
        const remainsInCrm = getUserKeys(user).some((key) => presentUserKeys.has(key));
        if (user.source !== "manual" && !remainsInCrm) {
          writes.push(archiveWrite(user.name));
        }

        if (writes.length >= 400) {
          await commitFirestoreWrites(accessToken, writes.splice(0));
          pendingAuthIds.length = 0;
        }
      }
    }

    await commitFirestoreWrites(accessToken, writes);
    pendingAuthIds.length = 0;

    return json({
      created,
      updated,
      skipped,
      imported: importedCrmIds.size,
      conflicts,
      archivedWithoutLogin,
      archiveMissing: Boolean(body.archiveMissing)
    });
  } catch (error) {
    for (const uid of pendingAuthIds) {
      try {
        await identityToolkit(rollbackToken, "delete", {
          localId: uid,
          targetProjectId: FIREBASE_PROJECT_ID
        });
      } catch (rollbackError) {
        console.error("CRM import Auth rollback failed", { uid, rollbackError });
      }
    }
    console.error("CRM import failed", error);
    return json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Не удалось выполнить импорт пользователей."
      },
      500
    );
  }
}
