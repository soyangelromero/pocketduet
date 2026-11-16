import http from "node:http";
import { readFile, writeFile, readdir, stat, mkdir, rename } from "node:fs/promises";
import { createReadStream, openSync, readSync, closeSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { Server as IOServer } from "socket.io";

const here = import.meta.dirname;

/* ---------- configurable paths (ROMs/BIOS are never committed) ---------- */
const GBA_ROOT = join(here, "site");
const GBA_ROMS = process.env.GBA_ROMS || join(here, "roms", "gba");
const GBA_SAVES = process.env.GBA_SAVES || join(here, "data", "gba-saves");
const HOME_ROOT = join(here, "home");

/* ---------- NDS ---------- */
const NDS_ROOT = join(here, "nds");
const NDS_ROMS = process.env.NDS_ROMS || join(here, "roms", "nds");
const NDS_BIOS = process.env.NDS_BIOS || join(here, "roms", "bios");
const WASM_ROOT = process.env.MELONDS_ROOT || join(here, "vendor", "melonds"); // served at /nds/wasm/
const DATA_DIR = process.env.DATA_DIR || join(here, "data");
const BIOS_MAP = { "bios7.bin": "biosnds7.rom", "bios9.bin": "biosnds9.rom", "firmware.bin": "firmware.bin" };

const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png",
  ".webp": "image/webp", ".ico": "image/x-icon", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

/** The owner asked for the whole ROM library to be reachable through the tunnel, so no access check. */
function trusted() { return true; }

async function serveStatic(root, rel, res) {
  const p = normalize(decodeURIComponent(rel)).replace(/^[\\/]+/, "");
  const file = join(root, p || "index.html");
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const s = await stat(file);
    const target = s.isDirectory() ? join(file, "index.html") : file;
    const data = await readFile(target);
    res.writeHead(200, { "content-type": types[extname(target)] ?? "application/octet-stream", "cache-control": "no-cache" }).end(data);
  } catch { res.writeHead(404).end("not found"); }
}

function readHeader(path) {
  const fd = openSync(path, "r"); const b = Buffer.alloc(0x20);
  try { readSync(fd, b, 0, 0x20, 0); } finally { closeSync(fd); }
  return { title: b.subarray(0, 12).toString("latin1").replace(/\0+$/, ""), code: b.subarray(12, 16).toString("latin1") };
}

let ndsCache = null;
async function ndsList() {
  if (ndsCache && Date.now() - ndsCache.t < 15000) return ndsCache.list;
  const list = [];
  try {
    const names = (await readdir(NDS_ROMS)).filter(n => n.toLowerCase().endsWith(".nds")).sort();
    for (const [i, n] of names.entries()) {
      const path = join(NDS_ROMS, n), s = await stat(path), h = readHeader(path);
      const base = n.replace(/\.nds$/i, "");
      list.push({ id: i, file: n, name: base.replace(/^[\w]{1,6} - /, "").replace(/\s*\[[^\]]*\]/g, "").trim(), size: s.size, code: h.code, title: h.title, hasSav: existsSync(join(NDS_ROMS, base + ".sav")) });
    }
  } catch {}
  ndsCache = { t: Date.now(), list };
  return list;
}

function streamRange(req, res, path, size, type) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  let start = 0, end = size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], size - 1); } else { start = Math.max(0, size - +m[2]); }
    status = 206;
  }
  const headers = { "content-type": type, "accept-ranges": "bytes", "content-length": end - start + 1, "cache-control": "private, max-age=600" };
  if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  const rs = createReadStream(path, { start, end });
  rs.on("error", () => res.destroy());
  res.on("close", () => rs.destroy());
  rs.pipe(res);
}

let gbaCache = null;
async function gbaList() {
  if (gbaCache && Date.now() - gbaCache.t < 15000) return gbaCache.list;
  const list = [];
  try {
    const names = (await readdir(GBA_ROMS)).filter(n => n.toLowerCase().endsWith(".gba")).sort();
    for (const [i, n] of names.entries()) {
      const path = join(GBA_ROMS, n), s = await stat(path);
      const fd = openSync(path, "r"); const b = Buffer.alloc(0x10);
      try { readSync(fd, b, 0, 0x10, 0xA0); } finally { closeSync(fd); }
      const base = n.replace(/\.gba$/i, "");
      const has = existsSync(join(GBA_SAVES, base + ".sav")) || existsSync(join(GBA_ROMS, base + ".sav"));
      list.push({ id: i, file: n, base, name: base.replace(/\s*\[[^\]]*\]/g, "").trim(), size: s.size, title: b.subarray(0, 12).toString("latin1").replace(/\0+$/, ""), code: b.subarray(12, 16).toString("latin1"), hasSav: has });
    }
  } catch {}
  gbaCache = { t: Date.now(), list };
  return list;
}

/* ---------- cover art (libretro-thumbnails, cached on disk; never committed) ---------- */
const ART_DIR = join(DATA_DIR, "art");
const ART_SYS = { gba: "Nintendo - Game Boy Advance", nds: "Nintendo - Nintendo DS" };
function artNames(base) {
  let n = base.replace(/^[A-Za-z]{0,2}\d+ - /, "").replace(/\s*\[[^\]]*\]/g, "").replace(/\s*\((patched|hack|translated)[^)]*\)/gi, "").trim();
  const out = [n];
  out.push(n.replace(/\s*\((NDSi Enhanced|Rev \d+|v[\d.]+)\)/gi, "").trim());
  const first = n.match(/^[^(]*\([^)]*\)/); if (first) out.push(first[0].trim());
  return [...new Set(out)].map(x => x.replace(/[&*\/:`<>?\|]/g, "_"));
}
async function artFor(sys, base) {
  await mkdir(ART_DIR, { recursive: true });
  const key = (sys + "_" + base).replace(/[^\w.-]+/g, "_").slice(0, 150);
  const file = join(ART_DIR, key + ".png"), none = join(ART_DIR, key + ".none");
  if (existsSync(file)) return await readFile(file);
  if (existsSync(none)) return null;
  for (const name of artNames(base)) {
    try {
      const r = await fetch(`https://thumbnails.libretro.com/${encodeURIComponent(ART_SYS[sys])}/Named_Boxarts/${encodeURIComponent(name)}.png`);
      if (r.ok && (r.headers.get("content-type") || "").includes("image")) { const buf = Buffer.from(await r.arrayBuffer()); await writeFile(file, buf); return buf; }
    } catch {}
  }
  await writeFile(none, "");
  return null;
}

const rooms = new Map();

/* ---------- HTTP ---------- */
// Optional access key for exposing the hub outside the PC: set ACCESS_KEY and every request needs ?k=KEY or the
// cookie it sets. Empty (the default) keeps the open-library behaviour the owner chose for the local tunnel.
const ACCESS_KEY = process.env.ACCESS_KEY || "";
function authorized(req, url) {
  if (!ACCESS_KEY) return true;
  if (url.searchParams.get("k") === ACCESS_KEY) return true;
  return (req.headers.cookie || "").split(/;\s*/).includes("k=" + ACCESS_KEY);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  if (!authorized(req, url)) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("Acceso restringido: falta la clave. Abre la dirección con ?k=TU_CLAVE al final.");
    return;
  }
  if (ACCESS_KEY && url.searchParams.get("k") === ACCESS_KEY) {
    res.setHeader("set-cookie", `k=${ACCESS_KEY}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  }
  if (path.startsWith("/socket.io")) return; // handled by socket.io (the cookie above authorises it)

  // netplay room list (EmulatorJS protocol)
  if (path === "/list") {
    const gid = url.searchParams.get("game_id");
    const out = {};
    for (const [sid, r] of rooms) {
      if (gid && String(r.gameId) !== String(gid)) continue;
      out[sid] = { room_name: r.name, current: Object.keys(r.users).length, max: r.max, hasPassword: !!r.password, game_id: r.gameId, game: r.game || "" };
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(out));
    return;
  }

  // NDS: ROM library (only from this PC or with the access key)
  if (path === "/nds/api/roms") {
    if (!trusted(req, url)) { res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "locked" })); return; }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(await ndsList()));
    return;
  }
  const bm = /^\/nds\/api\/bios\/([\w.]+)$/.exec(path);
  if (bm) {
    const f = BIOS_MAP[bm[1]];
    try { if (!f) throw 0; const data = await readFile(join(NDS_BIOS, f)); res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "private, max-age=3600" }).end(data); }
    catch { if (!res.headersSent) res.writeHead(404).end("nf"); }
    return;
  }
  const rm = /^\/nds\/api\/(rom|sav)\/(\d+)$/.exec(path);
  if (rm) {
    if (!trusted(req, url)) { res.writeHead(403).end("locked"); return; }
    const rom = (await ndsList())[+rm[2]];
    if (!rom) { res.writeHead(404).end("nf"); return; }
    const base = rom.file.replace(/\.nds$/i, "");
    if (rm[1] === "sav" && (req.method === "PUT" || req.method === "POST")) {
      // Third save layer of the plan: write the .sav next to the ROM, with a .bak copy and an atomic rename.
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const bytes = Buffer.concat(chunks);
      if (!bytes.length || bytes.length > 16 * 1048576) { res.writeHead(400).end("bad size"); return; }
      const target = join(NDS_ROMS, base + ".sav");
      try {
        if (existsSync(target)) await writeFile(target + ".bak", await readFile(target));
        await writeFile(target + ".tmp", bytes);
        await rename(target + ".tmp", target);
        ndsCache = null;
        res.writeHead(204, { "cache-control": "no-store" }).end();
      } catch { res.writeHead(500).end("write failed"); }
      return;
    }
    const file = rm[1] === "rom" ? join(NDS_ROMS, rom.file) : join(NDS_ROMS, base + ".sav");
    try { streamRange(req, res, file, (await stat(file)).size, "application/octet-stream"); } catch { res.writeHead(404).end("nf"); }
    return;
  }
  if (path === "/nds/api/public") {
    let pub = "";
    try {
      // Only trust tunnel.log while the tunnel is actually writing it: a stale log means the URL is dead
      // (Cloudflare quick tunnels are ephemeral and the domain stops resolving when the process exits).
      const logPath = join(here, "tunnel.log");
      const info = await stat(logPath);
      const fresh = Date.now() - info.mtimeMs < 5 * 60 * 1000;
      if (fresh) {
        const m = (await readFile(logPath, "utf8")).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
        pub = m ? m[m.length - 1] : "";
      }
    } catch {}
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ url: pub }));
    return;
  }
  if (path.startsWith("/ui/")) { await serveStatic(join(here, "ui"), path.slice(4), res); return; }
  if (path === "/coi-sw.js") { await serveStatic(here, "coi-sw.js", res); return; }
  if (path === "/nds") { res.writeHead(301, { location: "/nds/" + url.search }).end(); return; }
  // The melonDS-WASM port (Phase 11): only its static, browser-facing folders are exposed. `demo` lets the hub serve
  // the standalone demo/host page under the same origin (so socket.io is same-origin and COOP/COEP are already set).
  if (path.startsWith("/nds/wasm/")) {
    const rel = decodeURIComponent(path.slice("/nds/wasm/".length));
    if (!/^(dist|js|adapters|demo)\//.test(rel)) { res.writeHead(404).end("nf"); return; }
    await serveStatic(WASM_ROOT, rel, res);
    return;
  }
  if (path.startsWith("/nds/")) { await serveStatic(NDS_ROOT, path.slice(5), res); return; }

  // cover art
  const am = /^\/art\/(gba|nds)\/(\d+)$/.exec(path);
  if (am) {
    const g = (await (am[1] === "gba" ? gbaList() : ndsList()))[+am[2]];
    const buf = g ? await artFor(am[1], g.base || g.file.replace(/\.nds$/i, "")) : null;
    if (!buf) { res.writeHead(404, { "cache-control": "public, max-age=300" }).end("nf"); return; }
    res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=604800" }).end(buf);
    return;
  }
  // GBA library
  if (path === "/gba/api/roms") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(await gbaList()));
    return;
  }
  const gm = /^\/gba\/api\/(rom|sav)\/(\d+)$/.exec(path);
  if (gm) {
    const g = (await gbaList())[+gm[2]];
    if (!g) { res.writeHead(404).end("nf"); return; }
    try {
      if (gm[1] === "rom") { const f = join(GBA_ROMS, g.file); streamRange(req, res, f, (await stat(f)).size, "application/octet-stream"); return; }
      const mine = join(GBA_SAVES, g.base + ".sav");
      if (req.method === "PUT" || req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        if (body.length < 512 || body.length > 262144 + 64) { res.writeHead(400).end("bad size"); return; }
        await mkdir(GBA_SAVES, { recursive: true });
        await writeFile(mine, body);
        gbaCache = null;
        res.writeHead(204).end(); return;
      }
      const f = existsSync(mine) ? mine : join(GBA_ROMS, g.base + ".sav");
      const data = await readFile(f);
      res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" }).end(data);
    } catch { if (!res.headersSent) res.writeHead(404).end("nf"); }
    return;
  }
  if (path === "/gba") { res.writeHead(301, { location: "/gba/" + url.search }).end(); return; }
  if (path.startsWith("/gba/")) { await serveStatic(GBA_ROOT, path.slice(5), res); return; }
  await serveStatic(HOME_ROOT, path, res);
});

/* ---------- Netplay signaling (EmulatorJS-compatible) ---------- */
const io = new IOServer(server, {
  maxHttpBufferSize: 1e6,
  // socket.io (engine.io) intercepts /socket.io requests before the HTTP handler above, so the ACCESS_KEY check has to be
  // repeated here; otherwise the signaling server would accept anonymous connections even with a key configured.
  allowRequest: (req, callback) => {
    const url = new URL(req.url ?? "/", "http://x");
    callback(null, authorized(req, url));
  },
});

function leave(socket) {
  const sid = socket.data.room;
  if (!sid) return;
  const r = rooms.get(sid);
  socket.leave(sid); socket.data.room = null;
  if (!r) return;
  for (const [uid, u] of Object.entries(r.users)) if (u.socketId === socket.id) delete r.users[uid];
  if (r.owner === socket.id || !Object.keys(r.users).length) { rooms.delete(sid); io.to(sid).emit("users-updated", {}); io.in(sid).socketsLeave(sid); }
  else io.to(sid).emit("users-updated", r.users);
}

io.on("connection", socket => {
  socket.on("open-room", (d, cb) => {
    try {
      const extra = d?.extra || {}, sid = extra.sessionid;
      if (!sid || rooms.has(sid)) return cb?.("Room error");
      const r = { name: extra.room_name || "Sala", gameId: extra.game_id, game: extra.game_name || "", max: Math.min(Math.max(+d.maxPlayers || 2, 2), 4), password: d.password || "", owner: socket.id, users: {} };
      r.users[extra.userid] = { ...extra, socketId: socket.id };
      rooms.set(sid, r); socket.join(sid); socket.data.room = sid;
      cb?.(null);
      io.to(sid).emit("users-updated", r.users);
    } catch { cb?.("Room error"); }
  });
  socket.on("join-room", (d, cb) => {
    const extra = d?.extra || {}, r = rooms.get(extra.sessionid);
    if (!r) return cb?.("Room not found");
    if (r.password && r.password !== d.password) return cb?.("Wrong password");
    if (Object.keys(r.users).length >= r.max) return cb?.("Room is full");
    r.users[extra.userid] = { ...extra, socketId: socket.id };
    socket.join(extra.sessionid); socket.data.room = extra.sessionid;
    cb?.(null, r.users);
    io.to(extra.sessionid).emit("users-updated", r.users);
  });
  socket.on("data-message", d => { if (socket.data.room) socket.to(socket.data.room).emit("data-message", d); });
  socket.on("webrtc-signal", d => { if (d?.target) io.to(d.target).emit("webrtc-signal", { ...d, sender: socket.id }); });
  socket.on("leave-room", () => leave(socket));
  socket.on("disconnect", () => leave(socket));
});

process.on("uncaughtException", e => console.error("uncaught", e));
for (const dir of [GBA_ROMS, NDS_ROMS, NDS_BIOS, GBA_SAVES, ART_DIR]) await mkdir(dir, { recursive: true });

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, HOST, () => console.log(`http://${HOST}:${server.address().port}`));
