# Desplegar PocketDuet para jugar desde cualquier sitio

El hub es **un solo proceso Node** (`server.mjs`) que sirve las páginas, las ROM de tu PC y el motor WASM.
Necesita dos cosas para funcionar fuera de tu red:

1. **HTTPS y cabeceras COOP/COEP.** Sin `Cross-Origin-Opener-Policy: same-origin` y
   `Cross-Origin-Embedder-Policy: require-corp` no hay `SharedArrayBuffer` y ni mGBA ni melonDS arrancan.
   `server.mjs` ya las manda; el proxy que pongas delante **no debe quitarlas** (Cloudflare y Caddy las respetan).
2. **Un sitio donde escuchar.** Por defecto escucha en `127.0.0.1:8080`; con `HOST=0.0.0.0` escucha en todas.

Además, si el hub va a estar en Internet, usa **clave de acceso**:

```bash
ACCESS_KEY='una-clave-larga-y-aleatoria' PORT=8080 HOST=0.0.0.0 node server.mjs
```

Con `ACCESS_KEY`, toda petición necesita `?k=CLAVE` o la cookie que se crea al abrirla una vez:
sin eso responde 403. La cookie autoriza también la conexión socket.io del multijugador.

---

## Opción A — Cloudflare Tunnel con nombre (recomendada)

Ventajas: HTTPS gratis, sin abrir puertos, la URL no cambia, funciona en el móvil. Es la evolución del
`cloudflared tunnel --url` efímero que ya usabas, pero con nombre propio y estable.

1. Instala `cloudflared` (ya lo tienes en `C:\Program Files (x86)\cloudflared`).
2. `cloudflared tunnel login` (una vez; abre el navegador).
3. `cloudflared tunnel create pocketduet` → anota el UUID que imprime.
4. Copia `deploy/cloudflared-config.yml` a `%USERPROFILE%\.cloudflared\config.yml` y rellena `tunnel:` con el UUID,
   `credentials-file:` con la ruta del `.json` que creó el paso 3 y `hostname:` con tu dominio.
5. `cloudflared tunnel route dns pocketduet pocketduet.tudominio.com`
6. `cloudflared service install` y arranca el servicio (o `cloudflared tunnel run pocketduet`).

El hub debe estar corriendo **antes** que el túnel:

```bash
cd pocketduet
ACCESS_KEY='...' node server.mjs          # terminal 1 (o como servicio)
cloudflared tunnel run pocketduet        # terminal 2
```

Abre `https://pocketduet.tudominio.com/?k=TU_CLAVE` una vez: la cookie se queda y ya no hace falta la clave.
A partir de ahí, `/nds/api/public` ya no es necesario para invitar (la URL es fija): usa directamente
`https://pocketduet.tudominio.com/nds/`.

## Opción B — Tailscale (privada, sin dominio)

Ventajas: nada público, cifrado extremo a extremo, el móvil entra con su app de Tailscale.
Desventajas: cada dispositivo necesita Tailscale instalado.

1. Instala Tailscale en el PC y en el móvil, misma cuenta.
2. `HOST=0.0.0.0 PORT=8080 node server.mjs` (o `HOST=<IP de Tailscale>`).
3. En el móvil abre `http://<ip-tailscale-del-pc>:8080/`.
   Tailscale da HTTPS/MagicDNS si lo activas, pero para `SharedArrayBuffer` basta `localhost`; si usas la IP
   del tailnet, activa **Tailscale HTTPS** (`tailscale cert`) o sirve con Caddy para tener `https://` y que el
   navegador considere el contexto seguro.

Nota: Chrome considera "seguro" `http://localhost`, pero **no** `http://100.x.y.z`; sin contexto seguro no hay
`SharedArrayBuffer`. Activa HTTPS del tailnet o usa la opción A.

## Opción C — VPS con Caddy (control total)

1. En el VPS: Node 26, tu biblioteca en `/srv/roms` y el proyecto en `/srv/pocketduet`.
2. Copia tus ROMs a `roms/gba` y `roms/nds` (o define `GBA_ROMS`/`NDS_ROMS`); el servicio ya arranca desde el directorio del repo.
3. Servicio: `deploy/pocketduet.service` (copia a `/etc/systemd/system/`, `systemctl enable --now pocketduet`).
4. Caddy: `deploy/Caddyfile` (copia a `/etc/caddy/Caddyfile` y `systemctl reload caddy`).
   Caddy saca el certificado solo y no toca las cabeceras COOP/COEP.
5. Nginx también vale (`deploy/nginx.conf.example`), pero **no** añadas `proxy_hide_header` sobre COOP/COEP.

---

## Verificar el acceso remoto sin cuenta (túnel rápido)

Antes de montar el túnel con nombre se puede comprobar todo el camino con un túnel rápido y efímero de Cloudflare, sin
cuenta:

```powershell
cd pocketduet
node tests/remote-tunnel-browser.mjs
```

Arranca un segundo hub en `:8098` con `ACCESS_KEY` aleatoria, abre el túnel, y comprueba por la URL pública: **403 sin
clave y 200 con `?k=`/cookie**, COOP/COEP conservados, biblioteca y adaptador del port, handshake de socket.io protegido,
y **una ROM arrancando y dibujando en el navegador por HTTPS** (en la última pasada: Platino en 19 s a 53,3 fps, guardado
de 524 288 B, sin errores). El túnel se cierra al terminar; no queda nada público. Resultado esperado: **9/9**.

## Comprobaciones tras desplegar

```bash
curl -sI https://TU-DOMINIO/ | grep -i cross-origin
# debe mostrar cross-origin-opener-policy: same-origin y cross-origin-embedder-policy: require-corp

curl -s https://TU-DOMINIO/nds/api/roms?k=TU_CLAVE | head -c 120   # la biblioteca
```

En el navegador, con la consola abierta:

```js
self.crossOriginIsolated   // true
```

Si es `false`, el proxy está quitando las cabeceras o no hay HTTPS: los emuladores no arrancarán.

### Hostings que no permiten cabeceras (GitHub Pages, `python -m http.server`, etc.)

Publica el paquete estático (`node scripts/package.mjs`) **incluyendo `coi-sw.js` en la raíz** y abre la demo con
**`?coi=1`**: el service worker se registra una vez y recarga hasta quedar aislada. Necesita HTTPS o `localhost` (los
service workers no funcionan en HTTP remoto). Es una ayuda opcional: si el hosting sí deja poner cabeceras, úsalas (son
más fiables y no añaden una recarga). Comprobación: `self.crossOriginIsolated === true` y
`typeof SharedArrayBuffer !== "undefined"` tras la recarga; prueba dedicada `node tests/coi-sw-browser.mjs` en el puerto
del port.

## Seguridad y privacidad (importante)

- Con `ACCESS_KEY` el hub queda cerrado a quien no tenga la clave; **sin** ella, cualquiera con la URL ve tu
  biblioteca y puede descargar ROMs y guardados. Es una decisión explícita de `PROGRESO.md`, no un descuido.
- Las ROM y los `.sav` **no se suben a ningún repositorio**: viajan del PC al navegador y el guardado del servidor
  se escribe junto a la ROM (`PUT /nds/api/sav/:id`, con copia `.bak`).
- Un túnel público (`trycloudflare`) cambia de URL en cada arranque; el túnel con nombre no.
- Si compartes con amigos, comparte el enlace **con** la clave y no lo publiques.
