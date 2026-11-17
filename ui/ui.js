/* PocketDuet · utilidades compartidas de interfaz (sin dependencias).
   - Aplica tema y acento guardados antes de pintar (se carga en <head>, sin parpadeo).
   - Inyecta el sprite de iconos SVG: <svg class="i"><use href="#i-pause"/></svg>
   - UI.toast(), UI.icon(), UI.mountAppearance(el), UI.setTheme(), UI.setAccent()
   - Biblioteca reciente (“Continuar”): UI.recent.add()/list() */
(function () {
  "use strict";
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const root = document.documentElement;
  const ACCENTS = [["red", "#f44336", "Sandía"], ["green", "#4fa83a", "Verde"], ["blue", "#4c7dff", "Azul"], ["violet", "#9b6bff", "Violeta"], ["amber", "#e89a1f", "Ámbar"]];
  const THEMES = [["system", "Sistema"], ["dark", "Oscuro"], ["light", "Claro"]];

  function applyTheme(t) {
    if (t === "dark" || t === "light") root.setAttribute("data-theme", t); else root.removeAttribute("data-theme");
    const dark = t === "dark" || (t !== "light" && !matchMedia("(prefers-color-scheme: light)").matches);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", dark ? "#141317" : "#f4f3f0");
  }
  function applyAccent(a) { if (a && a !== "red") root.setAttribute("data-accent", a); else root.removeAttribute("data-accent"); }
  let theme = LS.get("ui.theme") || "system", accent = LS.get("ui.accent") || "red";
  applyTheme(theme); applyAccent(accent);

  const ICONS = {
    pause: '<path d="M8 5v14M16 5v14"/>', play: '<path d="M7 4.5v15l13-7.5z"/>',
    ff: '<path d="m5 5 7 7-7 7M13 5l7 7-7 7"/>', camera: '<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.6"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6 6 18"/>',
    volume: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6m0-6-5 6"/>',
    gamepad: '<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M8 10.5v4M6 12.5h4"/><circle cx="16" cy="11.5" r=".9" fill="currentColor"/><circle cx="18" cy="13.5" r=".9" fill="currentColor"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    home: '<path d="m3 11 9-7.5 9 7.5M5.5 9.5V20h13V9.5"/>', download: '<path d="M12 4v11m-5-4 5 5 5-5M5 20h14"/>', upload: '<path d="M12 16V5m-5 4 5-5 5 5M5 20h14"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.3A6 6 0 0 1 21.5 20"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.4-1-2.6 0-1 .8-1.6 1.8-1.6H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10.5" cy="7" r="1" fill="currentColor"/><circle cx="15.5" cy="7.5" r="1" fill="currentColor"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', chev: '<path d="m9 5 7 7-7 7"/>',
  };
  function icon(name, cls) { return '<svg class="i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function mountSprite() {
    if (document.getElementById("ui-sprite")) return;
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.id = "ui-sprite"; s.setAttribute("width", "0"); s.setAttribute("height", "0"); s.setAttribute("aria-hidden", "true"); s.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    s.innerHTML = Object.entries(ICONS).map(([n, d]) => '<symbol id="i-' + n + '" viewBox="0 0 24 24">' + d + "</symbol>").join("");
    document.body.prepend(s);
  }
  // sustituye <i data-i="pause"></i> por el icono
  function hydrate(scope) {
    for (const el of (scope || document).querySelectorAll("[data-i]")) {
      const sz = el.dataset.size ? " " + el.dataset.size : "";
      el.outerHTML = icon(el.dataset.i, (el.className || "") + sz);
    }
  }

  let toastT;
  function toast(msg, ms) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.append(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms || 2600);
  }

  /** Controles de apariencia (tema + acento) en cualquier contenedor. */
  function mountAppearance(el) {
    if (!el) return;
    el.innerHTML = "";
    const seg = document.createElement("div"); seg.className = "seg"; seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Tema de la interfaz");
    for (const [v, n] of THEMES) {
      const b = document.createElement("button"); b.type = "button"; b.textContent = n; b.dataset.v = v; b.className = v === theme ? "on" : "";
      b.onclick = () => { setTheme(v); for (const x of seg.children) x.classList.toggle("on", x === b); };
      seg.append(b);
    }
    const dots = document.createElement("div"); dots.className = "ap-dots"; dots.style.marginTop = "12px"; dots.setAttribute("role", "group"); dots.setAttribute("aria-label", "Color de acento");
    for (const [v, c, n] of ACCENTS) {
      const b = document.createElement("button"); b.type = "button"; b.className = "ap-dot"; b.style.background = c; b.title = n; b.setAttribute("aria-label", n); b.setAttribute("aria-pressed", String(v === accent));
      b.onclick = () => { setAccent(v); for (const x of dots.children) x.setAttribute("aria-pressed", String(x === b)); };
      dots.append(b);
    }
    el.append(seg, dots);
  }
  function setTheme(t) { theme = t; LS.set("ui.theme", t); applyTheme(t); }
  function setAccent(a) { accent = a; LS.set("ui.accent", a); applyAccent(a); }

  /* biblioteca reciente: [{t:"gba"|"nds", id, name, code, at}] */
  const RK = "ui.recent.v1";
  const recent = {
    list() { try { return JSON.parse(LS.get(RK) || "[]"); } catch { return []; } },
    add(item) {
      const l = recent.list().filter((x) => !(x.t === item.t && x.name === item.name));
      l.unshift({ ...item, at: Date.now() }); LS.set(RK, JSON.stringify(l.slice(0, 12)));
    },
    remove(t, name) { LS.set(RK, JSON.stringify(recent.list().filter((x) => !(x.t === t && x.name === name)))); },
  };
  const favs = {
    key: "ui.favs.v1",
    all() { try { return new Set(JSON.parse(LS.get("ui.favs.v1") || "[]")); } catch { return new Set(); } },
    has(k) { return favs.all().has(k); },
    toggle(k) { const s = favs.all(); s.has(k) ? s.delete(k) : s.add(k); LS.set("ui.favs.v1", JSON.stringify([...s])); return s.has(k); },
  };

  /* pending ROM: the library/landing stores a File, then opens the matching player. */
  function openRomDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB no disponible"));
      const req = indexedDB.open("pocketduet-roms", 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains("pending")) db.createObjectStore("pending"); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  const pendingRom = {
    async put(file) {
      const db = await openRomDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("pending", "readwrite");
        tx.objectStore("pending").put(file, "rom");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    async take() {
      const db = await openRomDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("pending", "readwrite");
        const store = tx.objectStore("pending");
        const get = store.get("rom");
        get.onsuccess = () => {
          const file = get.result || null;
          store.delete("rom");
          tx.oncomplete = () => { db.close(); resolve(file); };
        };
        get.onerror = () => { db.close(); reject(get.error); };
      });
    },
  };

  window.UI = { icon, hydrate, toast, mountAppearance, setTheme, setAccent, recent, favs, ls: LS, pendingRom, get theme() { return theme; }, get accent() { return accent; } };
  const ready = () => { mountSprite(); hydrate(); };
  if (document.body) ready(); else document.addEventListener("DOMContentLoaded", ready);
})();
