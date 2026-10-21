const MockCredentialStore = {
    students: [
        { id: '2510011214', password: '2510011214', profile: { id: 's1', name: '2510011214', role: 'student' } },
        { id: '2510011514', password: '2510011514', profile: { id: 's2', name: '2510011514', role: 'student' } },
        { id: '2510011592', password: '2510011592', profile: { id: 's3', name: '2510011592', role: 'student' } },
        { id: '2510012706', password: '2510012706', profile: { id: 's4', name: '2510012706', role: 'student' } }
    ],
    faculty: [
        { id: '1516', password: '1516', profile: { id: 'f1', name: 'Dr. Sharma', role: 'faculty' } }
    ]
};

const MeetingSubjects = [
    { name: 'Data Structures & Algorithms', code: 'CS201', roomName: 'DSA Classroom' },
    { name: 'Object Oriented Programming', code: 'CS202', roomName: 'OOP Classroom' },
    { name: 'Database Management Systems', code: 'CS203', roomName: 'DBMS Classroom' },
    { name: 'Computer Networks', code: 'CS204', roomName: 'Computer Networks Classroom' },
    { name: 'Operating Systems', code: 'CS205', roomName: 'Operating Systems Classroom' },
    { name: 'Mathematics', code: 'MA201', roomName: 'Mathematics Classroom' },
    { name: 'Computer Organization', code: 'CS206', roomName: 'Computer Organization Classroom' },
    { name: 'Software Engineering', code: 'CS207', roomName: 'Software Engineering Classroom' }
];
// Room 1..8 on the campus map = the 8 subjects above, in the same order.

// One entry per classroom on the campus map (4 on the top row, 4 on the bottom row)
const MeetingMapSlots = [
    { x: 0.125, y: 0.2 },
    { x: 0.375, y: 0.2 },
    { x: 0.625, y: 0.2 },
    { x: 0.875, y: 0.2 },
    { x: 0.125, y: 0.8 },
    { x: 0.375, y: 0.8 },
    { x: 0.625, y: 0.8 },
    { x: 0.875, y: 0.8 }
];

const MockData = {
    rooms: [
        { 
            id: 'r1', 
            name: 'Data Structures', 
            code: 'CS-101', 
            color: '#3B82F6', 
            accent: '#1D4ED8',
            icon: '💻', 
            faculty: 'Dr. Sharma', 
            topic: 'Binary Search Trees & AVL Rotations',
            initialMessages: [
                { sender: 'Dr. Sharma', role: 'faculty', text: "Welcome to today's live session. We'll be focusing on AVL Trees and balance factors." },
                { sender: '2510011514', role: 'student', text: "Sir, could you explain the left-right (LR) rotation case once more?" },
                { type: 'sys', text: "2510011592 enabled microphone." },
                { sender: '2510011592', role: 'student', text: "In LR rotation, we first perform a left rotation on the child, followed by a right rotation on the root node." },
                { sender: 'Dr. Sharma', role: 'faculty', text: "Exactly right! I will share the visual tree simulator on screen in a moment." }
            ]
        },
        { 
            id: 'r2', 
            name: 'Database Systems', 
            code: 'IS-204', 
            color: '#10B981', 
            accent: '#047857',
            icon: '🗄️', 
            faculty: 'Prof. Verma', 
            topic: 'B+ Tree Indexing & Query Plans',
            initialMessages: [
                { sender: 'Prof. Verma', role: 'faculty', text: "Good afternoon everyone. Today we are examining B+ Tree indices and multi-level indexing." },
                { sender: '2510011514', role: 'student', text: "Is the search complexity guaranteed to be O(log N) in B+ Trees?" },
                { sender: 'Prof. Verma', role: 'faculty', text: "Yes, because all leaf nodes reside at equal depth." }
            ]
        },
        { 
            id: 'r3', 
            name: 'C++ Programming', 
            code: 'SE-302', 
            color: '#8B5CF6', 
            accent: '#6D28D9',
            icon: '⚡', 
            faculty: 'Dr. Mehta', 
            topic: 'Memory Safety, RAII & Move Semantics',
            initialMessages: [
                { sender: 'Dr. Mehta', role: 'faculty', text: "Today's agenda covers RAII, std::unique_ptr, and move semantics." },
                { sender: '2510012706', role: 'student', text: "Why should we prefer std::make_unique over raw new allocations?" },
                { sender: 'Dr. Mehta', role: 'faculty', text: "It provides exception safety and guarantees no memory leak if secondary allocations fail." }
            ]
        }
    ],
    students: [
        { id: 's1', name: '2510011214', role: 'student', mic: 'off', screen: 'idle' },
        { id: 's2', name: '2510011514', role: 'student', mic: 'off', screen: 'idle' },
        { id: 's3', name: '2510011592', role: 'student', mic: 'on', screen: 'idle' },
        { id: 's4', name: '2510012706', role: 'student', mic: 'off', screen: 'idle' }
    ],
    faculty: { id: 'f1', name: 'Dr. Sharma', role: 'faculty', mic: 'on', screen: 'idle' }
};

const State = {
    appState: 'LOGIN', // LOGIN, VIRTUAL_CAMPUS
    user: null, // { id, name, role, room }  (room = assigned subject code, faculty only)
    token: null, // session token from /api/login

    init() {},

    setAuthenticatedUser(profile) {
        this.user = {
            id: profile.id,
            name: profile.name,
            role: profile.role,
            room: profile.room || null
        };
    },

    logout() {
        const token = this.token;
        if (token) {
            fetch('/api/logout', { method: 'POST', headers: { 'x-token': token }, keepalive: true }).catch(() => {});
        }
        this.token = null;
        this.user = null;
    }
};

const Navigation = {
    root: null,
    activeView: null,
    
    init() {
        this.root = document.getElementById('app');
    },
    
    navigate(targetState) {
        const nextView = this.getViewForState(targetState);

        if (this.activeView && this.activeView !== nextView && typeof this.activeView.cleanup === 'function') {
            this.activeView.cleanup();
        }

        State.appState = targetState;
        this.activeView = nextView;
        this.render();
    },

    getViewForState(targetState) {
        switch(targetState) {
            case 'LOGIN':
                return Login;
            case 'VIRTUAL_CAMPUS':
                return CampusWorld;
            default:
                return null;
        }
    },
    
    render() {
        this.root.innerHTML = ''; // clear
        
        // Always fade in new layer
        let layerHTML = '';
        let initLogic = null;
        
        switch(State.appState) {
            case 'LOGIN':
                layerHTML = Login.getHTML();
                initLogic = () => Login.init();
                break;
            case 'VIRTUAL_CAMPUS':
                layerHTML = CampusWorld.getHTML();
                initLogic = () => CampusWorld.init();
                break;
        }
        
        this.root.innerHTML = layerHTML;
        if(initLogic) initLogic();
    }
};

const Login = {
    getHTML() {
        return `
        <div class="layer landing-layer fade-in">
            <div class="login-wrapper">
                <div class="login-card">
                    <header>
                        <h1>EDUVERSE</h1>
                        <p>Virtual Interactive Learning Room</p>
                    </header>
                    
                    <div class="role-tabs">
                        <button type="button" class="role-tab selected" data-role="student">Student Login</button>
                        <button type="button" class="role-tab" data-role="faculty">Faculty Login</button>
                    </div>

                    <form id="login-form">
                        <div class="form-group">
                            <label id="id-label" for="userId">Student ID</label>
                            <input type="text" id="userId" class="login-input" placeholder="e.g. 2510011214" autocomplete="off">
                        </div>
                        
                        <div class="form-group">
                            <label for="password">Password</label>
                            <div class="password-wrapper">
                                <input type="password" id="password" class="login-input" placeholder="••••••••••" autocomplete="off">
                                <button type="button" class="toggle-password" id="toggle-pwd">👁</button>
                            </div>
                        </div>
                        
                        <div class="auth-feedback" id="auth-feedback"></div>
                        
                        <button type="submit" class="submit-btn" id="submit-btn">LOGIN</button>
                    </form>
                    
                    <div class="secure-notice">
                        <span>🔒 Secure academic access</span>
                    </div>
                </div>
            </div>
        </div>`;
    },
    
    init() {
        let currentRole = 'student';
        
        const tabs = document.querySelectorAll('.role-tab');
        const idLabel = document.getElementById('id-label');
        const idInput = document.getElementById('userId');
        const pwdInput = document.getElementById('password');
        const form = document.getElementById('login-form');
        const togglePwd = document.getElementById('toggle-pwd');
        const feedback = document.getElementById('auth-feedback');
        const submitBtn = document.getElementById('submit-btn');
        
        // Tab switching
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                tabs.forEach(t => t.classList.remove('selected'));
                e.target.classList.add('selected');
                currentRole = e.target.getAttribute('data-role');
                
                // Reset form
                feedback.textContent = '';
                idInput.classList.remove('error');
                pwdInput.classList.remove('error');
                idInput.value = '';
                pwdInput.value = '';
                
                if(currentRole === 'student') {
                    idLabel.textContent = 'Student ID';
                    idInput.placeholder = 'e.g. 2510011214';
                } else {
                    idLabel.textContent = 'Faculty ID';
                    idInput.placeholder = 'e.g. 1516';
                }
            });
        });
        
        // Show/Hide password
        togglePwd.addEventListener('click', () => {
            if(pwdInput.type === 'password') {
                pwdInput.type = 'text';
                togglePwd.style.color = 'white';
            } else {
                pwdInput.type = 'password';
                togglePwd.style.color = '#71717A';
            }
        });
        
        // Input listeners to clear error state on typing
        idInput.addEventListener('input', () => {
            idInput.classList.remove('error');
            if (feedback.classList.contains('error')) {
                feedback.textContent = '';
                feedback.className = 'auth-feedback';
            }
        });
        pwdInput.addEventListener('input', () => {
            pwdInput.classList.remove('error');
            if (feedback.classList.contains('error')) {
                feedback.textContent = '';
                feedback.className = 'auth-feedback';
            }
        });

        // Form submission
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const idVal = idInput.value.trim();
            const pwdVal = pwdInput.value;
            
            // Reset state
            idInput.classList.remove('error');
            pwdInput.classList.remove('error');
            feedback.className = 'auth-feedback';
            feedback.textContent = '';
            
            // Validation
            if (!idVal) {
                idInput.classList.add('error');
                feedback.classList.add('error');
                feedback.textContent = `${currentRole === 'student' ? 'Student ID' : 'Faculty ID'} is required.`;
                return;
            }
            
            if (currentRole === 'student' && !/^\d+$/.test(idVal)) {
                idInput.classList.add('error');
                feedback.classList.add('error');
                feedback.textContent = 'Enter a valid Student ID.';
                return;
            }

            if (currentRole === 'faculty' && !/^\d{4}$/.test(idVal)) {
                idInput.classList.add('error');
                feedback.classList.add('error');
                feedback.textContent = 'Enter a valid 4-digit Faculty ID.';
                return;
            }
            
            if (!pwdVal) {
                pwdInput.classList.add('error');
                feedback.classList.add('error');
                feedback.textContent = 'Password is required.';
                return;
            }
            
            // Simulate Authentication
            submitBtn.disabled = true;
            submitBtn.textContent = 'Authenticating...';
            
            fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: idVal, password: pwdVal, role: currentRole })
            })
                .then(res => res.json().then(body => ({ ok: res.ok, body })))
                .then(({ ok, body }) => {
                    if (!ok) throw new Error(body.error || 'Login failed.');

                    const userProfile = { id: body.id, name: body.name, role: body.role, room: body.room };

                    // Success
                    feedback.classList.add('success');
                    feedback.textContent = 'Authentication successful.';

                    // Transition after a brief delay
                    setTimeout(() => {
                        State.token = body.token;
                        State.setAuthenticatedUser(userProfile);
                        Navigation.navigate('VIRTUAL_CAMPUS');
                    }, 700);
                })
                .catch(error => {
                    // Fail
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'LOGIN';
                    feedback.classList.add('error');
                    feedback.textContent = error instanceof TypeError
                        ? "Cannot reach the server. Is 'npm start' running?"
                        : (error.message === 'Wrong username or password'
                            ? (currentRole === 'student' ? 'Invalid Student ID or password.' : 'Invalid Faculty ID or password.')
                            : error.message);
                });
        });
    }
};

// ---------- World geometry (fixed world units; the camera follows the avatar) ----------
const World = {
    roomW: 440, roomH: 360, gap: 20, padX: 120, top: 120, hallH: 340,
    wall: 14,        // thickness of the walls
    band: 34,        // header band on the wall opposite the door
    door: 96,        // width of the doorway
    get rowW() { return this.roomW * 4 + this.gap * 3; },
    get width() { return this.rowW + this.padX * 2; },
    get height() { return this.top * 2 + this.roomH * 2 + this.hallH; }
};

const CampusWorld = {
    canvas: null,
    ctx: null,
    animId: null,
    zoomPercent: 100,
    cameraZoom: 1,
    motionQuery: null,
    avatar: { x: 0, y: 0, size: 16, maxSpeed: 3.4, accel: 0.16, decel: 0.2, vx: 0, vy: 0, dir: 'down', walkPhase: 0, walkAmount: 0 },
    camPos: null,   // smoothed camera position
    audioCtx: null, // Web Audio context for the walking sound (local to this browser only)
    soundOn: true,
    lastDing: 0,
    dingBuffer: null, // your own sound file (public/ding.mp3), if present
    dingTried: false,
    dingSrc: null,
    lastTs: 0,      // previous frame timestamp (for frame-rate independent motion)
    dtf: 1,         // frames elapsed since last update (1 = 60fps)
    keys: { w: false, a: false, s: false, d: false, arrowup: false, arrowleft: false, arrowdown: false, arrowright: false },
    nearbyEntity: null, // only the notice board needs a key press now
    isModalOpen: false,
    tick: 0,
    patterns: {},
    remote: {}, // other logged-in users currently on campus (from the server)
    presenceTimer: null,
    presenceBusy: false,
    placedFor: null,
    layout: null,
    currentRoomCode: null, // the room the avatar is standing in (null = central hall)
    toastTimer: null,

    getHTML() {
        return `
        <div class="layer campus-world-layer fade-in">
            <!-- HUD -->
            <div class="world-hud">
                <div class="hud-left">
                    <span class="hud-brand">EDUVERSE</span>
                    <span class="hud-divider">|</span>
                    <span>${State.user.name}</span>
                    <span class="role-badge ${State.user.role}" style="margin:0; font-size:0.7rem; padding: 0.15rem 0.6rem;">${State.user.role}</span>
                    <span class="hud-divider">|</span>
                    <span class="hud-location" id="hud-location">Central Hall</span>
                </div>
                <div class="hud-right">
                    <div class="status-dot"></div>
                    <span id="online-count">1 Online</span>
                    <span class="hud-divider">•</span>
                    <span style="color:#10B981; font-weight:700;">Live Campus</span>
                    <button type="button" id="logout-btn" class="hud-logout-btn" title="Log out">⏻ Log out</button>
                </div>
            </div>

            <div class="zoom-controller" role="group" aria-label="Campus camera zoom">
                <div class="zoom-controls">
                    <button type="button" id="zoom-out-btn" aria-label="Zoom out" title="Zoom out">−</button>
                    <output id="zoom-level" aria-live="polite">100%</output>
                    <button type="button" id="zoom-in-btn" aria-label="Zoom in" title="Zoom in">+</button>
                </div>
                <button type="button" id="zoom-reset-btn">Reset</button>
            </div>

            <!-- Canvas -->
            <div class="world-canvas-container" id="canvas-container">
                <canvas id="world-canvas"></canvas>
            </div>

            <!-- Controls Hint -->
            <div class="movement-hint">
                <span>Move:</span>
                <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or <kbd>▲</kbd><kbd>◄</kbd><kbd>▼</kbd><kbd>►</kbd>
                ${State.user.role === 'student' ? '<span>· walk through a door to enter a classroom</span>' : ''}
            </div>

            <aside id="live-classes-panel" class="live-classes-panel" aria-label="Live classes"></aside>

            <!-- Shown while the avatar is inside a classroom (buttons are placeholders for now) -->
            <div id="room-bar" class="room-bar" aria-label="Classroom controls">
                <div class="room-bar-info">
                    <strong id="room-bar-title">Classroom</strong>
                    <span id="room-bar-sub"></span>
                </div>
                <button type="button" id="room-mic-btn" class="media-btn"><span class="icon">🎤</span><span class="label">Turn On Mic</span></button>
                <button type="button" id="room-screen-btn" class="media-btn"><span class="icon">💻</span><span class="label">Share Screen</span></button>
            </div>

            <!-- Notice board prompt (the only thing that still uses a key) -->
            <div id="interaction-overlay" class="interaction-overlay">
                <span class="interaction-key">E</span>
                <div>
                    <div class="interaction-title" id="interaction-title">Campus Notice Board</div>
                    <div class="interaction-sub" id="interaction-sub">Press E to see which classes are live</div>
                </div>
            </div>

            <div id="campus-toast" class="meeting-toast" role="status" aria-live="polite"></div>

            <!-- Campus Notice Board Modal -->
            <div id="campus-modal" class="campus-modal-backdrop">
                <div class="campus-modal">
                    <header>
                        <h3>🏛️ Eduverse Academic Announcements</h3>
                        <button class="close-modal-btn" id="close-modal-btn">✕</button>
                    </header>
                    <div class="notice-list" id="notice-list"></div>
                </div>
            </div>
        </div>`;
    },

    init() {
        this.canvas = document.getElementById('world-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.layout = this.buildLayout();
        this.currentRoomCode = null;

        this.resize();
        window.addEventListener('resize', this.resizeHandler);
        window.addEventListener('keydown', this.kdHandler);
        window.addEventListener('keyup', this.kuHandler);
        this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });

        document.getElementById('zoom-out-btn').addEventListener('click', () => this.adjustZoom(-10));
        document.getElementById('zoom-in-btn').addEventListener('click', () => this.adjustZoom(10));
        document.getElementById('zoom-reset-btn').addEventListener('click', () => this.setZoom(100));
        this.updateZoomControls();

        // mic / screen share are placeholders until they are built
        const soon = (e) => {
            this.showToast('Coming soon', 'Voice and screen sharing will be added in a later update.');
            e.currentTarget.blur();
        };
        document.getElementById('room-mic-btn').addEventListener('click', soon);
        document.getElementById('room-screen-btn').addEventListener('click', soon);

        document.getElementById('close-modal-btn').addEventListener('click', () => this.toggleNoticeModal(false));
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());

        this.renderLiveClasses();

        // a student appears in the middle of the hall (slightly spread out so avatars don't stack);
        // a faculty member appears inside their own assigned room
        if (this.placedFor !== State.user.id) {
            const home = this.homeRoom();
            if (home) {
                this.avatar.x = home.inner.x + home.inner.w / 2;
                this.avatar.y = home.inner.y + home.inner.h / 2;
            } else {
                const hall = this.layout.hall;
                this.avatar.x = hall.x + hall.width / 2 + (Math.random() - 0.5) * 300;
                this.avatar.y = hall.y + hall.height * 0.78;
            }
            this.placedFor = State.user.id;
            this.avatar.vx = 0; this.avatar.vy = 0; this.avatar.walkAmount = 0;
            this.camPos = null;
        }
        this.updateRoomState(this.getLayout());
        this.remote = {};
        this.startPresence();
        this.loop();
    },

    cleanup() {
        this.stopPresence();
        window.removeEventListener('resize', this.resizeHandler);
        window.removeEventListener('keydown', this.kdHandler);
        window.removeEventListener('keyup', this.kuHandler);
        if (this.canvas) this.canvas.removeEventListener('wheel', this.wheelHandler);
        if (this.animId) cancelAnimationFrame(this.animId);
        this.keys = { w: false, a: false, s: false, d: false, arrowup: false, arrowleft: false, arrowdown: false, arrowright: false };
        this.isModalOpen = false;
        this.lastTs = 0;
        this.camPos = null;
        this.stopCustomSound();
        if (this.audioCtx && this.audioCtx.state === 'running') this.audioCtx.suspend();
        this.avatar.vx = 0; this.avatar.vy = 0; this.avatar.walkAmount = 0;
    },

    resizeHandler: () => CampusWorld.resize(),
    kdHandler: (e) => CampusWorld.handleKey(e, true),
    kuHandler: (e) => CampusWorld.handleKey(e, false),
    wheelHandler: (e) => CampusWorld.handleWheel(e),

    showToast(title, message) {
        const toast = document.getElementById('campus-toast');
        if (!toast) return;
        toast.innerHTML = `<strong>${this.escapeHTML(title)}</strong><span>${this.escapeHTML(message)}</span>`;
        toast.classList.add('visible');
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 3500);
    },

    // the room a faculty member is assigned to (null for students)
    homeRoom() {
        if (!State.user || State.user.role !== 'faculty' || !State.user.room) return null;
        return this.layout.rooms.find(r => r.subject.code === State.user.room) || null;
    },

    // name of the faculty member currently inside a room (null if nobody is teaching there)
    facultyIn(code) {
        if (State.user.role === 'faculty' && this.currentRoomCode === code) return State.user.name;
        const f = Object.values(this.remote).find(p => p.role === 'faculty' && p.room === code);
        return f ? f.name : null;
    },

    liveRooms() {
        return this.layout.rooms
            .map(r => ({ room: r, faculty: this.facultyIn(r.subject.code) }))
            .filter(x => x.faculty);
    },

    logout() {
        const token = State.token;
        this.placedFor = null;
        Navigation.navigate('LOGIN'); // cleanup() stops presence and leaves the map
        State.token = token;
        State.logout();
    },

    // ---------- Presence: only users who are really logged in are shown ----------
    startPresence() {
        this.stopPresence();
        this.syncPresence();
        this.presenceTimer = window.setInterval(() => this.syncPresence(), 250);
    },

    stopPresence() {
        if (this.presenceTimer) {
            window.clearInterval(this.presenceTimer);
            this.presenceTimer = null;
            if (State.token) {
                fetch('/api/presence/leave', {
                    method: 'POST',
                    headers: { 'x-token': State.token },
                    keepalive: true
                }).catch(() => {});
            }
        }
    },

    async syncPresence() {
        if (!State.token || this.presenceBusy || !this.canvas) return;
        this.presenceBusy = true;
        try {
            const res = await fetch('/api/presence', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-token': State.token },
                body: JSON.stringify({
                    x: Math.round(this.avatar.x),
                    y: Math.round(this.avatar.y),
                    room: this.currentRoomCode
                })
            });
            if (State.appState !== 'VIRTUAL_CAMPUS' || !this.presenceTimer) return;
            if (res.status === 401) {
                // session is gone (for example the server restarted): sign in again
                this.presenceTimer = null;
                State.token = null;
                Navigation.navigate('LOGIN');
                return;
            }
            if (!res.ok) return;
            const data = await res.json();

            const seen = {};
            data.players.forEach(p => {
                seen[p.id] = true;
                const old = this.remote[p.id];
                this.remote[p.id] = { ...p, cx: old ? old.cx : p.x, cy: old ? old.cy : p.y };
            });
            Object.keys(this.remote).forEach(id => { if (!seen[id]) delete this.remote[id]; });

            this.renderLiveClasses();
            const counter = document.getElementById('online-count');
            if (counter) counter.textContent = `${data.online} Online`;
        } catch (err) {
            // server not reachable right now; try again on the next tick
        } finally {
            this.presenceBusy = false;
        }
    },

    escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    renderNotices() {
        const list = document.getElementById('notice-list');
        if (!list) return;
        const live = this.liveRooms();
        list.innerHTML = live.length
            ? live.map(({ room, faculty }) => `
                <div class="notice-item">
                    <span class="notice-badge live">● LIVE NOW</span>
                    <div class="notice-title">${this.escapeHTML(room.subject.name)} (${this.escapeHTML(room.subject.code)})</div>
                    <div class="notice-desc">${this.escapeHTML(faculty)} is teaching in Room ${room.number}.</div>
                </div>`).join('')
            : `<div class="notice-item">
                    <span class="notice-badge info">NO CLASSES</span>
                    <div class="notice-title">No live classes right now</div>
                    <div class="notice-desc">Every room is open. A class shows up here once its faculty member is in the room.</div>
                </div>`;
    },

    // Wooden floor and grass are drawn once as repeating tiles
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
                    if (x + 96 > 192) { t.fillRect(0, row * 32, x + 96 - 192, 32); }
                }
                for (let g = 0; g < 6; g++) {
                    t.fillStyle = 'rgba(120, 80, 30, 0.12)';
                    t.fillRect(rand() * 192, row * 32 + 4 + rand() * 24, 20 + rand() * 30, 1);
                }
            }
            t.fillStyle = '#8F6A3A';
            t.fillRect(0, 0, 192, 2);
            t.fillRect(0, 32, 192, 2);
            t.fillRect(0, 0, 2, 32);
            t.fillRect(96, 32, 2, 32);
        } else if (kind === 'room') {
            // lighter floor inside classrooms
            tile.width = 80; tile.height = 80;
            t.fillStyle = '#EFE6D2';
            t.fillRect(0, 0, 80, 80);
            t.fillStyle = 'rgba(120, 100, 60, 0.10)';
            t.fillRect(0, 0, 80, 1);
            t.fillRect(0, 0, 1, 80);
        } else {
            tile.width = 64; tile.height = 64;
            t.fillStyle = '#5E9C40';
            t.fillRect(0, 0, 64, 64);
            for (let i = 0; i < 45; i++) {
                t.fillStyle = rand() > 0.5 ? '#4F8A35' : '#6DAA4C';
                t.fillRect(Math.floor(rand() * 62), Math.floor(rand() * 58), 2, 5);
            }
        }
        this.patterns[kind] = this.ctx.createPattern(tile, 'repeat');
        return this.patterns[kind];
    },

    setZoom(percent) {
        this.zoomPercent = Math.max(50, Math.min(150, percent));
        this.updateZoomControls();
    },

    adjustZoom(amount) {
        this.setZoom(this.zoomPercent + amount);
    },

    updateZoomControls() {
        const level = document.getElementById('zoom-level');
        const zoomOut = document.getElementById('zoom-out-btn');
        const zoomIn = document.getElementById('zoom-in-btn');

        if (level) level.textContent = `${this.zoomPercent}%`;
        if (zoomOut) zoomOut.disabled = this.zoomPercent <= 50;
        if (zoomIn) zoomIn.disabled = this.zoomPercent >= 150;
    },

    isControlTarget(target) {
        return target instanceof Element && Boolean(target.closest(
            'input, textarea, select, [contenteditable="true"], [role="textbox"]'
        ));
    },

    handleWheel(e) {
        if (State.appState !== 'VIRTUAL_CAMPUS' || this.isModalOpen) return;
        e.preventDefault();
        if (e.deltaY < 0) this.adjustZoom(10);
        else if (e.deltaY > 0) this.adjustZoom(-10);
    },

    resize() {
        if (!this.canvas) return;
        const container = document.getElementById('canvas-container');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
    },

    // ---------- Layout: 4 big rooms on top, 4 at the bottom, a hall between ----------
    // Each room is a walled space with a doorway facing the hall. The avatar walks straight in.
    buildLayout() {
        const W = World;
        const hall = { x: W.padX, y: W.top + W.roomH, width: W.rowW, height: W.hallH };
        const rooms = [];
        for (let i = 0; i < 8; i++) {
            const topRow = i < 4;
            const x = W.padX + (i % 4) * (W.roomW + W.gap);
            const y = topRow ? W.top : hall.y + hall.height;
            const edge = topRow ? y + W.roomH : y; // the wall line facing the hall
            const doorX = x + W.roomW / 2;
            rooms.push({
                id: `room-${i + 1}`,
                number: i + 1,
                subject: MeetingSubjects[i],
                x, y, width: W.roomW, height: W.roomH,
                doorX, edge, doorTop: !topRow,
                // walkable floor inside (excludes the walls and the header band)
                inner: {
                    x: x + W.wall,
                    y: topRow ? y + W.band : y + W.wall,
                    w: W.roomW - W.wall * 2,
                    h: W.roomH - W.wall - W.band
                },
                // the gap in the wall (overlaps both the hall and the room floor)
                doorway: {
                    x: doorX - W.door / 2,
                    y: topRow ? edge - W.wall - 2 : edge - 2,
                    w: W.door,
                    h: W.wall + 4
                }
            });
        }

        const noticeBoard = {
            id: 'notice',
            name: 'Campus Notice Board',
            x: hall.x + hall.width / 2 - 28,
            y: hall.y + hall.height * 0.3 - 19,
            width: 56,
            height: 38
        };

        const walkable = [{ x: hall.x, y: hall.y, w: hall.width, h: hall.height }];
        rooms.forEach(r => { walkable.push(r.inner); walkable.push(r.doorway); });

        return { rooms, hall, noticeBoard, walkable };
    },

    getLayout() {
        if (!this.layout) this.layout = this.buildLayout();
        return this.layout;
    },

    // can a circle of radius r stand at (x, y)?  (checks the corners and edge midpoints of its box)
    canStand(layout, x, y, r) {
        const pts = [
            [x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r],
            [x, y - r], [x, y + r], [x - r, y], [x + r, y]
        ];
        const home = this.homeRoom();
        const areas = home ? [home.inner] : layout.walkable; // faculty never leave their own room
        const inside = (px, py) => areas.some(a => px >= a.x && px <= a.x + a.w && py >= a.y && py <= a.y + a.h);
        if (!pts.every(p => inside(p[0], p[1]))) return false;
        const nb = layout.noticeBoard;
        return !(x + r > nb.x && x - r < nb.x + nb.width && y + r > nb.y && y - r < nb.y + nb.height);
    },

    roomAt(layout, x, y) {
        return layout.rooms.find(r => x >= r.inner.x && x <= r.inner.x + r.inner.w && y >= r.inner.y && y <= r.inner.y + r.inner.h) || null;
    },

    handleKey(e, isDown) {
        if (State.appState !== 'VIRTUAL_CAMPUS') return;
        const key = e.key.toLowerCase();

        if (isDown) this.unlockAudio();   // browsers only allow sound after a key press / click
        if (isDown && !e.repeat && key === 'm' && !this.isModalOpen && !this.isControlTarget(e.target)) {
            this.soundOn = !this.soundOn;
            this.showToast('Sound', this.soundOn ? 'Walking sound on (press M to mute)' : 'Walking sound muted (press M to unmute)');
        }

        if (isDown && !e.repeat && !this.isModalOpen && !this.isControlTarget(e.target)) {
            if (key === '+' || key === '=') {
                e.preventDefault();
                this.adjustZoom(10);
            } else if (key === '-') {
                e.preventDefault();
                this.adjustZoom(-10);
            } else if (key === '0') {
                e.preventDefault();
                this.setZoom(100);
            }
        }

        if (key === 'escape' && isDown && this.isModalOpen) {
            this.toggleNoticeModal(false);
            return;
        }

        if (Object.prototype.hasOwnProperty.call(this.keys, key)) {
            this.keys[key] = isDown;
        }

        // E is only used for the notice board now - rooms open by walking in
        if (isDown && key === 'e') {
            if (this.isModalOpen) this.toggleNoticeModal(false);
            else if (this.nearbyEntity && this.nearbyEntity.type === 'notice') this.toggleNoticeModal(true);
        }
    },

    toggleNoticeModal(open) {
        this.isModalOpen = open;
        if (open) this.renderNotices();
        const modal = document.getElementById('campus-modal');
        if (modal) modal.classList.toggle('open', open);
    },

    // ---------- Entering / leaving a room happens by position, no new window ----------
    updateRoomState(layout) {
        const room = this.roomAt(layout, this.avatar.x, this.avatar.y);
        const code = room ? room.subject.code : null;
        if (code === this.currentRoomCode) return;

        this.currentRoomCode = code;

        const bar = document.getElementById('room-bar');
        const locEl = document.getElementById('hud-location');
        if (bar) {
            bar.classList.toggle('visible', Boolean(room));
            if (room) {
                document.getElementById('room-bar-title').textContent = `${room.subject.code} · ${room.subject.name}`;
            }
        }
        if (locEl && !this.nearbyEntity) locEl.textContent = room ? `${room.subject.code} Classroom` : 'Central Hall';
    },

    // students currently inside a room (me + everybody else reported by the server)
    studentsIn(code) {
        let n = Object.values(this.remote).filter(p => p.room === code && p.role === 'student').length;
        if (this.currentRoomCode === code && State.user.role === 'student') n++;
        return n;
    },

    // ---------- Walking sound ("ding ding ding") ----------
    // Generated here in the browser with Web Audio and never sent to the server,
    // so only the student who is walking hears it. Other users' movement is silent.
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

    // If public/ding.mp3 exists it is used instead of the built-in bell
    loadCustomSound() {
        if (this.dingTried || !this.audioCtx) return;
        this.dingTried = true;
        fetch('/ding.mp3')
            .then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
            .then(buf => this.audioCtx.decodeAudioData(buf))
            .then(decoded => { this.dingBuffer = decoded; })
            .catch(() => { /* no file: keep the built-in bell */ });
    },

    startCustomSound() {
        const ac = this.audioCtx;
        if (!ac || ac.state !== 'running' || this.dingSrc) return;
        const src = ac.createBufferSource();
        const g = ac.createGain();
        src.buffer = this.dingBuffer;
        src.loop = true;
        g.gain.setValueAtTime(0.0001, ac.currentTime);
        g.gain.linearRampToValueAtTime(0.8, ac.currentTime + 0.05);
        src.connect(g);
        g.connect(ac.destination);
        src.start();
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
        const t = ac.currentTime;
        const master = ac.createGain();
        master.gain.setValueAtTime(0.0001, t);
        master.gain.exponentialRampToValueAtTime(0.18, t + 0.008);
        master.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        master.connect(ac.destination);
        // a bright bell: fundamental + two overtones
        [[988, 1], [1976, 0.35], [2960, 0.15]].forEach(([freq, vol]) => {
            const osc = ac.createOscillator();
            const g = ac.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            g.gain.value = vol;
            osc.connect(g);
            g.connect(master);
            osc.start(t);
            osc.stop(t + 0.36);
        });
    },

    updateWalkSound(now) {
        const a = this.avatar;
        const inHall = this.currentRoomCode === null;
        const walking = Math.hypot(a.vx, a.vy) > 1.2;
        const shouldPlay = this.soundOn && inHall && walking && State.user.role === 'student';

        if (this.dingBuffer) {            // your mp3: plays while walking, fades out when you stop
            if (shouldPlay) this.startCustomSound(); else this.stopCustomSound();
            return;
        }
        if (!shouldPlay) return;
        if (now - this.lastDing >= 280) {
            this.lastDing = now;
            this.playDing();
        }
    },

    update(dtf = 1) {
        const a = this.avatar;
        if (this.isModalOpen) {
            a.vx = 0; a.vy = 0; a.walkAmount = 0;
            return;
        }

        this.tick++;

        // what the player is asking for (-1, 0, 1 on each axis)
        let ix = 0, iy = 0;
        if (this.keys.w || this.keys.arrowup) iy -= 1;
        if (this.keys.s || this.keys.arrowdown) iy += 1;
        if (this.keys.a || this.keys.arrowleft) ix -= 1;
        if (this.keys.d || this.keys.arrowright) ix += 1;
        if (ix !== 0 && iy !== 0) {
            ix *= 0.7071;
            iy *= 0.7071;
        }

        // ease the velocity toward the target instead of jumping to full speed
        // (speeds up gently, glides to a stop; same feel at any frame rate)
        const wantsMove = ix !== 0 || iy !== 0;
        const rate = wantsMove ? a.accel : a.decel;
        const k = 1 - Math.pow(1 - rate, dtf);
        a.vx += (ix * a.maxSpeed - a.vx) * k;
        a.vy += (iy * a.maxSpeed - a.vy) * k;
        if (Math.abs(a.vx) < 0.03) a.vx = 0;
        if (Math.abs(a.vy) < 0.03) a.vy = 0;

        // face the direction being pressed
        if (wantsMove) {
            if (Math.abs(ix) > Math.abs(iy)) a.dir = ix > 0 ? 'right' : 'left';
            else a.dir = iy > 0 ? 'down' : 'up';
        }

        const layout = this.getLayout();
        const r = a.size;
        const dx = a.vx * dtf, dy = a.vy * dtf;

        // slide along walls (test X and Y independently); stop that axis when blocked
        if (dx !== 0) {
            if (this.canStand(layout, a.x + dx, a.y, r)) a.x += dx; else a.vx = 0;
        }
        if (dy !== 0) {
            if (this.canStand(layout, a.x, a.y + dy, r)) a.y += dy; else a.vy = 0;
        }

        // walking animation follows the real speed
        const speed = Math.hypot(a.vx, a.vy);
        a.walkPhase += speed * 0.07 * dtf;
        a.walkAmount += (Math.min(1, speed / 1.6) - a.walkAmount) * (1 - Math.pow(0.8, dtf));

        this.updateRoomState(layout);
        this.updateWalkSound(performance.now());
        this.checkProximity(layout);
    },

    // only the notice board still shows a prompt
    checkProximity(layout) {
        const nb = layout.noticeBoard;
        const near = Math.hypot(this.avatar.x - (nb.x + nb.width / 2), this.avatar.y - (nb.y + nb.height / 2)) < 70;
        this.nearbyEntity = near ? { type: 'notice' } : null;

        const overlay = document.getElementById('interaction-overlay');
        const locEl = document.getElementById('hud-location');
        if (!overlay) return;
        overlay.classList.toggle('visible', near);

        const panel = document.getElementById('live-classes-panel');
        if (panel) panel.classList.toggle('interaction-active', near);

        if (locEl) {
            if (near) locEl.textContent = 'Notice Board';
            else {
                const room = this.roomAt(layout, this.avatar.x, this.avatar.y);
                locEl.textContent = room ? `${room.subject.code} Classroom` : 'Central Hall';
            }
        }
    },

    // camera follows the avatar, never shows past the edge of the world
    getCamera() {
        const w = this.canvas.width, h = this.canvas.height;
        const base = Math.min(1, Math.max(w / World.width, h / World.height));
        const targetZoom = this.zoomPercent / 100;
        if (this.motionQuery.matches) this.cameraZoom = targetZoom;
        else {
            this.cameraZoom += (targetZoom - this.cameraZoom) * 0.22;
            if (Math.abs(targetZoom - this.cameraZoom) < 0.001) this.cameraZoom = targetZoom;
        }
        const s = base * this.cameraZoom;
        const viewW = w / s, viewH = h / s;
        const fit = (center, view, size) => view >= size ? (size - view) / 2 : Math.max(0, Math.min(size - view, center - view / 2));
        const tx = fit(this.avatar.x, viewW, World.width);
        const ty = fit(this.avatar.y, viewH, World.height);
        if (!this.camPos || this.motionQuery.matches) {
            this.camPos = { x: tx, y: ty };
        } else {
            const k = 1 - Math.pow(1 - 0.14, this.dtf || 1);
            this.camPos.x += (tx - this.camPos.x) * k;
            this.camPos.y += (ty - this.camPos.y) * k;
            if (Math.abs(tx - this.camPos.x) < 0.05) this.camPos.x = tx;
            if (Math.abs(ty - this.camPos.y) < 0.05) this.camPos.y = ty;
            // never show past the edge of the world, even mid-zoom
            const lim = (v, view, size) => view >= size ? (size - view) / 2 : Math.max(0, Math.min(size - view, v));
            this.camPos.x = lim(this.camPos.x, viewW, World.width);
            this.camPos.y = lim(this.camPos.y, viewH, World.height);
        }
        return { s, x: this.camPos.x, y: this.camPos.y, viewW, viewH };
    },

    // small helper: rounded rectangle path
    rrect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    // A student character: school sweater, backpack, hair, face, swinging arms and legs.
    // (x, y) is the centre of the collision circle; feet touch the ground at y + size.
    // Faculty use the same character in a purple blazer, without the backpack.
    drawStudent(ctx, x, y, o) {
        const faculty = o.role === 'faculty';
        const dir = o.dir || 'down';
        const amt = o.amount || 0;
        const swing = Math.sin(o.phase || 0) * amt;
        const bob = Math.abs(Math.sin(o.phase || 0)) * 1.6 * amt + (amt < 0.05 ? Math.sin(this.tick * 0.06) * 0.4 : 0);
        const k = (o.size || 16) / 16;

        const skin = '#F5C9A0', hair = faculty ? '#6B7280' : '#3B2A1E';
        const sweater = faculty ? '#7C3AED' : '#4F46E5';
        const sweaterDark = faculty ? '#6D28D9' : '#4338CA';
        const pants = '#1E293B', shoe = '#0B1220';
        const pack = '#F59E0B', packDark = '#D97706';

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(k, k);

        // ground shadow (stays on the floor while the body bobs)
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(0, 16, 12, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.translate(0, -bob);

        const side = dir === 'left' || dir === 'right';
        const sg = dir === 'right' ? 1 : -1;

        // ---- legs ----
        if (side) {
            [[-1, '#172033'], [1, pants]].forEach(([n, col]) => {
                const off = swing * 5 * n;
                ctx.fillStyle = col;
                this.rrect(ctx, -3 + off, 4, 6, 12, 2);
                ctx.fill();
                ctx.fillStyle = shoe;
                this.rrect(ctx, -3 + off + (sg > 0 ? 0 : -2), 14, 8, 3, 1.5);
                ctx.fill();
            });
        } else {
            [[-7, Math.max(0, swing) * 3], [1, Math.max(0, -swing) * 3]].forEach(([lx, lift]) => {
                ctx.fillStyle = pants;
                this.rrect(ctx, lx, 4, 6, 12 - lift, 2);
                ctx.fill();
                ctx.fillStyle = shoe;
                this.rrect(ctx, lx - 0.5, 14 - lift, 7, 3, 1.5);
                ctx.fill();
            });
        }

        // ---- backpack behind the body (front and side views) ----
        const hasPack = !faculty;
        if (hasPack && dir === 'down') {
            ctx.fillStyle = packDark;
            this.rrect(ctx, -9, -8, 18, 17, 4);
            ctx.fill();
        } else if (hasPack && side) {
            ctx.fillStyle = packDark;
            this.rrect(ctx, -sg * 9 - 4, -9, 8, 15, 3);
            ctx.fill();
        }

        // ---- torso ----
        ctx.fillStyle = sweater;
        this.rrect(ctx, -10, -11, 20, 17, 5);
        ctx.fill();
        ctx.fillStyle = sweaterDark;      // hem stripe
        ctx.fillRect(-10, 3, 20, 2);

        if (dir === 'down') {
            ctx.fillStyle = '#FFFFFF';    // shirt collar
            ctx.beginPath();
            ctx.moveTo(-4, -11); ctx.lineTo(4, -11); ctx.lineTo(0, -5);
            ctx.closePath();
            ctx.fill();
            if (hasPack) {                // backpack straps
                ctx.fillStyle = pack;
                ctx.fillRect(-7, -10, 3, 14);
                ctx.fillRect(4, -10, 3, 14);
            } else {                      // tie for faculty
                ctx.fillStyle = '#FBBF24';
                ctx.fillRect(-1.2, -6, 2.4, 9);
            }
        }

        // ---- backpack in front of the body when seen from behind ----
        if (hasPack && dir === 'up') {
            ctx.fillStyle = pack;
            this.rrect(ctx, -9, -10, 18, 16, 4);
            ctx.fill();
            ctx.fillStyle = packDark;
            this.rrect(ctx, -6, -2, 12, 6, 2);
            ctx.fill();
            ctx.fillRect(-9, -6, 18, 1.5);
        }

        // ---- arms ----
        if (side) {
            const off = -swing * 4 * sg;
            ctx.fillStyle = sweaterDark;
            this.rrect(ctx, -2 + off, -9, 5, 11, 2.5);
            ctx.fill();
            ctx.fillStyle = skin;
            ctx.beginPath();
            ctx.arc(0.5 + off, 3.5, 2.3, 0, Math.PI * 2);
            ctx.fill();
        } else {
            [[-14, swing * 2.5], [10, -swing * 2.5]].forEach(([ax, dy]) => {
                ctx.fillStyle = sweaterDark;
                this.rrect(ctx, ax, -9 + dy, 4, 11, 2);
                ctx.fill();
                ctx.fillStyle = skin;
                ctx.beginPath();
                ctx.arc(ax + 2, 3.5 + dy, 2.3, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // ---- head ----
        const hy = -18;
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(0, hy, 8.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = hair;
        if (dir === 'up') {
            ctx.beginPath();
            ctx.arc(0, hy, 8.9, 0, Math.PI * 2);
            ctx.fill();
        } else if (dir === 'down') {
            ctx.beginPath();
            ctx.arc(0, hy, 8.9, Math.PI, 0);          // top of the head
            ctx.lineTo(8.9, hy);
            ctx.lineTo(5, hy + 2.5);                  // fringe
            ctx.lineTo(1.5, hy - 1);
            ctx.lineTo(-2.5, hy + 2.5);
            ctx.lineTo(-6, hy);
            ctx.lineTo(-8.9, hy);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#1F2937';                // eyes
            ctx.beginPath(); ctx.arc(-3, hy + 2.5, 1.2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(3, hy + 2.5, 1.2, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#B45309';              // smile
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(0, hy + 4, 2.2, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(0, hy, 8.9, 0, Math.PI * 2);      // hair, then face on top of the front half
            ctx.fill();
            ctx.fillStyle = skin;
            ctx.beginPath();
            ctx.ellipse(sg * 2.6, hy + 1, 6.3, 6.8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = hair;                     // fringe over the forehead
            ctx.beginPath();
            ctx.ellipse(sg * 3, hy - 5.2, 6, 2.6, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#1F2937';
            ctx.beginPath(); ctx.arc(sg * 5.6, hy + 1.8, 1.2, 0, Math.PI * 2); ctx.fill();
        }

        ctx.restore();
    },

    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const layout = this.getLayout();
        const hall = layout.hall;
        const cam = this.getCamera();

        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.scale(cam.s, cam.s);
        ctx.translate(-cam.x, -cam.y);

        // 1. Grass around the building
        ctx.fillStyle = this.getPattern('grass');
        ctx.fillRect(cam.x - 20, cam.y - 20, cam.viewW + 40, cam.viewH + 40);

        // 2. Hall: wooden floor
        ctx.fillStyle = this.getPattern('wood');
        ctx.fillRect(hall.x, hall.y, hall.width, hall.height);
        ctx.strokeStyle = '#6B4A22';
        ctx.lineWidth = 3;
        ctx.strokeRect(hall.x, hall.y, hall.width, hall.height);

        // 3. Rooms
        layout.rooms.forEach(room => this.drawRoom(ctx, room));

        // 4. Notice board
        const nb = layout.noticeBoard;
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(nb.x + 3, nb.y + 4, nb.width, nb.height);
        ctx.fillStyle = '#78350F';
        ctx.fillRect(nb.x, nb.y, nb.width, nb.height);
        ctx.fillStyle = '#B45309';
        ctx.fillRect(nb.x + 3, nb.y + 3, nb.width - 6, nb.height - 6);
        ctx.fillStyle = '#FEF3C7';
        ctx.fillRect(nb.x + 8, nb.y + 8, 14, 18);
        ctx.fillRect(nb.x + 28, nb.y + 10, 18, 16);
        ctx.fillStyle = '#3B2A14';
        ctx.font = 'bold 9px Inter';
        ctx.textAlign = 'center';
        ctx.fillText('NOTICES', nb.x + nb.width / 2, nb.y - 6);

        // 5. Other logged-in users (drawn back to front so nearer ones overlap)
        const peers = Object.values(this.remote);
        const follow = 1 - Math.pow(0.75, this.dtf || 1);
        peers.forEach(p => {
            const ddx = p.x - p.cx, ddy = p.y - p.cy;
            p.cx += ddx * follow;
            p.cy += ddy * follow;
            const moved = Math.hypot(ddx * follow, ddy * follow);
            p.phase = (p.phase || 0) + moved * 0.07;
            p.amount = (p.amount || 0) + (Math.min(1, moved / 1.6) - (p.amount || 0)) * 0.2;
            if (moved > 0.15) {
                p.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : (ddy > 0 ? 'down' : 'up');
            }
        });
        peers.sort((a, b) => a.cy - b.cy).forEach(peer => {
            this.drawStudent(ctx, peer.cx, peer.cy, {
                role: peer.role, dir: peer.dir || 'down', phase: peer.phase || 0, amount: peer.amount || 0, size: 14
            });

            ctx.font = '600 9px Inter';
            const tw = ctx.measureText(peer.name).width + 12;
            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.fillRect(peer.cx - tw / 2, peer.cy - 50, tw, 15);
            ctx.fillStyle = '#E2E8F0';
            ctx.textAlign = 'center';
            ctx.fillText(peer.name, peer.cx, peer.cy - 39);
        });

        // 6. Current user avatar
        const ax = this.avatar.x;
        const ay = this.avatar.y;
        const ar = this.avatar.size;

        // soft pulsing ring on the floor so you can spot yourself
        ctx.beginPath();
        ctx.ellipse(ax, ay + ar, ar + 7 + Math.sin(this.tick * 0.08) * 2, (ar + 7) * 0.38, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(79, 70, 229, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        this.drawStudent(ctx, ax, ay, {
            role: State.user.role, dir: this.avatar.dir, phase: this.avatar.walkPhase,
            amount: this.avatar.walkAmount, size: ar
        });

        const tagText = `${State.user.name} (You)`;
        ctx.font = 'bold 10px Inter';
        const tagW = ctx.measureText(tagText).width + 16;
        const tagH = 18;
        const tagY = ay - ar - 40;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(ax - tagW / 2, tagY, tagW, tagH);
        ctx.strokeStyle = '#6366F1';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ax - tagW / 2, tagY, tagW, tagH);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText(tagText, ax, tagY + 12.5);
        ctx.restore();
    },

    loop(ts) {
        if (State.appState !== 'VIRTUAL_CAMPUS') return;
        const now = ts || performance.now();
        const dt = this.lastTs ? Math.min(now - this.lastTs, 50) : 16.667;
        this.lastTs = now;
        this.dtf = dt / 16.667;   // 1 at 60fps, 0.5 at 120fps ...
        this.update(this.dtf);
        this.draw();
        this.animId = requestAnimationFrame((t) => this.loop(t));
    },

    // A walled classroom with a doorway. Purple + LIVE while a faculty member is teaching, grey otherwise.
    drawRoom(ctx, room) {
        const { x, y, width, height, doorX, doorTop, subject, inner } = room;
        const T = World.wall, B = World.band, D = World.door;
        const facultyName = this.facultyIn(subject.code);
        const live = Boolean(facultyName);
        const inside = this.currentRoomCode === subject.code;
        const students = this.studentsIn(subject.code);

        // shadow + floor
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.fillRect(x + 6, y + 6, width, height);
        ctx.fillStyle = this.getPattern('room');
        ctx.fillRect(x, y, width, height);

        // faint room info on the floor
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(31, 41, 55, 0.55)';
        ctx.font = 'bold 15px Inter';
        ctx.fillText(subject.name, x + width / 2, inner.y + 30);
        ctx.font = '500 12px Inter';
        ctx.fillText(live ? `${facultyName} is teaching` : 'Faculty has not joined yet', x + width / 2, inner.y + 50);
        ctx.fillText(`${students} student${students === 1 ? '' : 's'} inside`, x + width / 2, inner.y + 68);

        // walls
        const wallColor = inside ? '#8B6B3E' : '#5C4A32';
        ctx.fillStyle = wallColor;
        ctx.fillRect(x, y, T, height);                    // left
        ctx.fillRect(x + width - T, y, T, height);        // right
        const doorWallY = doorTop ? y : y + height - T;   // wall with the doorway
        const farWallY = doorTop ? y + height - B : y;    // header band wall
        ctx.fillRect(x, doorWallY, doorX - D / 2 - x, T);
        ctx.fillRect(doorX + D / 2, doorWallY, x + width - (doorX + D / 2), T);

        // header band
        ctx.fillStyle = live ? '#7C3AED' : '#7B8491';
        ctx.fillRect(x, farWallY, width, B);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 14px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(live ? `${subject.code}  ·  LIVE` : subject.code, x + width / 2, farWallY + 22);
        if (live) {
            ctx.fillStyle = '#34D399';
            ctx.beginPath();
            ctx.arc(x + 20, farWallY + B / 2, 5, 0, Math.PI * 2);
            ctx.fill();
        }

        // doormat just inside the doorway
        ctx.fillStyle = live ? '#9B2C2C' : '#8A6A4A';
        const matY = doorTop ? y + T + 2 : y + height - T - 10;
        ctx.fillRect(doorX - D / 2 + 6, matY, D - 12, 8);

        // highlight the room the avatar is in
        if (inside) {
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, width - 3, height - 3);
        }
    },

    renderLiveClasses() {
        const panel = document.getElementById('live-classes-panel');
        if (!panel || !State.user || State.user.role !== 'student') return;

        const live = this.liveRooms();
        const html = live.length
            ? `<h3>LIVE CLASSES <span>${live.length}</span></h3>${live.map(({ room }) => `
                <div class="live-class-item">
                    <i></i><span>${room.subject.code}</span><small>${room.subject.name}</small>
                </div>`).join('')}`
            : '';
        if (panel.dataset.html !== html) {
            panel.innerHTML = html;
            panel.dataset.html = html;
        }
        panel.classList.toggle('visible', live.length > 0);
    }
};


document.addEventListener('DOMContentLoaded', () => {
    State.init();
    Navigation.init();
    Navigation.navigate('LOGIN');
});