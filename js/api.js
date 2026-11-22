// Thin wrapper around fetch for the REST API (login, password management, ...)
const Api = {
    // Resolves to { ok, status, data }. Never throws for HTTP errors; network failures give { ok:false, network:true }.
    async request(method, path, body, token) {
        try {
            const res = await fetch(API_BASE + path, {
                method,
                headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) },
                body: body ? JSON.stringify(body) : undefined
            });
            let data = {};
            try { data = await res.json(); } catch (e) { /* empty body */ }
            return { ok: res.ok, status: res.status, data };
        } catch (err) {
            return { ok: false, status: 0, network: true, data: { error: "Cannot reach the server. Is 'npm start' running?" } };
        }
    },
    post(path, body, token) { return this.request('POST', path, body, token); },
    get(path, token) { return this.request('GET', path, null, token); }
};
