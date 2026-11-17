import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(here, "dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "nds", "wasm"), { recursive: true });
mkdirSync(join(out, "gba"), { recursive: true });
mkdirSync(join(out, "ui"), { recursive: true });

// Demo landing page: explains that there are no ROMs and links to both players.
cpSync(join(here, "landing.html"), join(out, "index.html"));
cpSync(join(root, "nds"), join(out, "nds"), { recursive: true });
cpSync(join(root, "site"), join(out, "gba"), { recursive: true });
cpSync(join(root, "ui"), join(out, "ui"), { recursive: true });
cpSync(join(root, "vendor", "melonds"), join(out, "nds", "wasm"), { recursive: true });
cpSync(join(root, "coi-sw.js"), join(out, "coi-sw.js"));
cpSync(join(root, "docs", "assets", "banner-en.png"), join(out, "og.png"));

console.log(`demo built in ${out} (no ROMs)`);
