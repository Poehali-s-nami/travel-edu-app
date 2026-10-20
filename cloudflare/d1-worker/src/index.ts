interface Env {
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_API_KEY: string;
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  ADMIN_EMAIL: string;
  ALLOWED_ORIGINS: string;
}

type FirestoreValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  referenceValue?: string;
  geoPointValue?: { latitude?: number; longitude?: number };
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
  name: string;
  fields?: Record<string, FirestoreValue>;
  createTime?: string;
  updateTime?: string;
};

const MIGRATED_COLLECTIONS = [
  "materials",
  "tracks",
  "trainingGroups",
  "accessUsers",
  "learningProgress",
  "materialViews",
  "videoCategories",
  "catalogMeta",
  "loginEvents",
  "adminImpersonations",
  "importHistory"
] as const;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((item) => item.trim());
  if (!allowed.includes(origin)) return {};
  return { "access-control-allow-origin": origin, vary: "Origin" };
}

function decode(value: FirestoreValue): unknown {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("stringValue" in value) return value.stringValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("geoPointValue" in value) return value.geoPointValue;
  if ("arrayValue" in value) return (value.arrayValue?.values ?? []).map(decode);
  if ("mapValue" in value) return decodeFields(value.mapValue?.fields);
  return null;
}

function decodeFields(fields: Record<string, FirestoreValue> = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function bool(value: unknown) {
  return value === true ? 1 : 0;
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringList(value: unknown) {
  return list(value).filter((item): item is string => typeof item === "string");
}

function officeGroupId(officeId: string) {
  const bytes = new TextEncoder().encode(officeId.trim());
  return `office_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function canAccessContent(
  audience: unknown,
  user: { trainingRole: string; groupIds: string[]; officeIds: string[] },
  activeGroupIds: ReadonlySet<string>
) {
  if (!audience) return true;
  if (typeof audience !== "object") return false;
  const value = audience as { mode?: unknown; roles?: unknown; groupIds?: unknown };
  if (value.mode === "everyone") return true;
  if (value.mode !== "restricted") return false;
  if (stringList(value.roles).includes(user.trainingRole)) return true;
  const memberships = new Set([...user.groupIds, ...user.officeIds.map(officeGroupId)]);
  return stringList(value.groupIds).some((id) => activeGroupIds.has(id) && memberships.has(id));
}

function documentId(document: FirestoreDocument) {
  return document.name.split("/").pop() ?? "";
}

function parseData(dataJson: string, id: string): Record<string, unknown> & { id: string } {
  return { ...(JSON.parse(dataJson) as Record<string, unknown>), id };
}

function base64Url(input: ArrayBuffer | string) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function verifyFirebaseUser(request: Request, env: Env) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 10000) return null;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: authorization.slice(7) })
    }
  );
  if (!response.ok) return null;
  return ((await response.json()) as {
    users?: Array<{ localId?: string; email?: string; disabled?: boolean }>;
  }).users?.[0] ?? null;
}

async function verifyAdmin(request: Request, env: Env) {
  const user = await verifyFirebaseUser(request, env);
  return user && !user.disabled && user.email?.toLowerCase() === env.ADMIN_EMAIL.toLowerCase()
    ? user
    : null;
}

async function firestoreToken(env: Env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON ?? "";
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
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
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`
    })
  });
  if (!response.ok) throw new Error(`Firebase service authentication failed: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function readFirestorePage(env: Env, token: string, collection: string, pageToken: string, pageSize: number) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}`
  );
  url.searchParams.set("pageSize", String(pageSize));
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Firestore list failed for ${collection}: ${response.status}`);
  return (await response.json()) as { documents?: FirestoreDocument[]; nextPageToken?: string };
}

function normalizedStatement(env: Env, collection: string, id: string, data: Record<string, unknown>) {
  const dataJson = JSON.stringify(data);
  if (collection === "accessUsers") {
    return env.DB.prepare(`INSERT INTO access_users
      (id, crm_id, login, normalized_login, display_name, role, training_role, active, archived,
       claim_state, source, password_reset_requested, office_ids_json, group_ids_json, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET crm_id=excluded.crm_id, login=excluded.login,
       normalized_login=excluded.normalized_login, display_name=excluded.display_name, role=excluded.role,
       training_role=excluded.training_role, active=excluded.active, archived=excluded.archived,
       claim_state=excluded.claim_state, source=excluded.source,
       password_reset_requested=excluded.password_reset_requested, office_ids_json=excluded.office_ids_json,
       group_ids_json=excluded.group_ids_json, data_json=excluded.data_json, updated_at=excluded.updated_at`)
      .bind(id, text(data.crmId) || null, text(data.login), text(data.normalizedLogin), text(data.displayName),
        text(data.role) || "user", text(data.trainingRole) || null, bool(data.active), bool(data.archived),
        text(data.claimState) || null, text(data.source) || null, bool(data.passwordResetRequested),
        JSON.stringify(list(data.officeIds)), JSON.stringify(list(data.groupIds)), dataJson, text(data.updatedAt) || null);
  }
  if (collection === "materials") {
    return env.DB.prepare(`INSERT INTO materials
      (id, title, content_type, tab, archived, audience_json, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, content_type=excluded.content_type,
       tab=excluded.tab, archived=excluded.archived, audience_json=excluded.audience_json,
       data_json=excluded.data_json, created_at=excluded.created_at, updated_at=excluded.updated_at`)
      .bind(id, text(data.title), text(data.type), text(data.tab), bool(data.archived),
        JSON.stringify(data.audience ?? { mode: "everyone", roles: [], groupIds: [] }), dataJson,
        text(data.createdAt) || null, text(data.updatedAt) || null);
  }
  if (collection === "tracks") {
    return env.DB.prepare(`INSERT INTO tracks
      (id, title, archived, material_ids_json, audience_json, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, archived=excluded.archived,
       material_ids_json=excluded.material_ids_json, audience_json=excluded.audience_json,
       data_json=excluded.data_json, created_at=excluded.created_at, updated_at=excluded.updated_at`)
      .bind(id, text(data.title), bool(data.archived), JSON.stringify(list(data.materialIds)),
        JSON.stringify(data.audience ?? { mode: "everyone", roles: [], groupIds: [] }), dataJson,
        text(data.createdAt) || null, text(data.updatedAt) || null);
  }
  if (collection === "trainingGroups") {
    return env.DB.prepare(`INSERT INTO training_groups
      (id, name, kind, office_id, archived, material_ids_json, track_ids_json, data_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, office_id=excluded.office_id,
       archived=excluded.archived, material_ids_json=excluded.material_ids_json,
       track_ids_json=excluded.track_ids_json, data_json=excluded.data_json, updated_at=excluded.updated_at`)
      .bind(id, text(data.name), text(data.kind) || "manual", text(data.officeId) || null,
        bool(data.archived), JSON.stringify(list(data.materialIds)), JSON.stringify(list(data.trackIds)),
        dataJson, text(data.updatedAt) || null);
  }
  if (collection === "learningProgress") {
    return env.DB.prepare(`INSERT INTO learning_progress
      (id, user_id, material_id, material_title, completed_at, data_json) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, material_id=excluded.material_id,
       material_title=excluded.material_title, completed_at=excluded.completed_at, data_json=excluded.data_json`)
      .bind(id, text(data.userId), text(data.materialId), text(data.materialTitle), text(data.completedAt), dataJson);
  }
  if (collection === "materialViews") {
    return env.DB.prepare(`INSERT INTO material_views
      (id, material_id, device_id, created_at, data_json) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET material_id=excluded.material_id, device_id=excluded.device_id,
       created_at=excluded.created_at, data_json=excluded.data_json`)
      .bind(id, text(data.materialId), text(data.deviceId), text(data.createdAt), dataJson);
  }
  if (["loginEvents", "adminImpersonations", "importHistory"].includes(collection)) {
    return env.DB.prepare(`INSERT INTO audit_events (id, event_type, actor_id, created_at, data_json)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET event_type=excluded.event_type,
       actor_id=excluded.actor_id, created_at=excluded.created_at, data_json=excluded.data_json`)
      .bind(`${collection}:${id}`, collection, text(data.uid) || text(data.adminUid) || null,
        text(data.createdAt) || null, dataJson);
  }
  return env.DB.prepare(`INSERT INTO reference_documents (collection_name, id, data_json, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(collection_name, id) DO UPDATE SET
     data_json=excluded.data_json, updated_at=excluded.updated_at`)
    .bind(collection, id, dataJson, text(data.updatedAt) || null);
}

async function savePage(env: Env, collection: string, documents: FirestoreDocument[], runId: string) {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const document of documents) {
    const id = documentId(document);
    const data = decodeFields(document.fields);
    const fieldsJson = JSON.stringify(document.fields ?? {});
    statements.push(
      env.DB.prepare(`INSERT INTO firestore_documents
        (collection_name, document_id, fields_json, firestore_create_time, firestore_update_time,
         checksum, migration_run_id, migrated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(collection_name, document_id) DO UPDATE SET fields_json=excluded.fields_json,
         firestore_create_time=excluded.firestore_create_time, firestore_update_time=excluded.firestore_update_time,
         checksum=excluded.checksum, migration_run_id=excluded.migration_run_id, migrated_at=excluded.migrated_at`)
        .bind(collection, id, fieldsJson, document.createTime ?? null, document.updateTime ?? null,
          await sha256(fieldsJson), runId, now),
      normalizedStatement(env, collection, id, data)
    );
  }
  for (let index = 0; index < statements.length; index += 80) {
    await env.DB.batch(statements.slice(index, index + 80));
  }
}

async function migratePage(request: Request, env: Env, headers: HeadersInit) {
  const admin = await verifyAdmin(request, env);
  if (!admin?.email) return json({ message: "Нет прав администратора." }, 403, headers);
  const body = (await request.json()) as {
    collection?: string;
    pageToken?: string;
    pageSize?: number;
    runId?: string;
  };
  const collection = body.collection ?? "";
  if (!MIGRATED_COLLECTIONS.includes(collection as (typeof MIGRATED_COLLECTIONS)[number])) {
    return json({ message: "Неизвестная коллекция." }, 400, headers);
  }
  const pageSize = Math.max(1, Math.min(100, Number(body.pageSize) || 100));
  const runId = body.runId || crypto.randomUUID();
  await env.DB.prepare(`INSERT OR IGNORE INTO migration_runs
    (id, status, started_at, initiated_by) VALUES (?, 'running', ?, ?)`)
    .bind(runId, new Date().toISOString(), admin.email.toLowerCase()).run();

  try {
    const token = await firestoreToken(env);
    const page = await readFirestorePage(env, token, collection, body.pageToken ?? "", pageSize);
    const documents = page.documents ?? [];
    await savePage(env, collection, documents, runId);
    return json({
      runId,
      collection,
      copied: documents.length,
      nextPageToken: page.nextPageToken ?? null,
      done: !page.nextPageToken
    }, 200, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Migration failed";
    await env.DB.prepare("UPDATE migration_runs SET status='failed', completed_at=?, error_message=? WHERE id=?")
      .bind(new Date().toISOString(), message.slice(0, 1000), runId).run();
    throw error;
  }
}

async function reconciliation(request: Request, env: Env, headers: HeadersInit) {
  if (!(await verifyAdmin(request, env))) return json({ message: "Нет прав администратора." }, 403, headers);
  const result = await env.DB.prepare(`SELECT collection_name, COUNT(*) AS count
    FROM firestore_documents GROUP BY collection_name ORDER BY collection_name`).all();
  return json({ collections: result.results }, 200, headers);
}

async function catalog(request: Request, env: Env, headers: HeadersInit) {
  const authUser = await verifyFirebaseUser(request, env);
  if (!authUser?.localId || authUser.disabled) {
    return json({ message: "Требуется вход." }, 401, headers);
  }
  const isAdmin = authUser.email?.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
  const profile = isAdmin
    ? null
    : await env.DB.prepare(`SELECT training_role, active, archived, claim_state,
        password_reset_requested, office_ids_json, group_ids_json
      FROM access_users WHERE id = ?`).bind(authUser.localId).first<{
        training_role: string | null;
        active: number;
        archived: number;
        claim_state: string | null;
        password_reset_requested: number;
        office_ids_json: string;
        group_ids_json: string;
      }>();
  if (!isAdmin && (!profile || profile.active !== 1 || profile.archived === 1 ||
      profile.password_reset_requested === 1 || (profile.claim_state ?? "claimed") !== "claimed")) {
    return json({ message: "Нет доступа." }, 403, headers);
  }

  const [materialRows, trackRows, groupRows] = await Promise.all([
    env.DB.prepare("SELECT id, data_json FROM materials").all<{ id: string; data_json: string }>(),
    env.DB.prepare("SELECT id, data_json FROM tracks").all<{ id: string; data_json: string }>(),
    env.DB.prepare("SELECT id, archived FROM training_groups").all<{ id: string; archived: number }>()
  ]);
  const activeGroupIds = new Set(groupRows.results.filter((row) => row.archived !== 1).map((row) => row.id));
  const user = {
    trainingRole: profile?.training_role ?? "",
    officeIds: profile ? stringList(JSON.parse(profile.office_ids_json)) : [],
    groupIds: profile ? stringList(JSON.parse(profile.group_ids_json)) : []
  };
  const visible = (item: Record<string, unknown>) => isAdmin ||
    (item.archived !== true && canAccessContent(item.audience, user, activeGroupIds));
  const materials = materialRows.results
    .map((row) => parseData(row.data_json, row.id))
    .filter(visible);
  const materialIds = new Set(materials.map((item) => item.id));
  const tracks = trackRows.results
    .map((row) => parseData(row.data_json, row.id))
    .filter((item) => visible(item) && stringList(item.materialIds).every((id) => materialIds.has(id)));
  return json(
    { materials, tracks },
    200,
    { ...headers, "cache-control": "private, no-store", vary: "Origin, Authorization" }
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "access-control-allow-headers": "authorization,content-type",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-max-age": "86400"
        }
      });
    }
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        return json({ ok: row?.ok === 1, service: "psn-hub-data-api" }, 200, headers);
      }
      if (request.method === "GET" && url.pathname === "/v1/catalog") {
        return await catalog(request, env, headers);
      }
      if (request.method === "POST" && url.pathname === "/admin/migrate-page") {
        return await migratePage(request, env, headers);
      }
      if (request.method === "GET" && url.pathname === "/admin/reconciliation") {
        return await reconciliation(request, env, headers);
      }
      return json({ message: "Not found" }, 404, headers);
    } catch (error) {
      console.error("D1 API request failed", error);
      return json({ message: "Временная ошибка сервиса данных." }, 503, headers);
    }
  }
};

