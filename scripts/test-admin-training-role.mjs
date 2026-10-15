import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: "test@example.invalid",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" })
});
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "test-project";

const source = readFileSync(new URL("../src/app/api/admin/set-training-role/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => {
    if (name === "next/server") return {
      NextResponse: { json: (data, options = {}) => ({ data, status: options.status ?? 200 }) }
    };
    if (name === "@/lib/training-role") return {
      classifyTrainingRole: (values) => ({ role: values.includes("Менеджер") ? "MANAGER" : "MANUAL_REVIEW" })
    };
    throw new Error(`Unexpected import: ${name}`);
  },
  module,
  module.exports
);
const { POST } = module.exports;

function setup({ admin = true, types = ["Менеджер"], previousRole = "EMPLOYEE", manual = false, conflict = false } = {}) {
  const commits = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.includes("accounts:lookup?key=")) return {
      ok: true, json: async () => ({ users: [{ localId: "admin-1", email: admin ? "psnkzeducation@gmail.com" : "other@example.invalid" }] })
    };
    if (url.includes("oauth2.googleapis.com/token")) return { ok: true, json: async () => ({ access_token: "service-token" }) };
    if (url.endsWith("documents/accessUsers/user-1")) return {
      ok: true,
      json: async () => ({
        name: "projects/test-project/databases/(default)/documents/accessUsers/user-1",
        updateTime: "2026-10-14T00:00:00Z",
        fields: {
          role: { stringValue: "user" },
          trainingRole: { stringValue: previousRole },
          trainingRoleManual: { booleanValue: manual },
          crmUserTypes: { arrayValue: { values: types.map((value) => ({ stringValue: value })) } }
        }
      })
    };
    if (url.endsWith("documents:commit")) {
      commits.push(JSON.parse(options.body));
      return { ok: !conflict, status: conflict ? 409 : 200 };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return commits;
}

function change(role, token = "admin-token") {
  return POST({
    headers: new Headers({ authorization: token ? `Bearer ${token}` : "" }),
    json: async () => ({ uid: "user-1", role })
  });
}

test("only the central administrator can assign a role", async () => {
  setup({ admin: false });
  assert.equal((await change("HEAD", "")).status, 401);
  assert.equal((await change("HEAD")).status, 403);
});

test("ADMIN is not assignable through the training role editor", async () => {
  const commits = setup();
  assert.equal((await change("ADMIN")).status, 400);
  assert.equal(commits.length, 0);
});

test("malformed or empty JSON is rejected before any Firestore write", async () => {
  const commits = setup();
  for (const json of [async () => { throw new SyntaxError("invalid JSON"); }, async () => null]) {
    const result = await POST({
      headers: new Headers({ authorization: "Bearer admin-token" }),
      json
    });
    assert.equal(result.status, 400);
  }
  assert.equal(commits.length, 0);
});

test("manual role change and audit record are committed atomically", async () => {
  const commits = setup();
  const result = await change("HEAD");
  assert.equal(result.status, 200);
  assert.equal(result.data.role, "HEAD");
  assert.equal(commits.length, 1);
  const [userWrite, auditWrite] = commits[0].writes;
  assert.equal(userWrite.update.fields.trainingRole.stringValue, "HEAD");
  assert.equal(userWrite.update.fields.trainingRoleManual.booleanValue, true);
  assert.equal(userWrite.update.fields.role, undefined);
  assert.equal(userWrite.currentDocument.updateTime, "2026-10-14T00:00:00Z");
  assert.match(auditWrite.update.name, /trainingRoleChanges/);
  assert.equal(auditWrite.update.fields.previousRole.stringValue, "EMPLOYEE");
});

test("returning to CRM recomputes the role and clears manual override", async () => {
  const commits = setup({ previousRole: "HEAD", manual: true });
  const result = await change("auto");
  assert.equal(result.status, 200);
  assert.equal(result.data.role, "MANAGER");
  assert.equal(commits[0].writes[0].update.fields.trainingRoleManual.booleanValue, false);
});

test("CRM mode is unavailable until user types have been imported", async () => {
  const commits = setup({ types: [] });
  assert.equal((await change("auto")).status, 409);
  assert.equal(commits.length, 0);
});

test("concurrent edit returns a conflict without claiming success", async () => {
  setup({ conflict: true });
  assert.equal((await change("HEAD")).status, 409);
});
