# Documentación

| Documento | Para qué |
|---|---|
| [`../README.md`](../README.md) | Inicio rápido, estructura, ROMs, configuración y despliegue |
| [`../deploy/README.md`](../deploy/README.md) | Cloudflare Tunnel con nombre, Tailscale o VPS con Caddy/Nginx; `ACCESS_KEY`, COOP/COEP |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Cómo encajan el hub Node, los reproductores DS/GBA y el port en `vendor/melonds` |
| [`../port-melonds/README.es.md`](../port-melonds/README.es.md) | Documentación del port melonDS-WASM (submódulo) |
| [`../port-melonds/API_CONTRACT.md`](../port-melonds/API_CONTRACT.md) | API pública del port |
| [`../port-melonds/tests/FINAL_ACCEPTANCE.md`](../port-melonds/tests/FINAL_ACCEPTANCE.md) | Evidencia de aceptación del port |

## Reglas del proyecto

- Las ROMs, BIOS, firmware y partidas **nunca** entran en el repositorio: viven en `roms/` y `data/`, ignorados por git.
- Prosa en español, código y comentarios técnicos en inglés.
- Cualquier cambio del port se hace en `port-melonds/` y se copia al runtime publicado con `npm run sync:port`.
