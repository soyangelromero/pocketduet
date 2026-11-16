// Phase 12 demo: standalone multiplayer host. Loads a ROM from the user's disk (never uploaded), starts the emulator,
// creates a room on the hub's signaling server and shows the invitation link for nds/join.html.
import { MelonDS } from "../js/melonds.js";
import { createNetplayHost } from "../adapters/netplay-host.js";

const $ = (id) => document.getElementById(id);
const canvas = $("screen");
const status = (text, error = false) => { $("status").textContent = text; $("err").textContent = error ? text : ""; };
const hub = () => $("hub").value.trim().replace(/\/$/, "");
let ds = null;
let host = null;
let audioUnlocked = false;

// When the page is served by the hub (server.mjs serves it at /nds/wasm/demo/host.html), default to the same origin:
// that way socket.io is same-origin and there is no COPP/COEP cross-origin resource problem. Standalone deployments can
// still type another signaling server (which must allow the cross-origin script; see README).
if (!$("hub").value) $("hub").value = location.origin;

/** Loads socket.io's browser client from the hub (once). The hub must serve it at /socket.io/socket.io.js. */
function loadSocketIo() {
  if (window.io) return Promise.resolve(window.io);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${hub()}/socket.io/socket.io.js`;
    script.onload = () => (window.io ? resolve(window.io) : reject(new Error("socket.io loaded but window.io is missing")));
    script.onerror = () => reject(new Error(`no se pudo cargar ${script.src} (¿hub apagado?; si el hub es otro origen, debe permitir el script con CORP/CORS)`));
    document.head.append(script);
  });
}

async function loadRom(file) {
  $("create").disabled = true;
  if (host) await host.leave();
  host = null;
  $("invite").value = "";
  $("players").textContent = "";
  if (ds) await ds.dispose().catch(() => {});
  ds = null;
  status("Cargando ROM y arrancando el núcleo…");
  try {
    ds = await MelonDS.create({ canvas, threads: "auto", audio: true });
    const info = await ds.loadRom(new Uint8Array(await file.arrayBuffer()));
    ds.start();
    ds.attachKeyboard(document);
    ds.attachPointer(canvas);
    status(`ROM cargada: ${info.title || file.name} (${info.code}). Activa el audio y crea la sala.`);
    $("unlock").disabled = false;
    $("create").disabled = false;
  } catch (error) {
    status(`No se pudo cargar la ROM: ${error.message}`, true);
    $("create").disabled = true;
  }
}

async function createRoom() {
  if (!ds) return;
  $("create").disabled = true;
  status("Conectando con el servidor de señalización…");
  try {
    const ioClient = await loadSocketIo();
    // Same origin (the hub serves this page at /nds/wasm/demo/host.html): use the normal transport upgrade. Different
    // origin: force the websocket transport so the handshake does not need CORS (WebSocket is exempt from CORS).
    const sameOrigin = new URL(hub()).origin === location.origin;
    const io = (url, options) => ioClient(url, sameOrigin ? options : { ...options, transports: ["websocket"] });
    host = await createNetplayHost({
      ds,
      canvas,
      io, // injected: the demo is served from its own port, socket.io comes from the hub
      serverUrl: hub(),
      roomName: $("room").value.trim() || "Sala de melonDS",
      gameId: 0,
      gameName: $("room").value.trim() || "melonDS",
      key: $("key").value.trim(),
      onPlayers: (users, guests = []) => {
        // netplay-host calls this with (usersMap, guests[]) where guests are the *other* players with a display name.
        $("players").textContent = "";
        for (const who of ["Anfitrión", ...guests.map((g) => g.name)]) {
          const chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = who;
          $("players").append(chip);
        }
      },
      onGuestJoined: () => status("Un invitado ha entrado."),
      onGuestLeft: () => status("Un invitado ha salido."),
      onError: (error) => status(`Error del multijugador: ${error.message}`, true),
    });
    $("invite").value = host.inviteUrl(hub());
    $("leave").disabled = false;
    status("Sala creada. Comparte el enlace con el invitado.");
  } catch (error) {
    status(`No se pudo crear la sala: ${error.message}`, true);
    $("create").disabled = false;
  }
}

$("rom").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) loadRom(file);
});

$("unlock").addEventListener("click", async () => {
  try {
    await ds?.unlockAudio();
    audioUnlocked = true;
    status("Audio activado: el invitado también lo oirá.");
  } catch (error) {
    status(`No se pudo activar el audio: ${error.message}`, true);
  }
});

$("create").addEventListener("click", createRoom);

$("leave").addEventListener("click", async () => {
  if (host) await host.leave();
  host = null;
  $("invite").value = "";
  $("players").textContent = "";
  $("leave").disabled = true;
  $("create").disabled = !ds;
  status("Has salido de la sala.");
});

window.__host = {
  get ds() { return ds; },
  get host() { return host; },
  get audioUnlocked() { return audioUnlocked; },
};
