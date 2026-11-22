// Stacked toast notifications (work on every screen, including the login page)
const Toast = {
    box: null,
    ICONS: { info: 'info', success: 'check', warn: 'alert', error: 'alert', hand: 'hand', mic: 'mic', screen: 'screen' },

    show(title, message, opts) {
        opts = opts || {};
        const type = opts.type || 'info';
        if (!this.box) {
            this.box = document.createElement('div');
            this.box.id = 'toasts';
            this.box.setAttribute('role', 'status');
            this.box.setAttribute('aria-live', 'polite');
            document.body.appendChild(this.box);
        }
        // the same message twice in a row only refreshes the first one
        const key = type + '|' + title + '|' + (message || '');
        const dup = Array.from(this.box.children).find(c => c.dataset.key === key);
        if (dup) { clearTimeout(dup._t); dup._t = setTimeout(() => this.dismiss(dup), opts.duration || 4200); return dup; }

        const el = document.createElement('div');
        el.className = 'toast ' + type;
        el.dataset.key = key;
        el.innerHTML = `<span class="toast-ic">${Icons.svg(opts.icon || this.ICONS[type] || 'info', 18)}</span>
            <div class="toast-body"><strong>${Util.escapeHTML(title)}</strong>${message ? `<span>${Util.escapeHTML(message)}</span>` : ''}</div>`;
        el.addEventListener('click', () => { if (opts.onClick) opts.onClick(); this.dismiss(el); });
        this.box.appendChild(el);
        while (this.box.children.length > 4) this.dismiss(this.box.firstElementChild);
        requestAnimationFrame(() => el.classList.add('in'));
        el._t = setTimeout(() => this.dismiss(el), opts.duration || 4200);
        return el;
    },

    dismiss(el) {
        if (!el || !el.parentNode) return;
        clearTimeout(el._t);
        el.classList.remove('in');
        el.classList.add('out');
        setTimeout(() => el.remove(), 250);
    }
};
