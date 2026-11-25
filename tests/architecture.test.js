import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 18788 + Math.floor(Math.random() * 1000);
const endpoint = `http://127.0.0.1:${port}/api/v1/health`;

async function waitForApi(child) {
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Typed API exited early.\n${output}`);
    try {
      const response = await fetch(endpoint);
      if (response.ok) return response;
    } catch {
      // Nest may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Typed API did not become ready.\n${output}`);
}

test("typed NestJS API exposes the shared health contract", async (t) => {
  const child = spawn(process.execPath, ["apps/api/dist/main.js"], {
    cwd: process.cwd(),
    env: { ...process.env, API_PORT: String(port), API_HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  const response = await waitForApi(child);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "api");
  assert.equal(body.architecture, "nestjs");
  assert.equal(typeof body.timestamp, "string");
});
