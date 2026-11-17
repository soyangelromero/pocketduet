# PocketDuet demo on Cloudflare Workers

Live demo: **https://pocketduet-demo.soyangelromero.workers.dev**

This folder contains a static Cloudflare Worker demo of PocketDuet. It serves the web app from Workers Assets and implements a minimal API for the two players:

- `/nds/api/roms`, `/nds/api/rom/0` — demo homebrew Nintendo DS ROM.
- `/gba/api/roms`, `/gba/api/rom/{0,1,2}` — three tiny MIT-licensed GBA test ROMs.
- `/nds/api/sav/*`, `/gba/api/sav/*` — accepts save calls in memory only; the demo does not persist saves.

The demo ROMs are **not committed** to the repository. `build.mjs` downloads them into the generated `dist/` folder, which is ignored by git:

- `nmap.nds` — CC0 homebrew by [rmn20](https://github.com/rmn20/normalmappingds).
- `hello.gba`, `shades.gba`, `stripes.gba` — MIT test ROMs from [jsmolka/gba-tests](https://github.com/jsmolka/gba-tests).

## Build

```bash
cd cloudflare
node build.mjs
```

The build needs Node 22+ and network access for those four small files. It copies the app, the vendored melonDS runtime and the GBA player into `cloudflare/dist/`.

## Deploy

```bash
cd cloudflare
npx wrangler deploy
```

The Worker is named `pocketduet-demo` and needs Workers Assets enabled (free plan is enough). Wrangler prints the `*.workers.dev` URL after deployment.

To use a custom domain, add a route in the Cloudflare dashboard or in `wrangler.toml` after the domain is in Cloudflare.

## Notes

- No ROMs, BIOS, saves or game assets are stored in the repository.
- The public demo includes only the open-source homebrew/test ROMs listed above; users can load their own ROM through the file picker.
- Saves are ephemeral by design in this demo. For persistence, bind KV or R2 in `wrangler.toml` and replace the save stubs in `worker.mjs`.
- Cloudflare free plan limits apply; the static assets are around 6 MB.
