import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function load(relativePath, dependencies = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected import: ${name}`);
      return dependencies[name];
    }, module, module.exports
  );
  return module.exports;
}

const groups = load("../src/lib/training-groups.ts");
const { canAccessContent } = load("../src/lib/content-access.ts", { "@/lib/training-groups": groups });
const heads = { mode: "restricted", roles: ["HEAD"], groupIds: [] };

test("legacy and everyone content stays visible", () => {
  assert.equal(canAccessContent(undefined, {}, new Set()), true);
  assert.equal(canAccessContent({ mode: "everyone", roles: [], groupIds: [] }, {}, new Set()), true);
});

test("head-only program is not visible to other roles", () => {
  assert.equal(canAccessContent(heads, { trainingRole: "HEAD" }, new Set()), true);
  assert.equal(canAccessContent(heads, { trainingRole: "MANAGER" }, new Set()), false);
  assert.equal(canAccessContent(heads, {}, new Set()), false);
});

test("active manual and office groups grant access, archived groups do not", () => {
  const officeId = groups.officeGroupId("42");
  const audience = { mode: "restricted", roles: [], groupIds: ["pilot", officeId] };
  assert.equal(canAccessContent(audience, { groupIds: ["pilot"] }, new Set(["pilot"])), true);
  assert.equal(canAccessContent(audience, { officeIds: ["42"] }, new Set([officeId])), true);
  assert.equal(canAccessContent(audience, { officeIds: ["42"] }, new Set()), false);
  assert.equal(canAccessContent(audience, { groupIds: ["other"] }, new Set(["pilot"])), false);
});

test("empty or damaged restricted audience fails closed", () => {
  assert.equal(canAccessContent({ mode: "restricted", roles: [], groupIds: [] }, { trainingRole: "HEAD" }, new Set()), false);
  assert.equal(canAccessContent({ mode: "unknown", roles: ["HEAD"], groupIds: [] }, { trainingRole: "HEAD" }, new Set()), false);
});

test("content API returns only permitted documents and hides tracks with unavailable lessons", async () => {
  const route = load("../src/app/api/content/route.ts", {
    "next/server": { NextResponse: { json: (data, options = {}) => ({ data, status: options.status ?? 200 }) } },
    "@/lib/content-access": { canAccessContent },
    "@/lib/training-groups": groups
  });
  const previousFetch = globalThis.fetch;
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const previousAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const value = (input) => {
    if (typeof input === "string") return { stringValue: input };
    if (typeof input === "boolean") return { booleanValue: input };
    if (Array.isArray(input)) return { arrayValue: { values: input.map(value) } };
    return { mapValue: { fields: Object.fromEntries(Object.entries(input).map(([key, item]) => [key, value(item)])) } };
  };
  const document = (collection, id, fields) => ({ name: `projects/test/databases/(default)/documents/${collection}/${id}`,
    fields: Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, value(item)])) });
  const response = (data) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  let revision = "first";
  let role = "MANAGER";
  let catalogReads = 0;

  try {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "test@example.com", private_key: "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----" });
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: { subtle: {
      importKey: async () => ({}), sign: async () => Uint8Array.from([1]).buffer
    } } });
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("accounts:lookup")) return response({ users: [{ localId: "uid-1", email: "user@example.com" }] });
      if (url.includes("oauth2.googleapis.com/token")) return response({ access_token: "service-token" });
      if (url.endsWith("/accessUsers/uid-1")) return response(document("accessUsers", "uid-1", {
        active: true, archived: false, claimState: "claimed", trainingRole: role, groupIds: ["pilot"]
      }));
      if (url.endsWith("/catalogMeta/current")) return response(document("catalogMeta", "current", { revision }));
      if (url.includes("/materials?")) { catalogReads += 1; return response({ documents: [
        document("materials", "public", { title: "Public", archived: false }),
        document("materials", "head", { title: "Head", archived: false, audience: { mode: "restricted", roles: ["HEAD"], groupIds: [] } }),
        document("materials", "pilot", { title: "Pilot", archived: false, audience: { mode: "restricted", roles: [], groupIds: ["pilot"] } })
      ] }); }
      if (url.includes("/tracks?")) { catalogReads += 1; return response({ documents: [
        document("tracks", "head-track", { title: "Head track", archived: false, materialIds: ["head"], audience: { mode: "restricted", roles: ["HEAD"], groupIds: [] } }),
        document("tracks", "incomplete-track", { title: "Incomplete track", archived: false, materialIds: ["public", "head", "pilot"], audience: { mode: "restricted", roles: [], groupIds: ["pilot"] } }),
        document("tracks", "pilot-track", { title: "Pilot track", archived: false, materialIds: ["public", "pilot"], audience: { mode: "restricted", roles: [], groupIds: ["pilot"] } })
      ] }); }
      if (url.endsWith("/trainingGroups/pilot")) return response(document("trainingGroups", "pilot", { archived: false }));
      throw new Error(`Unexpected request: ${url}`);
    };
    const result = await route.GET(new Request("https://example.com/api/content", { headers: { authorization: "Bearer valid-token" } }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.materials.map((item) => item.id), ["public", "pilot"]);
    assert.deepEqual(result.data.tracks.map((item) => item.id), ["pilot-track"]);
    assert.deepEqual(result.data.tracks[0].materialIds, ["public", "pilot"]);
    assert.equal(catalogReads, 2);

    role = "HEAD";
    const headResult = await route.GET(new Request("https://example.com/api/content", { headers: { authorization: "Bearer valid-token" } }));
    assert.deepEqual(headResult.data.materials.map((item) => item.id), ["public", "head", "pilot"]);
    assert.equal(catalogReads, 2, "Changing roles must reuse only the unfiltered catalog");

    role = "MANAGER";
    const managerAgain = await route.GET(new Request("https://example.com/api/content", { headers: { authorization: "Bearer valid-token" } }));
    assert.deepEqual(managerAgain.data.materials.map((item) => item.id), ["public", "pilot"]);
    assert.equal(catalogReads, 2);

    revision = "second";
    const refreshed = await route.GET(new Request("https://example.com/api/content", { headers: { authorization: "Bearer valid-token" } }));
    assert.equal(refreshed.status, 200);
    assert.equal(catalogReads, 4, "A content edit must reload both collections");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCrypto) Object.defineProperty(globalThis, "crypto", previousCrypto);
    if (previousAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousAccount;
  }
});
