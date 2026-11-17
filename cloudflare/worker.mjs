// Static PocketDuet demo on Cloudflare Workers Assets.
// The Worker serves the app and provides the few API endpoints the players need,
// with two tiny open-source demo ROMs (no commercial games are hosted).

const NDS_ROM = {
  id: 0,
  file: "nmap.nds",
  name: "nmap",
  size: 266240,
  code: "NMAP",
  title: "nmap",
  hasSav: false,
};

const GBA_ROMS = [
  { id: 0, file: "hello.gba", base: "hello", name: "Hello GBA", size: 1300, title: "HELLO", code: "HELLO", hasSav: false },
  { id: 1, file: "shades.gba", base: "shades", name: "Shades", size: 352, title: "SHADES", code: "SHADES", hasSav: false },
  { id: 2, file: "stripes.gba", base: "stripes", name: "Stripes", size: 324, title: "STRIPES", code: "STRIPES", hasSav: false },
];

const ISOLATION_HEADERS = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "cross-origin",
};

function withIsolation(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(ISOLATION_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data, status = 200) {
  return withIsolation(
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    }),
  );
}

const romOf = (request, env, path) => {
  const url = new URL(request.url);
  url.pathname = path;
  return env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/nds" || path === "/gba") {
      return Response.redirect(`${url.origin}${path}/${url.search}`, 301);
    }

    // The library links to /nds/?play=N; force the local WASM core in the demo
    // (the default core is EmulatorJS, which needs an external CDN and is not part of the demo).
    if (path === "/nds/" && url.searchParams.has("play") && !url.searchParams.has("engine") && !url.searchParams.has("core")) {
      url.searchParams.set("engine", "wasm");
      return Response.redirect(url.toString(), 302);
    }

    if (path === "/nds/api/roms") return json([NDS_ROM]);
    if (path === "/gba/api/roms") return json(GBA_ROMS);
    if (path === "/nds/api/rom/0") return withIsolation(await romOf(request, env, "/demo-assets/nmap.nds"));

    const gba = /^\/gba\/api\/rom\/(\d+)$/.exec(path);
    if (gba) {
      const rom = GBA_ROMS[Number(gba[1])];
      if (!rom) return json({ error: "not found" }, 404);
      return withIsolation(await romOf(request, env, `/demo-assets/${rom.file}`));
    }

    // The demo does not persist saves. Answer the players' save calls so they can
    // still start and play; a real deployment can point these at KV or R2.
    if (path.startsWith("/nds/api/sav/") || path.startsWith("/gba/api/sav/")) {
      if (request.method === "PUT" || request.method === "POST") return withIsolation(new Response(null, { status: 204 }));
      return new Response(null, { status: 404, headers: ISOLATION_HEADERS });
    }

    return withIsolation(await env.ASSETS.fetch(request));
  },
};
