import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type ImportUser = {
  crmId?: string;
  login: string;
  displayName: string;
  office?: string;
  email?: string;
  phone?: string;
  active: boolean;
  isBlocked?: boolean;
};

type ImportRequest = {
  idToken?: string;
  accessCode?: string;
  archiveMissing?: boolean;
  allCrmIds?: string[];
  allUserKeys?: string[];
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
  const bytes = new TextEncoder().encode(normalizeLogin(login));
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
  action: "lookup" | "update" | "signUp",
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

async function upsertAuthUser(
  token: string,
  uid: string,
  authEmail: string,
  accessCode: string,
  displayName: string,
  disabled: boolean,
  setTemporaryPassword: boolean
) {
  const existingById = await findAuthUserById(token, uid);

  if (existingById) {
    const update: Record<string, unknown> = {
      localId: existingById,
      email: authEmail,
      displayName,
      disabled,
      emailVerified: true
    };
    if (setTemporaryPassword) update.password = accessCode;
    await identityToolkit(token, "update", {
      ...update
    });
    return { uid: existingById, created: false };
  }

  const existingByEmail = await findAuthUserByEmail(token, authEmail);

  if (existingByEmail) {
    const update: Record<string, unknown> = {
      localId: existingByEmail,
      displayName,
      disabled,
      emailVerified: true
    };
    if (setTemporaryPassword) update.password = accessCode;
    await identityToolkit(token, "update", {
      ...update
    });
    return { uid: existingByEmail, created: false };
  }

  const created = await identityToolkit(token, "signUp", {
    localId: uid,
    email: authEmail,
    password: accessCode,
    displayName,
    disabled,
    emailVerified: true
  });

  return { uid: created.localId ?? uid, created: true };
}

function firestoreValue(value: unknown): Record<string, unknown> {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  return { stringValue: String(value ?? "") };
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
  passwordPolicyVersion: number
) {
  const normalizedLogin = normalizeLogin(user.login);
  const fields = {
    crmId: firestoreValue(user.crmId),
    login: firestoreValue(user.login),
    normalizedLogin: firestoreValue(normalizedLogin),
    displayName: firestoreValue(user.displayName || user.login),
    office: firestoreValue(user.office ?? ""),
    email: firestoreValue(user.email ?? ""),
    phone: firestoreValue(user.phone ?? ""),
    role: firestoreValue("user"),
    active: firestoreValue(user.active),
    archived: firestoreValue(!user.active),
    manual: firestoreValue(false),
    source: firestoreValue("crm"),
    passwordResetRequested: firestoreValue(passwordResetRequested),
    passwordPolicyVersion: firestoreValue(passwordPolicyVersion),
    updatedAt: { timestampValue: new Date().toISOString() }
  };

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
  normalizedLogin: string;
  email: string;
  source: string;
  passwordResetRequested: boolean;
  passwordPolicyVersion: number;
};

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
      documents?: Array<{
        name: string;
        fields?: {
          crmId?: { stringValue?: string };
          normalizedLogin?: { stringValue?: string };
          email?: { stringValue?: string };
          source?: { stringValue?: string };
          manual?: { booleanValue?: boolean };
          passwordResetRequested?: { booleanValue?: boolean };
          passwordPolicyVersion?: { integerValue?: string };
        };
      }>;
      nextPageToken?: string;
    };

    for (const document of data.documents ?? []) {
      const fallbackId = document.name.split("/").pop() ?? "";
      result.push({
        name: document.name,
        uid: fallbackId,
        crmId: document.fields?.crmId?.stringValue ?? fallbackId,
        normalizedLogin: document.fields?.normalizedLogin?.stringValue ?? "",
        email: (document.fields?.email?.stringValue ?? "").toLowerCase(),
        source:
          document.fields?.source?.stringValue ??
          (document.fields?.manual?.booleanValue ? "manual" : "crm"),
        passwordResetRequested:
          document.fields?.passwordResetRequested?.booleanValue === true,
        passwordPolicyVersion: Number(
          document.fields?.passwordPolicyVersion?.integerValue ?? 0
        )
      });
    }

    pageToken = data.nextPageToken ?? "";
  } while (pageToken);

  return result;
}

async function resolveImportIdentity(
  user: ImportUser,
  existingUsers: AccessUserRecord[]
) {
  const providedCrmId = user.crmId?.trim() ?? "";
  const normalizedLogin = normalizeLogin(user.login);
  const email = (user.email ?? "").trim().toLowerCase();
  const existing =
    existingUsers.find((item) => providedCrmId && item.crmId === providedCrmId) ??
    existingUsers.find((item) => item.normalizedLogin === normalizedLogin) ??
    existingUsers.find((item) => email && item.email === email);
  const crmId = providedCrmId || existing?.crmId || existing?.uid || await stableUidFromLogin(user.login);

  return {
    uid: existing?.uid || crmId,
    crmId,
    existing
  };
}

function getUserKeys(user: Pick<AccessUserRecord, "crmId" | "normalizedLogin" | "email">) {
  return [
    user.crmId ? `crm:${user.crmId.trim()}` : "",
    user.normalizedLogin ? `login:${user.normalizedLogin}` : "",
    user.email ? `email:${user.email.trim().toLowerCase()}` : ""
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ImportRequest;

    if (!body.idToken || !(await verifyAdmin(body.idToken))) {
      return json({ message: "Нет прав администратора." }, 403);
    }

    if (!body.accessCode || body.accessCode.trim().length < 12) {
      return json({ message: "Код доступа должен быть не короче 12 символов." }, 400);
    }

    const inputUsers = Array.isArray(body.users) ? body.users : [];
    const validUsers = inputUsers.filter((user) => user.login);

    if (!validUsers.length) {
      return json({ message: "В файле нет пользователей для импорта." }, 400);
    }

    const serviceAccount = getServiceAccount();
    const accessToken = await getAccessToken(serviceAccount);
    const existingAccessUsers = await listAccessUsers(accessToken);
    const importedCrmIds = new Set<string>();
    const importedLogins = new Set<string>();
    const writes: Array<Record<string, unknown>> = [];
    let created = 0;
    let updated = 0;
    let skipped = inputUsers.length - validUsers.length;

    for (const user of validUsers) {
      const identity = await resolveImportIdentity(user, existingAccessUsers);
      const crmId = identity.crmId;
      const normalizedLogin = normalizeLogin(user.login);

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

      const authEmail = await loginToEmail(user.login);
      const needsPasswordMigration =
        user.active &&
        (!identity.existing || identity.existing.passwordPolicyVersion < 1);
      const result = await upsertAuthUser(
        accessToken,
        identity.uid,
        authEmail,
        body.accessCode.trim(),
        user.displayName || user.login,
        !user.active,
        needsPasswordMigration
      );

      if (result.created) created += 1;
      else updated += 1;

      importedCrmIds.add(crmId);
      importedLogins.add(normalizedLogin);
      writes.push(
        accessUserWrite(
          result.uid,
          { ...user, crmId },
          needsPasswordMigration
            ? true
            : identity.existing?.passwordResetRequested ?? false,
          Math.max(identity.existing?.passwordPolicyVersion ?? 0, needsPasswordMigration ? 1 : 0)
        )
      );

      if (writes.length >= 400) {
        await commitFirestoreWrites(accessToken, writes.splice(0));
      }
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
        }
      }
    }

    await commitFirestoreWrites(accessToken, writes);

    return json({
      created,
      updated,
      skipped,
      imported: importedCrmIds.size,
      archiveMissing: Boolean(body.archiveMissing)
    });
  } catch (error) {
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
