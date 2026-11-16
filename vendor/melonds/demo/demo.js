import { VideoPlayer, SCANLINES, LAYOUT_LABELS } from "../js/player.js";
import { BUTTON_MASK } from "../js/input.js";

const $ = (id) => document.getElementById(id);
const canvas = $("screen"), msg = $("msg");
const params = new URLSearchParams(location.search);
let player = null;
let detachInput = [];   // Phase 5: keyboard / gamepad / pointer listeners of the current player

$("s-coi").textContent = String(self.crossOriginIsolated);
for (const label of LAYOUT_LABELS) $("layout").add(new Option(label, label));
if (params.get("backend") === "canvas2d") $("canvas2d").checked = true;
if (params.get("threads") === "0") $("threaded").checked = false;

let romKey = null, quick = null, saveEvents = 0;
// Third save layer (decision 0.0 #2): a .sav file on the user's PC via the File System Access API. The handle lives in
// memory only; the file is read when a ROM is loaded and (optionally) written on every in-game save. If the browser save
// and the PC file disagree, the user is asked which one to load; nothing is overwritten silently.
let pcSaveHandle = null, fsaWrites = 0;
const fsaSupported = () => typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function";
function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
async function writePcSave(bytes) {
  if (!pcSaveHandle) return false;
  try {
    const writable = await pcSaveHandle.createWritable();
    await writable.write(bytes);
    await writable.close();
    fsaWrites++;
    $("fsaState").textContent = `vinculado: ${pcSaveHandle.name} · ${fsaWrites} escritura(s), ${bytes.length} bytes`;
    return true;
  } catch (error) {
    say(`No se pudo escribir el .sav del PC: ${error.message}`, true);
    return false;
  }
}
async function linkPcSave() {
  if (!fsaSupported()) {
    say("Este navegador no soporta la File System Access API: usa «Descargar .sav» / «Reemplazar .sav».", true);
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "Guardado de Nintendo DS", accept: { "application/octet-stream": [".sav", ".dsv", ".bin"] } }],
      multiple: false,
    });
    pcSaveHandle = handle;
    const file = await handle.getFile();
    $("fsaState").textContent = `vinculado: ${file.name} (${file.size} bytes)`;
    $("fsaHint").textContent = "Se usará como .sav inicial al cargar una ROM; si el del navegador es distinto, se pregunta. Con la casilla marcada se escribe en cada guardado.";
    $("fsaSave").disabled = !player;
    say(`Guardado del PC vinculado: ${file.name} (${file.size} bytes).`);
    if (player && file.size) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (confirm("¿Cargar ahora el .sav del PC en el juego en curso? Reinicia la partida. Cancelar = solo vincularlo para la próxima carga.")) {
        try {
          await player.saves.loadSave(bytes);
          say("Guardado del PC cargado; partida reiniciada.");
        } catch (error) {
          fail(error);
        }
      }
    }
  } catch (error) {
    if (error?.name !== "AbortError") fail(error);
  }
}

// --- tiny IndexedDB key/value store (demo convenience only; the library itself never stores anything). Same DB as demo/saves.html ---
const db = () => new Promise((resolve, reject) => { const r = indexedDB.open("melonds-wasm-demo", 1); r.onupgradeneeded = () => r.result.createObjectStore("saves"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
async function idb(mode, fn) { const d = await db(); return new Promise((resolve, reject) => { const t = d.transaction("saves", mode); const req = fn(t.objectStore("saves")); t.oncomplete = () => resolve(req?.result); t.onerror = () => reject(t.error); }); }
const storeGet = (k) => idb("readonly", (st) => st.get(k)).catch(() => undefined);
const storePut = (k, v) => idb("readwrite", (st) => st.put(v, k));
const storeDel = (k) => idb("readwrite", (st) => st.delete(k));
const download = (bytes, name) => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([bytes])), download: name }); a.click(); URL.revokeObjectURL(a.href); };
const romKeyOf = (rom) => `${new TextDecoder().decode(rom.subarray(0x0c, 0x10))}:${new TextDecoder().decode(rom.subarray(0, 12)).replace(/\0/g, "").trim()}`;
const fail = (e) => { say(`${e.code ?? "error"}: ${e.message}`, true); console.error(e); };
const setEnabled = (on, hasSave) => {
  for (const id of ["qsave", "qload", "dlState", "loadState", "cheatOn", "cheatOff", "cheatClear"]) $(id).disabled = !on;
  for (const id of ["dlSave", "loadSave", "clearStore"]) $(id).disabled = !(on && hasSave);
};

const say = (text, error = false) => { msg.textContent = text; msg.classList.toggle("err", error); };
if (!self.crossOriginIsolated) say("Esta página no está aislada (COOP/COEP). Sírvela con `npm run serve` y abre http://127.0.0.1:8080/demo/", true);

async function loadRom(file) {
  say("Cargando…");
  detachInput.forEach((f) => f()); detachInput = [];
  if (player) { await player.dispose(); player = null; }
  setEnabled(false);
  const rom = new Uint8Array(await file.arrayBuffer()); // stays in this tab: no upload, no network
  romKey = romKeyOf(rom); quick = null; saveEvents = 0;
  let save = null, origin = "ninguno (partida nueva)";
  const picked = $("sav").files[0];
  if (picked) { save = new Uint8Array(await picked.arrayBuffer()); origin = `archivo ${picked.name} (${save.length} bytes)`; }
  else if ($("persist").checked) { const stored = await storeGet(romKey); if (stored) { save = new Uint8Array(stored); origin = `IndexedDB: «Continuar» (${save.length} bytes)`; } }
  // Linked .sav from the PC: used as the starting save when there is none, or after asking if the browser one differs.
  if (pcSaveHandle) {
    try {
      const file = await pcSaveHandle.getFile();
      const pcBytes = new Uint8Array(await file.arrayBuffer());
      if (!save || !save.length) {
        save = pcBytes;
        origin = `archivo vinculado ${file.name} (${pcBytes.length} bytes)`;
      } else if (!sameBytes(save, pcBytes)) {
        const usePc = confirm(`Hay dos guardados distintos para esta ROM: el del PC (${pcBytes.length} bytes) y el del navegador (${save.length} bytes). ¿Usar el del PC? Cancelar = usar el del navegador (no se sobrescribe nada hasta que guardes).`);
        if (usePc) { save = pcBytes; origin = `archivo vinculado ${file.name} (${pcBytes.length} bytes)`; }
        else origin += ` · no se usó el .sav vinculado (${file.name})`;
      } else {
        origin += ` · coincide con el .sav vinculado (${file.name})`;
      }
    } catch (error) {
      pcSaveHandle = null;
      say(`El .sav del PC ya no está accesible: ${error.message}`, true);
    }
  }
  try {
    player = await VideoPlayer.create({
      canvas, container: $("stage"), moduleUrl: new URL("../dist/melonds.js", import.meta.url),
      backend: $("canvas2d").checked ? "canvas2d" : "auto", threadedRenderer: $("threaded").checked,
      audioLatencyMs: +$("latency").value, audioIgnoreActivation: params.get("autoplay") === "1",
      audioCapture: params.get("capture") === "1", audioSampleRate: params.get("audiorate") ? +params.get("audiorate") : undefined,
      onStatus: (m) => { if (m.level === "err" && /error|abort/i.test(m.text)) console.warn(m.text); },
    });
    player.on("error", (e) => say(`${e.code ?? "error"}: ${e.message}`, true));
    // Re-apply the controls that were chosen before the ROM existed.
    player.setLayout($("layout").value); player.setScreenGap(+$("gap").value); player.setHybridSmallScreen($("hybrid").value);
    applyFilter(); player.setScaling({ integer: $("integer").checked, smooth: $("smooth").checked });
    player.setSpeed(+$("speed").value);
    player.setVolume(+$("volume").value / 100); player.setMuted($("mute").checked);
    let loaded = null;
    player.on("loaded", (m) => { loaded = m; });
    await player.loadRom(rom, { save });
    $("s-savetype").textContent = loaded ? `${loaded.saveType}${loaded.saveLen ? ` · ${loaded.saveLen} bytes` : ""}${loaded.saveStatus === 1 ? " · el .sav tenía otra longitud (rellenado/truncado)" : ""}` : "—";
    $("s-origin").textContent = origin;
    $("s-save").textContent = "— (todavía no ha escrito el juego)";
    $("s-cheats").textContent = "ninguno"; cheatState.clear();
    player.saves.onSave(async (bytes) => {
      saveEvents++;
      $("s-save").textContent = `#${saveEvents} ${new Date().toLocaleTimeString()} · ${bytes.length} bytes`;
      if ($("persist").checked) await storePut(romKey, bytes);
      if (pcSaveHandle && $("fsaAuto").checked) await writePcSave(bytes);
    }, 500);
    detachInput = [player.attachKeyboard(), player.attachGamepad(), player.attachPointer()]; // arrows/Space no longer scroll
    player.start();
    $("pause").disabled = $("shot").disabled = $("bench").disabled = false;
    $("fsaSave").disabled = !pcSaveHandle;
    setEnabled(true, !!loaded?.saveLen);
    say("");
    window.__demo.player = player;
  } catch (error) { say(`${error.code ?? "error"}: ${error.message}`, true); console.error(error); }
}

function applyFilter() {
  const v = $("filter").value;
  $("glsl").hidden = $("applyGlsl").hidden = v !== "custom";
  if (!player) return;
  const r = player.setPostProcess(v === "none" ? null : v === "scanlines" ? SCANLINES : { glsl: $("glsl").value });
  say(r.ok ? "" : `GLSL: ${r.error}`, !r.ok);
}

$("rom").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) loadRom(f); });
// Controls keep focus after a change; blur them so the arrow keys / Space go to the game, not to the <select>.
for (const el of document.querySelectorAll("aside select")) el.addEventListener("change", () => el.blur());
$("layout").addEventListener("change", () => player?.setLayout($("layout").value));
$("gap").addEventListener("input", () => { $("gapOut").textContent = $("gap").value; player?.setScreenGap(+$("gap").value); });
$("hybrid").addEventListener("change", () => player?.setHybridSmallScreen($("hybrid").value));
$("filter").addEventListener("change", applyFilter);
$("applyGlsl").addEventListener("click", applyFilter);
const scaling = () => player?.setScaling({ integer: $("integer").checked, smooth: $("smooth").checked });
$("integer").addEventListener("change", scaling); $("smooth").addEventListener("change", scaling);
$("volume").addEventListener("input", () => { $("volOut").textContent = $("volume").value; player?.setVolume(+$("volume").value / 100); });
$("mute").addEventListener("change", () => player?.setMuted($("mute").checked));
$("latency").addEventListener("input", () => { $("latOut").textContent = $("latency").value; });
$("audioBtn").addEventListener("click", () => player?.unlockAudio());
$("speed").addEventListener("change", () => player?.setSpeed(+$("speed").value));
$("pause").addEventListener("click", () => {
  const paused = $("pause").dataset.paused === "1";
  paused ? player.resume() : player.pause();
  $("pause").dataset.paused = paused ? "0" : "1"; $("pause").textContent = paused ? "Pausa" : "Reanudar";
});
$("shot").addEventListener("click", () => canvas.toBlob((b) => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(b), download: "melonds.png" }); a.click(); URL.revokeObjectURL(a.href); }));

// --- saves / states / cheats (phases 6 and 8) ---
$("dlSave").addEventListener("click", async () => { const b = await player.saves.getSaveNow(); if (b) download(b, "game.sav"); });
$("loadSave").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { const r = await player.saves.loadSave(new Uint8Array(await f.arrayBuffer())); say(r.resized ? "Guardado aplicado (tamaño distinto: rellenado/truncado) y juego reiniciado." : "Guardado aplicado y juego reiniciado."); } catch (err) { fail(err); } });
$("clearStore").addEventListener("click", async () => { await storeDel(romKey); say("Guardado almacenado borrado (el juego en curso no cambia)."); });
// File System Access API: feature-detect (Firefox/Safari do not have it) and wire the two buttons.
if (!fsaSupported()) {
  $("fsaHint").textContent = "Tu navegador no soporta la File System Access API (Chrome/Edge sí): usa «Descargar .sav» / «Reemplazar .sav».";
} else {
  $("fsaLink").disabled = false;
}
$("fsaLink").addEventListener("click", linkPcSave);
$("fsaSave").addEventListener("click", async () => {
  if (!player) return say("Carga una ROM primero.", true);
  const bytes = await player.saves.getSaveNow().catch(() => null);
  if (!bytes || !bytes.length) return say("Todavía no hay guardado que escribir.", true);
  if (await writePcSave(bytes)) say(`Guardado escrito en ${pcSaveHandle.name}.`);
});
$("qsave").addEventListener("click", async () => { try { quick = await player.saves.saveState(); say(`Estado rápido guardado (${(quick.length / 1048576).toFixed(1)} MiB).`); } catch (err) { fail(err); } });
$("qload").addEventListener("click", async () => { if (!quick) return say("No hay estado rápido.", true); try { await player.saves.loadState(quick); say("Estado rápido cargado."); } catch (err) { fail(err); } });
$("dlState").addEventListener("click", async () => { try { download(await player.saves.saveState(), "game.mdsstate"); } catch (err) { fail(err); } });
$("loadState").addEventListener("change", async (e) => { const f = e.target.files[0]; if (!f) return; try { await player.saves.loadState(new Uint8Array(await f.arrayBuffer())); say("Estado cargado."); } catch (err) { fail(err); } });
const cheatState = new Map();
const cheatSummary = () => { $("s-cheats").textContent = cheatState.size ? [...cheatState].map(([id, on]) => `#${id} ${on ? "ON" : "off"}`).join(" · ") : "ninguno"; };
async function setCheat(on) {
  try { const id = +$("cheatId").value; await player.setCheat(id, on, $("cheatCode").value); cheatState.set(id, on); cheatSummary(); say(`Truco #${id} ${on ? "activado" : "desactivado"}.`); }
  catch (err) { fail(err); }
}
$("cheatOn").addEventListener("click", () => setCheat(true));
$("cheatOff").addEventListener("click", () => setCheat(false));
$("cheatClear").addEventListener("click", async () => { try { await player.clearCheats(); cheatState.clear(); cheatSummary(); say("Trucos quitados."); } catch (err) { fail(err); } });
window.addEventListener("pagehide", () => { player?.saves.flush(); });

setInterval(() => {
  if (!player) return;
  const s = player.getStats();
  $("s-backend").textContent = s.backend;
  $("s-frame").textContent = `${canvas.width}x${canvas.height} (backing store) · CSS ${canvas.style.width} × ${canvas.style.height} · redimensionados ${s.canvasResizes}`;
  $("s-emu").textContent = `${s.emuFps.toFixed(1)} fps · ${s.emuMs.toFixed(2)} ms/fotograma · ${s.frameCount} fotogramas · duplicados ${s.duplicated}`;
  $("s-draw").textContent = `${s.drawFps.toFixed(1)} fps · ${s.drawnFrames} dibujados`;
  $("s-ring").textContent = `publicados ${s.ring.published} · consumidos ${s.ring.consumed} · descartados ${s.ring.dropped}`;
  $("s-workers").textContent = String(s.workers);
  const a = s.audio;
  if (a) {
    $("s-actx").textContent = `${a.contextState} · ${a.contextRate || "—"} Hz (núcleo ${a.sourceRate.toFixed(1)} Hz) · salida ≈${a.outputLatencyMs.toFixed(0)} ms · ${s.audioFeeding ? "reloj de audio = metrónomo" : "ritmo por temporizador (audio descartado)"}`;
    $("s-abuf").textContent = `${a.bufferMs.toFixed(1)} ms (objetivo ${(a.targetFrames / a.sourceRate * 1000).toFixed(0)} ms) · estado ${["cebando", "sonando", "sin datos"][a.mode]}`;
    $("s-aerr").textContent = `underruns ${a.underrunEvents} (${a.underrunFrames} muestras de silencio) · overruns ${a.overrunFrames} (descartadas) + ${a.trimmedFrames} (recortadas) · acelerado ${a.catchupFrames}`;
    const lvl = a.framesOut ? Math.sqrt(a.sumSq / a.framesOut) : 0;
    $("s-alevel").textContent = `RMS acumulado ${lvl.toFixed(4)} · pico ${a.peak.toFixed(3)} · máx. salto ${a.maxJump.toFixed(3)}`;
  }
  const p = player.input.pointer, names = Object.entries(BUTTON_MASK).filter(([, m]) => (player.input.mask & m) === m).map(([n]) => n);
  $("s-input").textContent = `${names.join("+") || "—"} · puntero ${p.pressed ? "PULSADO" : "libre"} (${p.x}, ${p.y})`;
}, 500);

// --- benchmark: samples the worker/audio stats every 250 ms while the user plays, then prints a summary ---
const stat = (xs) => { const a = [...xs].sort((x, y) => x - y); const n = a.length; return n ? { min: a[0], avg: a.reduce((s, v) => s + v, 0) / n, p5: a[Math.floor(n * 0.05)], max: a[n - 1] } : { min: 0, avg: 0, p5: 0, max: 0 }; };
let benching = false;
// Compares the emulator's measured fps with what the chosen speed needs (59.83 fps x speed).
const verdict = (speed, avg) => {
  if (!speed) return `Veredicto: «Sin límite» es el máximo que da tu equipo: ${avg.toFixed(0)} fps = ${(avg / 59.83).toFixed(1)}x tiempo real (el audio va en silencio).`;
  const need = 59.83 * speed, r = avg / need, label = speed === 1 ? "tiempo real" : `${String(speed).replace(".", ",")}x`;
  if (r >= 0.96) return `Veredicto: llega a ${label} (media ${avg.toFixed(1)} fps, objetivo ${need.toFixed(1)}).`;
  if (r >= 0.84) return `Veredicto: justo para ${label} (media ${avg.toFixed(1)} fps de ${need.toFixed(1)}): irá algo lento y el audio puede cortarse de vez en cuando.`;
  return `Veredicto: NO llega a ${label} en esta escena (media ${avg.toFixed(1)} fps de ${need.toFixed(1)}): irá más lento de lo pedido y el audio se cortará. Prueba una velocidad menor.`;
};
$("bench").addEventListener("click", async () => {
  if (!player || benching) return;
  benching = true;
  const secs = +$("benchSecs").value, out = $("benchOut"), btn = $("bench");
  out.hidden = false; $("benchCopy").hidden = true;
  const emuFps = [], emuMs = [], drawFps = [], abuf = [];
  const first = player.getStats(), a0 = first.audio, t0 = performance.now(), speed = $("speed").value;
  let last = -1;
  await new Promise((resolve) => {
    const id = setInterval(() => {
      const s = player.getStats(), left = Math.max(0, secs - (performance.now() - t0) / 1000);
      btn.textContent = `Midiendo… ${left.toFixed(0)} s (juega una escena pesada)`;
      // the worker publishes one window average every ~500 ms: keep one sample per new window
      if (s.frameCount !== last) { last = s.frameCount; emuFps.push(s.emuFps); emuMs.push(s.emuMs); drawFps.push(s.drawFps); if (s.audio) abuf.push(s.audio.bufferMs); }
      if (left <= 0) { clearInterval(id); resolve(); }
    }, 250);
  });
  const s = player.getStats(), a1 = s.audio;
  const gl = (() => { try { const g = document.createElement("canvas").getContext("webgl2"); const e = g.getExtension("WEBGL_debug_renderer_info"); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : "n/d"; } catch { return "n/d"; } })();
  const f = stat(emuFps), m = stat(emuMs), d = stat(drawFps), b = stat(abuf);
  const slow = emuMs.filter((v) => v > 16.7).length;
  // drawing diagnosis: rate of requestAnimationFrame (browser/display side) vs. what one draw() costs (our side)
  const calls = s.rafCalls - first.rafCalls, drawn = s.drawnFrames - first.drawnFrames;
  const gaps = calls ? s.rafGaps.slice(-calls) : [], costs = drawn ? s.drawCosts.slice(-drawn) : [];
  const g = stat(gaps), c = stat(costs), gp95 = gaps.length ? [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length * 0.95)] : 0;
  const late = gaps.filter((v) => v > 20).length;
  const lines = [
    `Medición de ${secs} s · ${new Date().toISOString()}`,
    `Velocidad ${+speed ? speed.replace(".", ",") + "x" : "sin límite"} · hilos 3D: ${s.workers} · dibujo: ${s.backend} · layout: ${$("layout").value}`,
    `CPU: ${navigator.hardwareConcurrency} hilos lógicos · GPU: ${gl}`,
    `Emulador (fps):        mín ${f.min.toFixed(1)} · p5 ${f.p5.toFixed(1)} · media ${f.avg.toFixed(1)} · máx ${f.max.toFixed(1)}`,
    `ms por fotograma:      media ${m.avg.toFixed(2)} · peor ventana ${m.max.toFixed(2)} (límite 16,70 para 1x) · ventanas lentas ${slow}/${emuMs.length}`,
    `Dibujado (fps):        mín ${d.min.toFixed(1)} · media ${d.avg.toFixed(1)}`,
    a1 && a0 ? `Audio: búfer mín ${b.min.toFixed(0)} · media ${b.avg.toFixed(0)} · máx ${b.max.toFixed(0)} ms · underruns +${a1.underrunEvents - a0.underrunEvents} (silencio ${a1.underrunFrames - a0.underrunFrames} muestras) · overruns +${a1.overrunFrames - a0.overrunFrames} · acelerado +${a1.catchupFrames - a0.catchupFrames}` : "Audio: sin datos (toca la página para activarlo)",
    `requestAnimationFrame: ${calls} llamadas · intervalo medio ${g.avg.toFixed(1)} ms (≈${(1000 / (g.avg || 1)).toFixed(0)} Hz) · p95 ${gp95.toFixed(1)} · máx ${g.max.toFixed(1)} · >20 ms: ${gaps.length ? ((late * 100) / gaps.length).toFixed(0) : 0} % · sin fotograma nuevo: ${s.rafEmpty - first.rafEmpty} · descartes en cola: ${s.queueDrops - first.queueDrops}`,
    `draw() en CPU: media ${c.avg.toFixed(2)} ms · máx ${c.max.toFixed(2)} ms (${drawn} dibujados)`,
    `Fotogramas del buffer de vídeo descartados: +${s.ring.dropped - first.ring.dropped} (normal si el dibujado va más lento que el emulador)`,
    verdict(+speed, f.avg),
    d.avg < 10 ? "Aviso: el dibujado fue muy bajo; la pestaña probablemente estaba en segundo plano o la ventana minimizada. Mídelo con la pestaña visible." : "",
  ].filter(Boolean);
  out.textContent = lines.join("\n");
  $("benchCopy").hidden = false;
  btn.textContent = "Medir rendimiento"; benching = false;
});
$("benchCopy").addEventListener("click", () => navigator.clipboard?.writeText($("benchOut").textContent).then(() => say("Resultado copiado."), () => say("No se pudo copiar; selecciona el texto a mano.", true)));

// Test hook (read-only helpers for tests/phase3-browser.mjs and tests/fsa-saves-browser.mjs).
window.__demo = {
  player: null,
  canvas,
  get romKey() { return romKey; },
  get fsa() { return { supported: fsaSupported(), linked: !!pcSaveHandle, name: pcSaveHandle?.name ?? "", writes: fsaWrites }; },
  linkPcSave,
  writePcSave,
};
$("s-coi").title = "audio: ?autoplay=1 ignora la política de autoplay (solo pruebas); ?capture=1 activa el anillo de captura del worklet (solo pruebas)";
