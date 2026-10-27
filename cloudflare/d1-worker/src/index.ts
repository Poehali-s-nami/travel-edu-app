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

const LIVE_SYNC_COLLECTIONS = ["materials", "tracks", "trainingGroups"] as const;
type LiveSyncCollection = (typeof LIVE_SYNC_COLLECTIONS)[number];

let firestoreTokenCache: { token: string; expiresAt: number } | null = null;

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((item) => item.trim());
  let isPreview = false;
  try {
    const url = new URL(origin);
    isPreview = url.protocol === "https:" && url.hostname.endsWith(".psn-hub-next.pages.dev");
  } catch {
    // Missing and malformed origins stay disallowed.
  }
  if (!allowed.includes(origin) && !isPreview) return {};
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
  if (firestoreTokenCache && firestoreTokenCache.expiresAt > Date.now() + 60_000) {
    return firestoreTokenCache.token;
  }
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
  const result = (await response.json()) as { access_token: string; expires_in?: number };
  firestoreTokenCache = {
    token: result.access_token,
    expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000
  };
  return result.access_token;
}

async function readFirestoreDocument(env: Env, token: string, collection: string, id: string) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/` +
      `${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore get failed for ${collection}: ${response.status}`);
  return (await response.json()) as FirestoreDocument;
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

async function countFirestoreCollection(env: Env, token: string, collection: string) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runAggregationQuery`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        structuredAggregationQuery: {
          aggregations: [{ alias: "count", count: {} }],
          structuredQuery: { from: [{ collectionId: collection }] }
        }
      })
    }
  );
  if (!response.ok) throw new Error(`Firestore count failed for ${collection}: ${response.status}`);
  const body = (await response.text()).trim();
  const rows = body.startsWith("[")
    ? JSON.parse(body) as Array<{ result?: { aggregateFields?: { count?: { integerValue?: string } } } }>
    : body.split(/\r?\n/).filter(Boolean).map((line) =>
        JSON.parse(line) as { result?: { aggregateFields?: { count?: { integerValue?: string } } } });
  return Number(rows.at(-1)?.result?.aggregateFields?.count?.integerValue ?? 0);
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

function deleteDocumentStatements(env: Env, collection: LiveSyncCollection, id: string) {
  const normalizedTables: Record<LiveSyncCollection, string> = {
    materials: "materials",
    tracks: "tracks",
    trainingGroups: "training_groups"
  };
  return [
    env.DB.prepare("DELETE FROM firestore_documents WHERE collection_name = ? AND document_id = ?")
      .bind(collection, id),
    env.DB.prepare(`DELETE FROM ${normalizedTables[collection]} WHERE id = ?`).bind(id)
  ];
}

async function syncDocuments(request: Request, env: Env, headers: HeadersInit) {
  const admin = await verifyAdmin(request, env);
  if (!admin?.email) return json({ message: "Нет прав администратора." }, 403, headers);
  const body = (await request.json()) as { documents?: Array<{ collection?: unknown; id?: unknown }> };
  if (!Array.isArray(body.documents) || body.documents.length < 1 || body.documents.length > 100) {
    return json({ message: "Передайте от 1 до 100 документов." }, 400, headers);
  }

  const seen = new Set<string>();
  const documents: Array<{ collection: LiveSyncCollection; id: string }> = [];
  for (const item of body.documents) {
    const collection = typeof item.collection === "string" ? item.collection : "";
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!LIVE_SYNC_COLLECTIONS.includes(collection as LiveSyncCollection) ||
        !id || id.length > 512 || id.includes("/")) {
      return json({ message: "Недопустимая ссылка на документ." }, 400, headers);
    }
    const key = `${collection}:${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      documents.push({ collection: collection as LiveSyncCollection, id });
    }
  }

  const token = await firestoreToken(env);
  const results: Array<{ collection: LiveSyncCollection; id: string; action: "upserted" | "deleted" }> = [];
  for (const item of documents) {
    const source = await readFirestoreDocument(env, token, item.collection, item.id);
    if (!source) {
      await env.DB.batch(deleteDocumentStatements(env, item.collection, item.id));
      results.push({ ...item, action: "deleted" });
      continue;
    }
    const runId = `live-sync:${item.collection}`;
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO migration_runs
      (id, collection_name, status, started_at, completed_at, initiated_by)
      VALUES (?, ?, 'completed', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at, initiated_by=excluded.initiated_by`)
      .bind(runId, item.collection, now, now, admin.email.toLowerCase()).run();
    await savePage(env, item.collection, [source], runId);
    results.push({ ...item, action: "upserted" });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO audit_events (id, event_type, actor_id, created_at, data_json)
    VALUES (?, 'd1LiveSync', ?, ?, ?)`)
    .bind(`d1LiveSync:${crypto.randomUUID()}`, admin.email.toLowerCase(), now,
      JSON.stringify({ documents: results })).run();
  return json({ synced: results.length, results }, 200, headers);
}

function cleanupStatements(env: Env, collection: string, runId: string) {
  const statements = [
    env.DB.prepare(`DELETE FROM firestore_documents
      WHERE collection_name = ? AND migration_run_id != ?`).bind(collection, runId)
  ];

  const normalizedTables: Record<string, string> = {
    accessUsers: "access_users",
    materials: "materials",
    tracks: "tracks",
    trainingGroups: "training_groups",
    learningProgress: "learning_progress",
    materialViews: "material_views"
  };
  const table = normalizedTables[collection];
  if (table) {
    statements.push(env.DB.prepare(`DELETE FROM ${table}
      WHERE id NOT IN (
        SELECT document_id FROM firestore_documents WHERE collection_name = ?
      )`).bind(collection));
  } else if (["loginEvents", "adminImpersonations", "importHistory"].includes(collection)) {
    statements.push(env.DB.prepare(`DELETE FROM audit_events
      WHERE event_type = ? AND id NOT IN (
        SELECT collection_name || ':' || document_id
        FROM firestore_documents WHERE collection_name = ?
      )`).bind(collection, collection));
  } else {
    statements.push(env.DB.prepare(`DELETE FROM reference_documents
      WHERE collection_name = ? AND id NOT IN (
        SELECT document_id FROM firestore_documents WHERE collection_name = ?
      )`).bind(collection, collection));
  }

  statements.push(env.DB.prepare(`UPDATE migration_runs
    SET status = 'completed', completed_at = ?, error_message = NULL WHERE id = ?`)
    .bind(new Date().toISOString(), runId));
  return statements;
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
  const existingRun = await env.DB.prepare(`SELECT collection_name, status
    FROM migration_runs WHERE id = ?`).bind(runId).first<{
      collection_name: string;
      status: "running" | "completed" | "failed";
    }>();
  if (existingRun && existingRun.collection_name !== collection) {
    return json({ message: "Запуск миграции относится к другой коллекции." }, 409, headers);
  }
  if (body.pageToken && !existingRun) {
    return json({ message: "Продолжение миграции не найдено. Начните коллекцию заново." }, 409, headers);
  }
  if (existingRun?.status === "completed") {
    return json({ message: "Эта миграция уже завершена." }, 409, headers);
  }
  if (!existingRun) {
    await env.DB.prepare(`INSERT INTO migration_runs
      (id, collection_name, status, started_at, initiated_by)
      VALUES (?, ?, 'running', ?, ?)`)
      .bind(runId, collection, new Date().toISOString(), admin.email.toLowerCase()).run();
  } else if (existingRun.status === "failed") {
    await env.DB.prepare(`UPDATE migration_runs
      SET status = 'running', completed_at = NULL, error_message = NULL WHERE id = ?`)
      .bind(runId).run();
  }

  try {
    const token = await firestoreToken(env);
    const page = await readFirestorePage(env, token, collection, body.pageToken ?? "", pageSize);
    const documents = page.documents ?? [];
    await savePage(env, collection, documents, runId);
    if (!page.nextPageToken) {
      await env.DB.batch(cleanupStatements(env, collection, runId));
    }
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
  const [d1Result, token] = await Promise.all([
    env.DB.prepare(`SELECT collection_name, COUNT(*) AS count
      FROM firestore_documents GROUP BY collection_name ORDER BY collection_name`).all<{
        collection_name: string;
        count: number;
      }>(),
    firestoreToken(env)
  ]);
  const d1Counts = new Map(d1Result.results.map((row) => [row.collection_name, Number(row.count)]));
  const firestoreCounts = await Promise.all(
    MIGRATED_COLLECTIONS.map((collection) => countFirestoreCollection(env, token, collection))
  );
  const collections = MIGRATED_COLLECTIONS.map((collection, index) => {
    const firestore = firestoreCounts[index];
    const d1 = d1Counts.get(collection) ?? 0;
    return { collection, firestore, d1, difference: firestore - d1, matches: firestore === d1 };
  });
  return json({
    checkedAt: new Date().toISOString(),
    matches: collections.every((item) => item.matches),
    collections
  }, 200, headers);
}

async function catalog(request: Request, env: Env, headers: HeadersInit) {
  const authUser = await verifyFirebaseUser(request, env);
  if (!authUser?.localId || authUser.disabled) {
    return json({ message: "Требуется вход." }, 401, headers);
  }
  const isAdmin = authUser.email?.toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
  const profileDocument = isAdmin
    ? null
    : await readFirestoreDocument(env, await firestoreToken(env), "accessUsers", authUser.localId);
  const profile = profileDocument ? decodeFields(profileDocument.fields) : null;
  if (!isAdmin && (!profile || profile.active !== true || profile.archived === true ||
      profile.passwordResetRequested === true || (profile.claimState ?? "claimed") !== "claimed")) {
    return json({ message: "Нет доступа." }, 403, headers);
  }

  const [materialRows, trackRows, groupRows] = await Promise.all([
    env.DB.prepare("SELECT id, data_json FROM materials").all<{ id: string; data_json: string }>(),
    env.DB.prepare("SELECT id, data_json FROM tracks").all<{ id: string; data_json: string }>(),
    env.DB.prepare("SELECT id, archived FROM training_groups").all<{ id: string; archived: number }>()
  ]);
  const activeGroupIds = new Set(groupRows.results.filter((row) => row.archived !== 1).map((row) => row.id));
  const user = {
    trainingRole: text(profile?.trainingRole),
    officeIds: stringList(profile?.officeIds),
    groupIds: stringList(profile?.groupIds)
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
      if (request.method === "POST" && url.pathname === "/admin/sync-documents") {
        return await syncDocuments(request, env, headers);
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

