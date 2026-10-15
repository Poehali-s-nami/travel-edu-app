import { NextRequest, NextResponse } from "next/server";
import { classifyTrainingRole } from "@/lib/training-role";

export const runtime = "edge";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBvX9x2IFLzG5nf8akzWmzLuv7r442XiKY";
const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "psnkzeducation@gmail.com";
const roles = ["HEAD", "MANAGER", "EMPLOYEE", "PARTNER"] as const;
type EditableRole = typeof roles[number];

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function base64Url(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "";
  if (!raw) throw new Error("Firebase service account is not configured");
  const account = JSON.parse(raw.trim().startsWith("{") ? raw : atob(raw)) as {
    client_email: string;
    private_key: string;
  };
  if (!account.client_email || !account.private_key) throw new Error("Firebase service account is incomplete");
  return account;
}

async function serviceToken() {
  const account = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore",
    iat: now,
    exp: now + 3600
  }))}`;
  const binary = atob(account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Service authentication failed");
  return ((await response.json()) as { access_token: string }).access_token;
}

async function verifyAdmin(idToken: string) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
    cache: "no-store"
  });
  if (!response.ok) return null;
  const user = ((await response.json()) as {
    users?: Array<{ localId?: string; email?: string; disabled?: boolean }>;
  }).users?.[0];
  return user?.localId && !user.disabled && user.email?.toLowerCase() === adminEmail.toLowerCase()
    ? user.localId
    : null;
}

type AccessDocument = {
  name: string;
  updateTime?: string;
  fields?: {
    role?: { stringValue?: string };
    trainingRole?: { stringValue?: string };
    trainingRoleManual?: { booleanValue?: boolean };
    crmUserTypes?: { arrayValue?: { values?: Array<{ stringValue?: string }> } };
  };
};

export async function POST(request: NextRequest) {
  try {
    const idToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    if (!idToken) return json({ message: "Требуется вход администратора." }, 401);
    const adminUid = await verifyAdmin(idToken);
    if (!adminUid) return json({ message: "Нет прав администратора." }, 403);
    if (Number(request.headers.get("content-length") ?? 0) > 4096) {
      return json({ message: "Слишком большой запрос." }, 413);
    }
    let body: { uid?: unknown; role?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ message: "Некорректный JSON запроса." }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ message: "Некорректный JSON запроса." }, 400);
    }
    if (typeof body.uid !== "string" || !/^[\w-]{1,128}$/.test(body.uid) ||
        (body.role !== "auto" && !roles.includes(body.role as EditableRole))) {
      return json({ message: "Некорректный пользователь или учебная роль." }, 400);
    }
    if (body.uid === adminUid) return json({ message: "Роль администратора здесь не изменяется." }, 403);

    const token = await serviceToken();
    const name = `projects/${projectId}/databases/(default)/documents/accessUsers/${body.uid}`;
    const found = await fetch(`https://firestore.googleapis.com/v1/${name}`, {
      headers: { authorization: `Bearer ${token}` }, cache: "no-store"
    });
    if (found.status === 404) return json({ message: "Сотрудник не найден." }, 404);
    if (!found.ok) throw new Error("Could not load access user");
    const record = (await found.json()) as AccessDocument;
    if (record.fields?.role?.stringValue === "admin") {
      return json({ message: "Роль администратора здесь не изменяется." }, 403);
    }
    if (!record.updateTime) throw new Error("Access user update time is missing");

    const crmTypes = (record.fields?.crmUserTypes?.arrayValue?.values ?? [])
      .map((value) => value.stringValue)
      .filter((value): value is string => typeof value === "string");
    if (body.role === "auto" && !crmTypes.length) {
      return json({ message: "Для этого сотрудника ещё не загружен тип пользователя из CRM." }, 409);
    }
    const manual = body.role !== "auto";
    const nextRole = manual ? body.role as EditableRole : classifyTrainingRole(crmTypes).role;
    const previousRole = record.fields?.trainingRole?.stringValue ?? "";
    const previousManual = record.fields?.trainingRoleManual?.booleanValue === true;
    if (previousRole === nextRole && previousManual === manual) {
      return json({ changed: false, role: nextRole });
    }

    const now = new Date().toISOString();
    const auditName = `projects/${projectId}/databases/(default)/documents/trainingRoleChanges/${crypto.randomUUID()}`;
    const commit = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ writes: [
        {
          update: { name, fields: {
            trainingRole: { stringValue: nextRole },
            trainingRoleManual: { booleanValue: manual },
            trainingRoleUpdatedAt: { timestampValue: now },
            trainingRoleUpdatedBy: { stringValue: adminUid },
            updatedAt: { timestampValue: now }
          } },
          updateMask: { fieldPaths: ["trainingRole", "trainingRoleManual", "trainingRoleUpdatedAt", "trainingRoleUpdatedBy", "updatedAt"] },
          currentDocument: { updateTime: record.updateTime }
        },
        {
          update: { name: auditName, fields: {
            targetUid: { stringValue: body.uid },
            adminUid: { stringValue: adminUid },
            previousRole: { stringValue: previousRole },
            nextRole: { stringValue: nextRole },
            previousManual: { booleanValue: previousManual },
            manual: { booleanValue: manual },
            createdAt: { timestampValue: now }
          } },
          currentDocument: { exists: false }
        }
      ] }),
      cache: "no-store"
    });
    if (commit.status === 409) return json({ message: "Данные сотрудника изменились. Обновите список и повторите." }, 409);
    if (!commit.ok) throw new Error("Could not save training role");
    return json({ changed: true, role: nextRole });
  } catch (error) {
    console.error("Training role update failed", error);
    return json({ message: "Не удалось сохранить учебную роль." }, 500);
  }
}
