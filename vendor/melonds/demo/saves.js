// Phase 6 demo: save RAM (.sav) and savestates on top of VideoPlayer. Independent of demo/demo.js on purpose.
// Persistence is a demo convenience (IndexedDB, keyed by the ROM's game code + title); the library itself never stores anything.
import { VideoPlayer } from "../js/player.js";

const $ = (id) => document.getElementById(id);
const say = (text, error = false) => { $("msg").textContent = text; $("msg").classList.toggle("err", error); };
let player = null, romKey = null, quick = null, saveEvents = 0;
$("s-coi").textContent = String(self.crossOriginIsolated);
if (!self.crossOriginIsolated) say("Esta página no está aislada (COOP/COEP). Sírvela con `npm run serve` y abre http://127.0.0.1:8080/demo/saves.html", true);

// --- tiny IndexedDB key/value store (demo only) ---
const db = () => new Promise((resolve, reject) => { const r = indexedDB.open("melonds-wasm-demo", 1); r.onupgradeneeded = () => r.result.createObjectStore("saves"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
async function idb(mode, fn) { const d = await db(); return new Promise((resolve, reject) => { const t = d.transaction("saves", mode); const req = fn(t.objectStore("saves")); t.oncomplete = () => resolve(req?.result); t.onerror = () => reject(t.error); }); }
const storeGet = (k) => idb("readonly", (s) => s.get(k));
const storePut = (k, v) => idb("readwrite", (s) => s.put(v, k));
const storeDel = (k) => idb("readwrite", (s) => s.delete(k));

const download = (bytes, name) => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([bytes])), download: name }); a.click(); URL.revokeObjectURL(a.href); };
const romKeyOf = (rom) => `${new TextDecoder().decode(rom.subarray(0x0c, 0x10))}:${new TextDecoder().decode(rom.subarray(0, 12)).replace(/\0/g, "").trim()}`;
const fail = (e) => { say(`${e.code ?? "error"}: ${e.message}`, true); console.error(e); };
const setEnabled = (on, hasSave) => { for (const id of ["qsave", "qload", "dlState", "loadState"]) $(id).disabled = !on; for (const id of ["dlSave", "loadSave", "clearStore"]) $(id).disabled = !(on && hasSave); };

async function loadRom(file) {
  say("Cargando…"); setEnabled(false);
  if (player) { await player.dispose(); player = null; }
  const rom = new Uint8Array(await file.arrayBuffer());
  romKey = romKeyOf(rom); quick = null; saveEvents = 0;
  let save = null, origin = "ninguno (partida nueva)";
  const picked = $("sav").files[0];
  if (picked) { save = new Uint8Array(await picked.arrayBuffer()); origin = `archivo ${picked.name} (${save.length} bytes)`; }
  else if ($("persist").checked) { const stored = await storeGet(romKey); if (stored) { save = new Uint8Array(stored); origin = `IndexedDB (${save.length} bytes)`; } }
  try {
    player = await VideoPlayer.create({ canvas: $("screen"), container: $("stage"), moduleUrl: new URL("../dist/melonds.js", import.meta.url), threadedRenderer: $("threaded").checked });
    player.on("error", fail);
    let loaded = null;
    player.on("loaded", (m) => { loaded = m; });
    await player.loadRom(rom, { save });
    $("s-type").textContent = loaded ? `${loaded.saveType}${loaded.saveLen ? ` · ${loaded.saveLen} bytes` : ""}${loaded.saveStatus === 1 ? " · el .sav tenía otra longitud (rellenado/truncado)" : ""}${loaded.saveStatus === 2 ? " · este juego no tiene memoria de guardado: .sav ignorado" : ""}` : "?";
    $("s-origin").textContent = origin;
    $("s-save").textContent = "— (todavía no ha escrito el juego)";
    player.saves.onSave(async (bytes) => {
      saveEvents++;
      $("s-save").textContent = `#${saveEvents} ${new Date().toLocaleTimeString()} · ${bytes.length} bytes`;
      if ($("persist").checked) await storePut(romKey, bytes);
    }, 500);
    player.start();
    setEnabled(true, !!loaded?.saveLen);
    say("");
    window.__saves = { player, get romKey() { return romKey; } };
  } catch (e) { fail(e); }
}

$("rom").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) loadRom(f); });
$("dlSave").addEventListener("click", async () => { const b = await player.saves.getSaveNow(); if (b) download(b, "game.sav"); });
$("loadSave").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { const r = await player.saves.loadSave(new Uint8Array(await f.arrayBuffer())); say(r.resized ? "Guardado aplicado (la longitud no coincidía: rellenado/truncado) y juego reiniciado." : "Guardado aplicado y juego reiniciado."); } catch (err) { fail(err); } e.target.value = ""; });
$("clearStore").addEventListener("click", async () => { await storeDel(romKey); say("Guardado almacenado borrado (el juego en curso no cambia)."); });
$("qsave").addEventListener("click", async () => { try { quick = await player.saves.saveState(); say(`Estado rápido guardado (${(quick.length / 1048576).toFixed(1)} MiB).`); } catch (err) { fail(err); } });
$("qload").addEventListener("click", async () => { if (!quick) return say("No hay estado rápido.", true); try { await player.saves.loadState(quick); say("Estado rápido cargado."); } catch (err) { fail(err); } });
$("dlState").addEventListener("click", async () => { try { download(await player.saves.saveState(), "game.mdsstate"); } catch (err) { fail(err); } });
$("loadState").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { await player.saves.loadState(new Uint8Array(await f.arrayBuffer())); say("Estado cargado."); } catch (err) { fail(err); } e.target.value = ""; });
window.addEventListener("pagehide", () => { player?.saves.flush(); });

setInterval(() => { if (player) $("s-frames").textContent = String(player.getStats().frameCount); }, 500);
