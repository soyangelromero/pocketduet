// Phase 12: WebRTC netplay host (API_CONTRACT.md section 7), independent of the web app.
//
// It takes a MelonDS instance and the signaling server, opens a room and, for each guest that joins, creates an
// RTCPeerConnection, sends the offer with the captureStream() tracks and opens the "inputs" data channel. The guest
// page (nds/join.html) already speaks this protocol: it answers the offer, shows the video and sends
// {player, index, value} over the data channel plus touch events over the socket.
//
// The socket.io client and the RTCPeerConnection are injectable so this module can be tested in Node.

/** libretro joypad index -> MelonDS button name (API_CONTRACT.md section 5). */
export const PAD_INDEX_TO_BUTTON = Object.freeze(["B", "Y", "SELECT", "START", "UP", "DOWN", "LEFT", "RIGHT", "A", "X", "L", "R"]);

export const DEFAULT_STUN = Object.freeze([{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }]);

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Loads /socket.io/socket.io.js once and resolves with the global `io` factory. */
async function loadSocketIoClient(doc = globalThis.document) {
  if (globalThis.io) return globalThis.io;
  if (!doc) throw Object.assign(new Error("socket.io client not available"), { code: "NO_SOCKET_IO" });
  await new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = "/socket.io/socket.io.js";
    script.onload = resolve;
    script.onerror = () => reject(Object.assign(new Error("could not load /socket.io/socket.io.js"), { code: "NO_SOCKET_IO" }));
    doc.head.append(script);
  });
  return globalThis.io;
}

/**
 * @param {object} options
 * @param {import("../js/melonds.js").MelonDS} options.ds
 * @param {HTMLCanvasElement} [options.canvas]      used for a video-only stream if the audio is not unlocked yet
 * @param {MediaStream} [options.stream]            pre-built stream (skips captureStream)
 * @param {Function} [options.io]                   socket.io client factory (injected in tests)
 * @param {string} [options.serverUrl]              default: the page origin
 * @param {string} options.roomName
 * @param {string} [options.playerName]
 * @param {number} [options.maxPlayers]
 * @param {string} [options.password]
 * @param {string|number} [options.gameId]
 * @param {string} [options.gameName]
 * @param {string} [options.key]                     access key appended to the socket.io handshake (?k=)
 * @param {Array} [options.iceServers]
 * @param {Function} [options.onPlayers]             called with the users map on every change
 * @param {Function} [options.onGuestJoined]
 * @param {Function} [options.onGuestLeft]
 * @param {Function} [options.onError]
 */
export async function createNetplayHost(options) {
  const {
    ds,
    canvas = null,
    stream = null,
    io: ioFactory = null,
    serverUrl = globalThis.location?.origin ?? "",
    roomName,
    playerName = "Anfitrión",
    maxPlayers = 4,
    password = "",
    gameId = 0,
    gameName = roomName ?? "",
    key = "",
    iceServers = DEFAULT_STUN,
    onPlayers = () => {},
    onGuestJoined = () => {},
    onGuestLeft = () => {},
    onError = () => {},
  } = options;
  if (!ds) throw Object.assign(new Error("createNetplayHost needs a MelonDS instance"), { code: "NO_DEVICE" });

  const sessionid = newId();
  const userid = newId();
  const peers = new Map(); // guest socketId -> { pc, dc, remoteSet, pending }
  const watch = []; // DataChannels whose PeerConnection never opened: closed on leave()

  const io = ioFactory ?? (await loadSocketIoClient());
  const socket = io(serverUrl, key ? { query: { k: key } } : {});
  let closed = false;

  // ---- media ----
  function buildStream(fps = 60) {
    if (stream) return stream;
    try {
      return ds.captureStream(fps);
    } catch (error) {
      // Audio not unlocked yet: a guest still wants to see the game, so fall back to video only.
      if (canvas?.captureStream) return new MediaStream(canvas.captureStream(fps).getVideoTracks());
      throw error;
    }
  }

  // ---- one peer per guest ----
  async function connectTo(target) {
    if (peers.has(target) || closed) return;
    const pc = new RTCPeerConnection({ iceServers });
    const entry = { pc, dc: null, remoteSet: false, candidates: [] };
    peers.set(target, entry);

    const media = buildStream();
    for (const track of media.getTracks()) pc.addTrack(track, media);

    const dc = pc.createDataChannel("inputs", { ordered: true });
    entry.dc = dc;
    dc.onmessage = (event) => onInput(event.data);

    pc.onicecandidate = (event) => {
      if (event.candidate) socket.emit("webrtc-signal", { target, candidate: event.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) dropPeer(target);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc-signal", { target, offer: pc.localDescription });
    onGuestJoined(target);
  }

  function dropPeer(target) {
    const entry = peers.get(target);
    if (!entry) return;
    peers.delete(target);
    try {
      entry.dc?.close();
    } catch {}
    try {
      entry.pc.close();
    } catch {}
    onGuestLeft(target);
  }

  // ---- guest input ----
  function onInput(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!message || message.type === "host-left") return;
    const { index, value, player = 0 } = message;
    const button = PAD_INDEX_TO_BUTTON[index];
    if (!button) return;
    try {
      ds.button(button, value === 1 || value === true, player);
    } catch (error) {
      onError(error);
    }
  }

  // ---- signaling ----
  socket.on("users-updated", (users) => {
    const map = users && typeof users === "object" ? users : {};
    const guests = Object.entries(map)
      .filter(([, user]) => user?.socketId && user.socketId !== socket.id)
      .map(([id, user]) => ({ id, socketId: user.socketId, name: user.player_name ?? "Invitado" }));
    for (const guest of guests) if (!peers.has(guest.socketId)) connectTo(guest.socketId).catch(onError);
    for (const socketId of [...peers.keys()]) if (!guests.some((g) => g.socketId === socketId)) dropPeer(socketId);
    onPlayers(map, guests);
  });

  socket.on("webrtc-signal", async (data) => {
    if (!data?.sender) return;
    const entry = peers.get(data.sender);
    if (!entry) return;
    try {
      if (data.answer) {
        await entry.pc.setRemoteDescription(data.answer);
        entry.remoteSet = true;
        for (const candidate of entry.candidates.splice(0)) await entry.pc.addIceCandidate(candidate).catch(() => {});
      } else if (data.candidate) {
        if (entry.remoteSet) await entry.pc.addIceCandidate(data.candidate).catch(() => {});
        else entry.candidates.push(data.candidate);
      }
    } catch (error) {
      onError(error);
    }
  });

  // Guest touch screen: relayed by the server (socket `data-message`, not the data channel).
  socket.on("data-message", (data) => {
    const touch = data?.touch;
    if (!touch) return;
    const clamp = (n) => Math.min(1, Math.max(0, Number(n) || 0));
    try {
      ds.touchFromCanvas(clamp(touch.x), clamp(touch.y), touch.s === "down" || touch.s === "move" || touch.s === "up" ? touch.s : "down");
    } catch (error) {
      onError(error);
    }
  });

  // ---- room lifecycle ----
  const extra = {
    domain: globalThis.location?.host ?? "",
    game_id: gameId,
    room_name: roomName,
    game_name: gameName,
    player_name: playerName,
    userid,
    sessionid,
  };

  await new Promise((resolve, reject) => {
    socket.emit("open-room", { extra, maxPlayers, password }, (error) => (error ? reject(Object.assign(new Error(String(error)), { code: "ROOM_ERROR" })) : resolve()));
  });

  const host = {
    sessionid,
    userid,
    name: roomName,
    socket,
    peers,
    /** Invitation link for the guest page; `base` is the public URL (tunnel) or the current origin. */
    inviteUrl(base = serverUrl) {
      return `${String(base).replace(/\/$/, "")}/nds/join.html?room=${encodeURIComponent(sessionid)}`;
    },
    playerCount() {
      return peers.size;
    },
    /** Sends {type:"host-left"} so the guests see a clear message before the channel dies. */
    async leave() {
      if (closed) return;
      closed = true;
      for (const entry of peers.values()) {
        try {
          entry.dc?.send(JSON.stringify({ type: "host-left" }));
        } catch {}
      }
      for (const entry of peers.values()) {
        try {
          entry.dc?.close();
        } catch {}
        try {
          entry.pc.close();
        } catch {}
      }
      peers.clear();
      watch.length = 0;
      try {
        socket.emit("leave-room");
        socket.disconnect();
      } catch {}
    },
  };
  host.destroy = host.leave;
  return host;
}

export default createNetplayHost;
