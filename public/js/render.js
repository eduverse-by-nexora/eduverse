// Drawing: hall, classrooms (board, teacher desk, desk-benches), the library (subject sections) and the path to it,
// people, name tags and seat markers.
Object.assign(CampusWorld, {
    SEAT_DY: -3, // seated avatars are drawn a little above the cushion centre

    inView(x, y, w, h, cam, pad) {
        pad = pad || 0;
        return x + w > cam.x - pad && x < cam.x + cam.viewW + pad && y + h > cam.y - pad && y < cam.y + cam.viewH + pad;
    },

    // everybody who has to be drawn this frame, with smooth movement for the remote ones
    people() {
        const list = [];
        const follow = 1 - Math.pow(0.75, this.dtf || 1);
        Object.values(this.remote).forEach(p => {
            let tx = p.x, ty = p.y, dir = p.dir || 'down';
            const room = p.seat !== null && p.room ? this.roomObj(p.room) : null;
            const seat = room ? room.seats[p.seat] : null;
            if (seat) { tx = seat.x; ty = seat.y + this.SEAT_DY; dir = seat.face; }
            const ddx = tx - p.cx, ddy = ty - p.cy;
            if (Math.hypot(ddx, ddy) > 260) { p.cx = tx; p.cy = ty; }
            else { p.cx += ddx * follow; p.cy += ddy * follow; }
            const moved = Math.hypot(ddx * follow, ddy * follow);
            p.phase += moved * 0.07;
            p.amount += (Math.min(1, moved / 1.6) - p.amount) * 0.2;
            list.push({
                id: p.id, x: p.cx, y: p.cy, room: p.room, role: p.role, look: p.look, name: p.name, dir,
                phase: p.phase, amount: p.amount, size: 14,
                sit: Boolean(seat) && Math.hypot(tx - p.cx, ty - p.cy) < 5,
                hand: Boolean(p.hand), speaking: Boolean(p.sp), mic: p.mic, muted: p.muted,
                sharing: this.isSharer(p.id), off: p.off, me: false
            });
        });
        const a = this.avatar, s = this.seat;
        const hop = s.phase === 'sitting' || s.phase === 'rising' ? Math.sin(Math.PI * Math.min(1, s.t)) * 7 : 0;
        const sit = s.phase === 'seated' || (s.phase === 'sitting' && s.t > 0.55) || (s.phase === 'rising' && s.t < 0.45);
        list.push({
            id: Net.myId || 'me', x: a.x, y: a.y - hop, sortY: a.y, room: this.currentRoomCode, role: State.user.role, look: this.myLook, name: State.user.name, dir: a.dir,
            phase: a.walkPhase, amount: a.walkAmount, size: a.size, sit, hand: this.handUp, speaking: this.mic.speaking,
            mic: this.mic.on, muted: this.mic.locked, sharing: this.screen.on, off: false, me: true
        });
        return list;
    },

    draw() {
        const ctx = this.ctx, layout = this.getLayout(), cam = this.getCamera();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.vw, this.vh);
        ctx.save();
        ctx.scale(cam.s, cam.s);
        ctx.translate(-cam.x, -cam.y);
        const people = this.people(); // once per frame: it also moves the remote avatars smoothly
        const focus = this.focusRoom();
        if (focus) this.drawFocus(ctx, layout, cam, people, focus);
        else this.drawWorld(ctx, layout, cam, people);
        ctx.restore();
    },

    // Class focus: once a student sits down (and while seated / standing up) only their classroom stays lit;
    // the rest of the campus fades to 10% over black.
    focusRoom() {
        if (!this.currentRoomCode || this.seat.phase === 'none') return null;
        const room = this.roomObj(this.currentRoomCode);
        return room && room.type === 'classroom' ? room : null;
    },

    drawFocus(ctx, layout, cam, people, room) {
        ctx.fillStyle = '#000';
        ctx.fillRect(cam.x - 20, cam.y - 20, cam.viewW + 40, cam.viewH + 40);
        ctx.save();
        ctx.globalAlpha = 0.1;
        this.drawWorld(ctx, layout, cam, people);
        ctx.restore();

        // the classroom itself at full brightness, with only the people inside it
        ctx.save();
        ctx.beginPath();
        ctx.rect(room.x, room.y, room.width, room.height);
        ctx.clip();
        this.drawRoom(ctx, room);
        const inRoom = people.filter(p => p.room === room.code);
        const items = this.furnitureItems(ctx, room);
        inRoom.forEach(p => items.push({ y: (p.sortY !== undefined ? p.sortY : p.y) + 16, fn: () => this.drawPerson(ctx, p) }));
        items.sort((a, b) => a.y - b.y).forEach(it => it.fn());
        inRoom.filter(p => !p.me).forEach(p => this.drawTag(ctx, p));
        inRoom.filter(p => p.me).forEach(p => this.drawTag(ctx, p));
        ctx.restore();
    },

    // desks, bookshelves and the teacher's / librarian's desk of one room, as items to be sorted by their feet
    furnitureItems(ctx, room) {
        const items = [];
        room.blocks.forEach(b => {
            if (!room.vert) items.push({ y: b.desk.y + b.desk.h + 5, fn: () => this.drawDesk(ctx, b.desk) });
            else for (let i = 0; i < 3; i++) { // a tall desk is drawn in 3 pieces so people sort correctly beside it
                const seg = { x: b.desk.x, y: b.desk.y + i * Seating.pitch, w: b.desk.w, h: Seating.pitch };
                items.push({ y: seg.y + seg.h + 5, fn: () => this.drawDesk(ctx, seg) });
            }
        });
        if (room.sections) room.sections.forEach(sec => items.push({ y: sec.shelf.y + sec.shelf.h + 5, fn: () => this.drawShelf(ctx, sec) }));
        items.push({ y: room.teacherDesk.y + room.teacherDesk.h + 5, fn: () => (room.type === 'library' ? this.drawLibrarianDesk(ctx, room) : this.drawTeacherDesk(ctx, room)) });
        return items;
    },

    // the whole campus as normal: grass, path, hall, rooms, library, furniture, people, name tags
    drawWorld(ctx, layout, cam, people) {
        const hall = layout.hall;
        // grass around the building
        ctx.fillStyle = this.getPattern('grass');
        ctx.fillRect(cam.x - 20, cam.y - 20, cam.viewW + 40, cam.viewH + 40);
        this.drawLibraryPath(ctx, layout, cam);

        // hall: wooden floor, a rug, the notice board. Its left end opens onto the path to the library.
        ctx.fillStyle = this.getPattern('wood');
        ctx.fillRect(hall.x, hall.y, hall.width, hall.height);
        const lp = layout.libPath;
        ctx.strokeStyle = '#6B4A22'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(hall.x, hall.y); ctx.lineTo(hall.x + hall.width, hall.y);
        ctx.moveTo(hall.x, hall.y + hall.height); ctx.lineTo(hall.x + hall.width, hall.y + hall.height);
        ctx.moveTo(hall.x + hall.width, hall.y); ctx.lineTo(hall.x + hall.width, hall.y + hall.height);   // right end: closed
        ctx.moveTo(hall.x, hall.y); ctx.lineTo(hall.x, lp.y);                                              // left end: open in the middle
        ctx.moveTo(hall.x, lp.y + lp.h); ctx.lineTo(hall.x, hall.y + hall.height);
        ctx.stroke();
        this.drawRug(ctx, hall);

        layout.rooms.forEach(room => { if (this.inView(room.x, room.y, room.width, room.height, cam, 40)) (room.type === 'library' ? this.drawLibrary(ctx, room) : this.drawRoom(ctx, room)); });

        const nb = layout.noticeBoard;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(nb.x + 3, nb.y + 4, nb.width, nb.height);
        ctx.fillStyle = '#78350F'; ctx.fillRect(nb.x, nb.y, nb.width, nb.height);
        ctx.fillStyle = '#B45309'; ctx.fillRect(nb.x + 3, nb.y + 3, nb.width - 6, nb.height - 6);
        ctx.fillStyle = '#FEF3C7'; ctx.fillRect(nb.x + 8, nb.y + 8, 14, 18); ctx.fillRect(nb.x + 28, nb.y + 10, 18, 16);
        ctx.fillStyle = '#3B2A14'; ctx.font = 'bold 9px Inter, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('NOTICES', nb.x + nb.width / 2, nb.y - 6);

        // everything with a "height" is sorted by its feet so nearer things overlap farther ones
        const items = [];
        layout.rooms.forEach(room => { if (this.inView(room.x, room.y, room.width, room.height, cam, 20)) items.push(...this.furnitureItems(ctx, room)); });
        layout.plants.forEach(pl => { if (this.inView(pl.x - 20, pl.y - 40, 40, 60, cam)) items.push({ y: pl.y + 10, fn: () => this.drawPlant(ctx, pl.x, pl.y) }); });
        people.forEach(p => items.push({ y: (p.sortY !== undefined ? p.sortY : p.y) + 16, fn: () => this.drawPerson(ctx, p) }));
        items.sort((a, b) => a.y - b.y).forEach(it => it.fn());

        this.drawAutoPath(ctx);
        // name tags last, so nothing covers them
        people.filter(p => !p.me).forEach(p => this.drawTag(ctx, p));
        people.filter(p => p.me).forEach(p => this.drawTag(ctx, p));
    },

    drawPerson(ctx, p) {
        ctx.save();
        if (p.off) ctx.globalAlpha *= 0.45;
        if (p.me) { // soft pulsing ring so you can spot yourself
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + 16 + (p.sit ? -3 : 0), 23 + Math.sin(this.tick * 0.08) * 2, 9, 0, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(129, 140, 248, 0.75)'; ctx.lineWidth = 1.6; ctx.stroke();
        }
        Avatar.draw(ctx, p.x, p.y, { look: p.look, role: p.role, dir: p.dir, phase: p.phase, amount: p.amount, size: p.size, sit: p.sit, hand: p.hand, speaking: p.speaking, tick: this.tick });
        ctx.restore();
    },

    drawTag(ctx, p) {
        const icons = (p.hand ? '✋ ' : '') + (p.sharing ? '🖥 ' : '') + (p.muted ? '🔇 ' : p.mic ? '🎤 ' : '');
        const text = icons + p.name + (p.me ? ' (You)' : '');
        ctx.font = '600 10px Inter, sans-serif';
        const w = ctx.measureText(text).width + 16, h = 17;
        const x = p.x - w / 2, y = p.y - (p.sit ? 41 : 46) - (p.hand ? 8 : 0);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        this.rrect(ctx, x, y, w, h, 8); ctx.fill();
        ctx.strokeStyle = p.me ? '#818CF8' : p.role !== 'student' ? '#A78BFA' : p.speaking ? '#34D399' : 'rgba(148,163,184,0.45)';
        ctx.lineWidth = p.me || p.speaking ? 1.5 : 1;
        ctx.stroke();
        ctx.fillStyle = '#F8FAFC'; ctx.textAlign = 'center';
        ctx.fillText(text, p.x, y + 12);
    },

    rrect(ctx, x, y, w, h, r) { Avatar.rr(ctx, x, y, w, h, r); },

    drawRug(ctx, hall) {
        const w = 360, h = 150, x = hall.x + hall.width / 2 - w / 2, y = hall.y + hall.height * 0.5 - h / 2;
        ctx.fillStyle = 'rgba(30, 41, 99, 0.55)'; this.rrect(ctx, x, y, w, h, 14); ctx.fill();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)'; ctx.lineWidth = 3; this.rrect(ctx, x + 8, y + 8, w - 16, h - 16, 10); ctx.stroke();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)'; ctx.lineWidth = 1; this.rrect(ctx, x + 16, y + 16, w - 32, h - 32, 6); ctx.stroke();
    },

    drawPlant(ctx, x, y) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + 10, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9A3412'; this.rrect(ctx, x - 9, y - 2, 18, 13, 3); ctx.fill();
        ctx.fillStyle = '#15803D';
        [[-8, -8, 7], [8, -9, 7], [0, -16, 8], [-3, -6, 7], [5, -5, 6]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2); ctx.fill(); });
        ctx.fillStyle = '#22C55E'; ctx.beginPath(); ctx.arc(x - 2, y - 15, 4, 0, Math.PI * 2); ctx.fill();
    },

    drawDesk(ctx, d) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(d.x + 2, d.y + d.h + 2, d.w, 5);
        ctx.fillStyle = '#8B5E34'; ctx.fillRect(d.x + 6, d.y + d.h, 5, 5); ctx.fillRect(d.x + d.w - 11, d.y + d.h, 5, 5); // legs
        ctx.fillStyle = '#A8723D'; ctx.fillRect(d.x, d.y + d.h - 2, d.w, 7);                                                 // front edge
        ctx.fillStyle = '#D4A267'; this.rrect(ctx, d.x, d.y, d.w, d.h, 3); ctx.fill();                                      // top
        ctx.strokeStyle = 'rgba(120,80,30,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(d.x + 3, d.y + 3, d.w - 6, d.h - 6);
    },

    drawTeacherDesk(ctx, room) {
        const d = room.teacherDesk;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(d.x + 3, d.y + d.h + 2, d.w, 6);
        ctx.fillStyle = '#5B3A1E'; ctx.fillRect(d.x, d.y + d.h - 4, d.w, 9);
        ctx.fillStyle = '#8B5A2B'; this.rrect(ctx, d.x, d.y, d.w, d.h, 4); ctx.fill();
        ctx.fillStyle = '#E5E7EB'; this.rrect(ctx, d.x + 14, d.y + 5, 32, 17, 2); ctx.fill();       // laptop
        ctx.fillStyle = '#6366F1'; ctx.fillRect(d.x + 17, d.y + 8, 26, 11);
        ctx.fillStyle = '#FDE68A'; ctx.fillRect(d.x + d.w - 40, d.y + 8, 22, 14);                      // papers
        ctx.fillStyle = '#F87171'; ctx.beginPath(); ctx.arc(d.x + d.w - 12, d.y + 12, 4, 0, Math.PI * 2); ctx.fill(); // apple
    },

    // A walled classroom: board, teacher's desk, 8 desk-benches. Purple + LIVE while a faculty member is teaching.
    drawRoom(ctx, room) {
        const { x, y, width, height, doorX, doorTop, subject } = room;
        const T = World.wall, B = World.band, D = World.door;
        const facultyName = this.facultyIn(subject.code);
        const live = Boolean(facultyName);
        const inside = this.currentRoomCode === subject.code;
        const restricted = this.bannedCodes.includes(subject.code);
        const free = this.freeSeats(subject.code);
        const students = this.studentsIn(subject.code);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'; ctx.fillRect(x + 6, y + 6, width, height);
        ctx.fillStyle = this.getPattern('room'); ctx.fillRect(x, y, width, height);

        // carpet runner down the centre aisle, from the door to the teacher
        const mid = room.lw / 2;
        const aisle = room.rect(mid - 36, 0, 72, room.ld);
        ctx.fillStyle = 'rgba(99, 102, 241, 0.13)'; ctx.fillRect(aisle.x, aisle.y, aisle.w, aisle.h);
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)'; ctx.lineWidth = 1.5; ctx.strokeRect(aisle.x + 0.5, aisle.y + 0.5, aisle.w - 1, aisle.h - 1);

        this.drawSeats(ctx, room);

        // walls
        ctx.fillStyle = inside ? '#8B6B3E' : '#5C4A32';
        ctx.fillRect(x, y, T, height);
        ctx.fillRect(x + width - T, y, T, height);
        const doorWallY = doorTop ? y : y + height - T;
        const farWallY = doorTop ? y + height - B : y;
        ctx.fillRect(x, doorWallY, doorX - D / 2 - x, T);
        ctx.fillRect(doorX + D / 2, doorWallY, x + width - (doorX + D / 2), T);

        // board wall: header band with the subject on a dark board
        ctx.fillStyle = restricted ? '#B91C1C' : live ? '#7C3AED' : '#7B8491';
        ctx.fillRect(x, farWallY, width, B);
        ctx.fillStyle = '#1E293B'; this.rrect(ctx, x + 26, farWallY + 7, width - 52, B - 14, 5); ctx.fill();
        ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#F1F5F9'; ctx.textAlign = 'center';
        const title = restricted ? `${subject.code}  ·  RESTRICTED` : `${subject.code}  ·  ${subject.name}`;
        let fs = 14;                                   // long subject names shrink to fit the board
        ctx.font = `bold ${fs}px Inter, sans-serif`;
        while (fs > 9 && ctx.measureText(title).width > width - 130) { fs--; ctx.font = `bold ${fs}px Inter, sans-serif`; }
        ctx.fillText(title, x + width / 2, farWallY + B / 2 + 5);
        if (live) {
            ctx.fillStyle = '#34D399'; ctx.beginPath(); ctx.arc(x + 42, farWallY + B / 2, 5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#A7F3D0'; ctx.font = 'bold 9px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('LIVE', x + 51, farWallY + B / 2 + 3.5);
        }

        // status text on the floor beside the teacher's desk
        const tp = room.toWorld(room.lw - 150, 31);
        ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(31, 41, 55, 0.7)';
        ctx.font = '600 12px Inter, sans-serif';
        ctx.fillText(restricted ? 'You were removed - try again in a moment' : live ? `${facultyName} is teaching` : 'Faculty has not joined yet', tp.x, tp.y);
        ctx.font = '500 11px Inter, sans-serif';
        ctx.fillText(`${students} student${students === 1 ? '' : 's'} inside · ${free} seat${free === 1 ? '' : 's'} free`, tp.x, tp.y + 16);

        // doormat
        ctx.fillStyle = live ? '#9B2C2C' : '#8A6A4A';
        ctx.fillRect(doorX - D / 2 + 6, doorTop ? y + T + 2 : y + height - T - 10, D - 12, 8);

        // door sign in the hall: room code (green dot = class is live)
        const sy = doorTop ? y - 16 : y + height + 16;
        ctx.font = 'bold 12px Inter, sans-serif';
        const sw = ctx.measureText(subject.code).width + (live ? 34 : 22);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'; this.rrect(ctx, doorX - sw / 2, sy - 11, sw, 22, 11); ctx.fill();
        ctx.strokeStyle = live ? '#34D399' : 'rgba(148,163,184,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#F8FAFC'; ctx.textAlign = 'center';
        ctx.fillText(subject.code, doorX + (live ? 6 : 0), sy + 4);
        if (live) { ctx.fillStyle = '#34D399'; ctx.beginPath(); ctx.arc(doorX - sw / 2 + 12, sy, 4, 0, Math.PI * 2); ctx.fill(); }

        if (inside) {
            ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
            ctx.strokeRect(x + 1.5, y + 1.5, width - 3, height - 3);
        }
    },

    // dotted guide from the avatar to the seat it is walking to
    drawAutoPath(ctx) {
        const au = this.auto;
        if (!au || !au.path || au.i >= au.path.length) return;
        const a = this.avatar;
        ctx.save();
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.setLineDash([2, 9]); ctx.lineDashOffset = -this.tick * 0.6;
        ctx.beginPath(); ctx.moveTo(a.x, a.y + 14);
        for (let i = au.i; i < au.path.length; i++) ctx.lineTo(au.path[i].x, au.path[i].y + 14);
        ctx.stroke();
        const end = au.path[au.path.length - 1];
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.beginPath(); ctx.ellipse(end.x, end.y + 14, 13 + Math.sin(this.tick * 0.1) * 2, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    },

    // bench strips, seat cushions and the green "free seat" markers (classrooms)
    drawSeats(ctx, room) {
        const subject = room.subject, occ = this.seatOwners(subject.code), myIdx = this.seat.idx;
        const inside = this.currentRoomCode === subject.code;
        const markFree = inside && State.user.role === 'student' && this.seat.phase === 'none';
        const cw = room.vert ? 14 : 40, ch = room.vert ? 40 : 14;
        room.blocks.forEach(b => {
            ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(b.bench.x + 1, b.bench.y + 3, b.bench.w, b.bench.h);
            ctx.fillStyle = '#A06B36'; this.rrect(ctx, b.bench.x, b.bench.y, b.bench.w, b.bench.h, 3); ctx.fill();
        });
        room.seats.forEach(s => {
            const taken = Boolean(occ[s.idx]) || myIdx === s.idx;
            ctx.fillStyle = taken ? '#7C4F25' : '#E2B878';
            this.rrect(ctx, s.x - cw / 2, s.y - ch / 2, cw, ch, 5); ctx.fill();
            ctx.strokeStyle = 'rgba(70,40,10,0.45)'; ctx.lineWidth = 1; ctx.stroke();
            if (markFree && !taken) {
                const near = this.nearSeat && this.nearSeat.idx === s.idx, target = this.auto && this.auto.seatIdx === s.idx;
                const pulse = 0.5 + 0.5 * Math.sin(this.tick * 0.08 + s.idx);
                ctx.strokeStyle = `rgba(16, 185, 129, ${near || target ? 0.95 : 0.35 + pulse * 0.3})`;
                ctx.lineWidth = near || target ? 3 : 1.6;
                this.rrect(ctx, s.x - cw / 2 - 2, s.y - ch / 2 - 2, cw + 4, ch + 4, 6); ctx.stroke();
                if (near) {
                    ctx.fillStyle = 'rgba(16, 185, 129, 0.25)'; this.rrect(ctx, s.x - cw / 2 - 2, s.y - ch / 2 - 2, cw + 4, ch + 4, 6); ctx.fill();
                    ctx.fillStyle = '#065F46'; ctx.font = 'bold 11px Inter, sans-serif'; ctx.textAlign = 'center';
                    ctx.fillText('S', s.x, s.y + 4);
                }
            }
        });
    },

    // the path from the hall's left end to the library, with a sign
    drawLibraryPath(ctx, layout, cam) {
        const r = layout.libPath;
        if (!this.inView(r.x, r.y, r.w, r.h, cam, 60)) return;
        ctx.fillStyle = this.getPattern('path'); ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = 'rgba(80, 70, 50, 0.6)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.w, r.y); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke();
        // sign in the middle of the path
        const label = '←  Library · subject notes', cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        ctx.font = 'bold 13px Inter, sans-serif';
        const sw = ctx.measureText(label).width + 28;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'; this.rrect(ctx, cx - sw / 2, cy - 13, sw, 26, 13); ctx.fill();
        ctx.strokeStyle = this.facultyIn(Library.code) ? '#34D399' : 'rgba(148,163,184,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#F8FAFC'; ctx.textAlign = 'center'; ctx.fillText(label, cx, cy + 4.5);
    },

    // The library: one tall room with a walkway from the entrance (right wall) to the librarian's desk, a second walkway
    // between the two columns of subject sections, and a floor mat in front of each section's bookshelf.
    drawLibrary(ctx, room) {
        const { x, y, width, height, inner, gate, aisle } = room;
        const T = World.wall, B = World.band;
        const inside = this.currentRoomCode === room.code;
        const restricted = this.bannedCodes.includes(room.code);
        const duty = this.facultyIn(room.code);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)'; ctx.fillRect(x + 6, y + 6, width, height);
        ctx.fillStyle = this.getPattern('lib'); ctx.fillRect(x, y, width, height);

        // carpet: entrance -> librarian's desk, and the walkway between the two columns
        const secs = room.sections, c0 = secs[0].shelf, c1 = secs[1].shelf;
        ctx.fillStyle = 'rgba(13, 148, 136, 0.16)'; ctx.strokeStyle = 'rgba(13, 148, 136, 0.35)'; ctx.lineWidth = 1.5;
        ctx.fillRect(inner.x, aisle.y, inner.w, aisle.h); ctx.strokeRect(inner.x + 0.5, aisle.y + 0.5, inner.w - 1, aisle.h - 1);
        const vx = c0.x + c0.w + 10, vw = c1.x - vx - 10;
        ctx.fillRect(vx, inner.y + 6, vw, inner.h - 12); ctx.strokeRect(vx + 0.5, inner.y + 6.5, vw - 1, inner.h - 13);

        // a floor mat in front of every bookshelf: stand on it and press E
        secs.forEach(sec => {
            const m = sec.mat, near = inside && this.nearSection === sec;
            ctx.save();
            ctx.globalAlpha = near ? 0.4 : 0.18; ctx.fillStyle = sec.color; this.rrect(ctx, m.x, m.y, m.w, m.h, 10); ctx.fill();
            ctx.globalAlpha = near ? 1 : 0.55; ctx.strokeStyle = sec.color; ctx.lineWidth = near ? 3 : 1.5; ctx.setLineDash(near ? [] : [6, 5]);
            this.rrect(ctx, m.x, m.y, m.w, m.h, 10); ctx.stroke();
            ctx.restore();
            // a little PDF sheet and the subject on the mat
            const px = m.x + 18, py = m.y + m.h / 2 - 17;
            ctx.fillStyle = '#FFFFFF'; ctx.fillRect(px, py, 26, 34);
            ctx.fillStyle = '#DC2626'; ctx.fillRect(px, py + 20, 26, 10);
            ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 7px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PDF', px + 13, py + 28);
            ctx.fillStyle = 'rgba(100,116,139,0.6)'; [6, 10, 14].forEach(dy => ctx.fillRect(px + 4, py + dy, 18, 1.5));
            ctx.textAlign = 'left'; ctx.fillStyle = '#0F172A';
            ctx.font = 'bold 15px Inter, sans-serif'; ctx.fillText(sec.code, px + 38, m.y + m.h / 2 - 4);
            let name = sec.name; ctx.font = '500 10.5px Inter, sans-serif';
            while (name.length > 4 && ctx.measureText(name).width > m.w - 70) name = name.slice(0, -2);
            if (name !== sec.name) name = name.trimEnd() + '…';
            ctx.fillStyle = 'rgba(15,23,42,0.75)'; ctx.fillText(name, px + 38, m.y + m.h / 2 + 12);
            if (near) { ctx.fillStyle = sec.color; ctx.font = 'bold 10px Inter, sans-serif'; ctx.fillText('Press E for the notes', px + 38, m.y + m.h / 2 + 27); }
        });

        // walls (the entrance is a gap in the right wall, in line with the path)
        ctx.fillStyle = restricted ? '#B91C1C' : inside ? '#8B6B3E' : '#5C4A32';
        ctx.fillRect(x, y, T, height);
        ctx.fillRect(x, y + height - T, width, T);
        ctx.fillRect(x + width - T, y, T, gate.y - y);
        ctx.fillRect(x + width - T, gate.y + gate.h, T, y + height - (gate.y + gate.h));

        // header band with the library sign
        ctx.fillStyle = restricted ? '#B91C1C' : duty ? '#0F766E' : '#7B8491';
        ctx.fillRect(x, y, width, B);
        ctx.fillStyle = '#1E293B'; this.rrect(ctx, x + 22, y + 7, width - 44, B - 14, 5); ctx.fill();
        ctx.strokeStyle = '#94A3B8'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#F1F5F9'; ctx.textAlign = 'center'; ctx.font = 'bold 14px Inter, sans-serif';
        ctx.fillText(restricted ? 'LIBRARY  ·  RESTRICTED' : `LIBRARY  ·  Notes for ${secs.length} subjects`, x + width / 2, y + B / 2 + 5);
        if (duty) { ctx.fillStyle = '#34D399'; ctx.beginPath(); ctx.arc(x + 40, y + B / 2, 5, 0, Math.PI * 2); ctx.fill(); }

        // doormat at the entrance
        ctx.fillStyle = '#0F766E'; ctx.fillRect(x + width - T - 12, gate.y + 20, 8, gate.h - 40);

        if (inside) { ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, width - 3, height - 3); }
    },

    // one subject's bookshelf, with a plate showing the subject code
    drawShelf(ctx, sec) {
        const d = sec.shelf;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(d.x + 3, d.y + d.h + 1, d.w, 6);
        ctx.fillStyle = '#5B3A1E'; ctx.fillRect(d.x, d.y + d.h - 5, d.w, 9);              // front edge
        ctx.fillStyle = '#7A4E28'; this.rrect(ctx, d.x, d.y, d.w, d.h, 3); ctx.fill();    // body
        // book spines (fixed pattern per section)
        let seed = sec.idx * 97 + 13;
        const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        const cols = [sec.color, '#F59E0B', '#E5E7EB', '#1D4ED8', '#B91C1C', '#15803D', '#7E22CE'];
        for (let bx = d.x + 6; bx < d.x + d.w - 8;) {
            const bw = 5 + Math.floor(rnd() * 5), bh = d.h - 10 - Math.floor(rnd() * 7);
            ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
            ctx.fillRect(bx, d.y + d.h - 5 - bh, bw, bh);
            bx += bw + 1;
        }
        // name plate
        ctx.font = 'bold 11px Inter, sans-serif';
        const pw = ctx.measureText(sec.code).width + 16, px = d.x + d.w / 2 - pw / 2;
        ctx.fillStyle = sec.color; this.rrect(ctx, px, d.y + d.h / 2 - 9, pw, 18, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center'; ctx.fillText(sec.code, d.x + d.w / 2, d.y + d.h / 2 + 4);
    },

    // the librarian's desk (taller than wide: it stands across the walkway at the far end)
    drawLibrarianDesk(ctx, room) {
        const d = room.teacherDesk;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(d.x + 3, d.y + d.h + 2, d.w, 6);
        ctx.fillStyle = '#134E4A'; ctx.fillRect(d.x, d.y + d.h - 4, d.w, 9);
        ctx.fillStyle = '#0F766E'; this.rrect(ctx, d.x, d.y, d.w, d.h, 4); ctx.fill();
        ['#F59E0B', '#EF4444', '#3B82F6', '#A855F7'].forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(d.x + 8, d.y + 8 + i * 7, 22, 6); }); // book stack
        ctx.fillStyle = '#E5E7EB'; this.rrect(ctx, d.x + 10, d.y + d.h - 50, 36, 24, 2); ctx.fill();                                     // monitor
        ctx.fillStyle = '#14B8A6'; ctx.fillRect(d.x + 13, d.y + d.h - 47, 30, 18);
        ctx.fillStyle = '#FDE68A'; ctx.beginPath(); ctx.arc(d.x + d.w - 14, d.y + 20, 6, 0, Math.PI * 2); ctx.fill();                   // bell
    }
});
