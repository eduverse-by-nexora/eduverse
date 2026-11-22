"use strict";
// EduVerse realtime classroom engine (Socket.IO).
//
// The server is the single source of truth for everything that carries a RULE:
//   * who sits on which bench seat
//   * who has a hand raised
//   * who may use the microphone      -> only faculty, or a student who is SEATED and not muted
//   * who may share a screen          -> only a SEATED student the faculty explicitly allowed,
//                                        and only one sharer per classroom at a time
//   * who may send audio / video to whom (WebRTC signalling is relayed only when the rules allow it)
// The browser only draws things and sends requests; it can never grant itself a permission.

const { userFromToken } = require("../middleware/auth");

// Seats per room come from the database: classroom 24 (4 rows x 2 benches x 3 seats). Must match Seating in public/js/config.js.
// The library has no seats (0): students pick up PDF notes there and can ask the librarian for help while standing.
const BAN_MS = 2 * 60 * 1000; // a removed student cannot re-enter that room for 2 minutes
const GRACE_MS = 10 * 1000; // a dropped connection keeps its seat this long
const TICK_MS = 100; // world snapshot rate (10 per second)
const DIRS = new Set(["up", "down", "left", "right"]);
const KINDS = new Set(["mic", "screen"]);
const MAX_REQUESTS = 30;

const coord = (n) => (typeof n === "number" && isFinite(n) ? Math.min(5000, Math.max(0, Math.round(n))) : 0);

class ClassroomEngine {
  constructor(io, roomList) {
    this.io = io;
    this.info = new Map(roomList.map((r) => [r.code, { type: r.type || "classroom", seats: r.seats ?? 24 }]));
    this.roomCodes = new Set(this.info.keys());
    this.players = new Map(); // userKey -> player
    this.rooms = new Map(); // code -> { seats: [], permit, sharer, requests: [] }
    for (const [code, i] of this.info) this.rooms.set(code, { seats: new Array(i.seats).fill(null), permit: null, sharer: null, requests: [] });
    this.mutes = new Map(); // studentKey -> room code (muted by faculty)
    this.bans = new Map(); // studentKey -> Map(code -> expiry)
    this.dirty = true;

    io.use(async (socket, next) => {
      try {
        const user = await userFromToken(socket.handshake.auth && socket.handshake.auth.token);
        if (!user) return next(new Error("unauthorized"));
        socket.data.user = user;
        next();
      } catch (e) {
        next(new Error("unauthorized"));
      }
    });
    io.on("connection", (socket) => this.onConnect(socket));

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.sweepTimer = setInterval(() => this.sweep(), 1000);
    this.tickTimer.unref();
    this.sweepTimer.unref();
  }

  // ------------------------------------------------------------------ helpers
  get(socket) {
    const p = this.players.get(String(socket.data.user._id));
    return p && p.socketId === socket.id ? p : null;
  }
  room(code) { return code ? this.rooms.get(code) : null; }
  isLibrary(code) { const i = this.info.get(code); return Boolean(i) && i.type === "library"; }
  seatCount(code) { const i = this.info.get(code); return i ? i.seats : 0; }
  socketOf(p) { return p && !p.offlineAt ? this.io.sockets.sockets.get(p.socketId) : null; }
  emitTo(p, event, payload) { const s = this.socketOf(p); if (s) s.emit(event, payload); }
  inRoom(code) { return [...this.players.values()].filter((p) => p.room === code && !p.offlineAt); }
  facultyOf(code) { return this.inRoom(code).filter((p) => p.role === "faculty"); }
  notifyFaculty(code, payload) { this.facultyOf(code).forEach((f) => this.emitTo(f, "notify", payload)); }
  isBanned(key, code) {
    const m = this.bans.get(key);
    if (!m) return false;
    const exp = m.get(code);
    if (!exp) return false;
    if (exp <= Date.now()) { m.delete(code); return false; }
    return true;
  }
  bansFor(key) {
    const m = this.bans.get(key);
    if (!m) return [];
    return [...m.keys()].filter((c) => this.isBanned(key, c));
  }
  pushBans(p) {
    const list = this.bansFor(p.key);
    const sig = list.join(",");
    if (sig !== p.bansSig) { p.bansSig = sig; this.emitTo(p, "bans", list); }
  }
  actorFaculty(p) { return p && p.role === "faculty" && p.assigned && p.room === p.assigned ? p : null; }
  // staff = the faculty of this classroom, or the librarian while in the library
  actorStaff(p) { return this.actorFaculty(p) || (p && p.role === "librarian" && this.isLibrary(p.room) ? p : null); }
  // library hands go to every librarian on duty, classroom hands to the faculty of that room
  notifyStaff(code, payload) {
    if (this.isLibrary(code)) [...this.players.values()].filter((x) => x.role === "librarian" && !x.offlineAt).forEach((x) => this.emitTo(x, "notify", payload));
    else this.notifyFaculty(code, payload);
  }

  // ------------------------------------------------------------------ connection lifecycle
  onConnect(socket) {
    const user = socket.data.user;
    const key = String(user._id);
    let p = this.players.get(key);
    if (p) {
      const old = this.socketOf(p);
      if (old && old.id !== socket.id) { old.data.replaced = true; old.disconnect(true); }
      p.socketId = socket.id;
      p.offlineAt = null;
      p.name = user.name;
    } else {
      p = {
        key, userId: user.userId, name: user.name, role: user.role, assigned: user.role === "faculty" ? user.room : null,
        socketId: socket.id, offlineAt: null,
        x: 0, y: 0, dir: "down", room: user.role === "faculty" ? user.room : null,
        enteredAt: user.role === "faculty" ? Date.now() : 0,
        mic: false, muted: false, speaking: false, seat: null, hand: 0, bansSig: "",
      };
      this.players.set(key, p);
    }
    this.dirty = true;

    // everything the client needs to start: its own identity, and the current world
    socket.emit("hello", { id: key, bans: this.bansFor(key) });
    this.pushBans(p);
    socket.emit("world", this.snapshot());

    socket.on("presence", (d) => this.onPresence(socket, d));
    socket.on("seat:sit", (d, ack) => this.safe(ack, () => this.sit(this.get(socket), d)));
    socket.on("seat:stand", (d, ack) => this.safe(ack, () => this.stand(this.get(socket), "You stood up.")));
    socket.on("hand:set", (d, ack) => this.safe(ack, () => this.setHand(this.get(socket), d)));
    socket.on("mic:set", (d, ack) => this.safe(ack, () => this.setMic(this.get(socket), d)));
    socket.on("screen:request", (d, ack) => this.safe(ack, () => this.screenRequest(this.get(socket), d)));
    socket.on("screen:cancel", (d, ack) => this.safe(ack, () => this.screenCancel(this.get(socket))));
    socket.on("screen:start", (d, ack) => this.safe(ack, () => this.screenStart(this.get(socket))));
    socket.on("screen:stop", (d, ack) => this.safe(ack, () => this.screenStop(this.get(socket))));
    socket.on("class:mute", (d, ack) => this.safe(ack, () => this.classMute(this.get(socket), d)));
    socket.on("class:mute-all", (d, ack) => this.safe(ack, () => this.classMuteAll(this.get(socket), d)));
    socket.on("class:remove", (d, ack) => this.safe(ack, () => this.classRemove(this.get(socket), d)));
    socket.on("class:lower-hand", (d, ack) => this.safe(ack, () => this.classLowerHand(this.get(socket), d)));
    socket.on("class:screen-grant", (d, ack) => this.safe(ack, () => this.screenGrant(this.get(socket), d)));
    socket.on("class:screen-deny", (d, ack) => this.safe(ack, () => this.screenDeny(this.get(socket), d)));
    socket.on("class:screen-revoke", (d, ack) => this.safe(ack, () => this.screenRevoke(this.get(socket))));
    socket.on("rtc:signal", (m) => this.relay(socket, m));
    socket.on("rtc:close", (m) => this.relayClose(socket, m));
    socket.on("disconnect", () => this.onDisconnect(socket));
  }

  safe(ack, fn) {
    let result;
    try { result = fn() || { ok: true }; } catch (err) { console.error("[engine]", err); result = { ok: false, error: "Something went wrong." }; }
    if (typeof ack === "function") ack(result);
  }

  onDisconnect(socket) {
    const p = this.players.get(String(socket.data.user._id));
    if (!p || p.socketId !== socket.id) return;
    if (socket.data.replaced) return; // a newer connection already took over
    // the connection (and any audio / screen stream) is gone: end those immediately, keep the seat for a moment
    p.mic = false; p.speaking = false;
    this.endScreenFor(p, "Connection lost.");
    p.offlineAt = Date.now();
    this.dirty = true;
  }

  // Called by the REST routes (logout, new login elsewhere, password change)
  disconnectUser(key, reason) {
    const p = this.players.get(key);
    if (!p) return;
    const s = this.socketOf(p);
    if (s) { s.data.replaced = true; s.emit("session:ended", { reason }); s.disconnect(true); }
    this.dropPlayer(p);
  }

  dropPlayer(p) {
    this.leaveRoom(p);
    if (p.role === "faculty") {
      // when a teacher leaves, the mutes they set in their room are lifted
      for (const [k, code] of this.mutes) if (code === p.assigned) this.mutes.delete(k);
    }
    this.players.delete(p.key);
    this.dirty = true;
  }

  sweep() {
    const now = Date.now();
    for (const p of [...this.players.values()]) {
      if (p.offlineAt && now - p.offlineAt > GRACE_MS) this.dropPlayer(p);
      else if (!p.offlineAt) this.pushBans(p);
    }
  }

  // ------------------------------------------------------------------ presence / rooms
  onPresence(socket, d) {
    const p = this.get(socket);
    if (!p || !d || typeof d !== "object") return;
    if (p.seat === null) {
      p.x = coord(d.x);
      p.y = coord(d.y);
      if (DIRS.has(d.dir)) p.dir = d.dir;
      let code = null;
      if (p.role === "faculty") code = p.assigned; // a teacher always belongs to their room
      else if (typeof d.room === "string" && this.roomCodes.has(d.room)) code = p.role === "librarian" && !this.isLibrary(d.room) ? null : d.room;
      this.setRoom(p, code);
    }
    const speaking = d.sp === true && p.mic;
    if (speaking !== p.speaking) p.speaking = speaking;
    this.dirty = true;
  }

  setRoom(p, code) {
    if (code && p.role === "student" && this.isBanned(p.key, code)) code = null; // removed students cannot be inside
    if (code === p.room) return;
    if (p.room) this.leaveRoom(p);
    p.room = code;
    p.enteredAt = code ? Date.now() : 0;
    p.muted = Boolean(code) && p.role === "student" && this.mutes.get(p.key) === code;
    this.dirty = true;
  }

  // Everything that belongs to "being in this room" is cleaned up here.
  leaveRoom(p) {
    const r = this.room(p.room);
    if (r && p.seat !== null && r.seats[p.seat] === p.key) r.seats[p.seat] = null;
    p.seat = null;
    p.hand = 0;
    if (p.mic) { p.mic = false; this.emitTo(p, "mic:forced", { reason: "You left the classroom." }); }
    p.speaking = false;
    this.endScreenFor(p, null);
    if (r) r.requests = r.requests.filter((k) => k !== p.key);
    this.dirty = true;
  }

  // ------------------------------------------------------------------ seats
  sit(p, d) {
    if (!p || p.role !== "student") return { ok: false, error: "Only students use the benches." };
    if (!p.room) return { ok: false, error: "Enter a classroom first." };
    if (p.seat !== null) return { ok: false, error: "You are already seated." };
    const idx = d && d.seat;
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.seatCount(p.room)) return { ok: false, error: "That seat does not exist." };
    const r = this.room(p.room);
    if (r.seats[idx] !== null) return { ok: false, error: "Someone just took that seat.", code: "SEAT_TAKEN" };
    r.seats[idx] = p.key;
    p.seat = idx;
    this.dirty = true;
    return { ok: true, seat: idx };
  }

  stand(p, reason) {
    if (!p) return { ok: false };
    if (p.seat === null) return { ok: true };
    const r = this.room(p.room);
    if (r && r.seats[p.seat] === p.key) r.seats[p.seat] = null;
    p.seat = null;
    p.hand = 0;
    if (p.mic) { p.mic = false; this.emitTo(p, "mic:forced", { reason: "You stood up, so the microphone was turned off." }); }
    p.speaking = false;
    this.endScreenFor(p, null);
    if (r) r.requests = r.requests.filter((k) => k !== p.key);
    this.dirty = true;
    return { ok: true };
  }

  // ------------------------------------------------------------------ raise hand
  setHand(p, d) {
    if (!p || p.role !== "student") return { ok: false, error: "Only students raise their hand." };
    const raised = Boolean(d && d.raised);
    if (raised) {
      if (!p.room) return { ok: false, error: "Enter a classroom first." };
      // the library has no seats: "Ask librarian" works anywhere inside it. In a classroom you must be seated.
      if (p.seat === null && !this.isLibrary(p.room)) return { ok: false, error: "Sit on a bench to raise your hand." };
      if (!p.hand) {
        p.hand = Date.now();
        this.notifyStaff(p.room, { type: "hand", id: p.key, name: p.name, seat: p.seat, room: p.room, library: this.isLibrary(p.room) });
      }
    } else {
      p.hand = 0;
    }
    this.dirty = true;
    return { ok: true, raised: Boolean(p.hand) };
  }

  classLowerHand(f, d) {
    if (!this.actorStaff(f)) return { ok: false, error: "Faculty only." };
    const t = this.studentIn(f, d && d.id);
    if (!t) return { ok: false, error: "That student is not in your room." };
    t.hand = 0;
    this.emitTo(t, "notify", { type: "hand-lowered", by: f.name });
    this.dirty = true;
    return { ok: true };
  }

  // ------------------------------------------------------------------ microphone
  setMic(p, d) {
    if (!p) return { ok: false };
    const on = Boolean(d && d.on);
    if (!on) { p.mic = false; p.speaking = false; this.dirty = true; return { ok: true, on: false }; }
    if (!p.room) return { ok: false, error: "Enter a classroom to use the microphone." };
    if (this.isLibrary(p.room)) return { ok: false, error: "The library is a quiet zone: no microphone here.", code: "QUIET_ZONE" };
    if (p.role === "student") {
      if (p.muted) return { ok: false, error: "Your teacher muted your microphone.", code: "MUTED" };
      if (p.seat === null) return { ok: false, error: "Sit on a bench to use the microphone.", code: "NOT_SEATED" };
    } else if (!this.actorFaculty(p)) {
      return { ok: false, error: "Faculty speak from their own classroom." };
    }
    p.mic = true;
    this.dirty = true;
    return { ok: true, on: true };
  }

  forceMicOff(p, reason) {
    if (!p.mic) return;
    p.mic = false; p.speaking = false;
    this.emitTo(p, "mic:forced", { reason });
    this.dirty = true;
  }

  // ------------------------------------------------------------------ screen sharing
  // room.permit  = student the faculty allowed to share (waiting to start, or currently sharing)
  // room.sharer  = whoever is sharing right now (a permitted student, or the faculty member)
  // room.requests = students who asked to share, oldest first
  screenRequest(p) {
    if (!p || p.role !== "student" || !p.room) return { ok: false, error: "Not in a classroom." };
    if (this.isLibrary(p.room)) return { ok: false, error: "Screen sharing is not available in the library.", code: "QUIET_ZONE" };
    if (p.seat === null) return { ok: false, error: "Sit on a bench to request screen sharing." };
    const r = this.room(p.room);
    if (r.sharer === p.key || r.permit === p.key) return { ok: true };
    if (!r.requests.includes(p.key)) {
      if (r.requests.length >= MAX_REQUESTS) return { ok: false, error: "Too many requests right now." };
      r.requests.push(p.key);
      this.notifyFaculty(p.room, { type: "screen-request", id: p.key, name: p.name });
    }
    this.dirty = true;
    return { ok: true };
  }

  screenCancel(p) {
    if (!p || !p.room) return { ok: false };
    const r = this.room(p.room);
    r.requests = r.requests.filter((k) => k !== p.key);
    if (r.permit === p.key && r.sharer !== p.key) r.permit = null;
    this.dirty = true;
    return { ok: true };
  }

  screenGrant(f, d) {
    if (!this.actorFaculty(f)) return { ok: false, error: "Faculty only." };
    const r = this.room(f.room);
    const t = this.players.get(d && d.id);
    if (!t || t.room !== f.room || t.role !== "student" || t.offlineAt) return { ok: false, error: "That student is not in your room." };
    if (t.seat === null) return { ok: false, error: "Only seated students can share. Ask them to sit first." };
    if (r.sharer) {
      const who = this.players.get(r.sharer);
      return { ok: false, error: `${who ? who.name : "Someone"} is sharing right now. Stop that share first.`, code: "SHARE_ACTIVE" };
    }
    if (r.permit && r.permit !== t.key) {
      const old = this.players.get(r.permit);
      if (old) this.emitTo(old, "screen:revoked", { reason: "Permission was given to another student." });
    }
    r.permit = t.key;
    r.requests = r.requests.filter((k) => k !== t.key);
    this.emitTo(t, "screen:granted", { by: f.name });
    this.dirty = true;
    return { ok: true };
  }

  screenDeny(f, d) {
    if (!this.actorFaculty(f)) return { ok: false, error: "Faculty only." };
    const r = this.room(f.room);
    const t = this.players.get(d && d.id);
    r.requests = r.requests.filter((k) => k !== (d && d.id));
    if (t && t.room === f.room) this.emitTo(t, "screen:denied", { by: f.name });
    this.dirty = true;
    return { ok: true };
  }

  // Faculty: take back the permission, or stop a share that is running
  screenRevoke(f) {
    if (!this.actorFaculty(f)) return { ok: false, error: "Faculty only." };
    const r = this.room(f.room);
    const target = r.sharer && r.sharer !== f.key ? this.players.get(r.sharer) : r.permit ? this.players.get(r.permit) : null;
    if (target) this.emitTo(target, "screen:revoked", { reason: `${f.name} ended screen sharing.` });
    if (r.sharer && r.sharer !== f.key) r.sharer = null;
    r.permit = null;
    this.dirty = true;
    return { ok: true };
  }

  screenStart(p) {
    if (!p || !p.room) return { ok: false, error: "Not in a classroom." };
    if (this.isLibrary(p.room)) return { ok: false, error: "Screen sharing is not available in the library.", code: "QUIET_ZONE" };
    const r = this.room(p.room);
    if (r.sharer && r.sharer !== p.key) {
      const who = this.players.get(r.sharer);
      return { ok: false, error: `${who ? who.name : "Someone"} is already sharing their screen.`, code: "SHARE_ACTIVE" };
    }
    if (p.role === "faculty") {
      if (!this.actorFaculty(p)) return { ok: false, error: "Faculty share from their own classroom." };
    } else {
      if (p.seat === null) return { ok: false, error: "Sit on a bench to share your screen.", code: "NOT_SEATED" };
      if (r.permit !== p.key) return { ok: false, error: "Your teacher has not allowed you to share your screen.", code: "NOT_PERMITTED" };
    }
    r.sharer = p.key;
    r.requests = r.requests.filter((k) => k !== p.key);
    this.dirty = true;
    return { ok: true };
  }

  screenStop(p) {
    if (!p || !p.room) return { ok: false };
    const r = this.room(p.room);
    if (r.sharer === p.key) { r.sharer = null; if (r.permit === p.key) r.permit = null; }
    this.dirty = true;
    return { ok: true };
  }

  // The player can no longer share (stood up, left, disconnected): drop their permission / share.
  endScreenFor(p, reason) {
    const r = this.room(p.room);
    if (!r) return;
    const wasSharing = r.sharer === p.key;
    if (wasSharing) r.sharer = null;
    if (r.permit === p.key) {
      r.permit = null;
      if (reason !== null && !wasSharing) this.emitTo(p, "screen:revoked", { reason });
    }
    if (wasSharing) this.emitTo(p, "screen:revoked", { reason: reason || "Screen sharing stopped because you left your seat." });
    this.dirty = true;
  }

  // ------------------------------------------------------------------ faculty moderation
  // a student the moderator may act on: faculty -> in their own room; librarian -> anywhere in the library
  studentIn(f, id) {
    const t = this.players.get(id);
    if (!t || t.role !== "student" || t.offlineAt || !t.room) return null;
    if (f.role === "librarian") return this.isLibrary(t.room) ? t : null;
    return t.room === f.room ? t : null;
  }

  classMute(f, d) {
    if (!this.actorFaculty(f)) return { ok: false, error: "Faculty only." };
    const t = this.studentIn(f, d && d.id);
    if (!t) return { ok: false, error: "That student is not in your room." };
    this.applyMute(t, f.room, Boolean(d.muted));
    return { ok: true };
  }

  classMuteAll(f, d) {
    if (!this.actorFaculty(f)) return { ok: false, error: "Faculty only." };
    const muted = Boolean(d && d.muted);
    const list = this.inRoom(f.room).filter((p) => p.role === "student");
    list.forEach((t) => this.applyMute(t, f.room, muted));
    return { ok: true, count: list.length };
  }

  applyMute(t, code, muted) {
    if (muted) { this.mutes.set(t.key, code); this.forceMicOff(t, "Your teacher muted your microphone."); }
    else this.mutes.delete(t.key);
    t.muted = muted;
    this.dirty = true;
  }

  classRemove(f, d) {
    if (!this.actorStaff(f)) return { ok: false, error: "Staff only." };
    const t = this.studentIn(f, d && d.id);
    if (!t) return { ok: false, error: "That student is not in your room." };
    const code = t.room;
    if (!this.bans.has(t.key)) this.bans.set(t.key, new Map());
    this.bans.get(t.key).set(code, Date.now() + BAN_MS);
    this.mutes.delete(t.key);
    this.leaveRoom(t);
    t.room = null; t.enteredAt = 0; t.muted = false;
    this.emitTo(t, "removed", { room: code, by: f.name });
    this.pushBans(t);
    this.dirty = true;
    return { ok: true };
  }

  // ------------------------------------------------------------------ WebRTC signalling relay
  // Media itself flows peer-to-peer. The server decides whether a connection may even be negotiated.
  //   role "pub": message from the publisher (offer / candidate)   -> publisher must be allowed to stream to the receiver
  //   role "sub": message from the receiver  (answer / candidate)  -> the publisher it answers must be allowed to stream to it
  canStream(from, to, kind) {
    if (!from || !to || from.key === to.key || from.offlineAt || to.offlineAt) return false;
    if (!from.room || from.room !== to.room) return false;
    if (kind === "mic") {
      if (!from.mic) return false;
      if (from.role === "faculty") return true; // the teacher is heard by everybody in the room
      // students are heard by the faculty and by the other SEATED students
      return from.seat !== null && !from.muted && (to.role === "faculty" || to.seat !== null);
    }
    if (kind === "screen") {
      const r = this.room(from.room);
      return Boolean(r) && r.sharer === from.key; // everybody else in the room may watch
    }
    return false;
  }

  relay(socket, m) {
    const me = this.get(socket);
    if (!me || !m || typeof m !== "object" || !KINDS.has(m.kind)) return;
    const other = this.players.get(m.to);
    if (!other) return;
    const role = m.role === "sub" ? "sub" : "pub";
    const allowed = role === "pub" ? this.canStream(me, other, m.kind) : this.canStream(other, me, m.kind);
    if (!allowed) return;
    const s = this.socketOf(other);
    if (s) s.emit("rtc:signal", { from: me.key, kind: m.kind, role, data: m.data });
  }

  relayClose(socket, m) {
    const me = this.get(socket);
    if (!me || !m || !KINDS.has(m.kind)) return;
    const other = this.players.get(m.to);
    const s = other && this.socketOf(other);
    if (s) s.emit("rtc:close", { from: me.key, kind: m.kind, role: m.role === "sub" ? "sub" : "pub" });
  }

  // ------------------------------------------------------------------ snapshots
  snapshot() {
    const players = [];
    for (const p of this.players.values()) {
      players.push({
        id: p.key, uid: p.userId, name: p.name, role: p.role,
        x: p.x, y: p.y, dir: p.dir, room: p.room,
        mic: p.mic, muted: p.muted, sp: p.speaking,
        seat: p.seat, hand: p.hand, since: p.enteredAt, off: Boolean(p.offlineAt),
      });
    }
    const rooms = {};
    for (const [code, r] of this.rooms) {
      if (r.sharer || r.permit || r.requests.length) rooms[code] = { sharer: r.sharer, permit: r.permit, requests: r.requests };
    }
    return { t: Date.now(), players, rooms, online: players.filter((p) => !p.off).length };
  }

  tick() {
    if (!this.dirty) return;
    this.dirty = false;
    this.io.emit("world", this.snapshot());
  }
}

module.exports = { ClassroomEngine };
