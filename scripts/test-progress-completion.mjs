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
process.env.NEXT_PUBLIC_CONTENT_API_URL = "https://api.example.invalid/v1/catalog";

const source = readFileSync(new URL("../src/app/api/progress/complete/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => {
    if (name === "next/server") return {
      NextResponse: class NextResponse {
        constructor(body, options = {}) {
          this.body = body;
          this.status = options.status ?? 200;
        }

        static json(data, options = {}) {
          const response = new this(JSON.stringify(data), options);
          response.data = data;
          return response;
        }
      }
    };
    throw new Error(`Unexpected import: ${name}`);
  },
  module,
  module.exports
);
const { POST } = module.exports;

function request(materialId = "material-1") {
  return {
    headers: new Headers({ authorization: "Bearer valid-token" }),
    json: async () => ({ materialId }),
    url: "https://preview.example.invalid/api/progress/complete"
  };
}

function mockServices({ visible = true, d1Ok = true } = {}) {
  const calls = { writes: [], d1: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("accounts:lookup?key=")) {
      return { ok: true, status: 200, json: async () => ({ users: [{ localId: "user-1", disabled: false }] }) };
    }
    if (url === "https://preview.example.invalid/api/content") {
      return { ok: true, status: 200, json: async () => ({
        materials: visible ? [{ id: "material-1", title: "Canonical title" }] : [],
        tracks: []
      }) };
    }
    if (url === "https://oauth2.googleapis.com/token") {
      return { ok: true, status: 200, json: async () => ({ access_token: "service-token" }) };
    }
    if (url.endsWith("/documents/learningProgress/user-1_material-1")) {
      calls.writes.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url === "https://api.example.invalid/v1/confirmed-progress") {
      calls.d1 += 1;
      return { ok: d1Ok, status: d1Ok ? 200 : 503, json: async () => ({ synced: d1Ok }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  return calls;
}

test("writes canonical progress only after the material access check", async () => {
  const calls = mockServices();
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.data.d1Synced, true);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.writes[0].fields.userId.stringValue, "user-1");
  assert.equal(calls.writes[0].fields.materialId.stringValue, "material-1");
  assert.equal(calls.writes[0].fields.materialTitle.stringValue, "Canonical title");
  assert.equal(calls.d1, 1);
});

test("rejects progress for a material outside the accessible catalog", async () => {
  const calls = mockServices({ visible: false });
  const response = await POST(request());
  assert.equal(response.status, 403);
  assert.equal(calls.writes.length, 0);
  assert.equal(calls.d1, 0);
});

test("keeps confirmed Firestore progress when D1 synchronization is temporarily unavailable", async () => {
  const calls = mockServices({ d1Ok: false });
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    const response = await POST(request());
    assert.equal(response.status, 200);
    assert.equal(response.data.d1Synced, false);
    assert.equal(calls.writes.length, 1);
    assert.equal(calls.d1, 1);
  } finally {
    console.warn = previousWarn;
  }
});
