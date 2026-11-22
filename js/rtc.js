// Voice and screen sharing with WebRTC.
//
// Model: whoever speaks / shares is the PUBLISHER and opens one one-way connection to each listener
// (kind "mic" or kind "screen"). The server relays the signalling only when the classroom rules allow
// that connection (see canStream in src/classroom/engine.js), so a standing student's audio or an
// unauthorised screen can never be negotiated.
const RTC = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    local: { mic: null, screen: null },   // MediaStreams I publish
    pubs: new Map(),                      // "peer|kind" -> { pc, sid, peerId, kind, failures }
    subs: new Map(),                      // "peer|kind" -> { pc, sid, peerId, kind, stream, el, pending }
    retryAt: new Map(),
    volume: 1,
    deafened: false,
    timer: null,
    audioBox: null,

    async init() {
        this.closeAll();
        try {
            const r = await Api.get('/api/rtc-config', State.token);
            if (r.ok && Array.isArray(r.data.iceServers) && r.data.iceServers.length) this.iceServers = r.data.iceServers;
        } catch (e) { /* default STUN servers */ }
        if (!this.audioBox) {
            this.audioBox = document.createElement('div');
            this.audioBox.id = 'rtc-audio';
            this.audioBox.style.display = 'none';
            document.body.appendChild(this.audioBox);
        }
        clearInterval(this.timer);
        this.timer = setInterval(() => this.sync(), 2000); // safety net: reconcile connections regularly
    },

    key: (peer, kind) => peer + '|' + kind,
    newId: () => Math.random().toString(36).slice(2) + Date.now().toString(36),
    send(to, kind, role, data) { Net.emit('rtc:signal', { to, kind, role, data }); },

    // ----- who should receive what (mirrors the server rules) -----
    targets(kind) {
        const me = CampusWorld.meServer;
        if (!me || !me.room) return [];
        const others = Object.values(CampusWorld.remote).filter(p => p.room === me.room && !p.off);
        if (kind === 'mic') return me.role === 'faculty' ? others : others.filter(p => p.role === 'faculty' || p.seat !== null);
        return others; // screen: everybody in the room may watch
    },

    setLocal(kind, stream) {
        this.local[kind] = stream || null;
        if (!stream) this.closePubs(kind);
        this.sync();
    },

    // open missing connections, close the ones that are no longer wanted
    sync() {
        ['mic', 'screen'].forEach(kind => {
            const stream = this.local[kind];
            if (!stream) return;
            const want = new Set(this.targets(kind).map(p => p.id));
            want.forEach(id => {
                const k = this.key(id, kind);
                if (this.pubs.has(k)) return;
                if ((this.retryAt.get(k) || 0) > Date.now()) return;
                this.publishTo(id, kind);
            });
            for (const [k, e] of this.pubs) if (e.kind === kind && !want.has(e.peerId)) this.closePub(k, true);
        });
        // listeners from people who are no longer allowed to talk to me
        for (const [k, s] of this.subs) {
            const peer = CampusWorld.remote[s.peerId];
            const me = CampusWorld.meServer;
            const old = Date.now() - s.born > 3000; // the world snapshot can lag a moment behind the offer
            if (!peer || !me || peer.room !== me.room || (old && ((s.kind === 'mic' && !peer.mic) || (s.kind === 'screen' && !CampusWorld.isSharer(peer.id))))) this.closeSub(k);
        }
    },

    async publishTo(peerId, kind) {
        const stream = this.local[kind];
        const k = this.key(peerId, kind);
        if (!stream || this.pubs.has(k)) return;
        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        const entry = { pc, sid: this.newId(), peerId, kind, failures: 0, timer: null };
        this.pubs.set(k, entry);

        const viewers = Math.max(1, this.targets(kind).length);
        stream.getTracks().forEach(track => {
            if (kind === 'mic') track.contentHint = 'speech';
            else if (track.kind === 'audio') track.contentHint = 'music'; // shared tab / system sound: keep it full-range
            const sender = pc.addTrack(track, stream);
            try {
                const p = sender.getParameters();
                if (!p.encodings || !p.encodings.length) p.encodings = [{}];
                if (kind === 'mic') p.encodings[0].maxBitrate = 48000;
                else if (track.kind === 'audio') p.encodings[0].maxBitrate = 128000;
                else if (track.kind === 'video') p.encodings[0].maxBitrate = Math.round(Util.clamp(12000000 / viewers, 500000, 2500000));
                sender.setParameters(p).catch(() => {});
            } catch (e) { /* optional tuning */ }
        });

        pc.onicecandidate = ev => { if (ev.candidate) this.send(peerId, kind, 'pub', { sid: entry.sid, candidate: ev.candidate }); };
        pc.onconnectionstatechange = () => {
            if (this.pubs.get(k) !== entry) return;
            clearTimeout(entry.timer);
            if (pc.connectionState === 'failed') this.recover(k);
            else if (pc.connectionState === 'disconnected') entry.timer = setTimeout(() => { if (pc.connectionState !== 'connected') this.recover(k); }, 4000);
        };
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.send(peerId, kind, 'pub', { sid: entry.sid, sdp: pc.localDescription });
        } catch (err) { this.closePub(k, false); }
    },

    // connection broke: drop it and let sync() build a fresh one (with a short back-off)
    recover(k) {
        const e = this.pubs.get(k);
        if (!e) return;
        const n = (this.retryAt.get(k + '#n') || 0) + 1;
        this.retryAt.set(k + '#n', n);
        this.closePub(k, true);
        this.retryAt.set(k, Date.now() + Math.min(8000, 700 * n));
        if (n === 4 && e.kind === 'mic') Toast.show('Audio connection problem', 'Some listeners cannot be reached. A TURN server may be needed on this network.', { type: 'warn' });
        setTimeout(() => this.sync(), 800 * n);
    },

    closePub(k, notify) {
        const e = this.pubs.get(k);
        if (!e) return;
        clearTimeout(e.timer);
        this.pubs.delete(k);
        try { e.pc.close(); } catch (err) { /* already closed */ }
        if (notify) Net.emit('rtc:close', { to: e.peerId, kind: e.kind, role: 'pub' });
    },
    closePubs(kind) { for (const [k, e] of [...this.pubs]) if (e.kind === kind) this.closePub(k, true); },

    // ----- incoming signalling -----
    async onSignal({ from, kind, role, data }) {
        if (!data) return;
        if (role === 'pub') await this.onPublisherMessage(from, kind, data);
        else await this.onSubscriberMessage(from, kind, data);
    },

    async onPublisherMessage(from, kind, d) { // I am the listener
        const k = this.key(from, kind);
        let s = this.subs.get(k);
        if (d.sdp) {
            if (s) this.closeSub(k);
            const pc = new RTCPeerConnection({ iceServers: this.iceServers });
            s = { pc, sid: d.sid, peerId: from, kind, stream: null, el: null, pending: [], born: Date.now() };
            this.subs.set(k, s);
            pc.onicecandidate = ev => { if (ev.candidate) this.send(from, kind, 'sub', { sid: s.sid, candidate: ev.candidate }); };
            pc.ontrack = ev => this.attach(s, ev.streams[0] || new MediaStream([ev.track]));
            pc.onconnectionstatechange = () => { if (pc.connectionState === 'closed' || pc.connectionState === 'failed') { if (this.subs.get(k) === s) this.closeSub(k); } };
            try {
                await pc.setRemoteDescription(d.sdp);
                for (const c of s.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.send(from, kind, 'sub', { sid: s.sid, sdp: pc.localDescription });
            } catch (err) { this.closeSub(k); }
        } else if (d.candidate && s && s.sid === d.sid) {
            if (s.pc.remoteDescription) await s.pc.addIceCandidate(d.candidate).catch(() => {});
            else s.pending.push(d.candidate);
        }
    },

    async onSubscriberMessage(from, kind, d) { // I am the publisher
        const e = this.pubs.get(this.key(from, kind));
        if (!e || e.sid !== d.sid) return;
        try {
            if (d.sdp) { await e.pc.setRemoteDescription(d.sdp); this.retryAt.delete(this.key(from, kind) + '#n'); }
            else if (d.candidate) await e.pc.addIceCandidate(d.candidate);
        } catch (err) { /* stale message */ }
    },

    onClose({ from, kind, role }) {
        if (role === 'pub') this.closeSub(this.key(from, kind));
        else this.closePub(this.key(from, kind), false);
    },

    // ----- playing what arrives -----
    attach(s, stream) {
        s.stream = stream;
        if (s.kind === 'mic') {
            if (!s.el) {
                s.el = document.createElement('audio');
                s.el.autoplay = true;
                s.el.setAttribute('playsinline', '');
                this.audioBox.appendChild(s.el);
            }
            s.el.srcObject = stream;
            s.el.volume = this.volume;
            s.el.muted = this.deafened;
            const play = s.el.play();
            if (play && play.catch) play.catch(() => this.needsGesture());
        } else {
            Dock.attachScreen(s.peerId, stream);
        }
    },

    needsGesture() {
        if (this._gestureShown) return;
        this._gestureShown = true;
        const t = Toast.show('Click anywhere to hear the class', 'Your browser blocked audio until you interact with the page.', { type: 'warn', duration: 9000 });
        const resume = () => { Util.$$('audio', this.audioBox).forEach(a => a.play().catch(() => {})); this._gestureShown = false; document.removeEventListener('pointerdown', resume); Toast.dismiss(t); };
        document.addEventListener('pointerdown', resume, { once: true });
    },

    closeSub(k) {
        const s = this.subs.get(k);
        if (!s) return;
        this.subs.delete(k);
        try { s.pc.close(); } catch (e) { /* closed */ }
        if (s.el) { s.el.srcObject = null; s.el.remove(); }
        if (s.kind === 'screen') Dock.detachScreen(s.peerId);
    },

    setVolume(v) {
        this.volume = Util.clamp(v, 0, 1);
        Util.$$('audio', this.audioBox).forEach(a => { a.volume = this.volume; });
        if (typeof Dock !== 'undefined') Dock.applyVolume();
    },
    setDeafened(on) {
        this.deafened = on;
        Util.$$('audio', this.audioBox).forEach(a => { a.muted = on; });
        if (typeof Dock !== 'undefined') Dock.applyVolume();
    },

    closeAll() {
        for (const k of [...this.pubs.keys()]) this.closePub(k, true);
        for (const k of [...this.subs.keys()]) this.closeSub(k);
        this.retryAt.clear();
        this.local = { mic: null, screen: null };
        clearInterval(this.timer);
    }
};
