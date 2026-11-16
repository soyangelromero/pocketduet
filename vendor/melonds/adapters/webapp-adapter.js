// Phase 11: adapter that makes the web app (nds/index.html) run on this port instead of EmulatorJS.
//
// The web app talks to EmulatorJS through `window.EJS_emulator` (`ejs`) and `ejs.gameManager` (`gm`). This module
// builds an object with that shape on top of `MelonDS`, so the page's own UI (tools, cheats, saves, layouts) keeps
// working unchanged. It is deliberately dependency-free and framework-free: a plain ES module served as a static file.
//
// What is NOT covered yet (Phase 12): `ejs.netplay` (rooms/WebRTC). Until then the adapter exposes `netplay: null`
// and the page must not offer rooms when this engine is active.
import { MelonDS, LAYOUT_LABELS, FILTERS, FILTER_BY_ID } from "../js/melonds.js";

/** Web app layout names (nds/index.html CORE tables) -> API_CONTRACT table 2.1 labels. */
export const LAYOUT_MAP = Object.freeze({
  "Top/Bottom": "Top/Bottom",
  "top/bottom": "Top/Bottom",
  "Bottom/Top": "Bottom/Top",
  "Left/Right": "Left/Right",
  "left/right": "Left/Right",
  "Right/Left": "Right/Left",
  "Top Only": "Top Only",
  top: "Top Only",
  "Bottom Only": "Bottom Only",
  "Hybrid Top": "Hybrid (Focus Top)",
  "hybrid/top": "Hybrid (Focus Top)",
  "Hybrid Bottom": "Hybrid (Focus Bottom)",
  "hybrid/bottom": "Hybrid (Focus Bottom)",
});

/** Old `melonds_hybrid_small_screen` values -> contract values ("one" reads a bit odd; "both" is the old Duplicate). */
export const HYBRID_MAP = Object.freeze({ Duplicate: "both", both: "both", Top: "one", Bottom: "one", one: "one" });

const STATE_PREFIX = "mds-state:";

function domError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** IndexedDB key/value store for savestates (a state is ~18 MiB, so localStorage is not an option). */
export function openStateStore() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("emerald-web-nds", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("states");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbGet(store, key) {
  const db = await store;
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("states", "readonly").objectStore("states").get(key);
    tx.onsuccess = () => resolve(tx.result ?? null);
    tx.onerror = () => reject(tx.error);
  });
}

async function idbSet(store, key, value) {
  const db = await store;
  if (!db) return false;
  return new Promise((resolve, reject) => {
    const tx = db.transaction("states", "readwrite").objectStore("states").put(value, key);
    tx.onsuccess = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/** Turns the web app's `setVariable(key, value)` into the contract calls. Returns false when the key is unknown. */
export function applyCoreVariable(ds, key, value) {
  switch (key) {
    case "melonds_screen_layout":
    case "desmume_screens_layout": {
      const label = LAYOUT_MAP[value];
      if (!label) return false;
      ds.setLayout(label);
      return true;
    }
    case "melonds_screen_gap":
    case "desmume_screens_gap": {
      ds.setScreenGap(Number(value));
      return true;
    }
    case "melonds_hybrid_small_screen": {
      ds.setHybridSmallScreen(HYBRID_MAP[value] ?? "one");
      return true;
    }
    case "melonds_threaded_renderer": {
      // Chosen at boot (before loadRom) in this port; acknowledging avoids breaking the benchmark button.
      return false;
    }
    default:
      return false;
  }
}

/**
 * Builds the EmulatorJS-shaped facade.
 *
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas    canvas where the game is drawn
 * @param {HTMLElement} [options.container]     element that receives the keyboard/pointer listeners
 * @param {string} options.romUrl               URL to fetch the ROM from (library API or blob:)
 * @param {string|null} [options.saveUrl]       PUT target for the .sav (server-side save), optional
 * @param {string} [options.locateFile]         base URL of dist/ and js/ (defaults to the module's own tree)
 * @param {"auto"|"none"|"real"} [options.firmware] "real" loads BIOS/firmware from /nds/api/bios
 * @param {(msg: string) => void} [options.onStatus]
 */
export async function createWebappEmulator(options) {
  const {
    canvas,
    container = null,
    romUrl,
    saveUrl = null,
    fetchSave = undefined,
    locateFile,

    firmware = "none",
    onStatus = () => {},
  } = options;
  if (!canvas) throw domError("NO_CANVAS", "createWebappEmulator needs a canvas");
  const host = container ?? canvas.parentElement;

  const base = locateFile ? locateFile : new URL("../", import.meta.url).href;
  const ds = await MelonDS.create({
    canvas,
    threads: "auto",
    audio: true,
    locateFile: (name) => (name === "melonds.js" ? new URL("dist/melonds.js", base).href : new URL(`js/${name}`, base).href),
    onStatus,
  });

  // ---- firmware / BIOS (before loadRom) ----
  if (firmware === "real") {
    try {
      const [bios7, bios9, fw] = await Promise.all(
        ["bios7.bin", "bios9.bin", "firmware.bin"].map(async (name) => {
          const r = await fetch(`/nds/api/bios/${name}`);
          return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
        }),
      );
      if (bios7 && bios9) ds.setBios({ arm7: bios7, arm9: bios9 });
      if (fw) ds.setFirmware(fw, { language: 5, nickname: "melonDS" });
    } catch (error) {
      onStatus(`firmware: ${error.message}`);
    }
  }

  // ---- ROM and .sav ----
  const romResponse = await fetch(romUrl);
  if (!romResponse.ok) throw domError("ROM_FETCH", `could not fetch the ROM (${romResponse.status})`);
  const rom = new Uint8Array(await romResponse.arrayBuffer());

  let save = null;
  if (saveUrl && fetchSave !== false) {
    try {
      const r = await fetch(saveUrl);
      if (r.ok) {
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length >= 512) save = bytes;
      }
    } catch {
      /* a game without a save is normal */
    }
  }

  const info = await ds.loadRom(rom, { save });
  ds.start();

  // Fit the picture to the available box: integer scaling when it gives at least 2x (crisp pixels), otherwise fill
  // with smooth scaling (a 256x384 frame in a 800x560 stage fits 1.46x, and 1x would waste most of the screen).
  const fitScaling = () => {
    if (!canvas.width || !canvas.height || !host?.getBoundingClientRect) return;
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const scale = Math.min(box.width / canvas.width, box.height / canvas.height);
    const integer = Math.floor(scale) >= 2;
    ds.setScaling({ integer, smooth: !integer });
  };
  const scalingObserver = typeof ResizeObserver === "function" && host ? new ResizeObserver(() => fitScaling()) : null;
  scalingObserver?.observe(host);
  let scaledOnce = false;
  ds.on("frame", () => {
    if (scaledOnce || !canvas.width) return;
    scaledOnce = true;
    fitScaling();
  });
  // The AudioContext needs a gesture: unlock on the first click/tap anywhere in the page (the canvas is inside a
  // container that may not receive it, and on mobile the on-screen buttons are outside it).
  const unlock = () => {
    ds.unlockAudio().catch(() => {});
    document.removeEventListener("pointerdown", unlock, true);
    document.removeEventListener("keydown", unlock, true);
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);

  // ---- input ----
  const detachKeyboard = ds.attachKeyboard(host ?? document);
  const detachPointer = ds.attachPointer(canvas);
  let destroyed = false;

  // ---- savestates in IndexedDB ----
  const stateStore = openStateStore();
  const stateKey = `${STATE_PREFIX}${info.code || "rom"}:${rom.length}:${save ? "sav" : "nosav"}:1`;

  // ---- save sync to the server (third layer of the save policy) ----
  let lastPut = 0;
  const pushSave = async () => {
    if (!saveUrl || destroyed) return false;
    const bytes = await ds.getSaveNow().catch(() => null);
    if (!bytes || bytes.length < 512) return false;
    const response = await fetch(saveUrl, { method: "PUT", body: bytes, headers: { "content-type": "application/octet-stream" } });
    lastPut = Date.now();
    return response.ok;
  };
  ds.onSave(() => {
    pushSave().catch(() => {});
  });
  addEventListener("pagehide", () => {
    // sendBeacon cannot be cancelled, but it is the only reliable hook on mobile Safari.
    const bytes = ds.getSave();
    if (bytes && saveUrl && bytes.length >= 512) navigator.sendBeacon?.(saveUrl, bytes);
  });

  // ---- EmulatorJS-shaped facade ----
  // The web app sets the ratio first (`setFastForwardRatio`) and then toggles (`toggleFastForward(1)`), so the ratio
  // has to be remembered: 0 means "unlimited" and must not be overwritten by the generic 2x.
  let speedRatio = 1;
  const gm = {
    getFrameNum: () => ds.getFrameCount(),
    setVSync: () => {}, // the port paces itself (audio clock); EmulatorJS vsync has no equivalent
    setFastForwardRatio: (ratio) => {
      speedRatio = Number(ratio) === 0 ? 0 : Number(ratio);
      ds.setSpeed(speedRatio);
    },
    toggleFastForward: (on) => ds.setSpeed(on ? (speedRatio >= 1 ? speedRatio : 0) : 1),
    setVariable: (key, value) => applyCoreVariable(ds, key, value),
    restart: () => ds.reset(),
    getSaveFile: () => ds.getSave(),
    getSaveFilePath: () => "rom.sav",
    FS: {
      _pending: null,
      writeFile(_path, bytes) {
        this._pending = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
        return true;
      },
      readFile() {
        return this._pending ?? ds.getSave();
      },
    },
    async loadSaveFiles() {
      if (!this.FS._pending) return false;
      await ds.loadSave(this.FS._pending);
      this.FS._pending = null;
      return true;
    },
    async quickSave() {
      try {
        await idbSet(stateStore, stateKey, await ds.saveState());
        return true;
      } catch {
        return false;
      }
    },
    async quickLoad() {
      try {
        const bytes = await idbGet(stateStore, stateKey);
        if (!bytes) return false;
        await ds.loadState(bytes);
        return true;
      } catch {
        return false;
      }
    },
    setCheat: (index, enabled, code) =>
      ds.setCheat(String(index), !!enabled, code).catch((error) => {
        console.warn("[wasm] cheat rejected:", error.code ?? error.message);
      }),
    clearCheats: () => ds.clearCheats(),
  };

  const ejs = {
    gameManager: gm,
    canvas,
    config: { threads: ds.getStats().threads },
    paused: false,
    // The web app's fast-forward limiter calls these; the port already paces, so they are no-ops.
    Module: { pauseMainLoop() {}, resumeMainLoop() {} },
    pause() {
      ds.pause();
      ejs.paused = true;
    },
    play() {
      ds.resume();
      ejs.paused = false;
    },
    setVolume(v) {
      ds.setVolume(Math.min(1, Math.max(0, Number(v))));
    },
    screenshot(callback) {
      ds.screenshot().then((blob) => callback?.(blob)).catch(() => callback?.(null));
    },
    toggleFullscreen(want) {
      const target = host ?? canvas;
      if (want && !document.fullscreenElement) target.requestFullscreen?.().catch(() => {});
      else if (!want && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    },
    // Filters (js/filters.js): the page lists `shaders` / `filterList` and calls enableShader(id). Unlike EmulatorJS these
    // are the port's own GLSL, so the names are ours (sharp-bilinear, smooth, lcd, scanlines, crt, dscolor, ds-lcd).
    shaders: { disabled: true, ...Object.fromEntries(FILTERS.map((f) => [f.id, true])) },
    filterList: FILTERS.map(({ id, name, hint }) => ({ id, name, hint })),
    enableShader(name) {
      if (name === "disabled" || !name) { ds.setPostProcess(null); return true; }
      const filter = FILTER_BY_ID[name];
      if (!filter) return false;
      try { ds.setPostProcess({ glsl: filter.glsl, scale: filter.scale }); return true; }
      catch { try { ds.setPostProcess(null); } catch {} return false; } // a GPU that cannot compile it: stay sharp
    },
    // Phase 12 fills this in; until then the page must hide the room controls.
    netplay: null,
    get stats() {
      return ds.getStats();
    },
    /** Not part of the EmulatorJS API: the bridge back to the port (stats, layout labels, saves). */
    melonDS: ds,
    layoutLabels: LAYOUT_LABELS,
    async getSave() {
      return ds.getSaveNow();
    },
    pushSave,
    lastServerSave() {
      return lastPut;
    },
    async destroy() {
      destroyed = true;
      scalingObserver?.disconnect();
      detachKeyboard?.();
      detachPointer?.();
      document.removeEventListener("pointerdown", unlock, true);
      document.removeEventListener("keydown", unlock, true);
      await ds.dispose();
    },
    romInfo: info,
  };

  return ejs;
}

export default createWebappEmulator;
