# Arquitectura

```
navegador
  ├─ /                hub (home/index.html)
  ├─ /nds/            reproductor NDS + adaptador → /nds/wasm/
  │    └─ vendor/melonds/   runtime prebuilt de melonDS DS (WASM + JS + adapters + demo)
  │         └─ port-melonds/  submódulo con el código fuente y el build (GPL-3.0)
  ├─ /gba/            reproductor mGBA-WASM (site/index.html, site/mgba.js, site/mgba.wasm)
  └─ /ui/             CSS/JS compartido de la interfaz
```

`server.mjs` es un único proceso Node (sin frameworks de servidor). Sirve los estáticos con las cabeceras
COOP/COEP necesarias para `SharedArrayBuffer`, expone las bibliotecas desde `roms/nds` y `roms/gba`, guarda las
partidas de GBA en `data/gba-saves`, escribe las de NDS junto a su ROM y hace de señalización socket.io para el
multijugador.

Los dos emuladores corren **en el navegador**; el servidor solo entrega archivos y coordina salas. Las ROMs no salen
del equipo salvo que tú pongas el servidor en Internet.

## Configuración

Todas las rutas se pueden mover con variables de entorno:

| Variable | Por defecto | Contenido |
|---|---|---|
| `NDS_ROMS` | `roms/nds` | ROMs `.nds` (y sus `.sav`) |
| `GBA_ROMS` | `roms/gba` | ROMs `.gba` |
| `NDS_BIOS` | `roms/bios` | BIOS/firmware opcionales (`biosnds7.rom`, `biosnds9.rom`, `firmware.bin`) |
| `GBA_SAVES` | `data/gba-saves` | partidas GBA enviadas desde el navegador |
| `DATA_DIR` | `data` | caché de carátulas y datos locales |
| `MELONDS_ROOT` | `vendor/melonds` | runtime del port que se sirve en `/nds/wasm/` |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | escucha |
| `ACCESS_KEY` | vacío | si se define, todo exige `?k=` o cookie; también socket.io |

## Actualizar el port

```bash
git submodule update --remote port-melonds
cd port-melonds && ./scripts/build.sh && cd ..
npm run sync:port
```

`npm run sync:port` copia `dist`, `js`, `adapters`, `demo`, `coi-sw.js` y las licencias desde el submódulo a
`vendor/melonds`. El repositorio guarda el runtime prebuilt para que una instalación nueva funcione sin compilar.
