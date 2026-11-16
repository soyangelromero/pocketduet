/* Smoke test: the web app starts on a fresh clone (no ROMs, empty libraries) and serves every entry point. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("fresh install serves the hub, both players, the vendored port and empty libraries", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "emerald-web-"));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: "0",
      HOST: "127.0.0.1",
      NDS_ROMS: join(tmp, "nds"),
      GBA_ROMS: join(tmp, "gba"),
      NDS_BIOS: join(tmp, "bios"),
      DATA_DIR: join(tmp, "data"),
    },
  });
  try {
    const port = await new Promise((resolvePort, reject) => {
      const timer = setTimeout(() => reject(new Error("server did not start")), 20000);
      child.stdout.on("data", (chunk) => {
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(String(chunk));
        if (match) { clearTimeout(timer); resolvePort(Number(match[1])); }
      });
      child.on("error", reject);
      child.on("exit", (code) => reject(new Error(`server exited early (${code})`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const get = async (path) => { const r = await fetch(base + path); return { status: r.status, type: r.headers.get("content-type") ?? "", text: await r.text() }; };

    for (const path of ["/", "/nds/", "/gba/", "/ui/ui.js", "/ui/ui.css", "/ui/player.css", "/coi-sw.js", "/nds/wasm/js/melonds.js", "/nds/wasm/dist/melonds.js", "/nds/wasm/dist/melonds.wasm", "/nds/wasm/adapters/webapp-adapter.js"]) {
      const r = await get(path);
      assert.equal(r.status, 200, `${path} -> ${r.status}`);
    }
    const nds = await get("/nds/api/roms");
    assert.equal(nds.status, 200);
    assert.deepEqual(JSON.parse(nds.text), [], "fresh clone must not contain NDS ROMs");
    const gba = await get("/gba/api/roms");
    assert.equal(gba.status, 200);
    assert.deepEqual(JSON.parse(gba.text), [], "fresh clone must not contain GBA ROMs");
    assert.equal((await get("/nds/api/rom/0")).status, 404);
    assert.equal((await get("/nds/wasm/third_party/secret.js")).status, 404, "the port whitelist must stay narrow");
    const coop = await fetch(`${base}/nds/`);
    assert.equal(coop.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(coop.headers.get("cross-origin-embedder-policy"), "require-corp");
  } finally {
    child.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
});
