// Realtime connection (Socket.IO). Carries positions, seating, hands, mic / screen permissions
// and the WebRTC signalling for voice and screen sharing.
const Net = {
    socket: null,
    myId: null,
    handlers: {},
    connected: false,

    loadClient() {
        if (window.io) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = API_BASE + '/socket.io/socket.io.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Could not load the realtime client from the server.'));
            document.head.appendChild(s);
        });
    },

    async connect(handlers) {
        this.disconnect();
        this.handlers = handlers || {};
        await this.loadClient();
        const socket = io(API_BASE || undefined, {
            auth: cb => cb({ token: State.token }),
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 500,
            reconnectionDelayMax: 3000
        });
        this.socket = socket;
        const h = (name, fn) => socket.on(name, (...a) => { if (this.socket === socket && this.handlers[fn || name]) this.handlers[fn || name](...a); });

        socket.on('connect', () => { this.connected = true; if (this.handlers.connect) this.handlers.connect(); });
        socket.on('disconnect', () => { this.connected = false; if (this.handlers.disconnect) this.handlers.disconnect(); });
        socket.on('connect_error', err => { if (this.handlers.error) this.handlers.error(err); });
        socket.on('hello', d => { this.myId = d.id; if (this.handlers.hello) this.handlers.hello(d); });
        ['world', 'bans', 'notify', 'removed', 'session:ended', 'mic:forced', 'screen:granted', 'screen:denied', 'screen:revoked', 'rtc:signal', 'rtc:close']
            .forEach(n => h(n));
    },

    disconnect() {
        if (this.socket) { this.socket.removeAllListeners(); this.socket.disconnect(); }
        this.socket = null; this.connected = false; this.myId = null;
    },

    // emit with an answer from the server; resolves { ok:false, error } instead of throwing
    request(event, data, timeout) {
        return new Promise(resolve => {
            if (!this.socket || !this.connected) return resolve({ ok: false, error: 'Connection lost. Reconnecting…' });
            const timer = setTimeout(() => resolve({ ok: false, error: 'The server did not answer. Try again.' }), timeout || 5000);
            this.socket.emit(event, data || {}, res => { clearTimeout(timer); resolve(res || { ok: false }); });
        });
    },

    sendPresence(d) { if (this.socket && this.connected) this.socket.volatile.emit('presence', d); },
    emit(event, data) { if (this.socket && this.connected) this.socket.emit(event, data); }
};
