import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

const ADMIN_EMAIL =
  process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "psnkzeducation@gmail.com";
const FIREBASE_PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";

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

  return serviceAccount;
}

async function getAccessToken(serviceAccount: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  )}.${base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      sub: serviceAccount.client_email,
      aud: "https://oauth2.googleapis.com/token",
      scope:
        "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore",
      iat: now,
      exp: now + 3600
    })
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

async function findAccessUser(token: string, normalizedLogin: string) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "accessUsers" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "normalizedLogin" },
              op: "EQUAL",
              value: { stringValue: normalizedLogin }
            }
          },
          limit: 1
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Firestore lookup failed: ${await response.text()}`);
  }

  const rows = (await response.json()) as Array<{
    document?: {
      fields?: {
        active?: { booleanValue?: boolean };
        archived?: { booleanValue?: boolean };
        claimState?: { stringValue?: string };
      };
    };
  }>;
  return rows.find((row) => row.document)?.document?.fields ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { login?: string };
    const normalizedLogin = normalizeLogin(body.login ?? "");

    if (!normalizedLogin) {
      return json({ status: "empty" });
    }

    if (normalizedLogin === ADMIN_EMAIL.toLowerCase()) {
      return json({ status: "admin" });
    }

    const token = await getAccessToken(getServiceAccount());
    const accessUser = await findAccessUser(token, normalizedLogin);

    if (!accessUser) {
      return json({ status: "not-found" });
    }

    if (accessUser.archived?.booleanValue === true) {
      return json({ status: "archived" });
    }

    if (accessUser.active?.booleanValue !== true) {
      return json({ status: "blocked" });
    }

    if (accessUser.claimState?.stringValue === "unclaimed") {
      return json({ status: "unclaimed" });
    }

    if (accessUser.claimState?.stringValue === "manual_review") {
      return json({ status: "blocked" });
    }

    return json({ status: "active" });
  } catch (error) {
    console.error("Login status check failed", error);
    return json({ status: "unknown" }, 200);
  }
}
