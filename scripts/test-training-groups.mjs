import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/training-groups.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", compiled)(() => { throw new Error("Unexpected import"); }, module, module.exports);
const { officeGroupId, belongsToGroup, assignedGroupContent } = module.exports;

test("office IDs create stable distinct group IDs", () => {
  assert.equal(officeGroupId("42"), officeGroupId(" 42 "));
  assert.notEqual(officeGroupId("42"), officeGroupId("43"));
});

test("CRM office and multiple manual memberships combine without duplicates", () => {
  const user = { officeIds: ["42"], groupIds: ["pilot", "office-extra"] };
  const groups = [
    { id: officeGroupId("42"), kind: "office", officeId: "42", trackIds: ["track-a"], materialIds: ["material-a"], archived: false },
    { id: "pilot", kind: "manual", trackIds: ["track-a", "track-b"], materialIds: ["material-b"], archived: false },
    { id: "old", kind: "manual", trackIds: ["track-c"], materialIds: [], archived: true },
    { id: "office-extra", kind: "office", officeId: "99", trackIds: [], materialIds: [], archived: false }
  ];
  assert.equal(belongsToGroup(user, groups[0]), true);
  assert.equal(belongsToGroup(user, groups[1]), true);
  assert.equal(belongsToGroup(user, groups[3]), true);
  const assigned = assignedGroupContent(user, groups);
  assert.deepEqual(assigned.trackIds, ["track-a", "track-b"]);
  assert.deepEqual(assigned.materialIds, ["material-a", "material-b"]);
  assert.equal(assigned.groups.length, 3);
});
