# PocketDuet demo on Cloudflare Workers

Live demo: **https://pocketduet-demo.soyangelromero.workers.dev**

This folder contains the static Cloudflare Worker demo of PocketDuet. It serves the web app from Workers Assets and implements a minimal API for the players.

## No demo ROMs

The demo contains **no ROMs, BIOS, firmware or saves**. The library APIs return empty lists, and there are no `/rom` assets. Visitors load their own legal ROM through the file picker:

- Nintendo DS: open `/nds/` and choose a `.nds` file.
- Game Boy Advance: open `/gba/`, open the *Partida* panel and use *Cargar otra ROM*.

The landing page at `/` explains this and includes a **Cargar ROM** button. The library header in the main app also has a **Cargar ROM** button. Both store the selected file in IndexedDB and open the correct player; the file never leaves the browser.

## Build

```bash
cd cloudflare
node build.mjs
```

The build copies the app, the vendored melonDS runtime, the GBA player and the demo landing page into `cloudflare/dist/`. It needs no network access and never stores ROMs.

## Deploy

```bash
cd cloudflare
npx wrangler deploy
```

The Worker is named `pocketduet-demo` and uses Workers Assets (free plan is enough). Wrangler prints the `*.workers.dev` URL after deployment.

## Limitations

- No persistent saves. Save requests are acknowledged but not stored; use KV or R2 for a real deployment.
- No socket.io multiplayer in this static demo.
- The demo uses `COOP: same-origin` and `COEP: require-corp` so `SharedArrayBuffer` works.
