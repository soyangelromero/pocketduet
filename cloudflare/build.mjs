import { cpSync, mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = join(here, "dist");
const demo = join(out, "demo-assets");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "nds", "wasm"), { recursive: true });
mkdirSync(join(out, "gba"), { recursive: true });
mkdirSync(join(out, "ui"), { recursive: true });
mkdirSync(demo, { recursive: true });

cpSync(join(root, "home", "index.html"), join(out, "index.html"));
cpSync(join(root, "nds"), join(out, "nds"), { recursive: true });
cpSync(join(root, "site"), join(out, "gba"), { recursive: true });
cpSync(join(root, "ui"), join(out, "ui"), { recursive: true });
cpSync(join(root, "vendor", "melonds"), join(out, "nds", "wasm"), { recursive: true });
cpSync(join(root, "coi-sw.js"), join(out, "coi-sw.js"));
cpSync(join(root, "docs", "assets", "banner-en.png"), join(out, "og.png"));

const downloads = [
  ["https://raw.githubusercontent.com/rmn20/normalmappingds/master/dist/nmap.nds", "nmap.nds"],
  ["https://raw.githubusercontent.com/jsmolka/gba-tests/master/ppu/hello.gba", "hello.gba"],
  ["https://raw.githubusercontent.com/jsmolka/gba-tests/master/ppu/shades.gba", "shades.gba"],
  ["https://raw.githubusercontent.com/jsmolka/gba-tests/master/ppu/stripes.gba", "stripes.gba"],
];
for (const [url, file] of downloads) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 128) throw new Error(`${file} looks empty`);
  writeFileSync(join(demo, file), bytes);
  console.log(`${file}: ${statSync(join(demo, file)).size} bytes`);
}
console.log(`demo built in ${out}`);
