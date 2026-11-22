// Browser end-to-end test (needs: npm i -D playwright, a running server on :3000 and the demo accounts set up - see README "Testing").
const L = require('./lib');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await L.launch();
  const fac = await L.newPage(b), s1 = await L.newPage(b), s2 = await L.newPage(b);
  await L.login(fac, 'faculty', '1516', 'Teacher#1516');
  await L.login(s1, 'student', '2510011214', 'Student#2510011214');
  await L.login(s2, 'student', '2510011514', 'Student#2510011514');
  await sleep(1200);

  // --- standing student in the hall: mic/screen bars hidden; enter room 1 by teleporting just inside the door
  const enter = async (p) => p.evaluate(() => { const r = CampusWorld.layout.rooms[0]; const q = r.toWorld(r.inner.w / 2, r.inner.h - 14); CampusWorld.avatar.x = q.x; CampusWorld.avatar.y = q.y; });
  await enter(s1); await sleep(300);
  const info = await s1.evaluate(() => ({ room: CampusWorld.currentRoomCode, auto: !!CampusWorld.auto, seatIdx: CampusWorld.auto && CampusWorld.auto.seatIdx }));
  ok(info.room === 'TCS-308' && info.auto, 'student entering room starts auto-walk ' + JSON.stringify(info));
  const mic0 = await s1.evaluate(() => [document.getElementById('room-mic-btn').disabled, document.getElementById('room-screen-btn').disabled, document.getElementById('hand-btn').disabled]);
  ok(mic0.every(Boolean), 'mic, screen, hand DISABLED while standing ' + mic0);
  // standing student tries to cheat: ask server directly
  const cheat = await s1.evaluate(async () => [await Net.request('mic:set', { on: true }), await Net.request('screen:request'), await Net.request('hand:set', { raised: true }), await Net.request('screen:start')]);
  ok(cheat.every(r => !r.ok), 'server refuses mic/screen/hand for standing student: ' + cheat.map(r => r.error).join(' | '));

  // wait for the auto walk to arrive
  for (let i = 0; i < 60; i++) { await sleep(250); if (!(await s1.evaluate(() => !!CampusWorld.auto))) break; }
  await sleep(300);
  const near = await s1.evaluate(() => CampusWorld.nearSeat && CampusWorld.nearSeat.label);
  ok(!!near, 'auto-walk arrived next to a free seat: ' + near);
  await s1.screenshot({ path: require('os').tmpdir() + '/room-standing.png' });

  // --- sit with S
  await s1.keyboard.press('s'); await sleep(2500);
  let st = await s1.evaluate(() => ({ phase: CampusWorld.seat.phase, idx: CampusWorld.seat.idx }));
  ok(st.phase === 'seated', 'S sits down: ' + JSON.stringify(st));
  const mic1 = await s1.evaluate(() => [document.getElementById('room-mic-btn').disabled, document.getElementById('room-screen-btn').disabled, document.getElementById('hand-btn').disabled]);
  ok(mic1.every(v => v === false), 'mic, screen, hand ENABLED once seated ' + mic1);

  // second student takes a seat too
  await enter(s2); for (let i = 0; i < 60; i++) { await sleep(250); if (!(await s2.evaluate(() => !!CampusWorld.auto))) break; }
  await sleep(300); await s2.keyboard.press('s'); await sleep(2500);
  const idx2 = await s2.evaluate(() => CampusWorld.seat.idx);
  ok(idx2 !== null && idx2 !== st.idx, 'second student got a different seat ' + st.idx + ' vs ' + idx2);

  // --- raise hand
  await s1.keyboard.press('h'); await sleep(600);
  const hands = await fac.evaluate(() => Object.values(CampusWorld.remote).filter(p => p.hand).map(p => p.name));
  ok(hands.includes('2510011214'), 'faculty sees raised hand: ' + hands);
  await sleep(300);
  await fac.screenshot({ path: require('os').tmpdir() + '/faculty-hand.png' });

  // --- student mic -> faculty hears
  await s1.click('#room-mic-btn'); await sleep(3500);
  const heard = await fac.evaluate(async () => {
    const subs = [...RTC.subs.values()].filter(s => s.kind === 'mic');
    const out = [];
    for (const s of subs) { const stats = await s.pc.getStats(); let bytes = 0; stats.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') bytes = r.bytesReceived; }); out.push({ state: s.pc.connectionState, bytes, playing: s.el && !s.el.paused }); }
    return out;
  });
  ok(heard.length >= 1 && heard.some(h => h.state === 'connected' && h.bytes > 1000 && h.playing), 'faculty receives student audio ' + JSON.stringify(heard));
  const heard2 = await s2.evaluate(async () => [...RTC.subs.values()].filter(s => s.kind === 'mic').map(s => s.pc.connectionState));
  ok(heard2.includes('connected'), 'seated classmate also hears student: ' + heard2);

  // --- faculty mic -> students hear
  await fac.click('#room-mic-btn'); await sleep(3500);
  const h3 = await s1.evaluate(async () => { const o = []; for (const s of RTC.subs.values()) { if (s.kind !== 'mic') continue; const st = await s.pc.getStats(); let b = 0; st.forEach(r => { if (r.type === 'inbound-rtp') b = r.bytesReceived; }); o.push({ state: s.pc.connectionState, b }); } return o; });
  ok(h3.some(x => x.state === 'connected' && x.b > 1000), 'student hears faculty ' + JSON.stringify(h3));

  // --- screen share: default not allowed
  const denied = await s1.evaluate(() => Net.request('screen:start'));
  ok(!denied.ok, 'student cannot start sharing without permission: ' + denied.error);
  await s1.click('#room-screen-btn'); await sleep(500);   // request
  const reqs = await fac.evaluate(() => CampusWorld.shareInfo().requests.length);
  ok(reqs === 1, 'faculty sees screen request');
  await fac.evaluate(() => Dock.act('tab', 'screen')); await sleep(300);
  await fac.screenshot({ path: require('os').tmpdir() + '/faculty-screen-tab.png' });
  const id1 = await s1.evaluate(() => Net.myId);
  await fac.evaluate(id => CampusWorld.classAction('grant', id), id1); await sleep(500);
  const lbl = await s1.evaluate(() => document.getElementById('room-screen-btn').textContent);
  ok(/Start sharing/.test(lbl), 'granted student sees "Start sharing": ' + lbl);
  // second student cannot start (no permit)
  const s2try = await s2.evaluate(() => Net.request('screen:start'));
  ok(!s2try.ok, 'other student cannot start: ' + s2try.error);
  await s1.click('#room-screen-btn'); await sleep(3500);
  const vid = async p => p.evaluate(() => { const v = document.getElementById('screen-video'); return { w: v.videoWidth, h: v.videoHeight, playing: !v.paused && v.readyState > 2, hidden: document.getElementById('viewer-card').hidden, secure: document.getElementById('secure-frame').classList.contains('secure') }; });
  const vf = await vid(fac), v2 = await vid(s2);
  ok(vf.w > 0 && !vf.hidden, 'faculty sees shared screen ' + JSON.stringify(vf));
  ok(v2.w > 0 && !v2.hidden && v2.secure, 'other student sees it, view-only/secure ' + JSON.stringify(v2));
  const s2second = await s2.evaluate(() => Net.request('screen:request'));
  const s2start = await s2.evaluate(() => Net.request('screen:start'));
  ok(!s2start.ok, 'second share refused while active: ' + s2start.error);
  await fac.screenshot({ path: require('os').tmpdir() + '/faculty-sharing.png' });
  await s2.screenshot({ path: require('os').tmpdir() + '/student2-viewing.png' });

  // faculty stops
  await fac.evaluate(() => CampusWorld.classAction('revoke', '')); await sleep(800);
  const after = await vid(s2);
  ok(after.hidden, 'share ended for viewers after faculty stop');
  const sharingLocal = await s1.evaluate(() => CampusWorld.screen.on);
  ok(!sharingLocal, 'sharer stopped locally');

  // --- stand with Ctrl: mic off
  await s1.keyboard.press('Control'); await sleep(2500);
  const stood = await s1.evaluate(() => ({ phase: CampusWorld.seat.phase, mic: CampusWorld.mic.on }));
  ok(stood.phase === 'none' && !stood.mic, 'Ctrl stands up and mic turns off ' + JSON.stringify(stood));
  const sv = await fac.evaluate(() => { const p = Object.values(CampusWorld.remote).find(p => p.name === '2510011214'); return { seat: p.seat, mic: p.mic, hand: p.hand }; });
  ok(sv.seat === null && !sv.mic && !sv.hand, 'server state cleared on stand ' + JSON.stringify(sv));
  await fac.screenshot({ path: require('os').tmpdir() + '/faculty-final.png' });
  await b.close();
})().catch(e => { console.log('ERR', e); process.exit(1); });
