// Account dialogs: change password, controls help
const Account = {
    open: false,

    show(html, onMount) {
        const backdrop = document.getElementById('app-modal');
        const box = document.getElementById('app-modal-box');
        box.innerHTML = html;
        backdrop.classList.add('open');
        this.open = true;
        CampusWorld.setModal(true);
        backdrop.onpointerdown = e => { if (e.target === backdrop) this.close(); };
        box.querySelector('[data-close]')?.addEventListener('click', () => this.close());
        if (onMount) onMount(box);
    },

    close() {
        if (!this.open) return;
        this.open = false;
        const backdrop = document.getElementById('app-modal');
        if (backdrop) backdrop.classList.remove('open');
        CampusWorld.setModal(false);
    },

    showHelp() {
        const k = t => `<kbd>${t}</kbd>`;
        const student = State.user.role === 'student';
        this.show(`
            <header><h3>${Icons.svg('help', 20)} Controls</h3><button class="close-modal-btn" data-close aria-label="Close">${Icons.svg('x', 18)}</button></header>
            <div class="help-body">
                <div class="help-row"><span>${k('W')}${k('A')}${k('S')}${k('D')} or arrows</span><p>Walk around the campus${student ? '. Walk through a door to enter a classroom.' : '.'}</p></div>
                ${student ? `
                <div class="help-row"><span>Enter a room</span><p>Your avatar walks to the seating area by itself. Press any move key to take over.</p></div>
                <div class="help-row"><span>${k('S')}</span><p>Sit on the bench you are standing next to (use ${k('↓')} to walk down near benches).</p></div>
                <div class="help-row"><span>${k('Ctrl')}</span><p>Stand up again.</p></div>
                <div class="help-row"><span>${k('H')}</span><p>Raise or lower your hand (seated only).</p></div>
                <div class="help-row"><span>Mic · Screen</span><p>Available only while you are seated. Screen sharing also needs your teacher's permission, and only one student can share at a time.</p></div>
                <div class="help-row"><span>Library</span><p>At the left end of the hall. The notes of every subject open on the right as you walk in: Open or Download any PDF. Stand at a subject section and press ${k('E')} to jump to its notes, ${k('H')} to ask the librarian. Quiet zone (no mic or screen sharing).</p></div>` : `
                <div class="help-row"><span>Dashboard</span><p>The panel on the right shows who is seated where, who is standing or waiting, and raised hands.</p></div>
                <div class="help-row"><span>Screen sharing</span><p>Students can share only after you allow it (Screen tab or the monitor icon on their row).</p></div>`}
                <div class="help-row"><span>${k('M')}</span><p>Mute / unmute the walking sound.</p></div>
                <div class="help-row"><span>${k('+')}${k('−')}${k('0')} or wheel</span><p>Zoom the camera.</p></div>
                <div class="help-row"><span>${k('E')}</span><p>Read the notice board when you stand next to it.</p></div>
            </div>`);
    },

    showChangePassword() {
        this.show(`
            <header><h3>${Icons.svg('key', 20)} Change password</h3><button class="close-modal-btn" data-close aria-label="Close">${Icons.svg('x', 18)}</button></header>
            <form id="cp-form" class="modal-form" novalidate>
                ${Login.pwField('cp-current', 'Current password', 'current-password')}
                ${Login.pwField('cp-new', 'New password', 'new-password')}
                ${Login.strengthBlock()}
                ${Login.pwField('cp-confirm', 'Confirm new password', 'new-password')}
                <div class="auth-feedback" id="cp-feedback" role="alert"></div>
                <div class="modal-actions">
                    <button type="button" class="btn-ghost" data-close>Cancel</button>
                    <button type="submit" class="submit-btn" id="cp-submit"><span class="btn-label">Update password</span><i class="spinner"></i></button>
                </div>
            </form>`, box => {
            const $ = id => document.getElementById(id);
            const fb = $('cp-feedback');
            const setFb = t => { fb.textContent = t || ''; fb.className = 'auth-feedback' + (t ? ' error' : ''); };
            box.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.close()));
            box.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', () => {
                const input = $(btn.dataset.toggle), show = input.type === 'password';
                input.type = show ? 'text' : 'password';
                btn.innerHTML = Icons.svg(show ? 'eyeOff' : 'eye', 18);
            }));
            const pwd = $('cp-new');
            const update = () => {
                const v = pwd.value, rules = { len: v.length >= 8, letter: /[A-Za-z]/.test(v), num: /\d/.test(v) };
                box.querySelectorAll('#pw-rules li').forEach(li => li.classList.toggle('ok', rules[li.dataset.rule]));
                let score = Object.values(rules).filter(Boolean).length;
                if (v.length >= 12 && /[^A-Za-z0-9]/.test(v) && score === 3) score = 4;
                if (!v) score = 0;
                box.querySelectorAll('#pw-meter i').forEach((bar, i) => bar.classList.toggle('on', i < score));
                $('pw-meter').dataset.score = String(score);
            };
            pwd.addEventListener('input', update);
            box.querySelectorAll('input').forEach(i => i.addEventListener('input', () => setFb('')));
            $('cp-current').focus();
            $('cp-form').addEventListener('submit', async e => {
                e.preventDefault();
                const cur = $('cp-current').value, nw = pwd.value, conf = $('cp-confirm').value;
                if (!cur) return setFb('Enter your current password.');
                if (!nw) return setFb('Choose a new password.');
                if (nw !== conf) return setFb('The two new passwords do not match.');
                const btn = $('cp-submit');
                btn.disabled = true; btn.classList.add('loading');
                const r = await Api.post('/api/auth/change-password', { currentPassword: cur, newPassword: nw, confirmPassword: conf }, State.token);
                btn.disabled = false; btn.classList.remove('loading');
                if (!r.ok) {
                    if (r.status === 401 && r.data.code === 'UNAUTHORIZED') { this.close(); CampusWorld.sessionEnded('expired'); return; }
                    return setFb(r.data.error || 'Could not change the password.');
                }
                if (r.data.token) State.setToken(r.data.token); // the old token no longer works
                this.close();
                Toast.show('Password changed', 'Your other sessions were signed out.', { type: 'success' });
            });
        });
    }
};
