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

const source = readFileSync(new URL("../src/app/api/access/confirm-password-change/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(
  (name) => {
    if (name === "next/server") return {
      NextResponse: { json: (data, options = {}) => ({ data, status: options.status ?? 200 }) }
    };
    throw new Error(`Unexpected import: ${name}`);
  },
  module,
  module.exports
);
const { POST } = module.exports;

function mockFirebase({ commitFailures = 0 } = {}) {
  const calls = { passwordUpdates: 0, commits: 0 };
  globalThis.fetch = async (input) => {
    const url = String(input);
    let data = {};
    if (url.includes("oauth2.googleapis.com/token")) data = { access_token: "service-token" };
    else if (url.includes("accounts:signInWithPassword")) data = { localId: "user-1" };
    else if (url.includes("accounts:lookup?key=")) {
      data = { users: [{ localId: "user-1", email: "user@example.invalid", disabled: false }] };
    } else if (url.endsWith("documents/accessUsers/user-1")) {
      data = { fields: { active: { booleanValue: true }, archived: { booleanValue: false } } };
    } else if (url.endsWith("accounts:update")) {
      calls.passwordUpdates += 1;
    } else if (url.endsWith("documents:commit")) {
      calls.commits += 1;
      if (calls.commits <= commitFailures) return { ok: false, status: 503 };
    } else throw new Error(`Unexpected request: ${url}`);
    return { ok: true, json: async () => data };
  };
  return calls;
}

function change(password = "Personal123", currentPassword = "Shared123") {
  return POST({
    headers: new Headers({ authorization: "Bearer valid-token" }),
    json: async () => ({ password, currentPassword })
  });
}

test("password change clears the access gate after changing Auth credentials", async () => {
  const calls = mockFirebase();
  const result = await change();
  assert.equal(result.status, 200);
  assert.deepEqual(calls, { passwordUpdates: 1, commits: 1 });
});

test("transient Firestore failure is retried without changing password twice", async () => {
  const calls = mockFirebase({ commitFailures: 1 });
  const result = await change();
  assert.equal(result.status, 200);
  assert.deepEqual(calls, { passwordUpdates: 1, commits: 2 });
});

test("persistent status failure keeps the gate and reports partial completion", async () => {
  const calls = mockFirebase({ commitFailures: 3 });
  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    const result = await change();
    assert.equal(result.status, 500);
    assert.match(result.data.message, /Пароль изменён/);
    assert.deepEqual(calls, { passwordUpdates: 1, commits: 3 });
  } finally {
    console.error = previousConsoleError;
  }
});

test("the shared password cannot be kept as the personal password", async () => {
  const calls = mockFirebase();
  const result = await change("Shared123", "Shared123");
  assert.equal(result.status, 400);
  assert.deepEqual(calls, { passwordUpdates: 0, commits: 0 });
});
