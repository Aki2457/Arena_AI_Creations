/*
 * Voice Chat — browser-to-browser group voice calls.
 *
 * Audio flows peer-to-peer over WebRTC (full mesh). Supabase Realtime is only used
 * as the signaling layer: Presence tells us who is in the room, and Broadcast
 * carries the SDP offers/answers and ICE candidates between peers.
 *
 * To avoid "glare" (both sides offering at once) the peer with the
 * lexicographically smaller id always creates the offer.
 */
(() => {
  "use strict";

  const cfg = window.VOICE_CHAT_CONFIG;
  const MAX_PEERS = 8;
  const $ = (id) => document.getElementById(id);

  // ---------- DOM ----------
  const lobby = $("lobby"), roomView = $("room");
  const joinForm = $("joinForm"), nameInput = $("nameInput"), roomInput = $("roomInput");
  const joinBtn = $("joinBtn"), lobbyError = $("lobbyError");
  const roomNameEl = $("roomName"), statusEl = $("status"), list = $("participants");
  const muteBtn = $("muteBtn"), leaveBtn = $("leaveBtn"), copyBtn = $("copyLink");
  const audioSink = $("audioSink"), toastEl = $("toast");

  // ---------- State ----------
  let client = null, channel = null, localStream = null, audioCtx = null;
  let myId = "", myName = "", roomId = "", muted = false, rafId = 0;
  const peers = new Map(); // id -> { pc, name, muted, audio, analyser, state, queue }
  let localAnalyser = null;

  // ---------- Helpers ----------
  const randomId = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
      .replace(/-/g, "").slice(0, 16);

  const randomRoom = () => {
    const a = ["sunny", "cosmic", "quiet", "lucky", "brave", "mellow", "swift", "neon"];
    const b = ["otter", "durian", "comet", "tiger", "panda", "falcon", "lotus", "koala"];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    return `${pick(a)}-${pick(b)}-${Math.floor(Math.random() * 90 + 10)}`;
  };

  const colorFor = (str) => {
    let h = 0;
    for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `hsl(${h} 70% 45%)`;
  };

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2500);
  }

  function setStatus(msg) { statusEl.textContent = msg; }

  function inviteLink() {
    const u = new URL(location.href);
    u.search = "";
    u.hash = "";
    u.searchParams.set("room", roomId);
    return u.toString();
  }

  // ---------- Init lobby ----------
  const params = new URLSearchParams(location.search);
  roomInput.value = (params.get("room") || "").replace(/[^a-zA-Z0-9_-]/g, "") || randomRoom();
  nameInput.value = localStorage.getItem("vc-name") || "";
  $("randomRoom").onclick = () => (roomInput.value = randomRoom());

  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    lobbyError.hidden = true;
    joinBtn.disabled = true;
    joinBtn.textContent = "Requesting microphone…";
    try {
      await join(nameInput.value.trim(), roomInput.value.trim().toLowerCase());
    } catch (err) {
      console.error(err);
      lobbyError.textContent = friendlyError(err);
      lobbyError.hidden = false;
      await leave(true);
    } finally {
      joinBtn.disabled = false;
      joinBtn.textContent = "Join voice room";
    }
  });

  function friendlyError(err) {
    if (!window.isSecureContext) return "Voice chat needs HTTPS. Open the site over https://.";
    if (err && (err.name === "NotAllowedError" || err.name === "SecurityError"))
      return "Microphone permission was denied. Allow mic access in your browser and try again.";
    if (err && err.name === "NotFoundError") return "No microphone was found on this device.";
    return (err && err.message) || "Something went wrong. Please try again.";
  }

  // ---------- Join / leave ----------
  async function join(name, room) {
    if (!name || !room) throw new Error("Enter your name and a room.");
    myName = name;
    roomId = room;
    myId = randomId();
    muted = false;
    localStorage.setItem("vc-name", name);

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    localAnalyser = makeAnalyser(localStream);

    joinBtn.textContent = "Connecting…";
    client = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 30 } },
    });

    channel = client.channel(`voice-room:${roomId}`, {
      config: { broadcast: { self: false }, presence: { key: myId } },
    });

    channel
      .on("presence", { event: "sync" }, onPresenceSync)
      .on("broadcast", { event: "signal" }, ({ payload }) => {
        if (payload && payload.to === myId) handleSignal(payload).catch((e) => console.warn("signal error", e));
      });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Could not reach the signaling server. Check your connection.")), 15000);
      channel.subscribe(async (status, err) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timer);
          await channel.track({ name: myName, muted, at: Date.now() });
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timer);
          reject(err || new Error("Signaling connection failed (" + status + ")."));
        }
      });
    });

    history.replaceState(null, "", "?room=" + encodeURIComponent(roomId));
    roomNameEl.textContent = roomId;
    lobby.hidden = true;
    roomView.hidden = false;
    updateMuteBtn();
    render();
    loop();
  }

  async function leave(silent) {
    cancelAnimationFrame(rafId);
    for (const id of [...peers.keys()]) closePeer(id);
    if (channel) {
      try { await channel.untrack(); } catch (_) {}
      try { await client.removeChannel(channel); } catch (_) {}
    }
    channel = null;
    client = null;
    if (localStream) localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    localAnalyser = null;
    if (audioCtx) { try { await audioCtx.close(); } catch (_) {} }
    audioCtx = null;
    roomView.hidden = true;
    lobby.hidden = false;
    if (!silent) toast("You left the room");
  }

  leaveBtn.onclick = () => leave(false);
  window.addEventListener("pagehide", () => { if (channel) channel.untrack(); });

  // ---------- Mute ----------
  muteBtn.onclick = async () => {
    if (!localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
    updateMuteBtn();
    render();
    if (channel) await channel.track({ name: myName, muted, at: Date.now() });
  };

  function updateMuteBtn() {
    muteBtn.classList.toggle("muted", muted);
    muteBtn.querySelector(".icon").textContent = muted ? "🔇" : "🎤";
    muteBtn.querySelector(".txt").textContent = muted ? "Unmute" : "Mute";
  }

  copyBtn.onclick = async () => {
    const link = inviteLink();
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied!");
    } catch (_) {
      prompt("Copy this invite link:", link);
    }
  };

  // ---------- Presence ----------
  function onPresenceSync() {
    const state = channel.presenceState();
    const present = new Set();

    for (const [id, metas] of Object.entries(state)) {
      if (id === myId || !metas || !metas.length) continue;
      present.add(id);
      const meta = metas[metas.length - 1];
      let peer = peers.get(id);
      if (!peer) {
        if (peers.size >= MAX_PEERS) continue;
        peer = createPeer(id, meta.name);
        toast(`${meta.name || "Someone"} joined`);
        if (myId < id) makeOffer(id).catch((e) => console.warn("offer failed", e));
      }
      peer.name = meta.name || peer.name;
      peer.muted = !!meta.muted;
    }

    for (const id of [...peers.keys()]) {
      if (!present.has(id)) {
        const p = peers.get(id);
        toast(`${(p && p.name) || "Someone"} left`);
        closePeer(id);
      }
    }
    render();
  }

  // ---------- WebRTC ----------
  function send(to, data) {
    if (!channel) return;
    channel.send({ type: "broadcast", event: "signal", payload: { ...data, from: myId, to, name: myName } });
  }

  function createPeer(id, name) {
    const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
    const peer = { pc, name: name || "Guest", muted: false, audio: null, analyser: null, state: "connecting", queue: [] };
    peers.set(id, peer);

    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) send(id, { type: "candidate", candidate: e.candidate.toJSON() });
    };

    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (!peer.audio) {
        peer.audio = document.createElement("audio");
        peer.audio.autoplay = true;
        peer.audio.playsInline = true;
        audioSink.appendChild(peer.audio);
      }
      peer.audio.srcObject = stream;
      peer.audio.play().catch(() => toast("Tap anywhere to enable audio"));
      peer.analyser = makeAnalyser(stream);
    };

    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === "failed" && myId < id) {
        // Try to recover with an ICE restart (only the offerer does this).
        makeOffer(id, true).catch(() => {});
      }
      render();
    };

    return peer;
  }

  async function makeOffer(id, iceRestart = false) {
    const peer = peers.get(id);
    if (!peer) return;
    const offer = await peer.pc.createOffer({ iceRestart });
    await peer.pc.setLocalDescription(offer);
    send(id, { type: "offer", sdp: peer.pc.localDescription.toJSON() });
  }

  async function flushCandidates(peer) {
    while (peer.queue.length) {
      const c = peer.queue.shift();
      try { await peer.pc.addIceCandidate(c); } catch (e) { console.warn("ICE add failed", e); }
    }
  }

  async function handleSignal(msg) {
    const { from, type } = msg;
    let peer = peers.get(from);

    if (type === "offer") {
      if (!peer) {
        if (peers.size >= MAX_PEERS) return;
        peer = createPeer(from, msg.name);
      }
      if (peer.pc.signalingState !== "stable") {
        try { await peer.pc.setLocalDescription({ type: "rollback" }); } catch (_) {}
      }
      await peer.pc.setRemoteDescription(msg.sdp);
      await flushCandidates(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      send(from, { type: "answer", sdp: peer.pc.localDescription.toJSON() });
      render();
    } else if (type === "answer") {
      if (!peer || peer.pc.signalingState !== "have-local-offer") return;
      await peer.pc.setRemoteDescription(msg.sdp);
      await flushCandidates(peer);
    } else if (type === "candidate") {
      if (!peer) return;
      if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
        try { await peer.pc.addIceCandidate(msg.candidate); } catch (e) { console.warn("ICE add failed", e); }
      } else {
        peer.queue.push(msg.candidate);
      }
    }
  }

  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    try { peer.pc.close(); } catch (_) {}
    if (peer.audio) { peer.audio.srcObject = null; peer.audio.remove(); }
    peers.delete(id);
  }

  // Some mobile browsers block autoplay until a user gesture.
  document.addEventListener("click", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    peers.forEach((p) => p.audio && p.audio.paused && p.audio.play().catch(() => {}));
  });

  // ---------- Speaking indicator ----------
  function makeAnalyser(stream) {
    if (!audioCtx) return null;
    try {
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      return { analyser, data: new Uint8Array(analyser.fftSize) };
    } catch (_) {
      return null;
    }
  }

  function level(a) {
    if (!a) return 0;
    a.analyser.getByteTimeDomainData(a.data);
    let sum = 0;
    for (let i = 0; i < a.data.length; i++) {
      const v = (a.data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / a.data.length);
  }

  function loop() {
    const threshold = 0.04;
    const me = list.querySelector('[data-id="me"]');
    if (me) me.classList.toggle("speaking", !muted && level(localAnalyser) > threshold);
    peers.forEach((p, id) => {
      const el = list.querySelector(`[data-id="${id}"]`);
      if (el) el.classList.toggle("speaking", !p.muted && level(p.analyser) > threshold);
    });
    rafId = requestAnimationFrame(loop);
  }

  // ---------- Render ----------
  const STATE_LABEL = {
    new: ["Connecting…", ""], connecting: ["Connecting…", ""], connected: ["Connected", "ok"],
    disconnected: ["Reconnecting…", "bad"], failed: ["Connection failed", "bad"], closed: ["Left", "bad"],
  };

  function participantEl(id, name, sub, stateText, stateCls) {
    const li = document.createElement("li");
    li.className = "participant";
    li.dataset.id = id;
    const av = document.createElement("div");
    av.className = "avatar";
    av.style.background = colorFor(name);
    av.textContent = (name[0] || "?").toUpperCase();
    const nm = document.createElement("div");
    nm.className = "pname";
    nm.textContent = name;
    if (sub) {
      const s = document.createElement("small");
      s.textContent = sub;
      nm.appendChild(s);
    }
    const st = document.createElement("div");
    st.className = "pstate " + (stateCls || "");
    st.textContent = stateText;
    li.append(av, nm, st);
    return li;
  }

  function render() {
    if (!channel) return;
    list.replaceChildren();
    list.appendChild(participantEl("me", myName, "(you)", muted ? "🔇 Muted" : "🎤 Live", muted ? "bad" : "ok"));
    peers.forEach((p, id) => {
      const [txt, cls] = STATE_LABEL[p.state] || ["…", ""];
      list.appendChild(participantEl(id, p.name, "", p.muted ? "🔇 Muted" : txt, p.muted ? "" : cls));
    });
    const n = peers.size;
    setStatus(
      n === 0
        ? "You're the only one here. Share the invite link to bring friends in!"
        : `${n + 1} people in the room`
    );
  }
})();
