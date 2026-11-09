import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBvX9x2IFLzG5nf8akzWmzLuv7r442XiKY";
const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const contentApiUrl = process.env.NEXT_PUBLIC_CONTENT_API_URL?.trim()
  || "https://api.psnhub.kz/v1/catalog";

function base64Url(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function serviceToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "";
  if (!raw) throw new Error("Firebase service account is not configured");
  const account = JSON.parse(raw.trim().startsWith("{") ? raw : atob(raw)) as {
    client_email?: string;
    private_key?: string;
  };
  if (!account.client_email || !account.private_key) throw new Error("Firebase service account is incomplete");
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
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Firebase service authentication failed");
  return ((await response.json()) as { access_token: string }).access_token;
}

export async function POST(request: NextRequest) {
  const bearer = request.headers.get("authorization") ?? "";
  if (!bearer.startsWith("Bearer ") || bearer.length > 10000) {
    return NextResponse.json({ message: "Требуется вход." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { materialId?: unknown };
    const materialId = typeof body.materialId === "string" ? body.materialId.trim() : "";
    if (!materialId || materialId.length > 512 || materialId.includes("/")) {
      return NextResponse.json({ message: "Некорректный материал." }, { status: 400 });
    }

    const identity = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: bearer.slice(7) }),
      cache: "no-store"
    });
    if (!identity.ok) return NextResponse.json({ message: "Сессия истекла." }, { status: 401 });
    const authUser = ((await identity.json()) as {
      users?: Array<{ localId?: string; disabled?: boolean }>;
    }).users?.[0];
    if (!authUser?.localId || authUser.disabled) {
      return NextResponse.json({ message: "Нет доступа." }, { status: 403 });
    }

    const contentResponse = await fetch(new URL("/api/content", request.url), {
      headers: { authorization: bearer },
      cache: "no-store"
    });
    if (!contentResponse.ok) {
      return NextResponse.json({ message: "Не удалось проверить доступ к материалу." }, { status: contentResponse.status });
    }
    const content = (await contentResponse.json()) as {
      materials?: Array<{ id?: unknown; title?: unknown }>;
    };
    const material = content.materials?.find((item) => item.id === materialId);
    if (!material || typeof material.title !== "string") {
      return NextResponse.json({ message: "Материал недоступен." }, { status: 403 });
    }

    const token = await serviceToken();
    const progressId = `${authUser.localId}_${materialId}`;
    const response = await fetch(`${firestoreBase}/learningProgress/${encodeURIComponent(progressId)}`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        fields: {
          userId: { stringValue: authUser.localId },
          materialId: { stringValue: materialId },
          materialTitle: { stringValue: material.title },
          completedAt: { timestampValue: new Date().toISOString() }
        }
      }),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Firestore progress write failed: ${response.status}`);

    let d1Synced = !contentApiUrl;
    if (contentApiUrl) {
      try {
        const syncResponse = await fetch(new URL("/v1/confirmed-progress", contentApiUrl), {
          method: "POST",
          headers: { authorization: bearer, "content-type": "application/json" },
          body: JSON.stringify({ materialId }),
          cache: "no-store"
        });
        d1Synced = syncResponse.ok;
        if (!syncResponse.ok) console.warn(`D1 progress synchronization failed: ${syncResponse.status}`);
      } catch (error) {
        console.warn("D1 progress synchronization failed", error);
      }
    }
    return NextResponse.json({ completed: true, materialId, d1Synced });
  } catch (error) {
    console.error("Progress completion failed", error);
    return NextResponse.json({ message: "Не удалось сохранить прогресс." }, { status: 503 });
  }
}
