// Login / first-time password setup / forgot + reset password.
// One screen with four modes that share the same card, so switching feels instant.
const Login = {
    mode: 'login',      // login | signup | forgot
    role: 'student',
    notice: null,       // { type, text } shown above the form (e.g. "Password saved")
    prefillId: '',
    codeSent: false,    // forgot mode: step 2 (enter the code) is showing

    show(mode, notice) {
        this.mode = mode || 'login';
        this.notice = notice || null;
        if (mode !== 'forgot') this.codeSent = false;
        if (State.appState === 'LOGIN' && Navigation.activeView === this) { Navigation.render(); } else Navigation.navigate('LOGIN');
    },

    idLabel() { return this.role === 'faculty' ? 'Faculty ID' : this.role === 'librarian' ? 'Librarian ID' : 'Student ID'; },
    idHint() { return this.role === 'faculty' ? 'Your special Faculty ID, e.g. 1516' : this.role === 'librarian' ? 'Library administrator ID' : 'e.g. 2510011214'; },

    pwField(id, label, extra) {
        return `<div class="form-group">
            <label for="${id}">${label}</label>
            <div class="password-wrapper">
                <input type="password" id="${id}" class="login-input" placeholder="••••••••••" autocomplete="${extra || 'current-password'}" maxlength="72">
                <button type="button" class="toggle-password" data-toggle="${id}" aria-label="Show password" tabindex="-1">${Icons.svg('eye', 18)}</button>
            </div>
        </div>`;
    },

    strengthBlock() {
        return `<div class="pw-meter" id="pw-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <ul class="pw-rules" id="pw-rules">
                <li data-rule="len">At least 8 characters</li>
                <li data-rule="letter">A letter</li>
                <li data-rule="num">A number</li>
            </ul>`;
    },

    body() {
        const idField = `<div class="form-group">
            <label id="id-label" for="userId">${this.idLabel()}</label>
            <input type="text" id="userId" class="login-input" placeholder="${this.idHint()}" autocomplete="username" spellcheck="false" maxlength="32" value="${Util.escapeHTML(this.prefillId)}">
        </div>`;

        if (this.mode === 'signup') {
            return {
                title: 'Set up your password',
                sub: `Your ${this.idLabel()} must already be registered by your administrator.`,
                form: idField + this.pwField('password', 'New password', 'new-password') + this.strengthBlock() + this.pwField('confirm', 'Confirm password', 'new-password'),
                submit: 'Save password',
                links: `<span>Already have a password? <a href="#" data-go="login">Log in</a></span>`
            };
        }
        if (this.mode === 'forgot') {
            const step2 = this.codeSent ? `
                <div class="form-group">
                    <label for="code">6-digit reset code</label>
                    <input type="text" id="code" class="login-input code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">
                </div>` + this.pwField('password', 'New password', 'new-password') + this.strengthBlock() + this.pwField('confirm', 'Confirm new password', 'new-password') : '';
            return {
                title: 'Reset your password',
                sub: this.codeSent
                    ? 'Enter the code you received (e-mail, or from your administrator) and choose a new password.'
                    : `Enter your ${this.idLabel()}. We send a one-time code to the e-mail registered for it, or your administrator can give you one.`,
                form: idField + step2,
                submit: this.codeSent ? 'Reset password' : 'Send reset code',
                links: `<span>${this.codeSent ? '<a href="#" data-go="resend">Send a new code</a> · ' : 'Have a code already? <a href="#" data-go="havecode">Enter it</a> · '}<a href="#" data-go="login">Back to log in</a></span>`
            };
        }
        return {
            title: 'Welcome back',
            sub: 'Log in to enter the virtual campus.',
            form: idField + this.pwField('password', 'Password') + `<div class="form-row"><a href="#" class="link-sm" data-go="forgot">Forgot password?</a></div>`,
            submit: 'Log in',
            links: `<span>First time here? <a href="#" data-go="signup">Set up your password</a></span>`
        };
    },

    getHTML() {
        const b = this.body();
        const notice = this.notice ? `<div class="auth-banner ${this.notice.type}" role="status">${Icons.svg(this.notice.type === 'success' ? 'check' : 'info', 16)}<span>${Util.escapeHTML(this.notice.text)}</span></div>` : '';
        return `
        <div class="layer auth-layer fade-in">
            <div class="auth-bg" aria-hidden="true"><i class="orb o1"></i><i class="orb o2"></i><i class="orb o3"></i></div>
            <div class="auth-shell">
                <aside class="auth-brand">
                    <div class="brand-mark">${Icons.svg('cap', 30)}</div>
                    <h1>EDUVERSE</h1>
                    <p class="brand-tag">Virtual Interactive Learning Room</p>
                    <ul class="brand-points">
                        <li>${Icons.svg('chair', 18)}<div><strong>Take your seat</strong><span>Walk into a classroom, find a bench and sit down.</span></div></li>
                        <li>${Icons.svg('mic', 18)}<div><strong>Live voice</strong><span>Speak with your teacher in real time once you are seated.</span></div></li>
                        <li>${Icons.svg('screen', 18)}<div><strong>Teacher-controlled sharing</strong><span>Present your screen when your teacher allows it.</span></div></li>
                    </ul>
                </aside>
                <main class="auth-card">
                    <header class="auth-head"><h2>${b.title}</h2><p>${b.sub}</p></header>
                    <div class="role-tabs" role="tablist" aria-label="Account type">
                        <button type="button" class="role-tab ${this.role === 'student' ? 'selected' : ''}" data-role="student" role="tab" aria-selected="${this.role === 'student'}">${Icons.svg('user', 16)} Student</button>
                        <button type="button" class="role-tab ${this.role === 'faculty' ? 'selected' : ''}" data-role="faculty" role="tab" aria-selected="${this.role === 'faculty'}">${Icons.svg('board', 16)} Faculty</button>
                        <button type="button" class="role-tab ${this.role === 'librarian' ? 'selected' : ''}" data-role="librarian" role="tab" aria-selected="${this.role === 'librarian'}">${Icons.svg('book', 16)} Librarian</button>
                    </div>
                    ${notice}
                    <form id="auth-form" novalidate>
                        ${b.form}
                        <div class="auth-feedback" id="auth-feedback" role="alert" aria-live="assertive"></div>
                        <button type="submit" class="submit-btn" id="submit-btn"><span class="btn-label">${b.submit}</span><i class="spinner" aria-hidden="true"></i></button>
                    </form>
                    <div class="auth-links">${b.links}</div>
                    <div class="secure-notice">${Icons.svg('lock', 14)} Secure academic access · passwords are encrypted</div>
                </main>
            </div>
        </div>`;
    },

    init() {
        const $ = id => document.getElementById(id);
        const form = $('auth-form'), feedback = $('auth-feedback'), submitBtn = $('submit-btn');
        const idInput = $('userId');

        const setFeedback = (text, type) => { feedback.textContent = text || ''; feedback.className = 'auth-feedback' + (text ? ' ' + (type || 'error') : ''); };
        const flag = (input, on) => input && input.classList.toggle('error', on);
        const busy = on => { submitBtn.disabled = on; submitBtn.classList.toggle('loading', on); };

        // role tabs keep what has been typed in the other fields
        Util.$$('.role-tab').forEach(tab => tab.addEventListener('click', () => {
            this.role = tab.dataset.role;
            this.prefillId = '';
            this.notice = null;
            Navigation.render();
        }));

        // links inside the card
        Util.$$('[data-go]').forEach(a => a.addEventListener('click', e => {
            e.preventDefault();
            const go = a.dataset.go;
            this.prefillId = idInput.value.trim();
            if (go === 'havecode') { this.codeSent = true; this.show('forgot'); }
            else if (go === 'resend') { this.codeSent = false; this.show('forgot'); }
            else this.show(go);
        }));

        // show / hide password
        Util.$$('[data-toggle]').forEach(btn => btn.addEventListener('click', () => {
            const input = $(btn.dataset.toggle);
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.innerHTML = Icons.svg(show ? 'eyeOff' : 'eye', 18);
            btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
            btn.classList.toggle('on', show);
        }));

        // live password strength
        const pwd = $('password');
        if (pwd && $('pw-meter')) {
            const update = () => {
                const v = pwd.value;
                const rules = { len: v.length >= 8, letter: /[A-Za-z]/.test(v), num: /\d/.test(v) };
                Util.$$('#pw-rules li').forEach(li => li.classList.toggle('ok', rules[li.dataset.rule]));
                let score = Object.values(rules).filter(Boolean).length;
                if (v.length >= 12 && /[^A-Za-z0-9]/.test(v) && score === 3) score = 4;
                if (!v) score = 0;
                const meter = $('pw-meter');
                meter.dataset.score = String(score);
                Util.$$('i', meter).forEach((bar, i) => bar.classList.toggle('on', i < score));
            };
            pwd.addEventListener('input', update);
            update();
        }

        // clear error state while typing
        Util.$$('.login-input').forEach(inp => inp.addEventListener('input', () => {
            inp.classList.remove('error');
            if (feedback.classList.contains('error')) setFeedback('');
        }));

        (idInput.value ? ($('password') || $('code') || idInput) : idInput).focus();

        form.addEventListener('submit', async e => {
            e.preventDefault();
            setFeedback('');
            const idVal = idInput.value.trim();
            const val = id => ($(id) ? $(id).value : '');
            const fail = (msg, input) => { flag(input, true); setFeedback(msg); if (input) input.focus(); };

            if (!idVal) return fail(`${this.idLabel()} is required.`, idInput);
            if (!/^[A-Za-z0-9_-]{3,32}$/.test(idVal)) return fail(`Enter a valid ${this.idLabel()}.`, idInput);
            this.prefillId = idVal;

            // ---------------- LOGIN ----------------
            if (this.mode === 'login') {
                if (!val('password')) return fail('Password is required.', $('password'));
                busy(true);
                const r = await Api.post('/api/auth/login', { role: this.role, userId: idVal, password: val('password') });
                if (!r.ok) {
                    busy(false);
                    if (r.data.code === 'PASSWORD_NOT_SET') {
                        setFeedback(r.data.error);
                        const link = document.createElement('a');
                        link.href = '#'; link.textContent = ' Set it up now';
                        link.addEventListener('click', ev => { ev.preventDefault(); this.show('signup'); });
                        feedback.appendChild(link);
                    } else {
                        flag($('password'), true);
                        setFeedback(r.data.error || 'Login failed.');
                    }
                    return;
                }
                setFeedback('Welcome! Entering the campus…', 'success');
                submitBtn.classList.add('loading');
                State.setSession(r.data.token, { id: r.data.id, userId: r.data.userId, name: r.data.name, role: r.data.role, room: r.data.room });
                setTimeout(() => Navigation.navigate('VIRTUAL_CAMPUS'), 450);
                return;
            }

            // ---------------- SET UP PASSWORD ----------------
            if (this.mode === 'signup') {
                if (!val('password')) return fail('Choose a password.', $('password'));
                if (val('password') !== val('confirm')) return fail('The two passwords do not match.', $('confirm'));
                busy(true);
                const r = await Api.post('/api/auth/signup', { role: this.role, userId: idVal, password: val('password'), confirmPassword: val('confirm') });
                busy(false);
                if (!r.ok) {
                    if (r.data.code === 'PASSWORD_ALREADY_SET') { this.show('login', { type: 'info', text: r.data.error }); return; }
                    return fail(r.data.error || 'Could not save the password.', r.data.code === 'ID_NOT_REGISTERED' ? idInput : $('password'));
                }
                this.show('login', { type: 'success', text: 'Password saved. You can log in now.' });
                return;
            }

            // ---------------- FORGOT / RESET ----------------
            if (!this.codeSent) {
                busy(true);
                const r = await Api.post('/api/auth/forgot', { role: this.role, userId: idVal });
                busy(false);
                if (!r.ok) return fail(r.data.error || 'Could not send a code.');
                this.codeSent = true;
                this.notice = { type: 'info', text: r.data.message };
                Navigation.render();
                return;
            }
            if (!/^\d{6}$/.test(val('code').trim())) return fail('Enter the 6-digit code.', $('code'));
            if (!val('password')) return fail('Choose a new password.', $('password'));
            if (val('password') !== val('confirm')) return fail('The two passwords do not match.', $('confirm'));
            busy(true);
            const r = await Api.post('/api/auth/reset', { role: this.role, userId: idVal, code: val('code').trim(), newPassword: val('password'), confirmPassword: val('confirm') });
            busy(false);
            if (!r.ok) return fail(r.data.error || 'Could not reset the password.', r.data.code === 'INVALID_CODE' ? $('code') : $('password'));
            this.codeSent = false;
            this.show('login', { type: 'success', text: 'Password updated. Log in with your new password.' });
        });
    }
};
