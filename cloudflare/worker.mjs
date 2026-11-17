// Static PocketDuet demo on Cloudflare Workers Assets.
// The demo contains no games, BIOS or saves. It shows the app and lets visitors
// load their own ROMs through the players' file pickers.

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/nds" || path === "/gba") {
      return Response.redirect(`${url.origin}${path}/${url.search}`, 301);
    }

    // The library is empty by design: this demo does not ship any ROMs.
    if (path === "/nds/api/roms" || path === "/gba/api/roms") return json([]);
    if (path.startsWith("/nds/api/rom/") || path.startsWith("/gba/api/rom/")) return json({ error: "not found" }, 404);

    // No persistence in the public demo. Answer save calls without storing anything.
    if (path.startsWith("/nds/api/sav/") || path.startsWith("/gba/api/sav/")) {
      if (request.method === "PUT" || request.method === "POST") return withIsolation(new Response(null, { status: 204 }));
      return new Response(null, { status: 404, headers: ISOLATION_HEADERS });
    }

    return withIsolation(await env.ASSETS.fetch(request));
  },
};
