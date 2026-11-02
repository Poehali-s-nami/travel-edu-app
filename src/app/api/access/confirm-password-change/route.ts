import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

const FIREBASE_API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBvX9x2IFLzG5nf8akzWmzLuv7r442XiKY";
const FIREBASE_PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";
const PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).{6,}$/u;

function passwordChangeServiceUrl() {
  return process.env.PASSWORD_CHANGE_SERVICE_URL?.trim() ?? "";
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "cache-control": "no-store" }
  });
}

function base64Url(input: ArrayBuffer | string) {
  const bytes =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string) {
  const binary = atob(
    pem
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s/g, "")
  );
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function getServiceAccount(): ServiceAccount {
  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ??
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ??
    "";
  if (!raw) throw new Error("Firebase service account is not configured");
  const account = JSON.parse(raw.trim().startsWith("{") ? raw : atob(raw));
  if (!account.client_email || !account.private_key) {
    throw new Error("Firebase service account is incomplete");
  }
  return { ...account, project_id: account.project_id ?? FIREBASE_PROJECT_ID };
}

async function getAccessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({
      iss: account.client_email,
      sub: account.client_email,
      aud: "https://oauth2.googleapis.com/token",
      scope:
        "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
      iat: now,
      exp: now + 3600
    })
  )}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`
    })
  });
  if (!response.ok) throw new Error("OAuth token request failed");
  return ((await response.json()) as { access_token: string }).access_token;
}

async function verifyUser(idToken: string) {
  if (!FIREBASE_API_KEY) return null;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  if (!response.ok) return null;
  const user = ((await response.json()) as {
    users?: Array<{ localId?: string; email?: string; disabled?: boolean }>;
  }).users?.[0];
  return user?.localId && user.email && !user.disabled
    ? { uid: user.localId, email: user.email }
    : null;
}

async function getAccessUser(token: string, uid: string) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/accessUsers/${encodeURIComponent(uid)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!response.ok) return null;
  return (await response.json()) as {
    fields?: {
      active?: { booleanValue?: boolean };
      archived?: { booleanValue?: boolean };
    };
  };
}

export async function POST(request: NextRequest) {
  let passwordUpdated = false;
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const idToken = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";
    const requestBody = await request.text();
    const body = JSON.parse(requestBody) as { password?: string; currentPassword?: string };
    const password = body.password ?? "";
    const currentPassword = body.currentPassword ?? "";

    if (!idToken) return json({ message: "Требуется авторизация." }, 401);
    if (!PASSWORD_PATTERN.test(password)) {
      return json(
        { message: "Пароль должен содержать минимум 6 символов, букву и цифру." },
        400
      );
    }
    if (!currentPassword || currentPassword === password) {
      return json({ message: "Введите текущий пароль и выберите другой новый пароль." }, 400);
    }

    const serviceUrlValue = passwordChangeServiceUrl();
    if (serviceUrlValue) {
      const serviceUrl = new URL(serviceUrlValue);
      const requestUrl = new URL(request.url);
      if (serviceUrl.protocol !== "https:") {
        throw new Error("Password change service must use HTTPS");
      }
      if (serviceUrl.origin !== requestUrl.origin) {
        const response = await fetch(serviceUrl, {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json"
          },
          body: requestBody
        });
        return new NextResponse(await response.text(), {
          status: response.status,
          headers: {
            "cache-control": "no-store",
            "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8"
          }
        });
      }
    }

    const verifiedUser = await verifyUser(idToken);
    if (!verifiedUser) return json({ message: "Сессия недействительна." }, 401);
    const { uid, email } = verifiedUser;

    const credentialCheck = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: currentPassword, returnSecureToken: true })
      }
    );
    if (!credentialCheck.ok) return json({ message: "Текущий пароль неверный." }, 400);
    const signedIn = (await credentialCheck.json()) as { localId?: string };
    if (signedIn.localId !== uid) return json({ message: "Сессия недействительна." }, 401);

    const token = await getAccessToken(getServiceAccount());
    const accessUser = await getAccessUser(token, uid);
    if (
      accessUser?.fields?.active?.booleanValue !== true ||
      accessUser.fields.archived?.booleanValue === true
    ) {
      return json({ message: "Доступ пользователя приостановлен." }, 403);
    }

    const passwordResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:update`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ localId: uid, password })
      }
    );
    if (!passwordResponse.ok) throw new Error("Firebase password update failed");
    passwordUpdated = true;

    const now = new Date().toISOString();
    const commitBody = JSON.stringify({
      writes: [{
        update: {
          name: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/accessUsers/${uid}`,
          fields: {
            passwordResetRequested: { booleanValue: false },
            passwordPolicyVersion: { integerValue: "1" },
            passwordChangedAt: { timestampValue: now },
            updatedAt: { timestampValue: now }
          }
        },
        updateMask: {
          fieldPaths: ["passwordResetRequested", "passwordPolicyVersion", "passwordChangedAt", "updatedAt"]
        }
      }]
    });
    let statusSaved = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await fetch(
          `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: commitBody
          }
        );
        if (result.ok) {
          statusSaved = true;
          break;
        }
      } catch (error) {
        console.error("Password status update attempt failed", error);
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
    if (!statusSaved) throw new Error("Password status update failed");

    return json({ changed: true });
  } catch (error) {
    console.error("Password change failed", error);
    return json({ message: passwordUpdated
      ? "Пароль изменён, но завершить активацию не удалось. Обратитесь к администратору; повторно используйте уже новый пароль."
      : "Не удалось изменить пароль." }, 500);
  }
}
