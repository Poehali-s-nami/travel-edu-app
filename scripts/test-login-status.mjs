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

const source = readFileSync(
  new URL("../src/app/api/access/login-status/route.ts", import.meta.url),
  "utf8"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => {
    if (name === "next/server") {
      return {
        NextResponse: {
          json: (data, options = {}) => ({ data, status: options.status ?? 200 })
        }
      };
    }
    throw new Error(`Unexpected import: ${name}`);
  },
  module,
  module.exports
);
const { POST } = module.exports;

function request(token = "") {
  return {
    headers: new Headers(token ? { authorization: `Bearer ${token}` } : {})
  };
}

test("anonymous login status checks never reach Firebase or Firestore", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected request");
  };
  const response = await POST(request());
  assert.equal(response.status, 401);
  assert.equal(response.data.status, "unauthorized");
  assert.equal(calls, 0);
});

test("an authenticated user is looked up only by the verified Firebase UID", async () => {
  const urls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("accounts:lookup?key=")) {
      return { ok: true, json: async () => ({ users: [{
        localId: "user-1",
        email: "user@example.invalid",
        disabled: false
      }] }) };
    }
    if (url.includes("oauth2.googleapis.com/token")) {
      return { ok: true, json: async () => ({ access_token: "service-token" }) };
    }
    if (url.endsWith("/documents/accessUsers/user-1")) {
      return { ok: true, status: 200, json: async () => ({ fields: {
        active: { booleanValue: true },
        archived: { booleanValue: false },
        claimState: { stringValue: "claimed" }
      } }) };
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const response = await POST(request("valid-token"));
  assert.equal(response.status, 200);
  assert.equal(response.data.status, "active");
  assert.equal(urls.some((url) => url.includes("documents:runQuery")), false);
  assert.equal(urls.some((url) => url.endsWith("/documents/accessUsers/user-1")), true);
});
