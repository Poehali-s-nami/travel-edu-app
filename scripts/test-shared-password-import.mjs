import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: "test@example.invalid",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  project_id: "test-project"
});
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project";

function compile(path, imports) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => {
      if (name in imports) return imports[name];
      throw new Error(`Unexpected import: ${name}`);
    },
    module,
    module.exports
  );
  return module.exports;
}

const dictionary = JSON.parse(readFileSync(
  new URL("../src/config/training-role-tokens.json", import.meta.url), "utf8"
));
const trainingRole = compile("../src/lib/training-role.ts", {
  "@/config/training-role-tokens.json": dictionary
});
const trainingGroups = compile("../src/lib/training-groups.ts", {});
const { POST } = compile("../src/app/api/admin/import-users/route.ts", {
  "next/server": { NextResponse: { json: (data, options = {}) => ({
    data,
    status: options.status ?? 200
  }) } },
  "@/lib/training-role": trainingRole,
  "@/lib/training-groups": trainingGroups
});

function ok(data = {}) {
  return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
}

function fail(status = 500) {
  return { ok: false, status, json: async () => ({}), text: async () => "failed" };
}

function profile(uid, login, claimState = "claimed") {
  return {
    name: `projects/test-project/databases/(default)/documents/accessUsers/${uid}`,
    fields: {
      crmId: { stringValue: uid },
      login: { stringValue: login },
      normalizedLogin: { stringValue: login },
      source: { stringValue: "crm" },
      claimState: { stringValue: claimState },
      passwordPolicyVersion: { integerValue: "1" },
      passwordResetRequested: { booleanValue: false }
    }
  };
}

function temporaryProfile(uid, login) {
  const existing = profile(uid, login);
  existing.fields.passwordPolicyVersion = { integerValue: "0" };
  existing.fields.passwordResetRequested = { booleanValue: true };
  return existing;
}

function setup({ profiles = [], authUsers = [], failCommit = false, failPasswordRotation = false, batchGetAsStream = false, onCommit } = {}) {
  const created = [];
  const updated = [];
  const deleted = [];
  const commits = [];
  const reads = { fullList: 0, targeted: 0, byId: 0 };
  const auth = new Map(authUsers.map((user) => [user.localId, user]));
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    const body = options.body && String(options.body).startsWith("{")
      ? JSON.parse(options.body)
      : {};
    if (url.includes("oauth2.googleapis.com/token")) return ok({ access_token: "token" });
    if (url.includes("accounts:lookup?key=")) {
      return ok({ users: [{ email: "psnkzeducation@gmail.com" }] });
    }
    if (url.endsWith("documents:runQuery")) {
      reads.targeted += 1;
      const filter = body.structuredQuery.where.fieldFilter;
      const values = new Set(filter.value.arrayValue.values.map((value) => value.stringValue));
      return ok(profiles.filter((item) => values.has(item.fields?.[filter.field.fieldPath]?.stringValue))
        .map((document) => ({ document })));
    }
    if (url.endsWith("documents:batchGet")) {
      reads.byId += 1;
      const rows = body.documents.map((name) => {
        const found = profiles.find((item) => item.name === name);
        return found ? { found } : { missing: name };
      });
      return batchGetAsStream
        ? { ok: true, text: async () => rows.map((row) => JSON.stringify(row)).join("\n") }
        : ok(rows);
    }
    if (url.includes("documents/accessUsers") && !options.method) {
      reads.fullList += 1;
      return ok({ documents: profiles });
    }
    if (url.endsWith("accounts:lookup")) {
      const users = [...auth.values()].filter((user) =>
        body.localId?.includes(user.localId) || body.email?.includes(user.email));
      return ok({ users });
    }
    if (url.endsWith("/accounts") && options.method === "POST") {
      created.push(body);
      auth.set(body.localId, body);
      return ok({ localId: body.localId });
    }
    if (url.endsWith("accounts:update")) {
      updated.push(body);
      if (body.password && failPasswordRotation) return fail();
      return ok({ localId: body.localId });
    }
    if (url.endsWith("accounts:delete")) {
      deleted.push(body);
      auth.delete(body.localId);
      return ok();
    }
    if (url.endsWith("documents:commit")) {
      commits.push(body);
      if (!failCommit) onCommit?.(profiles, body);
      return failCommit ? fail() : ok();
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  return { created, updated, deleted, commits, auth, reads };
}

function user(crmId, login) {
  return {
    crmId,
    login,
    displayName: login,
    active: true,
    crmUserTypes: ["Менеджер"]
  };
}

function importUsers(users, temporaryPassword = "Shared123") {
  return POST({ json: async () => ({
    idToken: "admin-token",
    temporaryPassword,
    users
  }) });
}

test("new profiles receive the shared temporary password and must change it", async () => {
  const state = setup();
  const response = await importUsers([user("crm-1", "first"), user("crm-2", "second")]);
  assert.equal(response.status, 200);
  assert.deepEqual(state.created.map((item) => item.localId), ["crm-1", "crm-2"]);
  assert.ok(state.created.every((item) => item.password === "Shared123"));
  const writes = state.commits[0].writes;
  assert.ok(writes.every((item) =>
    item.update.fields.passwordResetRequested.booleanValue === true &&
    item.update.fields.claimState.stringValue === "claimed"));
});

test("ordinary import reads only matching profiles, even with a large account collection", async () => {
  const profiles = Array.from({ length: 1500 }, (_, index) =>
    profile(`existing-${index}`, `existing-${index}`));
  const state = setup({ profiles });
  const response = await importUsers([user("new-crm-id", "new-login")]);
  assert.equal(response.status, 200);
  assert.deepEqual(state.reads, { fullList: 0, targeted: 2, byId: 1 });
});

test("archival import reads the complete account collection once", async () => {
  const state = setup();
  const response = await POST({ json: async () => ({
    idToken: "admin-token",
    temporaryPassword: "Shared123",
    archiveMissing: true,
    users: [user("crm-1", "first")]
  }) });
  assert.equal(response.status, 200);
  assert.deepEqual(state.reads, { fullList: 1, targeted: 0, byId: 0 });
});

test("legacy profile without a CRM ID field is found by document ID", async () => {
  const existing = profile("crm-1", "first");
  delete existing.fields.crmId;
  const state = setup({
    profiles: [existing],
    authUsers: [{ localId: "crm-1", email: "old@example.invalid" }]
  });
  const response = await importUsers([user("crm-1", "first")]);
  assert.equal(response.status, 200);
  assert.equal(state.created.length, 0);
  assert.equal(state.updated.length, 1);
});

test("repeat import preserves an existing password and UID", async () => {
  const state = setup({
    profiles: [profile("crm-1", "first")],
    authUsers: [{ localId: "crm-1", email: "old@example.invalid" }]
  });
  const response = await importUsers([user("crm-1", "first")]);
  assert.equal(response.status, 200);
  assert.equal(state.created.length, 0);
  assert.equal(state.updated.length, 1);
  assert.equal("password" in state.updated[0], false);
  assert.equal("passwordResetRequested" in state.commits[0].writes[0].update.fields, false);
});

test("weekly import replaces only the previous CRM temporary password", async () => {
  const state = setup({
    profiles: [temporaryProfile("crm-1", "first")],
    authUsers: [{ localId: "crm-1", email: "old@example.invalid", password: "LastWeek1" }],
    batchGetAsStream: true
  });
  const response = await importUsers([user("crm-1", "first")], "NewWeek2");
  assert.equal(response.status, 200);
  assert.equal(response.data.rotatedPasswords, 1, JSON.stringify(response.data));
  assert.deepEqual(state.updated.filter((item) => item.password).map((item) => item.password), ["NewWeek2"]);
  assert.equal("passwordResetRequested" in state.commits[0].writes[0].update.fields, false);
  assert.equal("passwordPolicyVersion" in state.commits[0].writes[0].update.fields, false);
});

test("weekly import leaves admin-reset and manually created account passwords untouched", async () => {
  const adminReset = temporaryProfile("crm-1", "first");
  adminReset.fields.passwordPolicyVersion = { integerValue: "1" };
  const manual = temporaryProfile("crm-2", "second");
  manual.fields.source = { stringValue: "manual" };
  const state = setup({
    profiles: [adminReset, manual],
    authUsers: [
      { localId: "crm-1", email: "first@example.invalid" },
      { localId: "crm-2", email: "second@example.invalid" }
    ]
  });
  const response = await importUsers([user("crm-1", "first"), user("crm-2", "second")], "NewWeek2");
  assert.equal(response.status, 200);
  assert.equal(response.data.rotatedPasswords, 0);
  assert.equal(state.updated.some((item) => "password" in item), false);
});

test("weekly import skips rotation when a personal password was set during import", async () => {
  const existing = temporaryProfile("crm-1", "first");
  const state = setup({
    profiles: [existing],
    authUsers: [{ localId: "crm-1", email: "old@example.invalid" }],
    onCommit: () => {
      existing.fields.passwordResetRequested = { booleanValue: false };
      existing.fields.passwordPolicyVersion = { integerValue: "1" };
      existing.fields.passwordChangedAt = { timestampValue: new Date().toISOString() };
    }
  });
  const response = await importUsers([user("crm-1", "first")], "NewWeek2");
  assert.equal(response.status, 200);
  assert.equal(response.data.rotatedPasswords, 0);
  assert.equal(response.data.conflicts.length, 1);
  assert.equal(state.updated.some((item) => "password" in item), false);
});

test("failed weekly password rotation is reported without claiming success", async () => {
  const state = setup({
    profiles: [temporaryProfile("crm-1", "first")],
    authUsers: [{ localId: "crm-1", email: "old@example.invalid" }],
    failPasswordRotation: true
  });
  const response = await importUsers([user("crm-1", "first")], "NewWeek2");
  assert.equal(response.status, 200);
  assert.equal(response.data.rotatedPasswords, 0);
  assert.equal(response.data.conflicts.length, 1);
  assert.equal(state.updated.some((item) => item.password === "NewWeek2"), true, JSON.stringify(response.data));
});

test("repeat import preserves a manually assigned training role", async () => {
  const existing = profile("crm-1", "first");
  existing.fields.trainingRoleManual = { booleanValue: true };
  existing.fields.trainingRole = { stringValue: "HEAD" };
  const state = setup({
    profiles: [existing],
    authUsers: [{ localId: "crm-1", email: "old@example.invalid" }]
  });
  const response = await importUsers([user("crm-1", "first")]);
  assert.equal(response.status, 200);
  const fields = state.commits[0].writes[0].update.fields;
  assert.equal(fields.trainingRole, undefined);
  assert.equal(fields.trainingRoleManual, undefined);
});

test("CRM import creates one office group per office ID without touching manual memberships", async () => {
  const existing = profile("crm-1", "first");
  existing.fields.groupIds = { arrayValue: { values: [{ stringValue: "manual-group" }] } };
  const state = setup({
    profiles: [existing],
    authUsers: [{ localId: "crm-1", email: "old@example.invalid" }]
  });
  const offices = [{ id: "42", name: "Центральный офис", city: "" }];
  const response = await importUsers([
    { ...user("crm-1", "first"), officeIds: ["42"], officeLinks: offices },
    { ...user("crm-2", "second"), officeIds: ["42"], officeLinks: offices }
  ]);
  assert.equal(response.status, 200);
  const writes = state.commits[0].writes;
  const officeWrites = writes.filter((item) => item.update.name.includes("/trainingGroups/"));
  assert.equal(officeWrites.length, 1);
  assert.equal(officeWrites[0].update.name.split("/").at(-1), trainingGroups.officeGroupId("42"));
  assert.equal(officeWrites[0].update.fields.name.stringValue, "Центральный офис");
  assert.equal(officeWrites[0].update.fields.trackIds, undefined);
  assert.equal(writes.find((item) => item.update.name.endsWith("/accessUsers/crm-1")).update.fields.groupIds, undefined);
});

test("office group is created when CRM supplies only the office ID", async () => {
  const state = setup();
  const response = await importUsers([{ ...user("crm-1", "first"), officeIds: ["77"] }]);
  assert.equal(response.status, 200);
  const office = state.commits[0].writes.find((item) => item.update.name.includes("/trainingGroups/"));
  assert.equal(office.update.fields.officeId.stringValue, "77");
  assert.equal(office.update.fields.name.stringValue, "Офис 77");
});

test("name fallback creates a new account with its unique derived login", async () => {
  const state = setup();
  const response = await importUsers([
    { ...user("52479", "Никита Другов"), loginSource: "name_fallback" }
  ]);
  assert.equal(response.status, 200);
  assert.equal(state.created[0].localId, "52479");
  assert.equal(state.commits[0].writes[0].update.fields.login.stringValue, "Никита Другов");
});

test("name fallback keeps an existing CRM account's login and password", async () => {
  const state = setup({
    profiles: [profile("52479", "nikita.crm")],
    authUsers: [{ localId: "52479", email: "old@example.invalid" }]
  });
  const response = await importUsers([
    { ...user("52479", "Никита Другов"), loginSource: "name_fallback" }
  ]);
  assert.equal(response.status, 200);
  assert.equal(state.created.length, 0);
  assert.equal(state.updated.length, 1);
  assert.equal("email" in state.updated[0], false);
  assert.equal("password" in state.updated[0], false);
  assert.equal(state.commits[0].writes[0].update.fields.login.stringValue, "nikita.crm");
  assert.equal(state.commits[0].writes[0].update.fields.normalizedLogin.stringValue, "nikita.crm");
});

test("name fallback cannot claim another account by matching its login", async () => {
  const state = setup({
    profiles: [profile("crm_legacy", "никита другов")],
    authUsers: [{ localId: "crm_legacy", email: "old@example.invalid" }]
  });
  const response = await importUsers([
    { ...user("52479", "Никита Другов"), loginSource: "name_fallback" }
  ]);
  assert.equal(response.status, 200);
  assert.equal(response.data.conflicts.length, 1);
  assert.equal(response.data.conflicts[0].crmId, "52479");
  assert.equal(state.created.length, 0);
  assert.equal(state.updated.length, 0);
  assert.equal(state.commits.length, 0);
});

test("an identity conflict does not stop safe users in the same batch", async () => {
  const state = setup({
    profiles: [profile("old-crm-id", "taken-login")],
    authUsers: [{ localId: "old-crm-id", email: "old@example.invalid" }]
  });
  const response = await importUsers([
    user("new-crm-id", "taken-login"),
    user("safe-crm-id", "safe-login")
  ]);
  assert.equal(response.status, 200);
  assert.equal(response.data.imported, 1);
  assert.equal(response.data.skipped, 1);
  assert.deepEqual(response.data.conflicts.map((item) => item.crmId), ["new-crm-id"]);
  assert.deepEqual(state.created.map((item) => item.localId), ["safe-crm-id"]);
  assert.equal(state.commits[0].writes.length, 1);
  assert.equal(state.commits[0].writes[0].update.fields.crmId.stringValue, "safe-crm-id");
});

test("an occupied Firebase Auth ID is reported without stopping the batch", async () => {
  const state = setup({
    authUsers: [{ localId: "occupied-id", email: "old@example.invalid" }]
  });
  const response = await importUsers([
    user("occupied-id", "different-login"),
    user("safe-crm-id", "safe-login")
  ]);
  assert.equal(response.status, 200);
  assert.equal(response.data.imported, 1);
  assert.deepEqual(response.data.conflicts.map((item) => item.crmId), ["occupied-id"]);
  assert.deepEqual(state.created.map((item) => item.localId), ["safe-crm-id"]);
  assert.equal(state.commits[0].writes.length, 1);
});

test("a profile missing Firebase Auth is skipped while safe users continue", async () => {
  const state = setup({ profiles: [profile("missing-auth", "existing-login")] });
  const response = await importUsers([
    user("missing-auth", "existing-login"),
    user("safe-crm-id", "safe-login")
  ]);
  assert.equal(response.status, 200);
  assert.equal(response.data.imported, 1);
  assert.deepEqual(response.data.conflicts.map((item) => item.crmId), ["missing-auth"]);
  assert.deepEqual(state.created.map((item) => item.localId), ["safe-crm-id"]);
  assert.equal(state.commits[0].writes.length, 1);
});

test("previously unclaimed profile gets Auth with its original UID", async () => {
  const state = setup({ profiles: [profile("crm-1", "first", "unclaimed")] });
  const response = await importUsers([user("crm-1", "first")]);
  assert.equal(response.status, 200);
  assert.equal(state.created[0].localId, "crm-1");
  assert.equal(state.commits[0].writes[0].update.fields.passwordResetRequested.booleanValue, true);
  assert.equal(state.commits[0].writes[0].update.fields.claimState.stringValue, "claimed");
});

test("missing temporary password is rejected before writing", async () => {
  const state = setup();
  const response = await importUsers([user("crm-1", "first")], "");
  assert.equal(response.status, 400);
  assert.equal(state.created.length, 0);
  assert.equal(state.commits.length, 0);
});

test("Auth account is removed if Firestore commit fails", async () => {
  const state = setup({ failCommit: true });
  const response = await importUsers([user("crm-1", "first")]);
  assert.equal(response.status, 500);
  assert.equal(state.created.length, 1);
  assert.equal(state.deleted[0].localId, "crm-1");
  assert.equal(state.auth.size, 0);
});
