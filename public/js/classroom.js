// Everything that happens INSIDE a classroom: seats, auto-walk, raise hand, microphone, screen sharing,
// the control bar, and the handlers for what the server tells us.
// The server decides every rule (see src/classroom/engine.js); this file shows the state and asks for changes.
Object.assign(CampusWorld, {
    seat: null, auto: null, nearSeat: null, handUp: false,
    mic: null, screen: null, seatMap: {}, ctrlTap: false,

    resetClassroomState() {
        this.seat = { idx: null, phase: 'none', t: 0, from: null, to: null, stand: null, pending: false, confirmedAt: 0 };
        this.auto = null;
        this.nearSeat = null;
        this.handUp = false;
        this.mic = { on: false, busy: false, locked: false, stream: null, ctx: null, analyser: null, buf: null, speaking: false, lastLoud: 0 };
        this.screen = { on: false, busy: false, stream: null, hasAudio: false };
        this.seatMap = {};
        this.ctrlTap = false;
    },

    // ------------------------------------------------------------------ room bar markup + wiring
    roomBarHTML() {
        const role = State.user.role, student = role === 'student', librarian = role === 'librarian';
        const btn = (id, extra) => `<span class="btn-wrap" data-wrap="${id}"><button type="button" id="${id}" class="media-btn" ${extra || ''}><span class="icon"></span><span class="label"></span><span class="kbd"></span></button></span>`;
        return `
        <div id="room-bar" class="room-bar" aria-label="Classroom controls">
            <div class="room-bar-info"><strong id="room-bar-title">Classroom</strong><span id="room-bar-sub"></span></div>
            <div class="room-bar-actions">
                ${student ? btn('seat-btn') : ''}
                ${librarian ? '' : `<span class="btn-wrap" data-wrap="room-mic-btn"><button type="button" id="room-mic-btn" class="media-btn" aria-pressed="false"><span class="icon"></span><span class="label"></span><span class="mic-meter" aria-hidden="true"><i id="mic-meter-bar"></i></span></button></span>
                ${btn('room-screen-btn')}`}
                ${student ? btn('hand-btn') : ''}
                ${student ? btn('notes-btn') : ''}
                ${librarian ? '' : `<div class="vol-wrap">
                    <button type="button" id="vol-btn" class="media-btn icon-only" title="Classroom volume" aria-label="Classroom volume"><span class="icon">${Icons.svg('volume', 18)}</span></button>
                    <div class="vol-pop" id="vol-pop" hidden>
                        <label for="vol-range">Classroom volume</label>
                        <input type="range" id="vol-range" min="0" max="100" value="100">
                        <button type="button" id="deafen-btn" class="btn-mini">Mute speakers</button>
                    </div>
                </div>`}
            </div>
        </div>`;
    },

    initClassroomUI() {
        const $ = id => document.getElementById(id);
        const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', e => { e.currentTarget.blur(); fn(e); }); };
        on('seat-btn', () => (this.seat.phase === 'seated' ? this.standUp() : this.nearSeat ? this.sitDown(this.nearSeat) : this.showToast('Find a free bench', 'Walk up to a green-marked seat, then press S.', 'info')));
        on('room-mic-btn', () => this.toggleMic());
        on('room-screen-btn', () => this.onScreenButton());
        on('hand-btn', () => this.toggleHand());
        on('notes-btn', () => Dock.showNotes());
        if ($('vol-btn')) {
            on('vol-btn', () => { const p = $('vol-pop'); p.hidden = !p.hidden; });
            $('vol-range').addEventListener('input', e => RTC.setVolume(e.target.value / 100));
            on('deafen-btn', () => {
                RTC.setDeafened(!RTC.deafened);
                $('deafen-btn').textContent = RTC.deafened ? 'Unmute speakers' : 'Mute speakers';
                $('vol-btn').querySelector('.icon').innerHTML = Icons.svg(RTC.deafened ? 'volumeX' : 'volume', 18);
            });
        }
        // a disabled button explains itself when clicked
        Util.$$('.btn-wrap').forEach(w => w.addEventListener('click', () => {
            const b = w.querySelector('button');
            if (b && b.disabled && w.dataset.reason) this.showToast(w.dataset.reasonTitle || 'Not available yet', w.dataset.reason, 'warn');
        }));
        this.updateRoomBar();
    },

    // ------------------------------------------------------------------ small queries
    seatOwners(code) { return this.seatMap[code] || {}; },
    isSeatFree(code, idx) {
        const o = this.seatMap[code] || {};
        if (o[idx] && o[idx] !== Net.myId) return false;
        return true;
    },
    freeSeats(code) {
        const o = this.seatMap[code] || {};
        let taken = Object.keys(o).length;
        if (this.seat.idx !== null && this.currentRoomCode === code && o[this.seat.idx] !== Net.myId) taken++;
        const room = this.roomObj(code);
        return Math.max(0, (room ? room.seatCount : Seating.cfg.classroom.count) - taken);
    },
    studentsIn(code) {
        let n = Object.values(this.remote).filter(p => p.room === code && p.role === 'student').length;
        if (this.currentRoomCode === code && State.user.role === 'student') n++;
        return n;
    },
    playerById(id) { return id === Net.myId ? this.meServer : this.remote[id] || null; },
    rosterFor(code) {
        const list = Object.values(this.remote).filter(p => p.room === code);
        if (this.meServer && this.meServer.room === code && State.user.role === 'student') list.push(this.meServer);
        return list;
    },
    isSharer(id) { return Object.values(this.serverRooms).some(r => r.sharer === id); },
    shareInfo() {
        const code = this.meServer && this.meServer.room;
        const rs = (code && this.serverRooms[code]) || {};
        const sharerId = rs.sharer || null;
        return { sharerId, sharer: sharerId ? this.playerById(sharerId) : null, permit: rs.permit || null, requests: rs.requests || [] };
    },
    seatedNow() { return this.seat.phase === 'seated' && !this.seat.pending; },

    // ------------------------------------------------------------------ what the server tells us
    netHandlers() {
        return {
            hello: () => {},
            world: d => this.onWorld(d),
            bans: list => { this.bannedCodes = list || []; },
            notify: n => this.onNotify(n),
            removed: ev => this.handleRemoved(ev),
            'session:ended': d => this.sessionEnded(d && d.reason),
            'mic:forced': d => { this.stopMic(); this.showToast('Microphone turned off', (d && d.reason) || 'Your microphone was turned off.', 'warn'); },
            'screen:granted': d => { this.showToast('You can share your screen', `${d.by} allowed it. Press "Start sharing" when you are ready.`, 'success'); this.updateRoomBar(); },
            'screen:denied': d => { this.showToast('Screen sharing declined', `${d.by} did not allow screen sharing right now.`, 'warn'); this.updateRoomBar(); },
            'screen:revoked': d => { if (this.screen.on) this.stopScreenLocal(false); this.showToast('Screen sharing ended', (d && d.reason) || 'Sharing was stopped.', 'warn'); this.updateRoomBar(); },
            'rtc:signal': d => RTC.onSignal(d),
            'rtc:close': d => RTC.onClose(d),
            connect: () => {
                const c = document.getElementById('conn-status');
                if (c) c.hidden = true;
                if (this._wasDown) { this._wasDown = false; this.showToast('Back online', 'Connection restored.', 'success'); RTC.sync(); }
            },
            disconnect: () => {
                const c = document.getElementById('conn-status');
                if (c) c.hidden = false;
                this._wasDown = true;
                // the connection (and every stream sent over it) is gone
                if (this.mic.on) { this.stopMic(); this.showToast('Connection lost', 'Your microphone was turned off. Turn it on again once you are back online.', 'warn'); }
                if (this.screen.on) this.stopScreenLocal(false);
            },
            error: err => {
                if (err && err.message === 'unauthorized') this.sessionEnded('expired');
            }
        };
    },

    onWorld(data) {
        const seatMap = {}, seen = {};
        this.serverRooms = data.rooms || {};
        data.players.forEach(p => {
            if (p.id === Net.myId) this.meServer = p;
            else {
                seen[p.id] = true;
                let r = this.remote[p.id];
                if (!r) r = this.remote[p.id] = { cx: p.x, cy: p.y, phase: 0, amount: 0, look: Avatar.look(p.uid, p.role) };
                Object.assign(r, p);
            }
            if (p.seat !== null && p.room) (seatMap[p.room] = seatMap[p.room] || {})[p.seat] = p.id;
        });
        Object.keys(this.remote).forEach(id => { if (!seen[id]) delete this.remote[id]; });
        this.seatMap = seatMap;
        this.onlineCount = data.online;
        const counter = document.getElementById('online-count');
        if (counter) counter.textContent = `${data.online} online`;

        const me = this.meServer;
        if (me) {
            this.handUp = Boolean(me.hand);
            // muted by the teacher?
            const locked = Boolean(me.muted) && Boolean(this.currentRoomCode);
            if (locked !== this.mic.locked) {
                this.mic.locked = locked;
                if (locked) { this.stopMic(); this.showToast('You were muted', 'Your teacher muted your microphone.', 'warn'); }
                else if (this.currentRoomCode && State.user.role === 'student') this.showToast('You can speak again', 'Your teacher allowed the microphone.', 'success');
            }
            this.reconcileSeat(me);
        }
        this.renderLiveClasses();
        this.updateRoomBar();
        Dock.update();
        RTC.sync();
        if (this.isModalOpen) this.renderNotices();
    },

    // my seat according to the server vs. what I think
    reconcileSeat(me) {
        const s = this.seat, now = performance.now();
        if (s.phase === 'seated' && !s.pending && me.seat === null && now - s.confirmedAt > 800) {
            // the server stood me up (removed, reconnected, ...)
            this.beginRise(false);
            this.showToast('You left your seat', 'The server released your seat.', 'info');
        } else if (s.phase === 'none' && me.seat !== null && now - (s.freedAt || 0) > 1200) {
            Net.emit('seat:stand'); // the server still holds a seat I am not sitting on
        }
    },

    onNotify(n) {
        if (n.type === 'hand') {
            const label = n.library ? 'In the library' : n.seat !== undefined && n.seat !== null ? Seating.label(n.seat) : '';
            this.playChime('hand');
            Toast.show(n.library ? `${n.name} needs help` : `${n.name} raised a hand`, label, { type: 'hand', duration: 6000, onClick: () => Dock.act('select', n.id) });
        } else if (n.type === 'screen-request') {
            this.playChime('screen');
            Toast.show(`${n.name} wants to share their screen`, 'Open the Screen tab to allow or deny.', { type: 'screen', duration: 7000, onClick: () => Dock.act('tab', 'screen') });
        } else if (n.type === 'hand-lowered') {
            this.showToast('Hand lowered', `${n.by} lowered your hand.`, 'info');
        }
    },

    // removed by the teacher: back to the lobby
    handleRemoved(ev) {
        this.stopMic();
        this.stopScreenLocal(false);
        this.cancelAutoWalk(false);
        this.seat = { idx: null, phase: 'none', t: 0, from: null, to: null, stand: null, pending: false, confirmedAt: 0, freedAt: performance.now() };
        this.handUp = false;
        const hall = this.getLayout().hall;
        this.avatar.x = hall.x + hall.width / 2 + (Math.random() - 0.5) * 300;
        this.avatar.y = hall.y + hall.height * 0.78;
        this.avatar.vx = 0; this.avatar.vy = 0; this.avatar.walkAmount = 0;
        this.updateRoomState(this.getLayout());
        this.showToast('Removed from class', `${ev.by || 'Your teacher'} removed you from ${ev.room}. You are back in the lobby.`, 'warn');
    },

    // ------------------------------------------------------------------ entering / leaving a room (by position)
    updateRoomState(layout) {
        const room = this.roomAt(layout, this.avatar.x, this.avatar.y);
        const code = room ? room.subject.code : null;
        if (code === this.currentRoomCode) return;

        this.currentRoomCode = code;
        this.stopMic();               // the microphone never follows you into another room or the hall
        this.mic.locked = false;      // the server re-applies a mute when you enter a room where you are muted
        this.cancelAutoWalk(false);
        this.nearSeat = null;
        const livePanel = document.getElementById('live-classes-panel');
        if (livePanel) livePanel.classList.toggle('in-room', Boolean(room));
        this.updateRoomBar();
        this.updateHint();

        // a student who walks in hears the entry sound once and is guided towards the seating area.
        // The library has no seats: instead the notes panel opens on the right.
        if (room && State.user.role === 'student') {
            this.playEnterSound();
            if (room.type === 'library') Dock.openNotesOnEntry();
            else this.startAutoWalk();
        }
        else if (!room && this.enterAudio) this.enterAudio.pause();
    },

    // ------------------------------------------------------------------ auto-walk to the seating area
    pickSeat(room, skipIdx) {
        const a = this.avatar, code = room.subject.code;
        let best = null, bd = Infinity;
        room.seats.forEach(s => {
            if (s.idx === skipIdx || !this.isSeatFree(code, s.idx)) return;
            const d = Math.hypot(s.sx - a.x, s.sy - a.y);
            if (d < bd) { bd = d; best = s; }
        });
        return best;
    },

    startAutoWalk(skipIdx) {
        const room = this.roomObj(this.currentRoomCode);
        if (!room || State.user.role !== 'student' || this.seat.phase !== 'none') return;
        const seat = this.pickSeat(room, skipIdx);
        if (!seat) {
            this.showToast('The classroom is full', 'All seats are taken. Wait here: your teacher can see you are waiting for a seat.', 'warn');
            return;
        }
        const path = this.planPath(this.avatar.x, this.avatar.y, seat.sx, seat.sy);
        if (!path) return;
        const first = !this.auto;
        this.auto = { path, i: 0, seatIdx: seat.idx, code: room.subject.code, check: 0 };
        if (first) this.showToast('Heading to the seating area', 'Press S when you reach a free bench. Move any time to take over.', 'info');
        this.updateHint();
    },

    cancelAutoWalk(announce) {
        if (!this.auto) return;
        this.auto = null;
        this.updateHint();
        if (announce) this.updateRoomBar();
    },

    // steering input (-1..1 on each axis) while the avatar walks itself
    autoInput() {
        const au = this.auto, a = this.avatar;
        // someone else took "my" seat: pick another one
        if (++au.check > 20) {
            au.check = 0;
            if (!this.isSeatFree(au.code, au.seatIdx)) { this.startAutoWalk(au.seatIdx); if (!this.auto) return [0, 0]; return this.autoInput(); }
        }
        let wp = au.path[au.i];
        while (wp && Math.hypot(wp.x - a.x, wp.y - a.y) < (au.i === au.path.length - 1 ? 5 : 12)) { au.i++; wp = au.path[au.i]; }
        if (!wp) { this.auto = null; this.updateHint(); return [0, 0]; }
        const dx = wp.x - a.x, dy = wp.y - a.y, d = Math.hypot(dx, dy) || 1;
        const sp = au.i === au.path.length - 1 ? Util.clamp(d / 30, 0.3, 1) : 1;
        return [dx / d * sp, dy / d * sp];
    },

    // A* over a coarse grid of the room floor (benches and desks are obstacles), then straightened
    planPath(sx, sy, tx, ty) {
        const room = this.roomObj(this.currentRoomCode), layout = this.getLayout(), r = this.avatar.rad;
        if (!room) return null;
        const cell = 10, bx = room.inner.x, by = room.inner.y;
        const cols = Math.floor(room.inner.w / cell) + 1, rows = Math.floor(room.inner.h / cell) + 1;
        const ok = new Map();
        const free = (gx, gy) => {
            if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) return false;
            const k = gy * cols + gx;
            if (!ok.has(k)) ok.set(k, this.canStand(layout, bx + gx * cell, by + gy * cell, r));
            return ok.get(k);
        };
        const near = (x, y) => {
            const gx = Math.round((x - bx) / cell), gy = Math.round((y - by) / cell);
            for (let d = 0; d < 6; d++) for (let oy = -d; oy <= d; oy++) for (let ox = -d; ox <= d; ox++) if (free(gx + ox, gy + oy)) return [gx + ox, gy + oy];
            return null;
        };
        const start = near(sx, sy), goal = near(tx, ty);
        if (!start || !goal) return null;
        const h = (x, y) => { const dx = Math.abs(x - goal[0]), dy = Math.abs(y - goal[1]); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); };
        const g = new Map(), from = new Map(), closed = new Set();
        const open = [[h(start[0], start[1]), start[0], start[1]]];
        g.set(start[1] * cols + start[0], 0);
        const push = n => { open.push(n); let i = open.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (open[p][0] <= open[i][0]) break; [open[p], open[i]] = [open[i], open[p]]; i = p; } };
        const pop = () => { const top = open[0], last = open.pop(); if (open.length) { open[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, rr = l + 1, m = i; if (l < open.length && open[l][0] < open[m][0]) m = l; if (rr < open.length && open[rr][0] < open[m][0]) m = rr; if (m === i) break; [open[m], open[i]] = [open[i], open[m]]; i = m; } } return top; };
        let found = false;
        while (open.length) {
            const [, x, y] = pop(), k = y * cols + x;
            if (closed.has(k)) continue;
            closed.add(k);
            if (x === goal[0] && y === goal[1]) { found = true; break; }
            for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
                if (!ox && !oy) continue;
                const nx = x + ox, ny = y + oy;
                if (!free(nx, ny) || (ox && oy && (!free(x + ox, y) || !free(x, y + oy)))) continue;
                const nk = ny * cols + nx, ng = g.get(k) + (ox && oy ? Math.SQRT2 : 1);
                if (ng < (g.has(nk) ? g.get(nk) : Infinity)) { g.set(nk, ng); from.set(nk, k); push([ng + h(nx, ny), nx, ny]); }
            }
        }
        if (!found) return null;
        let pts = [], k = goal[1] * cols + goal[0];
        while (k !== undefined) { pts.push({ x: bx + (k % cols) * cell, y: by + Math.floor(k / cols) * cell }); k = from.get(k); }
        pts.reverse();
        if (this.canStand(layout, tx, ty, r)) pts[pts.length - 1] = { x: tx, y: ty };
        // straighten: skip points that can be reached in a straight line
        const clear = (p, q) => {
            const n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 5);
            for (let i = 1; i < n; i++) if (!this.canStand(layout, p.x + (q.x - p.x) * i / n, p.y + (q.y - p.y) * i / n, r)) return false;
            return true;
        };
        const out = [];
        let i = 0;
        while (i < pts.length - 1) {
            let j = pts.length - 1;
            while (j > i + 1 && !clear(pts[i], pts[j])) j--;
            out.push(pts[j]);
            i = j;
        }
        return out.length ? out : [pts[pts.length - 1]];
    },

    // ------------------------------------------------------------------ sit / stand
    updateNearSeat() {
        this.nearSeat = null;
        const room = this.roomObj(this.currentRoomCode);
        if (!room || State.user.role !== 'student' || this.seat.phase !== 'none') return;
        const a = this.avatar, l = room.toLocal(a.x, a.y);
        let bd = Seating.sitRange;
        room.seats.forEach(s => {
            if (!this.isSeatFree(room.subject.code, s.idx)) return;
            if (l.v < s.v - 4) return; // sit from the walkway behind the bench, not from in front of the desk
            const d = Math.hypot(a.x - s.x, a.y - s.y);
            if (d < bd) { bd = d; this.nearSeat = s; }
        });
    },

    async sitDown(seat) {
        if (this.seat.phase !== 'none' || State.user.role !== 'student') return;
        const a = this.avatar;
        this.cancelAutoWalk(false);
        this.seat = {
            idx: seat.idx, phase: 'sitting', t: 0, from: { x: a.x, y: a.y }, to: { x: seat.x, y: seat.y + this.SEAT_DY },
            stand: { x: seat.sx, y: seat.sy }, pending: true, confirmedAt: 0, freedAt: 0
        };
        a.dir = seat.face; a.vx = 0; a.vy = 0;
        this.nearSeat = null;
        this.setPrompt(null);
        this.updateRoomBar(); this.updateHint();
        const res = await Net.request('seat:sit', { seat: seat.idx });
        if (this.seat.idx !== seat.idx) return;
        this.seat.pending = false;
        if (!res.ok) {
            this.showToast("Couldn't take that seat", res.error || 'Try another bench.', 'warn');
            this.beginRise(false);
            return;
        }
        this.seat.confirmedAt = performance.now();
        this.showToast('You are seated', `${Seating.label(seat.idx)}. Your microphone, screen sharing and Raise Hand are now available.`, 'success');
        this.updateRoomBar(); this.updateHint();
    },

    standUp() {
        const s = this.seat;
        if (s.phase !== 'seated' || s.pending) return;
        Net.request('seat:stand');
        this.handUp = false;
        this.stopMic();
        this.stopScreenLocal(false);
        this.beginRise(false);
        this.showToast('You stood up', 'Microphone, screen sharing and Raise Hand are off until you sit again.', 'info');
    },

    beginRise() {
        const s = this.seat, a = this.avatar;
        s.phase = 'rising'; s.t = 0; s.from = { x: a.x, y: a.y }; s.to = s.stand;
        this.handUp = false;
        this.stopMic();
        this.stopScreenLocal(false);
        this.updateRoomBar(); this.updateHint();
    },

    // returns true while the avatar is seated or moving to / from a seat (no walking then)
    updateSeat(dtf) {
        const s = this.seat, a = this.avatar;
        if (s.phase === 'none') return false;
        if (s.phase === 'sitting' || s.phase === 'rising') {
            s.t = Math.min(1, s.t + dtf / 20);
            const e = Util.ease(s.t);
            a.x = Util.lerp(s.from.x, s.to.x, e);
            a.y = Util.lerp(s.from.y, s.to.y, e);
            if (s.t >= 1) {
                if (s.phase === 'sitting') { s.phase = 'seated'; this.updateRoomBar(); this.updateHint(); }
                else { s.phase = 'none'; s.idx = null; s.freedAt = performance.now(); a.dir = a.dir; this.updateRoomBar(); this.updateHint(); }
            }
        }
        return true;
    },

    handleClassroomKey(e, key, isDown) {
        const student = State.user.role === 'student';
        if (isDown && key !== 'control') this.ctrlTap = false;
        if (isDown && (e.ctrlKey || e.metaKey) && key === 's' && this.currentRoomCode) e.preventDefault(); // no "Save page" dialog
        if (!student) return false;

        if (key === 'control') {
            // Ctrl pressed on its own (a tap) = stand up. Ctrl+C, Ctrl+R and friends do not.
            if (isDown && !e.repeat) this.ctrlTap = true;
            if (!isDown) { if (this.ctrlTap && this.seat.phase === 'seated') this.standUp(); this.ctrlTap = false; }
            return true;
        }
        if (isDown && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
            if (key === 's' && this.nearSeat && this.seat.phase === 'none') { e.preventDefault(); this.sitDown(this.nearSeat); return true; }
            if (key === 'h' && this.currentRoomCode) { this.toggleHand(); return true; }
        }
        return false;
    },

    // ------------------------------------------------------------------ raise hand
    async toggleHand() {
        const inLibrary = (this.roomObj(this.currentRoomCode) || {}).type === 'library'; // no seats there: ask the librarian from anywhere inside
        if (!inLibrary && !this.seatedNow()) { this.showToast('Sit down first', 'You can raise your hand once you are seated on a bench.', 'warn'); return; }
        const want = !this.handUp;
        const res = await Net.request('hand:set', { raised: want });
        if (!res.ok) { this.showToast('Cannot raise your hand', res.error || '', 'warn'); return; }
        this.handUp = res.raised;
        const lib = (this.roomObj(this.currentRoomCode) || {}).type === 'library';
        this.showToast(res.raised ? (lib ? 'Librarian called' : 'Hand raised') : 'Hand lowered', res.raised ? (lib ? 'The librarian can see you need help.' : 'Your teacher can see it now.') : '', res.raised ? 'hand' : 'info');
        this.updateRoomBar();
    },

    // ------------------------------------------------------------------ microphone
    micBlockedReason() {
        if (!this.currentRoomCode) return { title: 'Join a classroom', text: 'The microphone works inside a classroom.' };
        if (!Net.connected) return { title: 'Reconnecting…', text: 'The connection to the server was lost. One moment.' };
        if (State.user.role === 'student') {
            if (this.mic.locked) return { title: 'Muted by your teacher', text: 'You can speak again once your teacher allows it.' };
            if (!this.seatedNow()) return { title: 'Sit on a bench first', text: 'Students can talk to the teacher only while seated. Walk to a free bench and press S.' };
        }
        return null;
    },

    async toggleMic() {
        const m = this.mic;
        if (m.busy) return;
        if (m.on) { this.stopMic(); this.showToast('Microphone off', 'You are muted.', 'info'); return; }
        const block = this.micBlockedReason();
        if (block) { this.showToast(block.title, block.text, 'warn'); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showToast('Microphone unavailable', window.isSecureContext ? 'This browser cannot access a microphone.' : 'The microphone only works on https:// pages or on localhost.', 'error');
            return;
        }
        m.busy = true;
        this.updateRoomBar();
        let stream = null;
        try {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
            } catch (err) {
                if (err && err.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                else throw err;
            }
            // the permission prompt may have taken a while: check the rules again
            if (State.appState !== 'VIRTUAL_CAMPUS' || this.micBlockedReason()) { stream.getTracks().forEach(t => t.stop()); const b = this.micBlockedReason(); if (b) this.showToast(b.title, b.text, 'warn'); return; }
            const res = await Net.request('mic:set', { on: true });
            if (!res.ok) { stream.getTracks().forEach(t => t.stop()); this.showToast('Microphone not allowed', res.error || '', 'warn'); return; }
            m.stream = stream; m.on = true;
            stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => {
                if (m.stream === stream) { this.stopMic(); this.showToast('Microphone disconnected', 'Your microphone stopped working.', 'warn'); }
            }));
            this.startMeter(stream);
            RTC.setLocal('mic', stream);
            this.showToast('Microphone on', State.user.role === 'faculty' ? 'Your students can hear you.' : 'Your teacher and seated classmates can hear you.', 'mic');
        } catch (err) {
            const n = err && err.name;
            if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') this.showToast('Microphone not allowed', 'Click the icon left of the address bar, allow Microphone, then try again.', 'error');
            else if (n === 'NotFoundError') this.showToast('No microphone found', 'Plug in or enable a microphone and try again.', 'error');
            else if (n === 'NotReadableError' || n === 'AbortError') this.showToast('Microphone is busy', 'Another app may be using it. Close it and try again.', 'error');
            else this.showToast('Microphone error', 'Could not start the microphone.', 'error');
        } finally {
            m.busy = false;
            this.updateRoomBar();
        }
    },

    stopMic() {
        const m = this.mic;
        if (!m) return;
        const was = m.on;
        if (m.stream) m.stream.getTracks().forEach(t => t.stop());
        if (m.ctx) m.ctx.close().catch(() => {});
        m.stream = null; m.ctx = null; m.analyser = null; m.buf = null; m.on = false; m.speaking = false;
        if (was) { Net.emit('mic:set', { on: false }); RTC.setLocal('mic', null); }
        const bar = document.getElementById('mic-meter-bar');
        if (bar) bar.style.width = '0%';
        this.updateRoomBar();
    },

    // live level bar inside the button + "is speaking" detection for the ring around the avatar
    startMeter(stream) {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            const ctx = new AC();
            if (ctx.state === 'suspended') ctx.resume();
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            ctx.createMediaStreamSource(stream).connect(analyser); // not connected to the speakers: no echo
            this.mic.ctx = ctx; this.mic.analyser = analyser; this.mic.buf = new Uint8Array(analyser.fftSize);
        } catch (err) { /* meter is optional */ }
    },

    updateMicMeter() {
        const m = this.mic;
        if (!m.analyser) return;
        m.analyser.getByteTimeDomainData(m.buf);
        let sum = 0;
        for (let i = 0; i < m.buf.length; i++) { const v = (m.buf[i] - 128) / 128; sum += v * v; }
        const level = Math.min(1, Math.sqrt(sum / m.buf.length) * 4);
        const bar = document.getElementById('mic-meter-bar');
        if (bar) bar.style.width = Math.round(level * 100) + '%';
        const now = performance.now();
        if (level > 0.14) m.lastLoud = now;
        m.speaking = now - m.lastLoud < 350;
    },

    // ------------------------------------------------------------------ screen sharing
    screenState() {
        const info = this.shareInfo(), me = Net.myId;
        if (State.user.role === 'faculty') return this.screen.on ? 'sharing' : info.sharerId ? 'busy' : 'ready';
        if (info.sharerId === me && this.screen.on) return 'sharing';
        if (!this.seatedNow()) return 'standing';
        if (info.sharerId && info.sharerId !== me) return 'busy';
        if (info.permit === me) return 'permitted';
        if (info.requests.includes(me)) return 'requested';
        return 'idle';
    },

    async onScreenButton() {
        const st = this.screenState();
        if (this.screen.busy) return;
        if (st === 'standing') this.showToast('Sit on a bench first', 'Screen sharing is available only while you are seated.', 'warn');
        else if (st === 'busy') this.showToast('Screen sharing is in use', 'Only one person can share at a time. Wait until they finish.', 'warn');
        else if (st === 'idle') {
            const r = await Net.request('screen:request');
            this.showToast(r.ok ? 'Request sent' : 'Could not send the request', r.ok ? 'Your teacher will allow or decline it.' : r.error, r.ok ? 'success' : 'warn');
        } else if (st === 'requested') {
            await Net.request('screen:cancel');
            this.showToast('Request cancelled', '', 'info');
        } else if (st === 'permitted' || st === 'ready') await this.startScreen();
        else if (st === 'sharing') { this.stopScreenLocal(true); this.showToast('Screen sharing stopped', '', 'info'); }
        this.updateRoomBar();
    },

    async startScreen() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            this.showToast('Screen sharing unavailable', window.isSecureContext ? 'This browser cannot share the screen.' : 'Screen sharing needs https:// or localhost.', 'error');
            return;
        }
        this.screen.busy = true;
        this.updateRoomBar();
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30, max: 30 } },
                // raw, unprocessed sound (no echo cancellation / noise filter: those ruin music and video audio)
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: true },
                systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include'
            });
            const res = await Net.request('screen:start');
            if (!res.ok) { stream.getTracks().forEach(t => t.stop()); this.showToast('Cannot share your screen', res.error || '', 'warn'); return; }
            this.screen.stream = stream; this.screen.on = true;
            this.screen.hasAudio = stream.getAudioTracks().length > 0;
            // the browser's own "Stop sharing" bar
            stream.getVideoTracks()[0].addEventListener('ended', () => { if (this.screen.stream === stream) this.stopScreenLocal(true); });
            RTC.setLocal('screen', stream);
            if (this.screen.hasAudio) this.showToast('You are sharing your screen', 'Everyone in the classroom can see it, and hear its sound.', 'screen');
            else Toast.show('Sharing WITHOUT sound', 'To share sound, stop and share again: pick a Chrome Tab and tick "Also share tab audio" (or "Share system audio" for the entire screen).', { type: 'warn', duration: 9000 });
        } catch (err) {
            if (stream) stream.getTracks().forEach(t => t.stop());
            const n = err && err.name;
            if (n === 'NotAllowedError' || n === 'AbortError') this.showToast('Screen sharing cancelled', 'Nothing was shared. You can try again.', 'info');
            else this.showToast('Screen sharing failed', 'Could not start screen capture.', 'error');
        } finally {
            this.screen.busy = false;
            this.updateRoomBar();
        }
    },

    stopScreenLocal(notify) {
        const sc = this.screen;
        if (!sc) return;
        const was = sc.on;
        if (sc.stream) sc.stream.getTracks().forEach(t => t.stop());
        sc.stream = null; sc.on = false;
        if (was) { RTC.setLocal('screen', null); if (notify) Net.emit('screen:stop'); }
        this.updateRoomBar();
    },

    // ------------------------------------------------------------------ faculty actions
    async classAction(action, id) {
        if (State.user.role === 'student') return;
        const name = (this.remote[id] && this.remote[id].name) || 'The student';
        const calls = {
            mute: ['class:mute', { id, muted: true }], unmute: ['class:mute', { id, muted: false }],
            'mute-all': ['class:mute-all', { muted: true }], 'unmute-all': ['class:mute-all', { muted: false }],
            remove: ['class:remove', { id }], lower: ['class:lower-hand', { id }],
            grant: ['class:screen-grant', { id }], deny: ['class:screen-deny', { id }], revoke: ['class:screen-revoke', {}]
        };
        const c = calls[action];
        if (!c) return;
        const r = await Net.request(c[0], c[1]);
        if (!r.ok) { this.showToast('Could not do that', r.error || 'Try again.', 'warn'); return; }
        const msg = {
            remove: ['Student removed', `${name} was sent back to the lobby.`], 'mute-all': ['Everyone muted', 'All students in the room are muted.'],
            'unmute-all': ['Everyone can speak', 'Students may turn their microphones on again.'], grant: ['Screen sharing allowed', `${name} can now share their screen.`],
            deny: ['Request declined', ''], revoke: ['Screen sharing stopped', '']
        }[action];
        if (msg) this.showToast(msg[0], msg[1], 'success');
    },

    // ------------------------------------------------------------------ control bar
    setBtn(id, s) {
        const btn = document.getElementById(id);
        if (!btn) return;
        const sig = JSON.stringify(s);
        if (btn.dataset.sig === sig) return;
        btn.dataset.sig = sig;
        btn.disabled = Boolean(s.disabled);
        btn.classList.toggle('active', Boolean(s.active));
        btn.classList.toggle('attention', Boolean(s.attention));
        btn.classList.toggle('danger', Boolean(s.danger));
        btn.classList.toggle('loading', Boolean(s.loading));
        const ic = btn.querySelector('.icon'), lb = btn.querySelector('.label'), kb = btn.querySelector('.kbd');
        if (ic && s.icon) ic.innerHTML = Icons.svg(s.icon, 18);
        if (lb) lb.textContent = s.label || '';
        if (kb) kb.textContent = s.kbd || '';
        btn.title = s.title || '';
        const wrap = btn.closest('.btn-wrap');
        if (wrap) {
            wrap.dataset.reason = s.disabled && s.reason ? s.reason : '';
            wrap.dataset.reasonTitle = s.reasonTitle || '';
            wrap.classList.toggle('is-disabled', Boolean(s.disabled));
        }
    },

    updateRoomBar() {
        const bar = document.getElementById('room-bar');
        if (!bar || !State.user) return;
        const room = this.roomObj(this.currentRoomCode);
        bar.classList.toggle('visible', Boolean(room));
        if (!room) return;
        const code = room.code, role = State.user.role, student = role === 'student', librarian = role === 'librarian';
        const library = room.type === 'library';
        const free = this.freeSeats(code), fac = this.facultyIn(code);
        document.getElementById('room-bar-title').textContent = library ? room.subject.name : `${code} · ${room.subject.name}`;
        let sub;
        if (librarian) {
            const st = this.rosterFor(Library.code).filter(p => p.role === 'student');
            sub = `${st.length} student${st.length === 1 ? '' : 's'} inside · ${st.filter(p => p.hand).length} need help`;
        } else if (student) {
            sub = library
                ? `Quiet zone · notes for ${MeetingSubjects.length} subjects${fac ? ' · ' + fac + ' on duty' : ''}`
                : this.seat.phase === 'seated' ? `${Seating.label(this.seat.idx)} · ${fac ? fac + ' is teaching' : 'waiting for the teacher'}`
                : `${fac ? fac + ' is teaching' : 'Faculty has not joined yet'} · ${free} of ${room.seatCount} seats free`;
        } else {
            const st = this.rosterFor(code).filter(p => p.role === 'student');
            sub = `${st.length} student${st.length === 1 ? '' : 's'} · ${st.filter(p => p.seat !== null).length} seated · ${st.filter(p => p.hand).length} hand${st.filter(p => p.hand).length === 1 ? '' : 's'}`;
        }
        const subEl = document.getElementById('room-bar-sub');
        if (subEl.textContent !== sub) subEl.textContent = sub;
        if (librarian) { this.updateHint(); return; }

        // the library is a quiet zone: no microphone, no screen sharing, no speakers. It has no seats either, but a Notes button.
        Util.$$('[data-wrap="room-mic-btn"], [data-wrap="room-screen-btn"], [data-wrap="seat-btn"], .vol-wrap', bar).forEach(el => { el.hidden = library; });
        Util.$$('[data-wrap="notes-btn"]', bar).forEach(el => { el.hidden = !library; });
        if (student && library) this.setBtn('notes-btn', { icon: 'book', label: 'Notes', title: 'Show the PDF notes of every subject', active: Dock.notesVisible() });

        // seat / stand
        if (student && !library) {
            const ph = this.seat.phase;
            if (ph === 'seated') this.setBtn('seat-btn', { icon: 'up', label: 'Stand up', kbd: 'Ctrl', title: 'Stand up (Ctrl)', disabled: this.seat.pending });
            else if (ph === 'none') this.setBtn('seat-btn', {
                icon: 'chair', label: 'Sit', kbd: 'S', attention: Boolean(this.nearSeat), disabled: !this.nearSeat,
                title: 'Sit on the bench (S)', reasonTitle: 'Find a free bench', reason: free ? 'Walk up to a green-marked seat, then press S.' : 'All seats are taken right now.'
            });
            else this.setBtn('seat-btn', { icon: 'chair', label: ph === 'sitting' ? 'Sitting…' : 'Standing…', disabled: true, loading: true });
        }

        // microphone
        const m = this.mic, block = this.micBlockedReason();
        if (!library) this.setBtn('room-mic-btn', {
            icon: m.locked ? 'micOff' : m.on ? 'mic' : 'micOff',
            label: m.busy ? 'Waiting for permission…' : m.locked ? 'Muted by teacher' : m.on ? 'Mic on' : 'Turn on mic',
            active: m.on, loading: m.busy, disabled: Boolean(block) && !m.on,
            title: block ? block.text : m.on ? 'Turn the microphone off' : 'Turn the microphone on',
            reasonTitle: block && block.title, reason: block && block.text
        });
        const micBtn = document.getElementById('room-mic-btn');
        if (micBtn) micBtn.setAttribute('aria-pressed', String(m.on));

        // screen sharing
        const st = this.screenState(), sc = this.screen;
        const map = student ? {
            standing: { icon: 'screen', label: 'Share screen', disabled: true, reasonTitle: 'Sit on a bench first', reason: 'Screen sharing is available only while you are seated, and only when your teacher allows it.' },
            idle: { icon: 'screen', label: 'Request to share', title: 'Ask your teacher to let you share your screen' },
            requested: { icon: 'clock', label: 'Request sent · cancel', attention: false },
            permitted: { icon: 'play', label: 'Start sharing', attention: true, title: 'Your teacher allowed you to share' },
            busy: { icon: 'screenOff', label: 'Screen in use', disabled: true, reasonTitle: 'Screen sharing is in use', reason: 'Only one person can share at a time.' },
            sharing: { icon: 'stop', label: 'Stop sharing', danger: true, active: true }
        } : {
            ready: { icon: 'screen', label: 'Present screen', title: 'Share your screen with the class' },
            busy: { icon: 'screenOff', label: 'Student sharing', disabled: true, reasonTitle: 'A student is sharing', reason: 'Stop their share first (Screen tab) to present your own screen.' },
            sharing: { icon: 'stop', label: 'Stop presenting', danger: true, active: true }
        };
        if (!library) this.setBtn('room-screen-btn', { ...(map[st] || map.idle || map.ready), loading: sc.busy });

        // raise hand (in the library: ask the librarian; no seat needed there)
        if (student) {
            const seated = this.seatedNow() || library;
            this.setBtn('hand-btn', {
                icon: 'hand', label: this.handUp ? (library ? 'Cancel help' : 'Lower hand') : (library ? 'Ask librarian' : 'Raise hand'), kbd: 'H', active: this.handUp, disabled: !seated,
                title: library ? 'Call the librarian (H)' : 'Raise or lower your hand (H)', reasonTitle: 'Sit on a bench first', reason: 'You can ' + (library ? 'ask the librarian' : 'raise your hand') + ' once you are seated.'
            });
        }
        this.updateHint();
    }
});
