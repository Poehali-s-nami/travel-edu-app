import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBvX9x2IFLzG5nf8akzWmzLuv7r442XiKY";
const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "psnkzeducation@gmail.com";
const passwordPattern = /^(?=.*\p{L})(?=.*\d).{6,}$/u;

function response(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: { "cache-control": "no-store" } });
}

function base64Url(value: ArrayBuffer | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function serviceToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "";
  if (!raw) throw new Error("Service account is not configured");
  const account = JSON.parse(raw.trim().startsWith("{") ? raw : atob(raw)) as {
    client_email: string;
    private_key: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: account.client_email,
    sub: account.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
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
  const result = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`
    })
  });
  if (!result.ok) throw new Error("Service authentication failed");
  return ((await result.json()) as { access_token: string }).access_token;
}

export async function POST(request: NextRequest) {
  try {
    const idToken = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/, "");
    const { uid, password } = (await request.json()) as { uid?: string; password?: string };
    if (!idToken) return response("Требуется вход администратора.", 401);
    if (!uid || !/^[\w-]{1,128}$/.test(uid) || typeof password !== "string" || !passwordPattern.test(password)) {
      return response("Проверьте пользователя и временный пароль: минимум 6 символов, буква и цифра.", 400);
    }

    const verified = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    });
    if (!verified.ok) return response("Сессия недействительна.", 401);
    const admin = ((await verified.json()) as { users?: Array<{ email?: string; disabled?: boolean; localId?: string }> }).users?.[0];
    if (!admin || admin.disabled || admin.email?.toLowerCase() !== adminEmail.toLowerCase() || admin.localId === uid) {
      return response("Нет прав для сброса пароля.", 403);
    }

    const token = await serviceToken();
    const documentName = `projects/${projectId}/databases/(default)/documents/accessUsers/${uid}`;
    const found = await fetch(`https://firestore.googleapis.com/v1/${documentName}`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (found.status === 404) return response("Пользователь не найден.", 404);
    if (!found.ok) throw new Error("Could not load access user");
    const record = (await found.json()) as { fields?: { active?: { booleanValue?: boolean }; archived?: { booleanValue?: boolean } } };
    if (record.fields?.active?.booleanValue !== true || record.fields?.archived?.booleanValue === true) {
      return response("Сначала активируйте пользователя.", 400);
    }

    const now = new Date().toISOString();
    const saved = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ writes: [{
        update: { name: documentName, fields: {
          passwordResetRequested: { booleanValue: true },
          passwordPolicyVersion: { integerValue: "1" },
          updatedAt: { timestampValue: now }
        } },
        updateMask: { fieldPaths: ["passwordResetRequested", "passwordPolicyVersion", "updatedAt"] }
      }] })
    });
    if (!saved.ok) throw new Error("Could not mark password reset");

    const update = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ localId: uid, password })
    });
    if (!update.ok) throw new Error("Could not update password");
    return NextResponse.json({ reset: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Admin password reset failed", error);
    return response("Не удалось сбросить пароль. Повторите попытку позже.", 500);
  }
}
