import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBvX9x2IFLzG5nf8akzWmzLuv7r442XiKY";
const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "psnkzeducation@gmail.com";
const noStore = { "cache-control": "no-store" };

function failure(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: noStore });
}

function base64Url(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

type ServiceAccount = { client_email: string; private_key: string };

async function signedJwt(account: ServiceAccount, payload: Record<string, unknown>) {
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify(payload))}`;
  const binary = atob(account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(signature)}`;
}

async function serviceToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signedJwt(account, {
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    iat: now,
    exp: now + 3600
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Service authentication failed");
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function POST(request: NextRequest) {
  try {
    const idToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    if (!idToken) return failure("Требуется вход администратора.", 401);
    if (!apiKey) return failure("Firebase API key не настроен на сервере.", 503);

    const { uid } = (await request.json()) as { uid?: unknown };
    if (typeof uid !== "string" || !/^[\w-]{1,128}$/.test(uid)) {
      return failure("Некорректный пользователь.", 400);
    }

    const verified = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
      cache: "no-store"
    });
    if (!verified.ok) return failure("Сессия администратора недействительна.", 401);
    const admin = ((await verified.json()) as { users?: Array<{ localId?: string; email?: string; disabled?: boolean }> }).users?.[0];
    if (!admin?.localId || admin.disabled || admin.email?.toLowerCase() !== adminEmail.toLowerCase() || admin.localId === uid) {
      return failure("Нет прав для входа под выбранным пользователем.", 403);
    }

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "";
    if (!raw) return failure("Серверный ключ Firebase не настроен.", 503);
    const account = JSON.parse(raw.trim().startsWith("{") ? raw : atob(raw)) as ServiceAccount;
    const serviceAccessToken = await serviceToken(account);
    const documentName = `projects/${projectId}/databases/(default)/documents/accessUsers/${uid}`;
    const found = await fetch(`https://firestore.googleapis.com/v1/${documentName}`, {
      headers: { authorization: `Bearer ${serviceAccessToken}` }, cache: "no-store"
    });
    if (found.status === 404) return failure("Пользователь не найден.", 404);
    if (!found.ok) throw new Error("Could not load access user");
    const record = (await found.json()) as { fields?: {
      login?: { stringValue?: string };
      active?: { booleanValue?: boolean };
      archived?: { booleanValue?: boolean };
      passwordResetRequested?: { booleanValue?: boolean };
      role?: { stringValue?: string };
    } };
    if (record.fields?.active?.booleanValue !== true || record.fields.archived?.booleanValue === true) {
      return failure("Вход доступен только под активным сотрудником.", 409);
    }
    if (record.fields.passwordResetRequested?.booleanValue === true) {
      return failure("Сотрудник должен сначала установить личный пароль.", 409);
    }
    if (record.fields.role?.stringValue === "admin") {
      return failure("Вход под другим администратором недоступен.", 403);
    }

    const targetResult = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceAccessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ localId: [uid] }),
      cache: "no-store"
    });
    if (!targetResult.ok) throw new Error("Could not verify target account");
    const target = ((await targetResult.json()) as { users?: Array<{ localId?: string; email?: string; disabled?: boolean }> }).users?.[0];
    if (!target || target.localId !== uid || target.disabled) return failure("Учетная запись сотрудника недоступна.", 404);
    if (target.email?.toLowerCase() === adminEmail.toLowerCase()) return failure("Вход под другим администратором недоступен.", 403);

    const now = Math.floor(Date.now() / 1000);
    const auditName = `projects/${projectId}/databases/(default)/documents/adminImpersonations/${crypto.randomUUID()}`;
    const audit = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
      method: "POST",
      headers: { authorization: `Bearer ${serviceAccessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ writes: [{ update: { name: auditName, fields: {
        adminUid: { stringValue: admin.localId },
        targetUid: { stringValue: uid },
        targetLogin: { stringValue: record.fields.login?.stringValue ?? "" },
        createdAt: { timestampValue: new Date().toISOString() }
      } } }] }),
      cache: "no-store"
    });
    if (!audit.ok) throw new Error("Could not audit admin impersonation");

    const token = await signedJwt(account, {
      iss: account.client_email,
      sub: account.client_email,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid,
      claims: { psnImpersonation: true }
    });
    return NextResponse.json({ token }, { headers: noStore });
  } catch (error) {
    console.error("Admin impersonation failed", error);
    return failure("Не удалось войти под сотрудником. Повторите попытку позже.", 500);
  }
}
