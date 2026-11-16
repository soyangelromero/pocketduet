# Integración del port en la web app (`<web-app>`) — Fase 11/12

La web app **no es un repositorio git**, así que aquí queda el "diff exacto" en forma de bloques y tablas de
equivalencias (lo que la guía de la Fase 11 pide como `adapters/INTEGRATION.md`). Lo que se toca fuera de este
repositorio son **cuatro archivos**, todos con cambios aditivos:

| Archivo de la web app | Cambio | Líneas actuales (2026-11-15) |
|---|---|---|
| `nds/index.html` | Detección de motor `?engine=wasm`, arranque con el port (`startWasm`), pad táctil, pestaña Online con el anfitrión WebRTC, mensaje/fallback de `ROM_TOO_LARGE` | 178, 332-333, 435, 457-510, 568-580, 750, 788-… |
| `home/index.html` | Botón «melonDS WASM» en el selector de motor del hub | 72, 108, 132 |
| `server.mjs` | Rutas `/nds/wasm/` (lista blanca), `PUT /nds/api/sav/:id` (copia `.bak` + `rename`), `HOST`/`PORT`/`ACCESS_KEY`, frescura de `tunnel.log`, CORP `cross-origin` para socket.io | 138-158, 186-204, 230-236 |
| `docs/*.md` | Documentación de operación, despliegue y este informe | — |

`nds/join.html` **no se ha tocado**: el protocolo de invitados que ya existía es el que habla
`adapters/netplay-host.js` (mismos eventos socket.io, misma página de invitado).

## 1. Arranque según el motor

```js
// nds/index.html, ~332
const CORE = params.get("engine") || params.get("core") || store0("nds.core") || "melonds";
const IS_WASM = CORE === "wasm";

// ~435
async function startGame(g){
  …
  if (IS_WASM) { await startWasm(g); return; }   // port nuevo
  …                                              // EmulatorJS de siempre
}
```

`startWasm(g)` (~457) crea un `<canvas id="wasmcanvas">` dentro de `#ejs`, importa
`/nds/wasm/adapters/webapp-adapter.js` y llama a `createWebappEmulator({canvas, container, romUrl, saveUrl,
fetchSave, firmware, onStatus})`; después instala el resultado en `window.EJS_emulator` (el contrato que ya usaba la
página) y llama a `onGameStart()`. Si el motor rechaza la ROM con `ROM_TOO_LARGE` (Negra 2, 512 MB con la build de
1 GiB) muestra el motivo en la barra de estado y añade el botón `#wasmFallback`, que recarga con
`?core=melonds&play=<id>` (EmulatorJS) conservando `?k=`.

## 2. Equivalencias `ejs`/`gm` → adaptador

La página usa 45 llamadas a `ejs.*` / `gm.*`. Así las cubre `adapters/webapp-adapter.js`:

| Uso en `nds/index.html` | Nº | Adaptador (`createWebappEmulator`) | ¿Completo? |
|---|---|---|---|
| `gm.getFrameNum()` | 6 | `ds.getFrameCount()` (contador del worker, el mismo que `getStats().frameCount`) | Sí |
| `gm.setVariable(k, v)` | 7 | `applyCoreVariable`: layouts (`melonds_screen_layout`/`desmume_screens_layout`), gap, híbrido; `melonds_threaded_renderer` se elige al arrancar y se ignora en caliente | Sí (con esa nota) |
| `gm.setVSync(x)` | 2 | No-op: el port se regula por el reloj de audio | Sí (no aplica) |
| `gm.setFastForwardRatio(r)` / `gm.toggleFastForward(on)` | 2+3 | `ds.setSpeed(r)` recordando el último ratio (0 = sin límite) | Sí |
| `gm.restart()` | 1 | `ds.reset()` (recrea el worker, ~1 s: `retro_reset` requiere recompilar) | Sí, con coste |
| `gm.getSaveFile()`, `gm.getSaveFilePath()`, `gm.FS`, `gm.loadSaveFiles()` | 1+… | Copia cacheada del `.sav`, `loadSave()` + reinicio | Sí |
| `gm.quickSave()` / `gm.quickLoad()` | 1+1 | `saveState()`/`loadState()` en IndexedDB (`emerald-web-nds/states`) | Sí |
| `gm.setCheat(index, on, code)` / `clearCheats()` | 1+1 | `ds.setCheat()`/`ds.clearCheats()` (Action Replay del port) | Sí |
| `ejs.paused` / `ejs.pause()` / `ejs.play()` | 3+… | `ds.pause()`/`ds.resume()` y el flag `paused` | Sí |
| `ejs.setVolume()` | 2 | `ds.setVolume()` (0..1) | Sí |
| `ejs.screenshot(cb)` | 1 | `ds.screenshot()` (Blob PNG del canvas) | Sí |
| `ejs.toggleFullscreen(want)` | 1 | API de fullscreen del navegador sobre el contenedor | Sí |
| `ejs.enableShader(name)` + `ejs.shaders` | 2+1 | Solo `disabled` (el port solo trae scanlines); el selector filtra con `ejs.shaders` | Parcial documentado |
| `ejs.Module.pauseMainLoop()` / `resumeMainLoop()` | 3 | No-ops (el limitador de la página no hace falta) | Sí (no aplica) |
| `ejs.isFastForward` | 1 | Propiedad de la página que el adaptador no necesita; el `setSpeed` ya se aplica | Sí |
| `ejs.config.threads` | 1 | `ds.getStats().threads` (hilos 3D del worker) | Sí |
| `ejs.netplay` | 3 | `null` con `?engine=wasm`: la pestaña Online usa `setupOnlineWasm()` (Fase 12) | Sustituido |
| `ejs.canvas` | 1 | Canvas del port (`#wasmcanvas`) | Sí |
| `ejs.melonDS` (extra, no EmulatorJS) | 4 | Puente directo al port (stats, layouts, `unlockAudio`, `button`, `touchFromCanvas`) — lo usa el pad táctil y el Online | Extra |

## 3. Servidor (cambios aditivos)

- `/nds/wasm/(dist|js|adapters|demo)/…`: sirve solo esas carpetas del port; el resto da 404 (lista blanca
  comprobada en las pruebas de navegador). `demo` permite abrir la demo independiente y `demo/host.html` desde el
  **mismo origen** que el hub (socket.io same-origin, COOP/COEP ya presentes) y que sean alcanzables por el túnel.
- `PUT /nds/api/sav/:id`: escribe el `.sav` junto a la ROM con copia `.bak` y `rename` atómico (tercera capa de
  guardado). Los tests de biblioteca interceptan el `PUT` para no tocar los `.sav` reales.
- `HOST`/`PORT`/`ACCESS_KEY`: escuchar en LAN/VPS y clave opcional por cookie (también para socket.io).
- `/nds/api/public`: solo devuelve la URL del túnel si `tunnel.log` es reciente (< 5 min).
- `/socket.io*`: `Cross-Origin-Resource-Policy: cross-origin` para que la demo independiente (`demo/host.html`, servida
  desde otro puerto y aislada con COEP) pueda cargar el cliente de socket.io del hub.

## 4. Evidencia

| Prueba | Resultado |
|---|---|
| `node tests/phase11-browser.mjs` | 17/17: `crossOriginIsolated`, `window.EJS_emulator`, canvas 256×384, avance de fotogramas, contenido visible, fps, guardado 512 KiB, pausa/play, layout, móvil con pad táctil y START, sin 404 ni errores |
| `node tests/phase12-browser.mjs` | 11/11: sala, invitado, vídeo, START y toque del invitado, cierre, sin errores |
| `node tests/library-browser.mjs` | NDS 3/4 con el port + GBA 4/4 (Negra 2: `ROM_TOO_LARGE` elegante) |
| `node tests/library-fallback-browser.mjs` | 9/9: fallback a EmulatorJS para Negra 2 |
| `node tests/package.test.mjs` | 1/1: el paquete servido en aislado abre la demo en Chromium |
