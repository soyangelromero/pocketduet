// Synchronise the prebuilt melonDS-WASM runtime in vendor/melonds from the port-melonds submodule.
//
//   git submodule update --init --recursive
//   cd port-melonds && ./scripts/build.sh          # or download a release and copy dist/
//   cd .. && npm run sync:port
//
// The web app runs from vendor/melonds, so a fresh clone works without a build. The submodule is the GPL source
// corresponding to that prebuilt runtime; update both together.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "port-melonds");
const dst = join(root, "vendor", "melonds");
if (!existsSync(join(src, "dist", "melonds.js")) || !existsSync(join(src, "dist", "melonds.wasm"))) {
  console.error("port-melonds/dist/melonds.{js,wasm} missing: build the port first or download its release artifacts.");
  process.exit(1);
}
mkdirSync(join(dst, "dist"), { recursive: true });
for (const dir of ["js", "adapters", "demo"]) {
  rmSync(join(dst, dir), { recursive: true, force: true });
  cpSync(join(src, dir), join(dst, dir), { recursive: true });
}
for (const file of ["melonds.js", "melonds.wasm"]) cpSync(join(src, "dist", file), join(dst, "dist", file));
for (const file of ["coi-sw.js", "LICENSE", "THIRD_PARTY.md"]) {
  if (existsSync(join(src, file))) cpSync(join(src, file), join(dst, file));
}
const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
console.log(`vendor/melonds synced from port-melonds ${pkg.version} (${readdirSync(join(dst, "dist")).join(", ")})`);
