// Small shared helpers
const Util = {
    escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    lerp: (a, b, t) => a + (b - a) * t,
    ease: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    // stable number from a string (used to give every person their own look)
    hash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    },
    // "2510011214" -> "1214", "Dr. Sharma" -> "DS"
    shortName(name) {
        const s = String(name || '');
        if (/^\d+$/.test(s)) return s.slice(-4);
        const parts = s.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
        return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : s.slice(0, 2)).toUpperCase();
    },
    duration(ms) {
        const s = Math.max(0, Math.floor(ms / 1000));
        if (s < 60) return s + 's';
        const m = Math.floor(s / 60);
        return m < 60 ? m + 'm ' + (s % 60) + 's' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    },
    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
};
