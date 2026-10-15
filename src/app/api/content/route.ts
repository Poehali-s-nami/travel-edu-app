import { NextRequest, NextResponse } from "next/server";
import { canAccessContent } from "@/lib/content-access";
import { officeGroupId } from "@/lib/training-groups";
import type { ContentAudience } from "@/types/material";

export const runtime = "edge";

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";
const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBvX9x2IFLzG5nf8akzWmzLuv7r442XiKY";
const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL ?? "psnkzeducation@gmail.com";
const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

type Value = { stringValue?: string; booleanValue?: boolean; integerValue?: string; doubleValue?: number;
  timestampValue?: string; arrayValue?: { values?: Value[] }; mapValue?: { fields?: Record<string, Value> } };
type Document = { name: string; fields?: Record<string, Value> };
type CatalogItem = { id: string } & Record<string, unknown>;
type Catalog = { materials: CatalogItem[]; tracks: CatalogItem[] };

let catalogCache: { revision: string; expiresAt: number; value: Catalog } | null = null;
let catalogLoad: { revision: string; promise: Promise<Catalog> } | null = null;
const CATALOG_CACHE_MS = 60_000;

function decode(value: Value): unknown {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue?.values ?? []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue?.fields);
  return null;
}

function decodeFields(fields: Record<string, Value> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function base64Url(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function serviceToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ?? "";
  if (!raw) throw new Error("Firebase service account is not configured");
  const account = JSON.parse(raw.trim().startsWith("{") ? raw : atob(raw)) as { client_email?: string; private_key?: string };
  if (!account.client_email || !account.private_key) throw new Error("Firebase service account is incomplete");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(JSON.stringify({
    iss: account.client_email, sub: account.client_email, aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore", iat: now, exp: now + 3600
  }))}`;
  const binary = atob(account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64Url(signature)}` }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Firebase service authentication failed");
  return ((await response.json()) as { access_token: string }).access_token;
}

async function getDocument(token: string, path: string) {
  const response = await fetch(`${firestoreBase}/${path}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore get failed: ${response.status}`);
  return (await response.json()) as Document;
}

async function listDocuments(token: string, collectionName: string): Promise<CatalogItem[]> {
  const documents: Document[] = [];
  let pageToken = "";
  do {
    const url = new URL(`${firestoreBase}/${collectionName}`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error(`Firestore list failed: ${response.status}`);
    const page = (await response.json()) as { documents?: Document[]; nextPageToken?: string };
    documents.push(...(page.documents ?? []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return documents.map((document) => ({ ...decodeFields(document.fields), id: document.name.split("/").pop() ?? "" }));
}

async function loadCatalog(token: string, revision: string): Promise<Catalog> {
  if (catalogCache?.revision === revision && catalogCache.expiresAt > Date.now()) return catalogCache.value;
  if (catalogLoad?.revision === revision) return catalogLoad.promise;

  const promise = Promise.all([listDocuments(token, "materials"), listDocuments(token, "tracks")])
    .then(([materials, tracks]) => {
      const value = { materials, tracks };
      catalogCache = { revision, expiresAt: Date.now() + CATALOG_CACHE_MS, value };
      return value;
    });
  catalogLoad = { revision, promise };
  try {
    return await promise;
  } finally {
    if (catalogLoad?.promise === promise) catalogLoad = null;
  }
}

export async function GET(request: NextRequest) {
  const bearer = request.headers.get("authorization") ?? "";
  if (!bearer.startsWith("Bearer ") || bearer.length > 10000) {
    return NextResponse.json({ message: "Требуется вход." }, { status: 401 });
  }
  try {
    const identity = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: bearer.slice(7) }), cache: "no-store"
    });
    if (!identity.ok) return NextResponse.json({ message: "Сессия истекла." }, { status: 401 });
    const authUser = ((await identity.json()) as { users?: Array<{ localId?: string; email?: string; disabled?: boolean }> }).users?.[0];
    if (!authUser?.localId || authUser.disabled) return NextResponse.json({ message: "Нет доступа." }, { status: 403 });

    const token = await serviceToken();
    const isAdmin = authUser.email?.toLowerCase() === adminEmail.toLowerCase();
    const profile = isAdmin ? null : await getDocument(token, `accessUsers/${encodeURIComponent(authUser.localId)}`);
    const access = decodeFields(profile?.fields);
    if (!isAdmin && (!profile || access.active !== true || access.archived === true ||
        access.passwordResetRequested === true || (access.claimState ?? "claimed") !== "claimed")) {
      return NextResponse.json({ message: "Нет доступа." }, { status: 403 });
    }

    const catalogMeta = await getDocument(token, "catalogMeta/current");
    const revision = catalogMeta?.fields?.revision?.stringValue ?? "legacy";
    const { materials: allMaterials, tracks: allTracks } = await loadCatalog(token, revision);
    const restrictedGroupIds = new Set([...allMaterials, ...allTracks].flatMap((item) => {
      const audience = item.audience as ContentAudience | undefined;
      return audience?.mode === "restricted" ? strings(audience.groupIds) : [];
    }));
    const user = { trainingRole: String(access.trainingRole ?? ""), groupIds: strings(access.groupIds), officeIds: strings(access.officeIds) };
    const candidateGroups = [...new Set([...user.groupIds, ...user.officeIds.map(officeGroupId)])]
      .filter((id) => restrictedGroupIds.has(id));
    const groupDocuments = await Promise.all(candidateGroups.map((id) => getDocument(token, `trainingGroups/${encodeURIComponent(id)}`)));
    const activeGroupIds = new Set(candidateGroups.filter((id, index) =>
      groupDocuments[index] && decodeFields(groupDocuments[index]?.fields).archived !== true));
    const visible = (item: Record<string, unknown>) => isAdmin ||
      (item.archived !== true && canAccessContent(item.audience as ContentAudience | undefined, user, activeGroupIds));
    const materials = allMaterials.filter(visible);
    const materialIds = new Set(materials.map((item) => item.id));
    const tracks = allTracks.filter((track) => visible(track) &&
      strings(track.materialIds).every((id) => materialIds.has(id)));
    return NextResponse.json({ materials, tracks }, { headers: { "cache-control": "private, no-store", vary: "Authorization" } });
  } catch (error) {
    console.error("Content access failed", error);
    return NextResponse.json({ message: "Не удалось загрузить материалы." }, { status: 503 });
  }
}
