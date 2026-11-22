const State = {
    appState: 'LOGIN', // LOGIN, VIRTUAL_CAMPUS
    user: null,        // { id, userId, name, role, room }  (room = assigned subject code, faculty only)
    token: null,       // session token (JWT)

    init() {},

    setSession(token, profile) {
        this.setToken(token);
        this.setAuthenticatedUser(profile);
    },

    setToken(token) {
        this.token = token;
        try { sessionStorage.setItem('eduverse.token', token); } catch (e) { /* storage blocked */ }
    },

    setAuthenticatedUser(profile) {
        this.user = {
            id: profile.id,
            userId: profile.userId || profile.name,
            name: profile.name,
            role: profile.role,
            room: profile.room || null
        };
    },

    // a refresh keeps you signed in (the token lives in this tab only)
    async restore() {
        let token = null;
        try { token = sessionStorage.getItem('eduverse.token'); } catch (e) { /* blocked */ }
        if (!token) return false;
        const r = await Api.get('/api/me', token);
        if (!r.ok) { this.clear(); return false; }
        this.token = token;
        this.setAuthenticatedUser(r.data);
        return true;
    },

    clear() {
        this.token = null;
        this.user = null;
        try { sessionStorage.removeItem('eduverse.token'); } catch (e) { /* blocked */ }
    },

    logout() {
        const token = this.token;
        if (token) Api.request('POST', '/api/logout', null, token);
        this.clear();
    }
};

const Navigation = {
    root: null,
    activeView: null,

    init() { this.root = document.getElementById('app'); },

    navigate(targetState) {
        const nextView = this.getViewForState(targetState);
        if (this.activeView && this.activeView !== nextView && typeof this.activeView.cleanup === 'function') this.activeView.cleanup();
        State.appState = targetState;
        this.activeView = nextView;
        this.render();
    },

    getViewForState(s) { return s === 'LOGIN' ? Login : s === 'VIRTUAL_CAMPUS' ? CampusWorld : null; },

    render() {
        const view = this.activeView;
        this.root.innerHTML = view.getHTML();
        view.init();
    }
};

const CampusWorld = {
    canvas: null, ctx: null, animId: null, dpr: 1, vw: 0, vh: 0,
    zoomPercent: 100, cameraZoom: 1, baseZoom: null, motionQuery: null,
    // rad = collision radius, size = drawing scale
    avatar: { x: 0, y: 0, size: 16, rad: 13, maxSpeed: 4.08, accel: 0.16, decel: 0.2, vx: 0, vy: 0, dir: 'down', walkPhase: 0, walkAmount: 0 },
    myLook: null,
    camPos: null,
    audioCtx: null, soundOn: true, lastDing: 0, dingBuffer: null, dingTried: false, dingSrc: null,
    lastTs: 0, dtf: 1,
    keys: { w: false, a: false, s: false, d: false, arrowup: false, arrowleft: false, arrowdown: false, arrowright: false },
    nearbyEntity: null,
    nearSection: null,   // library section the avatar is standing at
    isModalOpen: false,
    tick: 0,
    patterns: {},
    remote: {},          // other people on campus (from the server)
    meServer: null,      // my own entry in the server's world snapshot
    serverRooms: {},     // per room: { sharer, permit, requests }
    placedFor: null,
    layout: null,
    currentRoomCode: null,
    bannedCodes: [],
    resizeObs: null,
    lastPresence: 0, lastSig: '',
    onlineCount: 1,

    // ---------------------------------------------------------------- markup
    getHTML() {
        const u = State.user;
        const initials = Util.escapeHTML(Util.shortName(u.name));
        return `
        <div class="layer campus-world-layer fade-in">
            <header class="hud">
                <div class="hud-left">
                    <span class="hud-brand">${Icons.svg('cap', 18)}<b>EDUVERSE</b></span>
                    <span class="hud-chip location">${Icons.svg('walk', 14)}<span id="hud-location">Central Hall</span></span>
                </div>
                <div class="hud-right">
                    <span class="hud-chip online"><i class="status-dot"></i><span id="online-count">1 online</span></span>
                    <span class="hud-chip conn" id="conn-status" hidden>Reconnecting…</span>
                    <button type="button" class="hud-icon-btn" id="help-btn" title="Controls and help" aria-label="Help">${Icons.svg('help', 18)}</button>
                    <div class="account">
                        <button type="button" class="account-btn" id="account-btn" aria-haspopup="menu" aria-expanded="false">
                            <span class="avatar-dot ${u.role}">${initials}</span>
                            <span class="acc-name">${Util.escapeHTML(u.name)}</span>
                            <span class="role-badge ${u.role}">${u.role}</span>
                            ${Icons.svg('chevron', 14)}
                        </button>
                        <div class="account-menu" id="account-menu" role="menu" hidden>
                            <div class="acc-head"><strong>${Util.escapeHTML(u.name)}</strong><small>${u.role === 'faculty' ? 'Faculty ID' : u.role === 'librarian' ? 'Librarian ID' : 'Student ID'} · ${Util.escapeHTML(u.userId)}</small></div>
                            <button type="button" id="change-pwd-btn" role="menuitem">${Icons.svg('key', 16)} Change password</button>
                            <button type="button" id="sound-btn" role="menuitem">${Icons.svg('volume', 16)} <span id="sound-label">Walking sound: on</span></button>
                            <button type="button" id="logout-btn" role="menuitem" class="danger">${Icons.svg('logout', 16)} Log out</button>
                        </div>
                    </div>
                </div>
            </header>

            <div class="stage">
                <div class="world-canvas-container" id="canvas-container">
                    <canvas id="world-canvas"></canvas>

                    <div class="zoom-controller" role="group" aria-label="Campus camera zoom">
                        <div class="zoom-controls">
                            <button type="button" id="zoom-out-btn" aria-label="Zoom out" title="Zoom out">−</button>
                            <output id="zoom-level" aria-live="polite">100%</output>
                            <button type="button" id="zoom-in-btn" aria-label="Zoom in" title="Zoom in">+</button>
                        </div>
                        <button type="button" id="zoom-reset-btn">Reset</button>
                    </div>

                    <div class="movement-hint" id="hint"></div>

                    <aside id="live-classes-panel" class="live-classes-panel" aria-label="Live classes"></aside>

                    <div id="interaction-overlay" class="interaction-overlay" role="status">
                        <span class="interaction-key" id="interaction-key">E</span>
                        <div>
                            <div class="interaction-title" id="interaction-title">Campus Notice Board</div>
                            <div class="interaction-sub" id="interaction-sub">Press E to see which classes are live</div>
                        </div>
                    </div>

                    ${this.roomBarHTML()}
                </div>
                ${Dock.html()}
            </div>

            <div id="campus-modal" class="campus-modal-backdrop">
                <div class="campus-modal">
                    <header><h3>${Icons.svg('board', 20)} Eduverse Academic Announcements</h3><button class="close-modal-btn" id="close-modal-btn" aria-label="Close">${Icons.svg('x', 18)}</button></header>
                    <div class="notice-list" id="notice-list"></div>
                </div>
            </div>
            <div id="app-modal" class="campus-modal-backdrop"><div class="campus-modal" id="app-modal-box" role="dialog" aria-modal="true"></div></div>
        </div>`;
    },

    init() {
        this.canvas = document.getElementById('world-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.layout = this.buildLayout();
        this.currentRoomCode = null;
        this.remote = {};
        this.meServer = null;
        this.serverRooms = {};
        this.bannedCodes = [];
        this.baseZoom = null;
        this.myLook = Avatar.look(State.user.userId, State.user.role);
        this.resetClassroomState();
        // plays once when a student walks into a classroom (put your own sound at public/audio.mp3)
        this.enterAudio = new Audio('audio.mp3');
        this.enterAudio.preload = 'auto';
        this.enterAudio.addEventListener('error', () => {}); // no file: stay silent

        this.resize();
        this.resizeObs = new ResizeObserver(() => this.resize());
        this.resizeObs.observe(document.getElementById('canvas-container'));
        window.addEventListener('resize', this.resizeHandler);
        window.addEventListener('keydown', this.kdHandler);
        window.addEventListener('keyup', this.kuHandler);
        window.addEventListener('blur', this.blurHandler);
        document.addEventListener('pointerdown', this.docClickHandler);
        this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });

        document.getElementById('zoom-out-btn').addEventListener('click', () => this.adjustZoom(-10));
        document.getElementById('zoom-in-btn').addEventListener('click', () => this.adjustZoom(10));
        document.getElementById('zoom-reset-btn').addEventListener('click', () => this.setZoom(100));
        this.updateZoomControls();

        document.getElementById('close-modal-btn').addEventListener('click', () => this.toggleNoticeModal(false));
        document.getElementById('campus-modal').addEventListener('pointerdown', e => { if (e.target.id === 'campus-modal') this.toggleNoticeModal(false); });
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('help-btn').addEventListener('click', () => Account.showHelp());
        document.getElementById('change-pwd-btn').addEventListener('click', () => { this.toggleAccountMenu(false); Account.showChangePassword(); });
        document.getElementById('sound-btn').addEventListener('click', () => { this.toggleSound(); });
        document.getElementById('account-btn').addEventListener('click', e => { e.stopPropagation(); this.toggleAccountMenu(); });

        this.initClassroomUI();
        Dock.init();
        this.renderLiveClasses();
        this.updateHint();

        // a student appears in the hall; a faculty member appears at the front of their own classroom
        if (this.placedFor !== State.user.id) {
            const home = this.homeRoom() || this.librarianHome();
            if (home) {
                const p = home.spawn || home.toWorld(home.lw / 2, 52);
                this.avatar.x = p.x; this.avatar.y = p.y;
                this.avatar.dir = home.spawn ? home.spawn.dir : home.face;
            } else {
                const hall = this.layout.hall;
                this.avatar.x = hall.x + hall.width / 2 + (Math.random() - 0.5) * 300;
                this.avatar.y = hall.y + hall.height * 0.78;
                this.avatar.dir = 'up';
            }
            this.placedFor = State.user.id;
            this.avatar.vx = 0; this.avatar.vy = 0; this.avatar.walkAmount = 0;
            this.camPos = null;
        }
        this.updateRoomState(this.layout);

        Net.connect(this.netHandlers()).then(() => RTC.init()).catch(err => {
            Toast.show('Cannot reach the server', err.message || 'Is the server running?', { type: 'error', duration: 8000 });
        });
        this.loop();
    },

    cleanup() {
        Net.disconnect();
        RTC.closeAll();
        Dock.cleanup();
        this.stopMic();
        this.stopScreenLocal(false);
        if (this.resizeObs) this.resizeObs.disconnect();
        window.removeEventListener('resize', this.resizeHandler);
        window.removeEventListener('keydown', this.kdHandler);
        window.removeEventListener('keyup', this.kuHandler);
        window.removeEventListener('blur', this.blurHandler);
        document.removeEventListener('pointerdown', this.docClickHandler);
        document.body.classList.remove('dock-open');
        this.placedFor = null;
        if (this.canvas) this.canvas.removeEventListener('wheel', this.wheelHandler);
        if (this.animId) cancelAnimationFrame(this.animId);
        this.resetKeys();
        this.isModalOpen = false;
        this.lastTs = 0;
        this.camPos = null;
        this.stopCustomSound();
        if (this.enterAudio) { this.enterAudio.pause(); this.enterAudio = null; }
        if (this.audioCtx && this.audioCtx.state === 'running') this.audioCtx.suspend();
        this.avatar.vx = 0; this.avatar.vy = 0; this.avatar.walkAmount = 0;
    },

    resetKeys() { this.keys = { w: false, a: false, s: false, d: false, arrowup: false, arrowleft: false, arrowdown: false, arrowright: false }; },
    resizeHandler: () => CampusWorld.resize(),
    kdHandler: e => CampusWorld.handleKey(e, true),
    kuHandler: e => CampusWorld.handleKey(e, false),
    // alt-tab or a permission prompt steals focus so key-up never arrives: stop walking by ourselves
    blurHandler: () => CampusWorld.resetKeys(),
    wheelHandler: e => CampusWorld.handleWheel(e),
    docClickHandler: e => { if (!(e.target instanceof Element) || !e.target.closest('.account')) CampusWorld.toggleAccountMenu(false); },

    showToast(title, message, type) { Toast.show(title, message, { type: type || 'info' }); },

    toggleAccountMenu(force) {
        const menu = document.getElementById('account-menu');
        if (!menu) return;
        const open = force === undefined ? menu.hidden : force;
        menu.hidden = !open;
        document.getElementById('account-btn').setAttribute('aria-expanded', String(open));
    },

    toggleSound() {
        this.soundOn = !this.soundOn;
        const l = document.getElementById('sound-label');
        if (l) l.textContent = 'Walking sound: ' + (this.soundOn ? 'on' : 'off');
        this.showToast('Walking sound', this.soundOn ? 'On (press M to mute)' : 'Muted (press M to unmute)');
    },

    homeRoom() {
        if (!State.user || State.user.role !== 'faculty' || !State.user.room) return null;
        return this.layout.rooms.find(r => r.code === State.user.room && r.type === 'classroom') || null;
    },

    // the librarian starts at the desk in the library
    librarianHome() {
        if (!State.user || State.user.role !== 'librarian') return null;
        return this.layout.library || null;
    },

    roomObj(code) { return code ? this.layout.rooms.find(r => r.code === code) || null : null; },

    logout() {
        const token = State.token;
        this.placedFor = null;
        Navigation.navigate('LOGIN'); // cleanup() disconnects from the campus
        State.token = token;
        State.logout();
        Login.show('login', { type: 'info', text: 'You have been logged out.' });
    },

    // the server ended this session (logged in somewhere else, password changed, ...)
    sessionEnded(reason) {
        State.clear();
        Navigation.navigate('LOGIN');
        const text = reason === 'session-replaced' ? 'You were signed out because this account logged in somewhere else.'
            : reason === 'password-changed' ? 'Your password was changed. Please log in again.' : 'Your session ended. Please log in again.';
        Login.show('login', { type: 'info', text });
    },

    // ---------------------------------------------------------------- modals
    setModal(open) { this.isModalOpen = open; if (open) this.resetKeys(); },

    toggleNoticeModal(open) {
        this.setModal(open);
        if (open) this.renderNotices();
        const modal = document.getElementById('campus-modal');
        if (modal) modal.classList.toggle('open', open);
    },

    // who is "in charge" of a room: the faculty member teaching a classroom, or the librarian on duty in the library
    facultyIn(code) {
        const room = this.roomObj(code);
        const role = room && room.type === 'library' ? 'librarian' : 'faculty';
        if (State.user.role === role && (role === 'librarian' || State.user.room === code)) return State.user.name;
        const f = Object.values(this.remote).find(p => p.role === role && !p.off && (role === 'librarian' || p.room === code));
        return f ? f.name : null;
    },

    liveRooms() {
        return this.layout.rooms.filter(r => r.type === 'classroom').map(r => ({ room: r, faculty: this.facultyIn(r.code) })).filter(x => x.faculty);
    },

    libraryInfo() {
        const files = Object.values(LibraryNotes).reduce((n, list) => n + list.length, 0);
        return { readers: this.studentsIn(Library.code), librarian: this.facultyIn(Library.code), subjects: MeetingSubjects.length, files };
    },

    renderNotices() {
        const list = document.getElementById('notice-list');
        if (!list) return;
        const live = this.liveRooms();
        const e = Util.escapeHTML;
        const lib = this.libraryInfo();
        const libItem = `
                <div class="notice-item">
                    <span class="notice-badge ${lib.librarian ? 'live' : 'info'}">${lib.librarian ? '● OPEN' : 'LIBRARY'}</span>
                    <div class="notice-title">Library · subject notes (left end of the hall)</div>
                    <div class="notice-desc">${lib.librarian ? e(lib.librarian) + ' is on duty. ' : 'No librarian on duty right now. '}${lib.readers} student${lib.readers === 1 ? '' : 's'} inside. PDF notes for all ${lib.subjects} subjects can be downloaded there. Quiet zone: no microphone or screen sharing.</div>
                </div>`;
        list.innerHTML = (live.length
            ? live.map(({ room, faculty }) => `
                <div class="notice-item">
                    <span class="notice-badge live">● LIVE NOW</span>
                    <div class="notice-title">${e(room.subject.name)} (${e(room.subject.code)})</div>
                    <div class="notice-desc">${e(faculty)} is teaching in Room ${room.number}. ${this.freeSeats(room.code)} of ${room.seatCount} seats are free.</div>
                </div>`).join('')
            : `<div class="notice-item">
                    <span class="notice-badge info">NO CLASSES</span>
                    <div class="notice-title">No live classes right now</div>
                    <div class="notice-desc">Every room is open. A class shows up here once its faculty member is in the room.</div>
                </div>`) + libItem;
    },

    renderLiveClasses() {
        const panel = document.getElementById('live-classes-panel');
        if (!panel || !State.user || State.user.role !== 'student') return;
        const live = this.liveRooms();
        const html = live.length
            ? `<h3>LIVE CLASSES <span>${live.length}</span></h3>${live.map(({ room }) => `
                <div class="live-class-item"><i></i><span>${room.subject.code}</span><small>${room.subject.name}</small><em>${this.freeSeats(room.code)} free</em></div>`).join('')}`
            : '';
        if (panel.dataset.html !== html) { panel.innerHTML = html; panel.dataset.html = html; }
        panel.classList.toggle('visible', live.length > 0);
    },

    // ---------------------------------------------------------------- textures
    getPattern(kind) {
        if (this.patterns[kind]) return this.patterns[kind];
        const tile = document.createElement('canvas');
        const t = tile.getContext('2d');
        let seed = kind === 'wood' ? 7 : 3;
        const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        if (kind === 'wood') {
            tile.width = 192; tile.height = 64;
            const colors = ['#C99F66', '#C29860', '#CDA46C', '#BE945C'];
            for (let row = 0; row < 2; row++) {
                const offset = row * 96;
                for (let k = 0; k < 2; k++) {
                    const x = (offset + k * 96) % 192;
                    t.fillStyle = colors[Math.floor(rand() * colors.length)];
                    t.fillRect(x, row * 32, 96, 32);
                    if (x + 96 > 192) t.fillRect(0, row * 32, x + 96 - 192, 32);
                }
                for (let g = 0; g < 6; g++) { t.fillStyle = 'rgba(120, 80, 30, 0.12)'; t.fillRect(rand() * 192, row * 32 + 4 + rand() * 24, 20 + rand() * 30, 1); }
            }
            t.fillStyle = '#8F6A3A';
            t.fillRect(0, 0, 192, 2); t.fillRect(0, 32, 192, 2); t.fillRect(0, 0, 2, 32); t.fillRect(96, 32, 2, 32);
        } else if (kind === 'path') {
            tile.width = 64; tile.height = 64;
            t.fillStyle = '#D9D2C2'; t.fillRect(0, 0, 64, 64);
            for (let i = 0; i < 30; i++) { t.fillStyle = rand() > 0.5 ? 'rgba(120,105,80,0.10)' : 'rgba(255,255,255,0.12)'; t.fillRect(rand() * 62, rand() * 62, 2 + rand() * 3, 2); }
            t.fillStyle = 'rgba(120,105,80,0.35)'; t.fillRect(0, 0, 64, 1); t.fillRect(0, 0, 1, 64);
        } else if (kind === 'lib') {
            tile.width = 80; tile.height = 80;
            t.fillStyle = '#E3ECF4'; t.fillRect(0, 0, 80, 80);
            t.fillStyle = 'rgba(13,148,136,0.10)'; t.fillRect(0, 0, 40, 40); t.fillRect(40, 40, 40, 40);
            t.fillStyle = 'rgba(70,100,130,0.16)'; t.fillRect(0, 0, 80, 1); t.fillRect(0, 0, 1, 80);
        } else if (kind === 'room') {
            tile.width = 80; tile.height = 80;
            t.fillStyle = '#EFE6D2'; t.fillRect(0, 0, 80, 80);
            t.fillStyle = 'rgba(120, 100, 60, 0.10)'; t.fillRect(0, 0, 80, 1); t.fillRect(0, 0, 1, 80);
        } else {
            tile.width = 64; tile.height = 64;
            t.fillStyle = '#5E9C40'; t.fillRect(0, 0, 64, 64);
            for (let i = 0; i < 45; i++) { t.fillStyle = rand() > 0.5 ? '#4F8A35' : '#6DAA4C'; t.fillRect(Math.floor(rand() * 62), Math.floor(rand() * 58), 2, 5); }
        }
        this.patterns[kind] = this.ctx.createPattern(tile, 'repeat');
        return this.patterns[kind];
    },

    // ---------------------------------------------------------------- zoom
    setZoom(percent) { this.zoomPercent = Util.clamp(percent, 50, 150); this.updateZoomControls(); },
    adjustZoom(amount) { this.setZoom(this.zoomPercent + amount); },
    updateZoomControls() {
        const level = document.getElementById('zoom-level');
        const zo = document.getElementById('zoom-out-btn'), zi = document.getElementById('zoom-in-btn');
        if (level) level.textContent = `${this.zoomPercent}%`;
        if (zo) zo.disabled = this.zoomPercent <= 50;
        if (zi) zi.disabled = this.zoomPercent >= 150;
    },
    isControlTarget(target) {
        return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
    },
    handleWheel(e) {
        if (State.appState !== 'VIRTUAL_CAMPUS' || this.isModalOpen) return;
        e.preventDefault();
        this.adjustZoom(e.deltaY < 0 ? 10 : -10);
    },

    resize() {
        if (!this.canvas) return;
        const c = document.getElementById('canvas-container');
        if (!c) return;
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.vw = c.clientWidth; this.vh = c.clientHeight;
        this.canvas.width = Math.round(this.vw * this.dpr);
        this.canvas.height = Math.round(this.vh * this.dpr);
        this.canvas.style.width = this.vw + 'px';
        this.canvas.style.height = this.vh + 'px';
    },

    // ---------------------------------------------------------------- layout
    // Layout (see the project sketch): the campus building (6 classrooms on top, 6 below, a hall between) and, on its
    // left, the LIBRARY: one tall room joined to the hall's left end by a path. The library has no seats; it has one
    // section per subject where students get the PDF notes (the list is in LibraryNotes, config.js).
    // A classroom is described in its own "frame": u runs along the room, v runs from the board wall towards the door,
    // so the same seat / bench code works for the top row and the bottom row.
    makeFrame(far, box) {
        const vert = far === 'W' || far === 'E';
        const toWorld = (u, v) => far === 'N' ? { x: box.x + u, y: box.y + v } : far === 'S' ? { x: box.x + u, y: box.y + box.h - v }
            : far === 'W' ? { x: box.x + v, y: box.y + u } : { x: box.x + box.w - v, y: box.y + u };
        const toLocal = (px, py) => far === 'N' ? { u: px - box.x, v: py - box.y } : far === 'S' ? { u: px - box.x, v: box.y + box.h - py }
            : far === 'W' ? { u: py - box.y, v: px - box.x } : { u: py - box.y, v: box.x + box.w - px };
        const rect = (u, v, w, h) => {
            const p = toWorld(u, v), q = toWorld(u + w, v + h);
            return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
        };
        return { far, vert, lw: vert ? box.h : box.w, ld: vert ? box.w : box.h, toWorld, toLocal, rect, face: { N: 'up', S: 'down', W: 'left', E: 'right' }[far] };
    },

    // benches, seats and desks of one classroom (4 rows)
    furnish(room, type) {
        const cfg = Seating.cfg[type];
        room.cfg = cfg; room.seatCount = cfg.count; room.rows = cfg.rows;
        room.seats = []; room.blocks = [];
        for (let idx = 0; idx < cfg.count; idx++) {
            const info = Seating.info(idx);
            const u = Seating.seatU(idx, room.lw), bv = Seating.blockV(info.row, cfg);
            const seat = room.toWorld(u, bv + Seating.seatV), stand = room.toWorld(u, bv + Seating.standV);
            room.seats.push({ ...info, u, v: bv + Seating.seatV, x: seat.x, y: seat.y, sx: stand.x, sy: stand.y, face: room.face });
        }
        for (let row = 0; row < cfg.rows; row++) {
            for (let side = 0; side < 2; side++) {
                const u0 = Seating.benchU0(side, room.lw), bv = Seating.blockV(row, cfg);
                room.blocks.push({
                    row, side,
                    all: room.rect(u0, bv, Seating.benchLen, Seating.blockD),
                    desk: room.rect(u0, bv, Seating.benchLen, Seating.deskD),
                    bench: room.rect(u0, bv + Seating.benchTop, Seating.benchLen, Seating.blockD - Seating.benchTop)
                });
            }
        }
        room.obstacles = room.blocks.map(b => b.all).concat([room.teacherDesk]);
    },

    // The library: a tall room left of the building. Its entrance is in the middle of its right wall, where the path
    // from the hall arrives. Inside: a cross-shaped walkway, the librarian's desk at the far end of it, and 12 subject
    // sections (a bookshelf + a floor mat where the student stands to get that subject's notes) in two columns.
    buildLibrary(hall) {
        const W = World, T = W.wall, B = W.band;
        const box = { x: W.margin, y: W.top, w: W.libW, h: W.bldH };
        const inner = { x: box.x + T, y: box.y + B, w: box.w - 2 * T, h: box.h - T - B };
        const midY = hall.y + hall.height / 2;                       // the path (and the entrance) line up with the hall
        const gate = { y: midY - W.pathW / 2, h: W.pathW };          // opening in the library's right wall
        const aisle = { y: midY - 80, h: 160 };                      // walkway from the entrance to the librarian's desk

        const room = Object.assign({
            id: 'library', number: 13, type: 'library', subject: { code: Library.code, name: Library.name }, code: Library.code,
            x: box.x, y: box.y, width: box.w, height: box.h, inner, box, gate, aisle,
            seats: [], blocks: [], seatCount: 0, rows: 0
        }, this.makeFrame('W', inner));
        room.contains = (px, py) => px >= inner.x && px <= inner.x + inner.w && py >= inner.y && py <= inner.y + inner.h;
        room.teacherDesk = { x: inner.x + 56, y: midY - 60, w: 60, h: 120 };   // the librarian's desk
        room.spawn = { x: inner.x + 30, y: midY, dir: 'right' };                // where the librarian starts (behind the desk)

        // 12 sections: 2 columns x (3 rows above the walkway + 3 rows below it)
        const colW = 240, side = 12, rowH = 160, shelfH = 34;
        const colX = [inner.x + side, inner.x + inner.w - side - colW];
        const palette = ['#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0891B2', '#65A30D', '#EA580C', '#4F46E5', '#0D9488', '#9333EA'];
        const cells = [];
        for (let r = 0; r < 3; r++) cells.push({ y: aisle.y - (3 - r) * rowH });   // above the walkway
        for (let r = 0; r < 3; r++) cells.push({ y: aisle.y + aisle.h + r * rowH }); // below it
        room.sections = [];
        MeetingSubjects.forEach((subject, i) => {
            const cell = cells[Math.floor(i / 2)], x = colX[i % 2];
            const shelf = { x, y: cell.y, w: colW, h: shelfH };
            const mat = { x: x + 10, y: cell.y + shelfH + 8, w: colW - 20, h: rowH - shelfH - 22 };
            room.sections.push({ idx: i, code: subject.code, name: subject.name, color: palette[i % palette.length], shelf, mat });
        });
        room.obstacles = room.sections.map(s => s.shelf).concat([room.teacherDesk]);
        room.area = { x: inner.x, y: inner.y, w: inner.w, h: inner.h, contains: room.contains, code: Library.code };
        // the path: from the inside of the library's right wall to the hall's left end
        const path = { x: inner.x + inner.w, y: gate.y, w: hall.x - (inner.x + inner.w), h: gate.h };
        return { room, path };
    },

    buildLayout() {
        const W = World;
        const hall = { x: W.padX, y: W.top + W.roomH, width: W.rowW, height: W.hallH };
        const rooms = [];

        // ---- the 12 classrooms (unchanged inside) ----
        MeetingSubjects.forEach((subject, i) => {
            const topRow = i < W.perRow;
            const x = W.padX + (i % W.perRow) * (W.roomW + W.gap);
            const y = topRow ? W.top : hall.y + hall.height;
            const edge = topRow ? y + W.roomH : y;
            const doorX = x + W.roomW / 2;
            const inner = { x: x + W.wall, y: topRow ? y + W.band : y + W.wall, w: W.roomW - W.wall * 2, h: W.roomH - W.wall - W.band };
            const frame = this.makeFrame(topRow ? 'N' : 'S', inner);
            const room = Object.assign({
                id: `room-${i + 1}`, number: i + 1, type: 'classroom', subject, code: subject.code,
                x, y, width: W.roomW, height: W.roomH, doorX, edge, doorTop: !topRow, inner,
                doorway: { x: doorX - W.door / 2, y: topRow ? edge - W.wall - 2 : edge - 2, w: W.door, h: W.wall + 4 }
            }, frame);
            room.contains = (px, py) => px >= inner.x && px <= inner.x + inner.w && py >= inner.y && py <= inner.y + inner.h;
            room.teacherDesk = room.rect(26, 24, 132, 26);
            this.furnish(room, 'classroom');
            room.area = { x: inner.x, y: inner.y, w: inner.w, h: inner.h, code: subject.code };
            rooms.push(room);
        });

        // ---- the library, left of the building, and the path to it ----
        const lib = this.buildLibrary(hall);
        rooms.push(lib.room);
        const libPath = lib.path;

        const noticeBoard = {
            id: 'notice', name: 'Campus Notice Board',
            x: hall.x + hall.width / 2 - 28, y: hall.y + hall.height * 0.3 - 19, width: 56, height: 38
        };
        const plants = [];
        const nPlants = Math.round(hall.width / 460);
        for (let i = 0; i <= nPlants; i++) {
            const px = hall.x + 70 + i * ((hall.width - 140) / nPlants);
            plants.push({ x: px, y: hall.y + 22 });
            plants.push({ x: px, y: hall.y + hall.height - 18 });
        }

        const hallArea = { x: hall.x, y: hall.y, w: hall.width, h: hall.height, code: null };
        const walkable = [hallArea];
        rooms.forEach(r => { walkable.push(r.area); if (r.doorway) walkable.push(Object.assign({}, r.doorway, { code: r.code })); });
        walkable.push(Object.assign({ code: null, libPath: true }, libPath));
        const obstacles = [];
        rooms.forEach(r => r.obstacles.forEach(o => obstacles.push(o)));
        return { rooms, hall, noticeBoard, walkable, obstacles, plants, libPath, hallArea, library: lib.room, building: { x: W.padX, y: W.top, w: W.bldW, h: W.bldH } };
    },

    getLayout() { if (!this.layout) this.layout = this.buildLayout(); return this.layout; },

    // can a circle of radius r stand at (x, y)?
    // students walk anywhere (except rooms they were removed from), faculty stay in their own classroom,
    // the librarian stays in the library and on the path to it
    canStand(layout, x, y, r) {
        const pts = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r], [x, y - r], [x, y + r], [x - r, y], [x + r, y]];
        const home = this.homeRoom();
        let areas = layout.walkable;
        if (home) areas = [home.area];
        else if (State.user && State.user.role === 'librarian') areas = layout.walkable.filter(a => a.libPath || a.code === Library.code);
        else if (this.bannedCodes.length) areas = areas.filter(a => !(a.code && this.bannedCodes.includes(a.code)));
        const inside = (px, py) => areas.some(a => px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h && (!a.contains || a.contains(px, py)));
        if (!pts.every(p => inside(p[0], p[1]))) return false;
        const nb = layout.noticeBoard;
        if (x + r > nb.x && x - r < nb.x + nb.width && y + r > nb.y && y - r < nb.y + nb.height) return false;
        for (const o of layout.obstacles) {
            const cx = Util.clamp(x, o.x, o.x + o.w), cy = Util.clamp(y, o.y, o.y + o.h);
            if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return false;
        }
        return true;
    },

    roomAt(layout, x, y) { return layout.rooms.find(r => r.contains(x, y)) || null; },

    // ---------------------------------------------------------------- walking sound (local only)
    unlockAudio() {
        try {
            if (!this.audioCtx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                this.audioCtx = new AC();
            }
            if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
            this.loadCustomSound();
        } catch (err) { /* no audio available */ }
    },
    loadCustomSound() {
        if (this.dingTried || !this.audioCtx) return;
        this.dingTried = true;
        fetch('ding.mp3').then(r => (r.ok ? r.arrayBuffer() : Promise.reject())).then(b => this.audioCtx.decodeAudioData(b)).then(d => { this.dingBuffer = d; }).catch(() => {});
    },
    startCustomSound() {
        const ac = this.audioCtx;
        if (!ac || ac.state !== 'running' || this.dingSrc) return;
        const src = ac.createBufferSource(), g = ac.createGain();
        src.buffer = this.dingBuffer; src.loop = true;
        g.gain.setValueAtTime(0.0001, ac.currentTime);
        g.gain.linearRampToValueAtTime(0.8, ac.currentTime + 0.05);
        src.connect(g); g.connect(ac.destination); src.start();
        this.dingSrc = { src, g };
    },
    stopCustomSound() {
        if (!this.dingSrc) return;
        const { src, g } = this.dingSrc;
        const t = this.audioCtx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0.0001, t + 0.12);
        src.stop(t + 0.13);
        this.dingSrc = null;
    },
    playDing() {
        const ac = this.audioCtx;
        if (!ac || ac.state !== 'running') return;
        const t = ac.currentTime, master = ac.createGain();
        master.gain.setValueAtTime(0.0001, t);
        master.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        master.connect(ac.destination);
        [[988, 1], [1976, 0.35], [2960, 0.15]].forEach(([freq, vol]) => {
            const osc = ac.createOscillator(), g = ac.createGain();
            osc.type = 'sine'; osc.frequency.value = freq; g.gain.value = vol;
            osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + 0.36);
        });
    },
    // a soft two-note chime for "a student raised a hand" and similar alerts
    playChime(kind) {
        const ac = this.audioCtx;
        if (!ac || ac.state !== 'running') return;
        const notes = kind === 'hand' ? [660, 880] : [520, 660];
        notes.forEach((f, i) => {
            const t = ac.currentTime + i * 0.13, osc = ac.createOscillator(), g = ac.createGain();
            osc.type = 'triangle'; osc.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(0.14, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
            osc.connect(g); g.connect(ac.destination); osc.start(t); osc.stop(t + 0.4);
        });
    },
    updateWalkSound(now) {
        const a = this.avatar;
        const walking = Math.hypot(a.vx, a.vy) > 1.2;
        const shouldPlay = this.soundOn && this.currentRoomCode === null && walking && State.user.role === 'student';
        if (this.dingBuffer) { if (shouldPlay) this.startCustomSound(); else this.stopCustomSound(); return; }
        if (!shouldPlay) return;
        if (now - this.lastDing >= 280) { this.lastDing = now; this.playDing(); }
    },

    // the room-entry sound: plays once from the start, never loops, stops if you leave straight away
    playEnterSound() {
        const a = this.enterAudio;
        if (!a) return;
        try {
            a.loop = false; a.pause(); a.currentTime = 0; a.volume = 0.9;
            const p = a.play();
            if (p && p.catch) p.catch(() => {});
        } catch (e) { /* no sound available */ }
    },

    // ---------------------------------------------------------------- input
    handleKey(e, isDown) {
        if (State.appState !== 'VIRTUAL_CAMPUS') return;
        const key = e.key.toLowerCase();
        const typing = this.isControlTarget(e.target);

        if (isDown) this.unlockAudio();   // browsers only allow sound after a key press / click
        if (key === 'escape' && isDown) {
            if (this.isModalOpen) { this.toggleNoticeModal(false); Account.close(); }
            this.toggleAccountMenu(false);
            return;
        }
        if (typing || this.isModalOpen) return;

        if (isDown && !e.repeat) {
            if (key === 'm') this.toggleSound();
            else if (key === '+' || key === '=') { e.preventDefault(); this.adjustZoom(10); }
            else if (key === '-') { e.preventDefault(); this.adjustZoom(-10); }
            else if (key === '0') { e.preventDefault(); this.setZoom(100); }
        }

        if (this.handleClassroomKey(e, key, isDown)) return;

        if (Object.prototype.hasOwnProperty.call(this.keys, key)) this.keys[key] = isDown;
        if (isDown && !e.repeat && key === 'e' && this.nearbyEntity && this.nearbyEntity.type === 'notice') this.toggleNoticeModal(true);
        // library: E at a subject section opens that subject's notes in the panel on the right
        if (isDown && !e.repeat && key === 'e' && this.nearbyEntity && this.nearbyEntity.type === 'notes') Dock.showNotes(this.nearbyEntity.code);
    },

    // ---------------------------------------------------------------- frame update
    update(dtf = 1) {
        const a = this.avatar;
        if (this.isModalOpen) { a.vx = 0; a.vy = 0; a.walkAmount = 0; return; }
        this.tick++;

        // sitting down / standing up / seated: no walking
        if (this.updateSeat(dtf)) {
            a.vx = 0; a.vy = 0;
            a.walkAmount += (0 - a.walkAmount) * 0.3;
            this.updateRoomState(this.getLayout());
            this.checkProximity(this.getLayout());
            return;
        }

        let ix = 0, iy = 0;
        if (this.keys.w || this.keys.arrowup) iy -= 1;
        if (this.keys.s || this.keys.arrowdown) iy += 1;
        if (this.keys.a || this.keys.arrowleft) ix -= 1;
        if (this.keys.d || this.keys.arrowright) ix += 1;
        if (ix !== 0 && iy !== 0) { ix *= 0.7071; iy *= 0.7071; }
        if (ix !== 0 || iy !== 0) { if (this.auto) this.cancelAutoWalk(true); }
        else if (this.auto) [ix, iy] = this.autoInput();

        // ease the velocity toward the target (gentle start, glide to a stop; same feel at any frame rate)
        const wantsMove = ix !== 0 || iy !== 0;
        const k = 1 - Math.pow(1 - (wantsMove ? a.accel : a.decel), dtf);
        a.vx += (ix * a.maxSpeed - a.vx) * k;
        a.vy += (iy * a.maxSpeed - a.vy) * k;
        if (Math.abs(a.vx) < 0.03) a.vx = 0;
        if (Math.abs(a.vy) < 0.03) a.vy = 0;
        if (wantsMove) {
            if (Math.abs(ix) > Math.abs(iy)) a.dir = ix > 0 ? 'right' : 'left';
            else a.dir = iy > 0 ? 'down' : 'up';
        }

        const layout = this.getLayout(), r = a.rad;
        const dx = a.vx * dtf, dy = a.vy * dtf;
        // slide along walls: test X and Y independently
        if (dx !== 0) { if (this.canStand(layout, a.x + dx, a.y, r)) a.x += dx; else a.vx = 0; }
        if (dy !== 0) { if (this.canStand(layout, a.x, a.y + dy, r)) a.y += dy; else a.vy = 0; }

        const speed = Math.hypot(a.vx, a.vy);
        a.walkPhase += speed * 0.07 * dtf;
        a.walkAmount += (Math.min(1, speed / 1.6) - a.walkAmount) * (1 - Math.pow(0.8, dtf));

        this.updateRoomState(layout);
        this.updateWalkSound(performance.now());
        this.checkProximity(layout);
    },

    updateHint() {
        const el = document.getElementById('hint');
        if (!el) return;
        const k = t => `<kbd>${t}</kbd>`;
        let html;
        if (State.user.role !== 'student') html = this.currentRoomCode ? '' : `<span>Move</span>${k('W')}${k('A')}${k('S')}${k('D')}`;
        else if (!this.currentRoomCode) html = `<span>Move</span>${k('W')}${k('A')}${k('S')}${k('D')}<span class="sep">·</span><span>Walk through a door to enter a classroom · the library is at the left end of the hall</span>`;
        else if ((this.roomObj(this.currentRoomCode) || {}).type === 'library') html = `${k('E')}<span>Notes at a section</span><span class="sep">·</span>${k('H')}<span>${this.handUp ? 'Cancel help' : 'Librarian'}</span>`;
        else if (this.seat.phase === 'seated' || this.seat.phase === 'sitting') html = `${k('Ctrl')}<span>Stand up</span><span class="sep">·</span>${k('H')}<span>${(this.roomObj(this.currentRoomCode) || {}).type === 'library' ? 'Ask the librarian' : 'Raise / lower hand'}</span>`;
        else if (this.auto) html = `<span>${Icons.svg('walk', 14)} Walking to the seating area…</span><span class="sep">·</span><span>Press any move key to take over</span>`;
        else html = `<span>Walk to a free bench and press</span>${k('S')}<span class="sep">·</span><span>Move with</span>${k('W')}${k('A')}${k('↓')}${k('D')}`;
        el.classList.toggle('top', Boolean(this.currentRoomCode));
        if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    },

    // the prompt above the room bar: notice board, free seat nearby, ...
    setPrompt(p) {
        const overlay = document.getElementById('interaction-overlay');
        if (!overlay) return;
        const sig = p ? p.key + p.title + p.sub : '';
        if (overlay.dataset.sig !== sig) {
            overlay.dataset.sig = sig;
            if (p) {
                document.getElementById('interaction-key').textContent = p.key;
                document.getElementById('interaction-title').textContent = p.title;
                document.getElementById('interaction-sub').textContent = p.sub;
            }
        }
        overlay.classList.toggle('visible', Boolean(p));
        const panel = document.getElementById('live-classes-panel');
        if (panel) panel.classList.toggle('interaction-active', Boolean(p));
    },

    // the library section whose floor mat is at (x, y), or null
    sectionAtPoint(x, y) {
        const lib = this.layout && this.layout.library;
        if (!lib) return null;
        const pad = 10;
        return lib.sections.find(s => x >= s.mat.x - pad && x <= s.mat.x + s.mat.w + pad && y >= s.mat.y - pad && y <= s.mat.y + s.mat.h + pad) || null;
    },
    // the section I am standing at (only while I am inside the library)
    sectionAt(x, y) {
        return this.currentRoomCode === Library.code ? this.sectionAtPoint(x, y) : null;
    },

    checkProximity(layout) {
        const a = this.avatar, nb = layout.noticeBoard;
        const nearNotice = !this.currentRoomCode && Math.hypot(a.x - (nb.x + nb.width / 2), a.y - (nb.y + nb.height / 2)) < 70;
        const section = nearNotice ? null : this.sectionAt(a.x, a.y);
        this.nearSection = section;
        this.nearbyEntity = nearNotice ? { type: 'notice' } : section ? { type: 'notes', code: section.code } : null;
        this.updateNearSeat();

        let prompt = null;
        if (nearNotice) prompt = { key: 'E', title: 'Campus Notice Board', sub: 'Press E to see which classes are live' };
        else if (section) prompt = { key: 'E', title: `${section.code} · ${section.name}`, sub: 'Press E to open these notes on the right' };
        else if (this.nearSeat) prompt = { key: 'S', title: 'Sit here', sub: `${this.nearSeat.label} · press S to sit down` };
        this.setPrompt(prompt);

        const locEl = document.getElementById('hud-location');
        if (locEl) {
            const room = this.roomAt(layout, a.x, a.y);
            const inHall = a.x >= layout.hall.x && a.x <= layout.hall.x + layout.hall.width && a.y >= layout.hall.y && a.y <= layout.hall.y + layout.hall.height;
            const txt = nearNotice ? 'Notice Board' : room ? (room.type === 'library' ? (section ? `Library · ${section.code} notes` : 'Library') : `${room.subject.code} Classroom`) : inHall ? 'Central Hall' : 'Path to the Library';
            if (locEl.textContent !== txt) locEl.textContent = txt;
        }
    },

    // ---------------------------------------------------------------- camera
    getCamera() {
        const w = this.vw, h = this.vh;
        // the campus is wide (12 rooms), so the hall view never zooms out further than 60%: avatars stay readable and the camera follows you
        const hallBase = Math.max(0.6, Math.min(1, Math.max(w / World.width, h / World.height)));
        // inside a classroom the camera frames the whole room so every bench is in view
        const room = this.roomObj(this.currentRoomCode);
        let target = hallBase, focus = null, shift = 0;
        if (room && room.type === 'library') {
            // the library is as tall as the whole building: zoom in on it and follow the avatar up and down
            target = Math.max(hallBase, Math.min(1.1, w / (room.width + 80)));
        } else if (room) {
            const barH = 84, topPad = 10; // keep the room clear of the control bar at the bottom
            target = Math.max(hallBase, Math.min(1.7, Math.min(w / (room.width + 50), (h - barH - topPad) / (room.height + 20))));
            focus = { x: room.x + room.width / 2, y: room.y + room.height / 2 };
            shift = (barH - topPad) / 2;
        }
        if (this.baseZoom === null || this.motionQuery.matches) this.baseZoom = target;
        else { this.baseZoom += (target - this.baseZoom) * 0.12; if (Math.abs(target - this.baseZoom) < 0.0005) this.baseZoom = target; }
        const tz = this.zoomPercent / 100;
        if (this.motionQuery.matches) this.cameraZoom = tz;
        else { this.cameraZoom += (tz - this.cameraZoom) * 0.22; if (Math.abs(tz - this.cameraZoom) < 0.001) this.cameraZoom = tz; }
        const s = this.baseZoom * this.cameraZoom;
        const viewW = w / s, viewH = h / s;
        const fit = (center, view, size) => view >= size ? (size - view) / 2 : Math.max(0, Math.min(size - view, center - view / 2));
        const cx = focus ? focus.x : this.avatar.x, cy = focus ? focus.y + shift / s : this.avatar.y;
        const tx = fit(cx, viewW, World.width), ty = fit(cy, viewH, World.height);
        if (!this.camPos || this.motionQuery.matches) this.camPos = { x: tx, y: ty };
        else {
            const k = 1 - Math.pow(1 - 0.12, this.dtf || 1);
            this.camPos.x += (tx - this.camPos.x) * k;
            this.camPos.y += (ty - this.camPos.y) * k;
            if (Math.abs(tx - this.camPos.x) < 0.05) this.camPos.x = tx;
            if (Math.abs(ty - this.camPos.y) < 0.05) this.camPos.y = ty;
            const lim = (v, view, size) => view >= size ? (size - view) / 2 : Math.max(0, Math.min(size - view, v));
            this.camPos.x = lim(this.camPos.x, viewW, World.width);
            this.camPos.y = lim(this.camPos.y, viewH, World.height);
        }
        return { s, x: this.camPos.x, y: this.camPos.y, viewW, viewH };
    },

    loop(ts) {
        if (State.appState !== 'VIRTUAL_CAMPUS') return;
        const now = ts || performance.now();
        const dt = this.lastTs ? Math.min(now - this.lastTs, 50) : 16.667;
        this.lastTs = now;
        this.dtf = dt / 16.667;
        this.update(this.dtf);
        this.updateMicMeter();
        this.sendPresence(now);
        this.draw();
        this.animId = requestAnimationFrame(t => this.loop(t));
    },

    sendPresence(now) {
        if (now - this.lastPresence < 100) return;
        const a = this.avatar;
        const payload = { x: Math.round(a.x), y: Math.round(a.y), dir: a.dir, room: this.currentRoomCode, sp: this.mic.speaking };
        const sig = payload.x + ',' + payload.y + ',' + payload.dir + ',' + payload.room + ',' + payload.sp;
        if (sig === this.lastSig && now - this.lastPresence < 1000) return;
        this.lastSig = sig; this.lastPresence = now;
        Net.sendPresence(payload);
    }
};
