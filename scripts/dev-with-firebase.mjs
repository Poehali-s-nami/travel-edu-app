import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), true);

const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (keyPath && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  try {
    const raw = readFileSync(keyPath, "utf8");
    const key = JSON.parse(raw);
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-edu-app";
    if (key.project_id !== projectId || !key.client_email || !key.private_key) {
      throw new Error("The Firebase service account does not match this project.");
    }
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = raw;
  } catch (error) {
    console.error("Cannot load the local Firebase service account:", error.message);
    process.exit(1);
  }
}

const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env }
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
