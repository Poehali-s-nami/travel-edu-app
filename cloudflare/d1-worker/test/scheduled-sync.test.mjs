import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runScheduledSync, SCHEDULED_SYNC_COLLECTIONS } from "../src/scheduled-sync.ts";

test("scheduled sync covers the three service collections in a stable order", () => {
  assert.deepEqual([...SCHEDULED_SYNC_COLLECTIONS], ["accessUsers", "loginEvents", "materialViews"]);
});

test("scheduled sync continues after one collection fails", async () => {
  const attempted = [];
  const failures = [];
  const result = await runScheduledSync(
    async (collection) => {
      attempted.push(collection);
      if (collection === "loginEvents") throw new Error("temporary failure");
    },
    (collection) => failures.push(collection)
  );
  assert.deepEqual(attempted, ["accessUsers", "loginEvents", "materialViews"]);
  assert.deepEqual(failures, ["loginEvents"]);
  assert.deepEqual(result, ["loginEvents"]);
});

test("wrangler schedules the sync for 02:15 Asia/Qyzylorda", () => {
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(config, /crons\s*=\s*\["15 21 \* \* \*"\]/);
});
