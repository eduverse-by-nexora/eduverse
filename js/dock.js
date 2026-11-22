// The right-hand dock inside a classroom.
//  * Faculty: live class dashboard (who is seated where, who is standing / waiting, raised hands,
//    screen-share requests) plus the shared screen when somebody is presenting.
//  * Students: the shared screen (view-only, with screenshot deterrents); in the library, the PDF notes of every subject.
//  * Librarian (in the library): who is inside / needs help, and the same notes list.
const Dock = {
    el: null, panel: null, viewer: null, video: null, frame: null,
    tab: 'students',
    lastHTML: '',
    selected: null,
    pendingRemove: null,
    pendingTimer: null,
    expanded: false,
    streamFor: null,
    soundBlocked: false,   // the browser refused to play the shared sound until the user clicks
    attachedAt: 0,        // peer id whose screen is attached
    shieldReasons: new Set(),
    timerHandle: null,
    notesHidden: false,   // a student closed the notes panel (it opens again on the next visit, or with the Notes button)

    html() {
        return `
        <aside id="dock" class="dock" aria-label="Classroom side panel">
            <section id="viewer-card" class="viewer-card" hidden>
                <header class="viewer-head">
                    <span class="live-pill"><i></i>LIVE</span>
                    <strong id="viewer-title">Shared screen</strong>
                    <span class="audio-pill" id="viewer-audio" hidden></span>
                    <button type="button" class="btn-mini primary" id="viewer-sound" data-act="enable-sound" hidden>${Icons.svg('volume', 13)} Enable sound</button>
                    <span class="viewer-timer" id="share-timer"></span>
                    <div class="viewer-actions" id="viewer-actions"></div>
                </header>
                <div class="secure-frame" id="secure-frame">
                    <video id="screen-video" autoplay playsinline disablepictureinpicture disableremoteplayback controlslist="nodownload nofullscreen noremoteplayback" tabindex="-1"></video>
                    <div class="secure-watermark" id="secure-watermark"></div>
                    <div class="viewer-placeholder" id="viewer-placeholder"><i class="spinner"></i><span>Connecting to the shared screen…</span></div>
                    <div class="secure-shield" id="secure-shield">${Icons.svg('eyeOff', 26)}<strong>Shared screen hidden</strong><span>Return to this window to keep watching.</span></div>
                    <div class="self-share" id="self-share">${Icons.svg('screen', 34)}<strong>You are sharing your screen</strong><span>Everyone in the classroom can see it.</span><span id="self-share-audio" class="audio-pill"></span></div>
                </div>
            </section>
            <section id="dock-panel" class="class-panel"></section>
        </aside>`;
    },

    init() {
        this.el = document.getElementById('dock');
        this.panel = document.getElementById('dock-panel');
        this.viewer = document.getElementById('viewer-card');
        this.video = document.getElementById('screen-video');
        this.frame = document.getElementById('secure-frame');
        this.lastHTML = '';
        this.selected = null;
        this.streamFor = null;
        this.shieldReasons = new Set();
        this.expanded = false;

        this.el.addEventListener('click', e => {
            const btn = e.target instanceof Element ? e.target.closest('[data-act]') : null;
            if (btn && !btn.disabled) this.act(btn.dataset.act, btn.dataset.id);
        });
        this.setupWatermark();
        this.setupSecurity();
        clearInterval(this.timerHandle);
        this.timerHandle = setInterval(() => this.tickTimer(), 1000);
    },

    cleanup() {
        clearInterval(this.timerHandle);
        clearTimeout(this.pendingTimer);
        this.removeSecurity();
        if (this.video) this.video.srcObject = null;
        this.streamFor = null;
    },

    // ------------------------------------------------------------ actions
    act(action, id) {
        if (action === 'notes-hide') { this.notesHidden = true; this.update(); CampusWorld.updateRoomBar(); return; }
        if (action === 'tab') { this.tab = id; this.lastHTML = ''; this.update(); return; }
        if (action === 'select') { this.selected = id; this.tab = 'students'; this.lastHTML = ''; this.update(); const row = this.panel.querySelector(`[data-row="${CSS.escape(id)}"]`); if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
        if (action === 'enable-sound') { this.soundBlocked = false; this.applyVolume(); this.video.play().catch(() => {}); this.updateAudioUI(); return; }
        if (action === 'expand') { this.expanded = !this.expanded; this.el.classList.toggle('expanded', this.expanded); window.dispatchEvent(new Event('resize')); return; }
        if (action === 'fullscreen') { if (this.frame.requestFullscreen) this.frame.requestFullscreen().catch(() => {}); return; }
        if (action === 'remove') {
            if (this.pendingRemove !== id) { // two clicks, so nobody is removed by accident
                this.pendingRemove = id;
                clearTimeout(this.pendingTimer);
                this.pendingTimer = setTimeout(() => { this.pendingRemove = null; this.lastHTML = ''; this.update(); }, 3000);
                this.lastHTML = ''; this.update();
                return;
            }
            clearTimeout(this.pendingTimer);
            this.pendingRemove = null;
        }
        CampusWorld.classAction(action, id);
    },

    // ------------------------------------------------------------ main refresh (called on every world update)
    update() {
        if (!this.el || !State.user) return;
        const me = CampusWorld.meServer;
        const code = me && me.room;
        const role = State.user.role, isFaculty = role === 'faculty';
        const share = CampusWorld.shareInfo();
        const roomObj = CampusWorld.roomObj(code);
        const showViewer = Boolean(code && share.sharerId);
        // faculty: the classroom dashboard. In the library: the notes (students) / the library dashboard (librarian)
        const inLibrary = Boolean(roomObj && roomObj.type === 'library');
        const showPanel = Boolean(code) && (isFaculty || (role === 'librarian' && inLibrary) || (role === 'student' && inLibrary && !this.notesHidden));

        this.viewer.hidden = !showViewer;
        this.panel.hidden = !showPanel;
        const visible = showViewer || showPanel;
        document.body.classList.toggle('dock-open', visible);
        this.el.classList.toggle('visible', visible);

        if (showViewer) this.updateViewer(share);
        else if (this.streamFor) this.detachScreen(this.streamFor);
        if (showPanel) { if (inLibrary) this.renderLibraryPanel(); else this.renderPanel(code, share); }
        this.updateSpeaking();
    },

    // ------------------------------------------------------------ viewer
    updateViewer(share) {
        const mine = share.sharerId === Net.myId;
        const isFaculty = State.user.role === 'faculty';
        const who = mine ? 'You' : (share.sharer ? share.sharer.name : 'Someone');
        document.getElementById('viewer-title').textContent = mine ? 'You are sharing' : `${who} is sharing`;
        this.frame.classList.toggle('mine', mine);
        this.frame.classList.toggle('secure', !isFaculty && !mine);
        const actions = document.getElementById('viewer-actions');
        const sig = (mine ? 'm' : 'o') + (isFaculty ? 'f' : 's') + this.expanded;
        if (actions.dataset.sig !== sig) {
            actions.dataset.sig = sig;
            actions.innerHTML =
                (mine ? '' : `<button type="button" class="icon-btn" data-act="expand" title="${this.expanded ? 'Smaller' : 'Larger'} view">${Icons.svg('expand', 16)}</button>`) +
                (isFaculty && !mine ? `<button type="button" class="icon-btn" data-act="fullscreen" title="Full screen">${Icons.svg('screen', 16)}</button>` : '') +
                (isFaculty && !mine ? `<button type="button" class="btn-mini danger" data-act="revoke">${Icons.svg('stop', 13)} Stop</button>` : '');
        }
        const waiting = !mine && !this.video.srcObject;
        document.getElementById('viewer-placeholder').classList.toggle('show', waiting);
        if (this.sharingSince !== share.sharerId) { this.sharingSince = share.sharerId; this.shareStart = Date.now(); }
        this.updateAudioUI();
        this.tickTimer();
    },

    tickTimer() {
        const el = document.getElementById('share-timer');
        if (el && this.shareStart && !this.viewer.hidden) el.textContent = Util.duration(Date.now() - this.shareStart);
    },

    attachScreen(peerId, stream) {
        this.streamFor = peerId;
        if (this.video.srcObject !== stream) { // video and audio arrive as separate tracks of the same stream: attach it once
            this.video.srcObject = stream;
            this.attachedAt = Date.now();
            this.soundBlocked = false;
            stream.addEventListener('addtrack', () => this.updateAudioUI());
        }
        this.applyVolume();
        const p = this.video.play();
        if (p && p.catch) p.catch(() => {
            // autoplay with sound was refused: show the picture muted and offer a button, never stay silently muted
            this.soundBlocked = true;
            this.video.muted = true;
            this.video.play().catch(() => {});
            this.updateAudioUI();
        });
        document.getElementById('viewer-placeholder').classList.remove('show');
        this.update();
    },

    detachScreen(peerId) {
        if (this.streamFor !== peerId) return;
        this.streamFor = null;
        if (this.video) this.video.srcObject = null;
        this.update();
    },

    // the shared screen's sound follows the classroom volume / "mute speakers"
    applyVolume() {
        if (!this.video) return;
        this.video.volume = RTC.volume;
        this.video.muted = RTC.deafened || this.soundBlocked;
    },

    updateAudioUI() {
        const stream = this.video && this.video.srcObject;
        const pill = document.getElementById('viewer-audio'), btn = document.getElementById('viewer-sound');
        if (!pill || !btn) return;
        const mine = this.frame.classList.contains('mine');
        const hasAudio = Boolean(stream && stream.getAudioTracks().length);
        const waited = Date.now() - this.attachedAt > 2500;
        btn.hidden = mine || !(hasAudio && this.soundBlocked);
        pill.hidden = mine || !stream || (!hasAudio && !waited);
        pill.classList.toggle('off', !hasAudio || RTC.deafened);
        pill.innerHTML = hasAudio ? Icons.svg(RTC.deafened || this.soundBlocked ? 'volumeX' : 'volume', 13) + (RTC.deafened ? ' Muted' : this.soundBlocked ? ' Sound off' : ' Sound on')
            : Icons.svg('volumeX', 13) + ' No sound in this share';
        const self = document.getElementById('self-share-audio');
        if (self) {
            const inc = CampusWorld.screen && CampusWorld.screen.hasAudio;
            self.innerHTML = Icons.svg(inc ? 'volume' : 'volumeX', 13) + (inc ? ' Sound is included' : ' No sound included');
            self.classList.toggle('off', !inc);
        }
    },

    // ------------------------------------------------------------ view-only protection
    // A web page cannot stop the operating system from taking a screenshot. What it CAN do (and does here):
    // offer no download / capture / pop-out / fullscreen controls to viewers, block the usual shortcuts and the
    // context menu, hide the picture the moment the window loses focus (which is what snipping tools cause), hide it
    // when printing, and tile the viewer's own ID over it so a leaked picture can be traced.
    isSecure() { return State.user && State.user.role !== 'faculty' && CampusWorld.shareInfo().sharerId !== Net.myId; },

    setupWatermark() {
        const label = Util.escapeHTML(`${State.user.userId || State.user.name}`);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="120"><text x="10" y="70" transform="rotate(-24 110 60)" font-family="Inter,Arial" font-size="15" font-weight="600" fill="white" fill-opacity="0.16">${label}</text></svg>`;
        document.getElementById('secure-watermark').style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
    },

    setShield(reason, on) {
        if (on) this.shieldReasons.add(reason); else this.shieldReasons.delete(reason);
        if (this.frame) this.frame.classList.toggle('shielded', this.shieldReasons.size > 0 && this.isSecure());
    },
    flash(reason, ms) { this.setShield(reason, true); setTimeout(() => this.setShield(reason, false), ms); },

    handlers: null,
    setupSecurity() {
        this.removeSecurity();
        const block = e => { if (this.isSecure() && this.frame.contains(e.target)) e.preventDefault(); };
        const keydown = e => {
            if (!this.isSecure() || !CampusWorld.shareInfo().sharerId) return;
            const k = (e.key || '').toLowerCase();
            const snip = k === 'printscreen' || (e.metaKey && e.shiftKey) || (e.metaKey && ['3', '4', '5'].includes(k));
            if (snip) { this.flash('key', 3500); this.clearClipboard(); }
            if ((e.ctrlKey || e.metaKey) && (k === 'p' || k === 's')) { e.preventDefault(); this.flash('key', 1500); }
        };
        const keyup = e => { if (this.isSecure() && e.key === 'PrintScreen') { this.flash('key', 3500); this.clearClipboard(); } };
        this.handlers = {
            blur: () => this.setShield('blur', true),
            focus: () => this.setShield('blur', false),
            vis: () => this.setShield('hidden', document.hidden),
            before: () => this.setShield('print', true),
            after: () => this.setShield('print', false),
            block, keydown, keyup
        };
        const h = this.handlers;
        window.addEventListener('blur', h.blur);
        window.addEventListener('focus', h.focus);
        document.addEventListener('visibilitychange', h.vis);
        window.addEventListener('beforeprint', h.before);
        window.addEventListener('afterprint', h.after);
        ['contextmenu', 'dragstart', 'selectstart', 'copy', 'cut', 'auxclick'].forEach(ev => document.addEventListener(ev, h.block));
        document.addEventListener('keydown', h.keydown, true);
        document.addEventListener('keyup', h.keyup, true);
    },
    removeSecurity() {
        const h = this.handlers;
        if (!h) return;
        window.removeEventListener('blur', h.blur);
        window.removeEventListener('focus', h.focus);
        document.removeEventListener('visibilitychange', h.vis);
        window.removeEventListener('beforeprint', h.before);
        window.removeEventListener('afterprint', h.after);
        ['contextmenu', 'dragstart', 'selectstart', 'copy', 'cut', 'auxclick'].forEach(ev => document.removeEventListener(ev, h.block));
        document.removeEventListener('keydown', h.keydown, true);
        document.removeEventListener('keyup', h.keyup, true);
        this.handlers = null;
    },
    clearClipboard() { try { navigator.clipboard.writeText(' ').catch(() => {}); } catch (e) { /* not allowed */ } },

    // ------------------------------------------------------------ faculty dashboard
    studentRow(p, kind, share, free) {
        const id = Util.escapeHTML(p.id);
        const look = p.look || Avatar.look(p.uid, p.role);
        const seatInfo = p.seat !== null && p.seat !== undefined ? Seating.info(p.seat) : null;
        const roomObj = CampusWorld.roomObj(p.room);
        const lib = Boolean(roomObj && roomObj.type === 'library');
        const section = lib ? CampusWorld.sectionAtPoint(p.x, p.y) : null;
        const confirming = this.pendingRemove === p.id;
        const permitted = share.permit === p.id, sharing = share.sharerId === p.id;
        let status;
        if (p.off) status = '<span class="tag warn">Reconnecting…</span>';
        else if (lib) status = section ? `At <b>${Util.escapeHTML(section.code)}</b> notes` : `Browsing · since ${new Date(p.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        else if (seatInfo) status = `Seated · <b>${seatInfo.label}</b>`;
        else status = free === 0 ? 'Standing · <b class="wait">waiting for a seat</b>' : `Standing · since ${new Date(p.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const flags = lib ? (p.hand ? `<span class="flag hand" title="Needs help">${Icons.svg('hand', 14)}</span>` : '') :
            (p.hand ? `<span class="flag hand" title="Hand raised">${Icons.svg('hand', 14)}</span>` : '') +
            (sharing ? `<span class="flag share" title="Sharing screen">${Icons.svg('screen', 14)}</span>` : permitted ? `<span class="flag allowed" title="Allowed to share">${Icons.svg('check', 14)}</span>` : '') +
            (p.muted ? `<span class="flag muted" title="Muted by you">${Icons.svg('micOff', 14)}</span>` : p.mic ? `<span class="flag mic" title="Microphone on">${Icons.svg('mic', 14)}</span>` : '');
        const btn = (act, icon, title, extra) => `<button type="button" class="icon-btn ${extra || ''}" data-act="${act}" data-id="${id}" title="${title}" aria-label="${title}">${Icons.svg(icon, 15)}</button>`;
        let actions = lib ? '' : btn(p.muted ? 'unmute' : 'mute', p.muted ? 'volume' : 'micOff', p.muted ? 'Unmute' : 'Mute');
        if (p.hand) actions += btn('lower', 'hand', lib ? 'Help given' : 'Lower hand', 'accent');
        if (seatInfo && !lib) actions += sharing || permitted ? btn('revoke', 'screenOff', sharing ? 'Stop sharing' : 'Take back permission', 'warn') : (share.sharerId ? '' : btn('grant', 'screen', 'Allow screen sharing'));
        actions += `<button type="button" class="icon-btn danger ${confirming ? 'confirm' : ''}" data-act="remove" data-id="${id}" title="Remove from class">${confirming ? 'Sure?' : Icons.svg('x', 15)}</button>`;
        return `<li class="st-row ${p.hand ? 'has-hand' : ''} ${this.selected === p.id ? 'selected' : ''}" data-row="${id}" data-pid="${id}">
            <span class="st-avatar" style="background:${look.top}">${Util.escapeHTML(Util.shortName(p.name))}<i class="speak-dot"></i></span>
            <div class="st-main"><strong>${Util.escapeHTML(p.name)}</strong><small>${status}</small></div>
            <div class="st-flags">${flags}</div>
            <div class="st-actions">${actions}</div>
        </li>`;
    },

    renderPanel(code, share) {
        const students = CampusWorld.rosterFor(code).filter(p => p.role === 'student');
        const seated = students.filter(p => p.seat !== null).sort((a, b) => a.seat - b.seat);
        const standing = students.filter(p => p.seat === null).sort((a, b) => a.since - b.since);
        const hands = seated.filter(p => p.hand).sort((a, b) => a.hand - b.hand);
        const roomObj = CampusWorld.roomObj(code);
        const free = roomObj.seatCount - students.filter(p => p.seat !== null).length;
        const subject = MeetingSubjects.find(s => s.code === code);
        const requests = (share.requests || []).map(id => CampusWorld.playerById(id)).filter(Boolean);
        const permitted = share.permit ? CampusWorld.playerById(share.permit) : null;

        const stat = (n, label, cls) => `<div class="stat ${cls || ''}"><b>${n}</b><span>${label}</span></div>`;
        const tabBtn = (id, label, badge) => `<button type="button" class="tab ${this.tab === id ? 'active' : ''}" data-act="tab" data-id="${id}" role="tab">${label}${badge ? `<i class="badge">${badge}</i>` : ''}</button>`;
        const section = (title, cls, list, extra) => list.length ? `<h4 class="sec ${cls}">${title} <span>${list.length}</span>${extra || ''}</h4><ul class="st-list">${list.map(p => this.studentRow(p, cls, share, free)).join('')}</ul>` : '';

        let body = '';
        if (this.tab === 'students') {
            body = students.length
                ? section(`${Icons.svg('hand', 14)} Hands raised`, 'hands', hands) +
                  section(`${Icons.svg('chair', 14)} Seated`, 'seated', seated.filter(p => !p.hand)) +
                  section(`${Icons.svg('walk', 14)} Standing`, 'standing', standing, free === 0 ? '<em class="wait-chip">all seats full · waiting</em>' : '')
                : `<div class="empty">${Icons.svg('users', 30)}<strong>No students yet</strong><span>They appear here as soon as they walk into your classroom.</span></div>`;
        } else if (this.tab === 'seats') {
            body = this.seatMap(roomObj, students, standing, free);
        } else {
            body = this.screenTab(share, requests, permitted, seated);
        }

        const html = `
            <header class="cp-head">
                <div><h3>${Util.escapeHTML(subject ? subject.name : code)}</h3><small>${Util.escapeHTML(code)} · live dashboard</small></div>
                <div class="cp-bulk"><button type="button" class="btn-mini" data-act="mute-all">${Icons.svg('micOff', 13)} Mute all</button><button type="button" class="btn-mini" data-act="unmute-all">${Icons.svg('volume', 13)} Unmute all</button></div>
            </header>
            <div class="stats">
                ${stat(students.length, 'Present')}${stat(seated.length, 'Seated', 'ok')}${stat(standing.length, 'Standing', standing.length && !free ? 'warn' : '')}${stat(hands.length, 'Hands', hands.length ? 'hand' : '')}${stat(free, 'Free')}
            </div>
            <nav class="tabs" role="tablist">${tabBtn('students', 'Students', hands.length)}${tabBtn('seats', 'Seat map')}${tabBtn('screen', 'Screen', requests.length)}</nav>
            <div class="tab-body">${body}</div>`;
        if (html !== this.lastHTML) {
            const scroller = this.panel.querySelector('.tab-body');
            const top = scroller ? scroller.scrollTop : 0;
            this.panel.innerHTML = html;
            this.lastHTML = html;
            const sc = this.panel.querySelector('.tab-body');
            if (sc) sc.scrollTop = top;
        }
    },

    // rows of seat chips for one classroom (4 rows)
    seatGrid(room, byseat) {
        const cell = idx => {
            const p = byseat[idx], info = Seating.info(idx);
            if (!p) return `<span class="sm-seat free" title="${info.label} · free">${info.letter}</span>`;
            return `<button type="button" class="sm-seat taken ${p.hand ? 'hand' : ''}" data-act="select" data-id="${Util.escapeHTML(p.id)}" data-pid="${Util.escapeHTML(p.id)}" title="${info.label} · ${Util.escapeHTML(p.name)}"><b>${Util.escapeHTML(Util.shortName(p.name))}</b>${p.hand ? '<i>✋</i>' : ''}</button>`;
        };
        let rows = '';
        for (let r = 0; r < room.rows; r++) {
            const base = r * 6;
            rows += `<div class="sm-row"><span class="sm-bench">${cell(base)}${cell(base + 1)}${cell(base + 2)}</span><span class="sm-aisle"></span><span class="sm-bench">${cell(base + 3)}${cell(base + 4)}${cell(base + 5)}</span></div>
                     <div class="sm-benchlabels"><span>Bench ${r * 2 + 1}</span><span>Bench ${r * 2 + 2}</span></div>`;
        }
        return rows;
    },

    seatMap(room, students, standing, free) {
        const byseat = {};
        students.forEach(p => { if (p.seat !== null) byseat[p.seat] = p; });
        const waiting = standing.length
            ? `<h4 class="sec standing">${Icons.svg('walk', 14)} ${free === 0 ? 'Waiting for a seat' : 'Standing, not seated yet'} <span>${standing.length}</span></h4>
               <div class="chips">${standing.map((p, i) => `<span class="chip" data-pid="${Util.escapeHTML(p.id)}">${free === 0 ? `<em>${i + 1}</em>` : ''}${Util.escapeHTML(p.name)}</span>`).join('')}</div>`
            : '';
        return `<div class="seatmap"><div class="sm-board">${Icons.svg('board', 14)} Board · teacher</div>${this.seatGrid(room, byseat)}<div class="sm-door">Door</div></div>
            <div class="legend"><span><i class="lg free"></i>Free</span><span><i class="lg taken"></i>Occupied</span><span><i class="lg hand"></i>Hand raised</span></div>${waiting}`;
    },

    // ------------------------------------------------------------ library: notes for everyone, readers for the librarian
    notesVisible() { return Boolean(this.el && this.el.classList.contains('visible') && !this.panel.hidden && this.panel.querySelector('.notes-list')); },

    // a student walks into the library: the notes panel slides in on the right
    openNotesOnEntry() { this.notesHidden = false; this.lastHTML = ''; this.update(); },

    // the Notes button, or E at a subject section: show the panel (and that subject's card)
    showNotes(code) {
        this.notesHidden = false;
        if (State.user.role === 'librarian') this.tab = 'notes';
        this.lastHTML = '';
        this.update();
        CampusWorld.updateRoomBar();
        if (!code) return;
        const card = this.panel.querySelector(`[data-subject="${CSS.escape(code)}"]`);
        if (!card) return;
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    },

    notesList() {
        const e = Util.escapeHTML;
        const sections = (CampusWorld.layout && CampusWorld.layout.library) ? CampusWorld.layout.library.sections : [];
        return `<ul class="notes-list">${MeetingSubjects.map(subj => {
            const files = LibraryNotes[subj.code] || [];
            const sec = sections.find(x => x.code === subj.code);
            const rows = files.length ? files.map(f => `
                <div class="note-file">
                    <span class="pdf-ic">PDF</span>
                    <span class="nf-title">${e(f.title)}</span>
                    <a class="btn-mini" href="${e(f.file)}" target="_blank" rel="noopener" title="Open in a new tab">${Icons.svg('eye', 13)} Open</a>
                    <a class="btn-mini primary" href="${e(f.file)}" download="${e(subj.code + ' - ' + f.title + '.pdf')}" title="Download the PDF">${Icons.svg('download', 13)} Download</a>
                </div>`).join('') : '<div class="note-file empty-file">No notes uploaded yet.</div>';
            return `<li class="note-card" data-subject="${e(subj.code)}" style="--c:${sec ? sec.color : '#6366F1'}">
                <div class="note-head"><span class="note-code">${e(subj.code)}</span><strong>${e(subj.name)}</strong></div>
                ${rows}
            </li>`;
        }).join('')}</ul>`;
    },

    renderLibraryPanel() {
        const librarian = State.user.role === 'librarian';
        const files = Object.values(LibraryNotes).reduce((n, list) => n + list.length, 0);
        let html;
        if (!librarian) {
            html = `
            <header class="cp-head">
                <div><h3>${Icons.svg('book', 16)} Library · subject notes</h3><small>${MeetingSubjects.length} subjects · ${files} PDF${files === 1 ? '' : 's'} · open or download any of them</small></div>
                <button type="button" class="icon-btn" data-act="notes-hide" title="Hide the notes (the Notes button brings them back)" aria-label="Hide the notes">${Icons.svg('x', 15)}</button>
            </header>
            <div class="tab-body">${this.notesList()}</div>`;
        } else {
            if (this.tab !== 'students' && this.tab !== 'notes') this.tab = 'students';
            const all = CampusWorld.rosterFor(Library.code).filter(p => p.role === 'student');
            const hands = all.filter(p => p.hand).sort((a, b) => a.hand - b.hand);
            const browsing = all.filter(p => !p.hand).sort((a, b) => a.since - b.since);
            const stat = (n, label, cls) => `<div class="stat ${cls || ''}"><b>${n}</b><span>${label}</span></div>`;
            const tabBtn = (id, label, badge) => `<button type="button" class="tab ${this.tab === id ? 'active' : ''}" data-act="tab" data-id="${id}" role="tab">${label}${badge ? `<i class="badge">${badge}</i>` : ''}</button>`;
            const section = (title, cls, list) => list.length ? `<h4 class="sec ${cls}">${title} <span>${list.length}</span></h4><ul class="st-list">${list.map(p => this.studentRow(p, cls, {}, 1)).join('')}</ul>` : '';
            const body = this.tab === 'notes' ? this.notesList()
                : all.length
                    ? section(`${Icons.svg('hand', 14)} Need help`, 'hands', hands) + section(`${Icons.svg('book', 14)} In the library`, 'standing', browsing)
                    : `<div class="empty">${Icons.svg('book', 30)}<strong>The library is empty</strong><span>Students appear here as soon as they walk in.</span></div>`;
            html = `
            <header class="cp-head">
                <div><h3>Library</h3><small>${MeetingSubjects.length} subject sections · quiet zone</small></div>
            </header>
            <div class="stats four">${stat(all.length, 'Inside')}${stat(hands.length, 'Help', hands.length ? 'hand' : '')}${stat(MeetingSubjects.length, 'Subjects')}${stat(files, 'PDFs')}</div>
            <nav class="tabs" role="tablist">${tabBtn('students', 'Students', hands.length)}${tabBtn('notes', 'Notes')}</nav>
            <div class="tab-body">${body}</div>`;
        }
        if (html !== this.lastHTML) {
            const sc0 = this.panel.querySelector('.tab-body'), top = sc0 ? sc0.scrollTop : 0;
            this.panel.innerHTML = html; this.lastHTML = html;
            const sc = this.panel.querySelector('.tab-body'); if (sc) sc.scrollTop = top;
        }
    },

    screenTab(share, requests, permitted, seated) {
        const sharer = share.sharerId ? share.sharer : null;
        const mine = share.sharerId === Net.myId;
        const row = (p, actions) => `<li class="st-row" data-pid="${Util.escapeHTML(p.id)}"><span class="st-avatar" style="background:${(p.look || Avatar.look(p.uid, p.role)).top}">${Util.escapeHTML(Util.shortName(p.name))}<i class="speak-dot"></i></span><div class="st-main"><strong>${Util.escapeHTML(p.name)}</strong><small>${p.seat !== null && p.seat !== undefined ? Seating.label(p.seat) : 'Standing'}</small></div><div class="st-actions">${actions}</div></li>`;
        const b = (act, id, label, cls) => `<button type="button" class="btn-mini ${cls || ''}" data-act="${act}" data-id="${Util.escapeHTML(id)}">${label}</button>`;

        const status = sharer || mine
            ? `<div class="share-status on"><span class="live-pill"><i></i>LIVE</span><div><strong>${mine ? 'You are presenting' : Util.escapeHTML(sharer.name) + ' is sharing'}</strong><small>Everyone in the room can watch</small></div>${mine ? '' : b('revoke', '', 'Stop sharing', 'danger')}</div>`
            : permitted
                ? `<div class="share-status wait">${Icons.svg('clock', 18)}<div><strong>${Util.escapeHTML(permitted.name)} is allowed to share</strong><small>Waiting for them to press Start sharing</small></div>${b('revoke', '', 'Take back', 'warn')}</div>`
                : `<div class="share-status">${Icons.svg('screenOff', 18)}<div><strong>Nobody is sharing</strong><small>Students can only share after you allow it</small></div></div>`;

        const reqList = requests.length
            ? `<h4 class="sec">${Icons.svg('bell', 14)} Requests <span>${requests.length}</span></h4><ul class="st-list">${requests.map(p => row(p, share.sharerId ? '<small class="muted">busy</small>' : b('grant', p.id, 'Allow', 'primary') + b('deny', p.id, 'Deny'))).join('')}</ul>`
            : '';
        const allow = seated.filter(p => !requests.includes(p) && p.id !== share.permit && p.id !== share.sharerId);
        const allowList = allow.length && !share.sharerId
            ? `<h4 class="sec">${Icons.svg('check', 14)} Allow a seated student <span>${allow.length}</span></h4><ul class="st-list">${allow.map(p => row(p, b('grant', p.id, 'Allow'))).join('')}</ul>`
            : '';
        return status + reqList + allowList +
            `<p class="rule-note">${Icons.svg('shield', 14)} One student can share at a time. Everyone else can only watch; the picture has no download or capture controls.</p>`;
    },

    // direct DOM update: avoids re-rendering the panel (and swallowing clicks) every time somebody speaks
    updateSpeaking() {
        const players = CampusWorld.remote;
        Util.$$('[data-pid]', this.el).forEach(n => {
            const p = players[n.dataset.pid];
            n.classList.toggle('speaking', Boolean(p && p.sp));
        });
    }
};
