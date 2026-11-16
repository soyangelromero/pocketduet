# Third-party components

This repository is a web front-end around two independent open-source emulators. **No ROMs, BIOS, firmware or game
assets are included or distributed.**

## melonDS DS / melonDS — Nintendo DS

- **Emulator:** melonDS DS **v1.4.0** (libretro core), based on melonDS upstream
  commit `16f127dbb587a73371827ce79689c5d237c4b59b`.
- **License:** GPL-3.0. Source and build instructions:
  <https://github.com/soyangelromero/melonds-wasm> (git submodule at `port-melonds/`).
- **How it is used here:** the prebuilt WebAssembly runtime lives in `vendor/melonds/` (generated from the submodule
  with `npm run sync:port`). `LICENSE`, `THIRD_PARTY.md` and the full source are available in the submodule.
- If you redistribute this web app, the GPL-3.0 applies to the port and its corresponding source must remain
  available. See `LICENSE`.

## mGBA — Game Boy Advance

- **Emulator:** [mGBA](https://mgba.io/), compiled to WebAssembly by
  [`@thenick775/mgba-wasm`](https://github.com/thenick775/mgba-wasm) **v2.6.0**.
- **License:** MPL-2.0 (the mGBA-wasm package declares MPL-2.0). The prebuilt files are `site/mgba.js` and
  `site/mgba.wasm`; their upstream sources are available at the links above. The MPL-2.0 applies to those files.
- The GBA UI and its cheat catalog are part of this web app (GPL-3.0).

## socket.io

- Multiplayer signalling server, `socket.io` v4.8.x, MIT. <https://socket.io/>

## EmulatorJS (optional legacy loader)

The DS page can optionally load the older EmulatorJS engines (`melonDS` / `DeSmuME`) from
`cdn.emulatorjs.org`; they are **not bundled** in this repository. Their upstream licenses and sources are at
<https://github.com/EmulatorJS/EmulatorJS>. The default DS engine in this web app is the local melonDS-WASM port.

## Fonts, icons and images

- Icons and UI are original CSS/SVG in `ui/` and `home/`/`nds/`/`site/`.
- Cover art is downloaded at runtime from libretro-thumbnails into `data/art/` (ignored by git). It is not
  redistributed here.
- README screenshots use the CC0 homebrew *nmap* by rmn20; no commercial ROM content is included.
