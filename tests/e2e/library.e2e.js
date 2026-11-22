// Browser end-to-end test (see README "Testing"): the library (one room left of the hall, reached by a path),
// its subject sections and PDF notes panel, the librarian dashboard and the quiet-zone rules.
const L = require('./lib');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const tp = (p, x, y) => p.evaluate(([x, y]) => { CampusWorld.avatar.x = x; CampusWorld.avatar.y = y; }, [x, y]);
(async () => {
  const b = await L.launch();
  const lib = await L.newPage(b, 1366, 800), s1 = await L.newPage(b, 1366, 800), s2 = await L.newPage(b, 1366, 800);
  // librarian login through the UI (third tab)
  await lib.goto('http://localhost:3000/'); await lib.click('[data-role=librarian]');
  ok((await lib.textContent('#id-label')).includes('Librarian ID'), 'login page has a Librarian tab');
  await lib.fill('#userId', 'LIB001'); await lib.fill('#password', 'Library@123'); await lib.click('#submit-btn');
  await lib.waitForSelector('#world-canvas', { timeout: 8000 });
  await L.login(s1, 'student', '2510011214', 'Student#2510011214');
  await L.login(s2, 'student', '2510011514', 'Student#2510011514');
  await sleep(1500);

  // --- map: 12 classrooms + ONE library (no seats, one section per subject) and the path to it
  const info = await s1.evaluate(() => { const Lo = CampusWorld.layout; return { cls: Lo.rooms.filter(r => r.type === 'classroom').length, libs: Lo.rooms.filter(r => r.type === 'library').map(r => r.code + ':' + r.seatCount + ':' + r.sections.length), hall: Lo.hall }; });
  ok(info.cls === 12 && info.libs.join() === 'LIBRARY:0:12', '12 classrooms unchanged + one library with 0 seats and 12 subject sections: ' + info.libs.join());
  const lr = await lib.evaluate(() => ({ role: State.user.role, room: CampusWorld.currentRoomCode, dock: document.getElementById('dock').classList.contains('visible') }));
  ok(lr.role === 'librarian' && lr.room === 'LIBRARY' && lr.dock, 'librarian starts at the desk in the library with the library dashboard');

  // --- connectivity: BFS on a 10px grid with the real collision test
  const reach = await s1.evaluate(() => {
    const Lo = CampusWorld.getLayout(), r = CampusWorld.avatar.rad, g = 10, cols = Math.ceil(World.width / g), rows = Math.ceil(World.height / g);
    const start = [Math.round((Lo.hall.x + Lo.hall.width / 2 - 200) / g), Math.round((Lo.hall.y + Lo.hall.height * 0.8) / g)];
    const seen = new Set([start.join()]), q = [start];
    while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(k)) continue; if (!CampusWorld.canStand(Lo, nx * g, ny * g, r)) continue; seen.add(k); q.push([nx, ny]); } }
    const has = (px, py) => { for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (seen.has((Math.round(px / g) + dx) + ',' + (Math.round(py / g) + dy))) return true; return false; };
    const miss = [];
    Lo.library.sections.forEach(s => { if (!has(s.mat.x + s.mat.w / 2, s.mat.y + s.mat.h / 2)) miss.push(s.code + ' section'); });
    Lo.rooms.filter(x => x.type === 'classroom').forEach(x => { if (!has(x.seats[0].sx, x.seats[0].sy)) miss.push(x.code + ' seat'); });
    return miss;
  });
  ok(!reach.length, 'from the hall a student can reach all 12 library sections and a seat in all 12 classrooms ' + reach.join(','));

  // --- walk from the hall's left end along the path into the library
  await tp(s1, info.hall.x + 60, info.hall.y + info.hall.height / 2); await sleep(300);
  await s1.keyboard.down('a');
  for (let i = 0; i < 40; i++) { await sleep(150); if (await s1.evaluate(() => CampusWorld.currentRoomCode) === 'LIBRARY') break; }
  await s1.keyboard.up('a'); await sleep(900);
  const st = await s1.evaluate(() => ({ room: CampusWorld.currentRoomCode, auto: !!CampusWorld.auto, dock: document.getElementById('dock').classList.contains('visible'), cards: document.querySelectorAll('#dock-panel .note-card').length, links: document.querySelectorAll('#dock-panel a[download]').length }));
  ok(st.room === 'LIBRARY', 'walking left along the path enters the library');
  ok(!st.auto, 'no auto-walk to a seat in the library');
  ok(st.dock && st.cards === 12 && st.links >= 12, `notes panel opens on the right on entry: ${st.cards} subject cards, ${st.links} download links`);
  const files = await s1.evaluate(() => Promise.all([...document.querySelectorAll('#dock-panel a[download]')].map(async a => { const r = await fetch(a.href); const bytes = new Uint8Array(await r.arrayBuffer()); return r.status === 200 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-'; })));
  ok(files.every(Boolean), 'every listed notes file is served as a PDF');
  const [dl] = await Promise.all([s1.waitForEvent('download'), s1.click('#dock-panel [data-subject="TCS-302"] a[download]')]);
  ok(/^TCS-302 - .+\.pdf$/.test(dl.suggestedFilename()), 'Download saves the PDF: ' + dl.suggestedFilename());

  // --- stand at a section, press E
  const mat = await s1.evaluate(() => { const s = CampusWorld.layout.library.sections.find(x => x.code === 'TCS-340'); return [s.mat.x + s.mat.w / 2, s.mat.y + s.mat.h / 2]; });
  await tp(s1, mat[0], mat[1]); await sleep(400);
  const pr = await s1.evaluate(() => ({ vis: document.getElementById('interaction-overlay').classList.contains('visible'), t: document.getElementById('interaction-title').textContent }));
  ok(pr.vis && pr.t.includes('TCS-340'), 'standing at a section shows its prompt: ' + pr.t);
  await s1.keyboard.press('e'); await sleep(300);
  ok(await s1.evaluate(() => document.querySelector('[data-subject="TCS-340"]').classList.contains('flash')), "E highlights that subject's notes in the panel");
  await s1.screenshot({ path: require('os').tmpdir() + '/library-student.png' });

  // --- notes panel can be hidden and brought back
  await s1.click('[data-act="notes-hide"]'); await sleep(300);
  const hidden = await s1.evaluate(() => !document.getElementById('dock').classList.contains('visible'));
  await s1.click('#notes-btn'); await sleep(300);
  ok(hidden && await s1.evaluate(() => document.getElementById('dock').classList.contains('visible')), 'the notes panel closes with x and reopens with the Notes button');

  // --- quiet zone rules enforced by the server; no seats
  const q = await s1.evaluate(async () => [await Net.request('mic:set', { on: true }), await Net.request('screen:request'), await Net.request('screen:start'), await Net.request('seat:sit', { seat: 0 })]);
  ok(q.slice(0, 3).every(r => !r.ok && r.code === 'QUIET_ZONE') && !q[3].ok, 'quiet zone: mic / screen refused, no seat to sit on: ' + q.map(r => r.error).join(' | '));
  const btns = await s1.evaluate(() => ({ seat: document.querySelector('[data-wrap=seat-btn]').hidden, mic: document.querySelector('[data-wrap=room-mic-btn]').hidden, scr: document.querySelector('[data-wrap=room-screen-btn]').hidden, notes: document.querySelector('[data-wrap=notes-btn]').hidden, hand: document.getElementById('hand-btn').textContent.trim() }));
  ok(btns.seat && btns.mic && btns.scr && !btns.notes && /Ask librarian/.test(btns.hand), 'room bar: no Sit / mic / screen; shows Notes and "Ask librarian": ' + JSON.stringify(btns));

  // --- ask the librarian (no seat needed) -> librarian sees who and at which section
  await s1.keyboard.press('h'); await sleep(900);
  ok(await s1.evaluate(() => CampusWorld.handUp), 'H = Ask librarian works while standing in the library');
  const lp = await lib.evaluate(() => { const t = document.getElementById('dock-panel').innerText; return { need: /NEED HELP/i.test(t), at: /TCS-340/.test(t), stats: [...document.querySelectorAll('.stat')].map(s => s.innerText.replace(/\n/g, ':')).join(' ') }; });
  ok(lp.need && lp.at, 'librarian sees who needs help and at which section: ' + lp.stats);
  const toast = await lib.evaluate(() => document.getElementById('toasts') ? document.getElementById('toasts').innerText : '');
  ok(/needs help/.test(toast), 'librarian got a "needs help" notification');
  await lib.evaluate(() => Dock.act('tab', 'notes')); await sleep(400);
  ok(await lib.evaluate(() => document.querySelectorAll('#dock-panel .note-card').length) === 12, 'librarian Notes tab lists the same 12 subjects');
  await lib.screenshot({ path: require('os').tmpdir() + '/library-librarian.png' });

  // --- librarian can mark help given and remove a student (ban from the library)
  const id1 = await s1.evaluate(() => Net.myId);
  await lib.evaluate(id => CampusWorld.classAction('lower', id), id1); await sleep(500);
  ok(!(await s1.evaluate(() => CampusWorld.handUp)), 'librarian can mark help given (hand lowered)');
  await lib.evaluate(id => CampusWorld.classAction('remove', id), id1); await sleep(900);
  const rem = await s1.evaluate(() => ({ room: CampusWorld.currentRoomCode, banned: CampusWorld.bannedCodes, dock: document.getElementById('dock').classList.contains('visible') }));
  ok(rem.room === null && rem.banned.includes('LIBRARY') && !rem.dock, 'librarian can remove a student from the library ' + JSON.stringify(rem));

  // --- librarian stays in the library and on its path; no classroom powers
  const lreach = await lib.evaluate(() => { const Lo = CampusWorld.getLayout(); return { hall: CampusWorld.canStand(Lo, Lo.hall.x + 800, Lo.hall.y + 150, 13), room: CampusWorld.canStand(Lo, Lo.rooms[0].inner.x + 100, Lo.rooms[0].inner.y + 200, 13), path: CampusWorld.canStand(Lo, Lo.libPath.x + Lo.libPath.w / 2, Lo.libPath.y + Lo.libPath.h / 2, 13) }; });
  ok(!lreach.hall && !lreach.room && lreach.path, 'librarian is limited to the library and the path to it ' + JSON.stringify(lreach));
  const lm = await lib.evaluate(async () => [await Net.request('class:mute', { id: 'x', muted: true }), await Net.request('screen:start')]);
  ok(lm.every(r => !r.ok), 'librarian has no classroom powers (mute / screen)');

  // --- students cannot do librarian things; classrooms unchanged
  const sc = await s2.evaluate(async id => [await Net.request('class:remove', { id }), await Net.request('class:lower-hand', { id })], id1);
  ok(sc.every(r => !r.ok), 'a student cannot remove / lower hands');
  await s2.evaluate(() => { const r = CampusWorld.roomObj('TCS-308'); const p = r.toWorld(r.lw / 2, r.ld - 30); CampusWorld.avatar.x = p.x; CampusWorld.avatar.y = p.y; }); await sleep(600);
  const c = await s2.evaluate(() => ({ room: CampusWorld.currentRoomCode, auto: !!CampusWorld.auto, notes: document.querySelector('[data-wrap=notes-btn]').hidden, dock: document.getElementById('dock').classList.contains('visible') }));
  ok(c.room === 'TCS-308' && c.auto && c.notes && !c.dock, 'classrooms unchanged: auto-walk to a seat, no notes panel');
  await b.close();
})().catch(e => { console.log('ERR', e); process.exit(1); });
