import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/import-resume.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
new Function("module", "exports", compiled)(module, module.exports);
const { buildImportFileKey, checkpointMatchesFile } = module.exports;

test("logical import key is stable across file metadata changes", () => {
  const contents = { users: [{ crmId: "1", login: "user" }], blocked: [] };
  assert.equal(buildImportFileKey(contents, 1), buildImportFileKey(contents, 1));
  assert.notEqual(
    buildImportFileKey(contents, 1),
    buildImportFileKey({ users: [{ crmId: "2", login: "user" }], blocked: [] }, 1)
  );
});

test("version 2 checkpoint matches the same logical file", () => {
  const identity = {
    fileKey: buildImportFileKey({ users: ["one"] }, 1),
    fileName: "users.xlsx",
    fileSize: 100,
    recordCount: 1
  };
  assert.equal(checkpointMatchesFile({ fileKey: identity.fileKey }, identity), true);
});

test("legacy checkpoint ignores lastModified for the same file", () => {
  const identity = {
    fileKey: buildImportFileKey({ users: ["one"] }, 1),
    fileName: "users.xlsx",
    fileSize: 100,
    recordCount: 1
  };
  assert.equal(
    checkpointMatchesFile({ fileKey: "users.xlsx:100:123456789:1" }, identity),
    true
  );
  assert.equal(
    checkpointMatchesFile({ fileKey: "users.xlsx:101:123456789:1" }, identity),
    false
  );
});
