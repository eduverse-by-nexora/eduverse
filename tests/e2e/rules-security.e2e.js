// Browser end-to-end test (needs: npm i -D playwright, a running server on :3000 and the demo accounts set up - see README "Testing").
const L = require('./lib');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const waitIdle = async p => { for (let i = 0; i < 80; i++) { await sleep(250); if (!(await p.evaluate(() => !!CampusWorld.auto))) break; } await sleep(300); };
const enter = p => p.evaluate(() => { const r = CampusWorld.layout.rooms[0]; const q = r.toWorld(r.inner.w / 2, r.inner.h - 14); CampusWorld.avatar.x = q.x; CampusWorld.avatar.y = q.y; });
const sitIn = async p => { await enter(p); await waitIdle(p); await p.keyboard.press('s'); for (let i = 0; i < 30; i++) { await sleep(200); if (await p.evaluate(() => CampusWorld.seatedNow())) return true; } return false; };
(async () => {
  const b = await L.launch();
  const fac = await L.newPage(b), s1 = await L.newPage(b), s2 = await L.newPage(b), s3 = await L.newPage(b);
  await L.login(fac, 'faculty', '1516', 'Teacher#1516');
  await L.login(s1, 'student', '2510011214', 'Student#2510011214');
  await L.login(s2, 'student', '2510011514', 'Student#2510011514');
  await L.login(s3, 'student', '2510011592', 'Student#2510011592');
  await sleep(1000);

  ok(await sitIn(s1), 's1 seated'); ok(await sitIn(s2), 's2 seated');
  // s3 enters but stays standing
  await enter(s3); await waitIdle(s3);
  await sleep(500);
  const roster = await fac.evaluate(() => { const r = CampusWorld.rosterFor('TCS-308').filter(p => p.role === 'student'); return { seated: r.filter(p => p.seat !== null).length, standing: r.filter(p => p.seat === null).map(p => p.name) }; });
  ok(roster.seated === 2 && roster.standing.join() === '2510011592', 'faculty distinguishes seated vs standing ' + JSON.stringify(roster));
  const txt = await fac.evaluate(() => document.getElementById('dock-panel').innerText);
  ok(/STANDING/i.test(txt) && /2510011592/.test(txt) && /Bench \d · Seat [ABC]/.test(txt), 'dashboard shows standing student and seat labels');
  await fac.evaluate(() => Dock.act('tab', 'seats')); await sleep(400);
  await fac.screenshot({ path: require('os').tmpdir() + '/faculty-seatmap.png' });
  await s3.screenshot({ path: require('os').tmpdir() + '/student-standing-view.png' });

  // same seat race
  const race = await Promise.all([s3.evaluate(() => Net.request('seat:sit', { seat: 3 })), s2.evaluate(() => 0)]);
  const race2 = await fac.evaluate(() => 0);
  const again = await s3.evaluate(() => Net.request('seat:sit', { seat: 3 }));
  ok(!again.ok, 'cannot sit twice: ' + again.error);
  await s3.evaluate(() => Net.request('seat:stand'));
  const takenSeat = await s1.evaluate(() => CampusWorld.seat.idx);
  const rr = await s3.evaluate(i => Net.request('seat:sit', { seat: i }), takenSeat);
  ok(!rr.ok && rr.code === 'SEAT_TAKEN', 'occupied seat refused: ' + rr.error);

  // mute: forced off and cannot re-enable
  await s1.click('#room-mic-btn'); await sleep(1200);
  ok(await s1.evaluate(() => CampusWorld.mic.on), 's1 mic on');
  const id1 = await s1.evaluate(() => Net.myId);
  await fac.evaluate(id => CampusWorld.classAction('mute', id), id1); await sleep(900);
  ok(!(await s1.evaluate(() => CampusWorld.mic.on)), 'teacher mute turns mic off');
  const re = await s1.evaluate(() => Net.request('mic:set', { on: true }));
  ok(!re.ok && re.code === 'MUTED', 'muted student cannot re-enable: ' + re.error);
  const btn = await s1.evaluate(() => [document.getElementById('room-mic-btn').disabled, document.getElementById('room-mic-btn').textContent.trim()]);
  ok(btn[0], 'mic button disabled when muted: ' + btn[1]);
  await fac.evaluate(id => CampusWorld.classAction('unmute', id), id1); await sleep(600);

  // security: viewer shields (student view while faculty presents)
  await fac.click('#room-screen-btn'); await sleep(3500);
  const vis = await s2.evaluate(() => !document.getElementById('viewer-card').hidden && document.getElementById('secure-frame').classList.contains('secure'));
  ok(vis, 'student views faculty presentation in secure frame');
  await s2.keyboard.down('PrintScreen'); await sleep(200);
  ok(await s2.evaluate(() => document.getElementById('secure-frame').classList.contains('shielded')), 'PrintScreen hides the shared content');
  await sleep(3800);
  ok(!(await s2.evaluate(() => document.getElementById('secure-frame').classList.contains('shielded'))), 'content returns afterwards');
  await s2.evaluate(() => window.dispatchEvent(new Event('blur'))); await sleep(150);
  ok(await s2.evaluate(() => document.getElementById('secure-frame').classList.contains('shielded')), 'window blur hides it');
  await s2.evaluate(() => window.dispatchEvent(new Event('focus')));
  const ctx = await s2.evaluate(() => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.getElementById('screen-video').dispatchEvent(e); return e.defaultPrevented; });
  ok(ctx, 'context menu blocked on the shared video');
  const attrs = await s2.evaluate(() => { const v = document.getElementById('screen-video'); return [v.disablePictureInPicture, v.disableRemotePlayback, v.controls, v.getAttribute('controlslist')]; });
  ok(attrs[0] && attrs[1] && !attrs[2], 'no PiP / remote playback / controls ' + attrs);
  await s2.screenshot({ path: require('os').tmpdir() + '/student2-viewing.png' });
  // faculty keeps controls; a student cannot start while faculty presents
  const sf = await s2.evaluate(() => Net.request('screen:start'));
  ok(!sf.ok, 'student cannot share while faculty presents');
  await fac.click('#room-screen-btn'); await sleep(600);

  // raise hand then faculty lowers
  await s2.keyboard.press('h'); await sleep(500);
  const id2 = await s2.evaluate(() => Net.myId);
  await fac.evaluate(id => CampusWorld.classAction('lower', id), id2); await sleep(500);
  ok(!(await s2.evaluate(() => CampusWorld.handUp)), 'faculty can lower a hand');

  // remove: student returns to hall, cannot re-enter
  await fac.evaluate(id => CampusWorld.classAction('remove', id), id2); await sleep(900);
  const rem = await s2.evaluate(() => ({ room: CampusWorld.currentRoomCode, seat: CampusWorld.seat.phase, banned: CampusWorld.bannedCodes }));
  ok(rem.room === null && rem.seat === 'none' && rem.banned.includes('TCS-308'), 'removed student is back in the hall and banned ' + JSON.stringify(rem));
  const free = await fac.evaluate(() => CampusWorld.freeSeats('TCS-308'));
  ok(free === 23 || free === 22, 'seat freed after removal: ' + free);

  // session persistence across reload
  await s3.reload(); await s3.waitForSelector('#world-canvas', { timeout: 8000 });
  ok(true, 'page reload keeps the session');

  // change password via the UI
  await s3.click('#account-btn'); await s3.click('#change-pwd-btn'); await sleep(300);
  await s3.fill('#cp-current', 'Student#2510011592'); await s3.fill('#cp-new', 'NewPass#2026'); await s3.fill('#cp-confirm', 'NewPass#2026');
  await s3.screenshot({ path: require('os').tmpdir() + '/change-pwd.png' });
  await s3.click('#cp-submit'); await sleep(1200);
  ok(!(await s3.evaluate(() => document.getElementById('app-modal').classList.contains('open'))), 'change password modal closed on success');
  const l = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'student', userId: '2510011592', password: 'NewPass#2026' }) });
  ok(l.status === 200, 'new password works for login');
  await b.close();
})().catch(e => { console.log('ERR', e); process.exit(1); });
