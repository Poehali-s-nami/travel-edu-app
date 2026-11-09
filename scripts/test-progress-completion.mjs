import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

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

function request(materialId = "material-1", token = "valid-token") {
  return {
    headers: new Headers({ authorization: `Bearer ${token}` }),
    json: async () => ({ materialId })
  };
}

function mockWorker(status, data) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => data
    };
  };
  return calls;
}

test("forwards a valid completion to the protected Worker endpoint", async () => {
  const calls = mockWorker(200, { completed: true, materialId: "material-1", d1Synced: true });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.data.completed, true);
  assert.equal(response.data.d1Synced, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.example.invalid/v1/complete-progress");
  assert.equal(calls[0].init.headers.authorization, "Bearer valid-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), { materialId: "material-1" });
});

test("preserves a Worker access rejection", async () => {
  const calls = mockWorker(403, { message: "Материал недоступен." });
  const response = await POST(request());
  assert.equal(response.status, 403);
  assert.equal(response.data.message, "Материал недоступен.");
  assert.equal(calls.length, 1);
});

test("returns confirmed Firestore completion when the Worker reports a D1 retry is needed", async () => {
  mockWorker(200, { completed: true, materialId: "material-1", d1Synced: false });
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.data.completed, true);
  assert.equal(response.data.d1Synced, false);
});

test("rejects malformed input before contacting the Worker", async () => {
  const calls = mockWorker(200, {});
  const response = await POST(request("invalid/id"));
  assert.equal(response.status, 400);
  assert.equal(calls.length, 0);
});
