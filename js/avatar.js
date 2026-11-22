// Avatars: every person gets their own look (derived from their ID), a smooth walk cycle,
// a sitting pose, a waving raised hand, blinking eyes and a talking mouth.
const Avatar = {
    SKIN: ['#F5C9A0', '#E8B48A', '#D49A6A', '#B97A4F', '#8D5A3B', '#FADDC0'],
    HAIR: ['#2B1B12', '#4A2E1B', '#8B5A2B', '#C9A227', '#1F2937', '#7C2D12', '#5B3A29', '#A8A29E'],
    TOPS: ['#4F46E5', '#0EA5E9', '#10B981', '#F43F5E', '#F59E0B', '#8B5CF6', '#14B8A6', '#EC4899'],
    PACKS: ['#F59E0B', '#EF4444', '#22C55E', '#38BDF8', '#A78BFA'],

    look(uid, role) {
        const h = Util.hash(String(uid) + ':' + role);
        const pick = (arr, shift) => arr[(h >>> shift) % arr.length];
        if (role === 'librarian') {
            return { skin: pick(this.SKIN, 2), hair: '#4A2E1B', style: 2, top: '#0D9488', topDark: '#0F766E', pack: null, glasses: true, stripe: false, seed: h % 97 };
        }
        if (role === 'faculty') {
            return { skin: pick(this.SKIN, 2), hair: ['#6B7280', '#1F2937', '#A8A29E'][(h >>> 5) % 3], style: (h >>> 7) % 2 ? 1 : 0,
                top: '#7C3AED', topDark: '#6D28D9', pack: null, glasses: true, stripe: false, seed: h % 97 };
        }
        const top = pick(this.TOPS, 0);
        return { skin: pick(this.SKIN, 3), hair: pick(this.HAIR, 6), style: (h >>> 9) % 4, top, topDark: this.shade(top, -0.18),
            pack: pick(this.PACKS, 12), glasses: (h >>> 15) % 5 === 0, stripe: (h >>> 17) % 3 === 0, seed: h % 97 };
    },

    shade(hex, amt) {
        const n = parseInt(hex.slice(1), 16);
        const f = c => Math.round(Util.clamp(c + c * amt, 0, 255));
        return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
    },

    rr(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    },

    // (x, y) = centre of the collision circle; feet touch the ground at y + 16 * scale.
    // o: { look, role, dir, phase, amount, size, sit, hand, speaking, tick }
    draw(ctx, x, y, o) {
        const L = o.look, faculty = o.role !== 'student'; // staff (faculty / librarian) wear a blazer and glasses
        const dir = o.dir || 'down', sit = Boolean(o.sit), amt = o.amount || 0, tick = o.tick || 0;
        const swing = Math.sin(o.phase || 0) * amt;
        const k = (o.size || 16) / 16;
        const breathe = Math.sin(tick * 0.05 + L.seed) * 0.5;
        const bob = sit ? breathe * 0.6 : Math.abs(Math.sin(o.phase || 0)) * 1.9 * amt + (amt < 0.05 ? breathe : 0);
        const blink = ((tick + L.seed * 37) % 230) < 6;
        const side = dir === 'left' || dir === 'right';
        const sg = dir === 'right' ? 1 : -1;
        const pants = '#1E293B', shoe = '#0B1220';

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(k, k);

        // soft ground shadow (stays on the floor while the body bobs)
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.ellipse(0, sit ? 13 : 16, sit ? 11 : 12 - amt, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // speaking: expanding sound rings
        if (o.speaking) {
            for (let i = 0; i < 2; i++) {
                const ph = ((tick * 0.03) + i * 0.5) % 1;
                ctx.strokeStyle = `rgba(52, 211, 153, ${0.55 * (1 - ph)})`;
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.ellipse(0, 15, 12 + ph * 16, 4 + ph * 6, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        ctx.translate(0, sit ? 4 - bob : -bob);

        // ---- legs (hidden by the desk when sitting) ----
        if (!sit) {
            if (side) {
                [[-1, '#172033'], [1, pants]].forEach(([n, col]) => {
                    const off = swing * 5.5 * n;
                    ctx.fillStyle = col;
                    this.rr(ctx, -3 + off, 4, 6, 12, 2.5); ctx.fill();
                    ctx.fillStyle = shoe;
                    this.rr(ctx, -3 + off + (sg > 0 ? 0 : -2), 14, 8, 3, 1.5); ctx.fill();
                });
            } else {
                [[-7, Math.max(0, swing) * 3.2], [1, Math.max(0, -swing) * 3.2]].forEach(([lx, lift]) => {
                    ctx.fillStyle = pants;
                    this.rr(ctx, lx, 4, 6, 12 - lift, 2.5); ctx.fill();
                    ctx.fillStyle = shoe;
                    this.rr(ctx, lx - 0.5, 14 - lift, 7, 3, 1.5); ctx.fill();
                });
            }
        }

        // ---- backpack behind the body ----
        if (L.pack && !sit && dir === 'down') {
            ctx.fillStyle = this.shade(L.pack, -0.2);
            this.rr(ctx, -9, -8, 18, 17, 4); ctx.fill();
        } else if (L.pack && !sit && side) {
            ctx.fillStyle = this.shade(L.pack, -0.2);
            this.rr(ctx, -sg * 9 - 4, -9, 8, 15, 3); ctx.fill();
        }

        // ---- back hair (long styles hang behind the shoulders) ----
        const hy = sit ? -16 : -18;
        if (L.style === 1 && !faculty) {
            ctx.fillStyle = L.hair;
            if (dir === 'down') { this.rr(ctx, -10, hy - 2, 20, 22, 8); ctx.fill(); }
            else if (side) { this.rr(ctx, -sg * 9 - 3, hy - 2, 9, 20, 4); ctx.fill(); }
        }

        // ---- torso ----
        const torsoH = sit ? 14 : 17;
        ctx.fillStyle = L.top;
        this.rr(ctx, -10, -11, 20, torsoH, 5); ctx.fill();
        ctx.fillStyle = L.topDark; // hem
        ctx.fillRect(-10, -11 + torsoH - 3, 20, 2);
        if (L.stripe && !faculty) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(-10, -4, 20, 2.2); }
        if (dir === 'down') {
            ctx.fillStyle = '#FFFFFF'; // collar
            ctx.beginPath(); ctx.moveTo(-4, -11); ctx.lineTo(4, -11); ctx.lineTo(0, -5); ctx.closePath(); ctx.fill();
            if (faculty) { ctx.fillStyle = '#FBBF24'; ctx.fillRect(-1.2, -6, 2.4, 9); }
            else if (L.pack && !sit) { ctx.fillStyle = L.pack; ctx.fillRect(-7, -10, 3, 14); ctx.fillRect(4, -10, 3, 14); }
        }
        if (L.pack && dir === 'up') { // seen from behind: the backpack is in front of the body
            ctx.fillStyle = L.pack;
            this.rr(ctx, -9, -10, 18, sit ? 13 : 16, 4); ctx.fill();
            ctx.fillStyle = this.shade(L.pack, -0.2);
            this.rr(ctx, -6, -2, 12, 6, 2); ctx.fill();
            ctx.fillRect(-9, -6, 18, 1.5);
        }

        // ---- arms ----
        const armCol = L.topDark;
        const hand = (cx, cy) => { ctx.fillStyle = L.skin; ctx.beginPath(); ctx.arc(cx, cy, 2.4, 0, Math.PI * 2); ctx.fill(); };
        if (side) {
            const off = -swing * 4.5 * sg;
            ctx.fillStyle = armCol; this.rr(ctx, -2 + off, -9, 5, 11, 2.5); ctx.fill();
            hand(0.5 + off, 3.5);
        } else if (sit) {
            // forearms resting on the desk
            ctx.fillStyle = armCol;
            this.rr(ctx, -14, -9, 4, 11, 2); ctx.fill();
            if (!o.hand) this.rr(ctx, 10, -9, 4, 11, 2), ctx.fill();
            hand(-12, 3.5);
            if (!o.hand) hand(12, 3.5);
        } else {
            [[-14, swing * 2.6], [10, -swing * 2.6]].forEach(([ax, dy], i) => {
                if (o.hand && i === 1) return;
                ctx.fillStyle = armCol; this.rr(ctx, ax, -9 + dy, 4, 11, 2); ctx.fill();
                hand(ax + 2, 3.5 + dy);
            });
        }
        if (o.hand) { // raised, waving arm
            const wave = Math.sin(tick * 0.22) * 0.22;
            ctx.save();
            ctx.translate(12, -8);
            ctx.rotate(wave);
            ctx.fillStyle = armCol; this.rr(ctx, -2.2, -19, 4.4, 20, 2.2); ctx.fill();
            ctx.fillStyle = L.skin;
            ctx.beginPath(); ctx.arc(0, -21, 3.3, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }

        // ---- head ----
        ctx.fillStyle = L.skin;
        ctx.beginPath(); ctx.arc(0, hy, 8.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = L.hair;
        const eyeCol = '#1F2937';
        if (dir === 'up') {
            ctx.beginPath(); ctx.arc(0, hy, 8.9, 0, Math.PI * 2); ctx.fill();
            if (L.style === 2) { ctx.beginPath(); ctx.arc(0, hy - 9, 4.2, 0, Math.PI * 2); ctx.fill(); }
            if (L.style === 3) { ctx.beginPath(); ctx.arc(0, hy - 1, 10.6, 0, Math.PI * 2); ctx.fill(); }
            if (L.style === 1 && !faculty) { this.rr(ctx, -9, hy, 18, 14, 6); ctx.fill(); }
        } else if (dir === 'down') {
            if (L.style === 3) { ctx.beginPath(); ctx.arc(0, hy - 1, 10.4, Math.PI, 0); ctx.fill(); }
            ctx.beginPath();
            ctx.arc(0, hy, 8.9, Math.PI, 0);
            ctx.lineTo(8.9, hy); ctx.lineTo(5, hy + 2.5); ctx.lineTo(1.5, hy - 1); ctx.lineTo(-2.5, hy + 2.5); ctx.lineTo(-6, hy); ctx.lineTo(-8.9, hy);
            ctx.closePath(); ctx.fill();
            if (L.style === 2) { ctx.beginPath(); ctx.arc(0, hy - 9.5, 4.2, 0, Math.PI * 2); ctx.fill(); }
            // eyes (blink) and brows
            ctx.fillStyle = eyeCol;
            if (blink) { ctx.fillRect(-4.3, hy + 2.3, 2.6, 1); ctx.fillRect(1.7, hy + 2.3, 2.6, 1); }
            else { ctx.beginPath(); ctx.arc(-3, hy + 2.6, 1.3, 0, Math.PI * 2); ctx.arc(3, hy + 2.6, 1.3, 0, Math.PI * 2); ctx.fill(); }
            // mouth: smile, or talking
            if (o.speaking) {
                const open = 0.6 + Math.abs(Math.sin(tick * 0.4)) * 1.7;
                ctx.fillStyle = '#7F1D1D'; ctx.beginPath(); ctx.ellipse(0, hy + 5.4, 1.9, open, 0, 0, Math.PI * 2); ctx.fill();
            } else {
                ctx.strokeStyle = '#B45309'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(0, hy + 4, 2.3, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
            }
            ctx.fillStyle = 'rgba(244,114,128,0.28)'; // cheeks
            ctx.beginPath(); ctx.arc(-5.6, hy + 4.4, 1.5, 0, Math.PI * 2); ctx.arc(5.6, hy + 4.4, 1.5, 0, Math.PI * 2); ctx.fill();
            if (L.glasses) { ctx.strokeStyle = '#111827'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(-3, hy + 2.6, 2.6, 0, Math.PI * 2); ctx.moveTo(0.4, hy + 2.6); ctx.arc(3, hy + 2.6, 2.6, 0, Math.PI * 2); ctx.moveTo(-0.4, hy + 2.4); ctx.lineTo(0.4, hy + 2.4); ctx.stroke(); }
        } else {
            ctx.beginPath(); ctx.arc(0, hy, 8.9, 0, Math.PI * 2); ctx.fill();
            if (L.style === 2) { ctx.beginPath(); ctx.arc(-sg * 5, hy - 8, 4, 0, Math.PI * 2); ctx.fill(); }
            if (L.style === 3) { ctx.beginPath(); ctx.arc(-sg * 1.5, hy - 1, 10.2, 0, Math.PI * 2); ctx.fill(); }
            ctx.fillStyle = L.skin; ctx.beginPath(); ctx.ellipse(sg * 2.6, hy + 1, 6.3, 6.8, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = L.hair; ctx.beginPath(); ctx.ellipse(sg * 3, hy - 5.2, 6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = eyeCol;
            if (blink) ctx.fillRect(sg * 5.6 - 1.3, hy + 1.8, 2.6, 1);
            else { ctx.beginPath(); ctx.arc(sg * 5.6, hy + 1.8, 1.3, 0, Math.PI * 2); ctx.fill(); }
            if (L.glasses) { ctx.strokeStyle = '#111827'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(sg * 5.6, hy + 1.8, 2.6, 0, Math.PI * 2); ctx.stroke(); }
        }

        ctx.restore();
    }
};
