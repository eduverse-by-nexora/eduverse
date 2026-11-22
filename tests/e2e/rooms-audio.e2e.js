// Browser end-to-end test (see README "Testing"): 12 rooms, room-entry sound, screen share WITH sound.
const L = require('./lib');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await L.launch();
  const fac = await L.newPage(b), s1 = await L.newPage(b), s2 = await L.newPage(b);
  // count plays of audio.mp3 and give the shared screen a real audio track (a tone)
  for (const p of [s1, s2]) await p.addInitScript(() => {
    window.__plays = []; const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if ((this.src || '').endsWith('audio.mp3')) window.__plays.push(Date.now()); return orig.apply(this, arguments); };
  });
  await s1.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'); let n = 0;
      setInterval(() => { g.fillStyle = `hsl(${n++ % 360},70%,50%)`; g.fillRect(0, 0, 640, 360); }, 66);
      const ac = new AudioContext(), osc = ac.createOscillator(), dst = ac.createMediaStreamDestination(); osc.frequency.value = 440; osc.connect(dst); osc.start();
      const s = c.captureStream(30); dst.stream.getAudioTracks().forEach(t => s.addTrack(t)); return s;
    };
  });
  await L.login(fac, 'faculty', '1516', 'Teacher#1516');
  await L.login(s1, 'student', '2510011214', 'Student#2510011214');
  await L.login(s2, 'student', '2510011514', 'Student#2510011514');
  await sleep(1200);

  const info = await s1.evaluate(() => ({ n: CampusWorld.layout.rooms.filter(r => r.type === 'classroom').length, codes: CampusWorld.layout.rooms.filter(r => r.type === 'classroom').map(r => r.subject.code), top: CampusWorld.layout.rooms.filter(r => r.type === 'classroom' && !r.doorTop).length }));
  ok(info.n === 12 && info.top === 6, '12 rooms, 6 top + 6 bottom: ' + info.codes.join(' '));
  const facRoom = await fac.evaluate(() => CampusWorld.currentRoomCode);
  ok(facRoom === 'TCS-308', 'faculty 1516 starts in TCS-308: ' + facRoom);

  // enter sound: once on entering, not again while inside, again on re-entering
  ok((await s1.evaluate(() => window.__plays.length)) === 0, 'no entry sound while in the hall');
  const enter = (p, i) => p.evaluate(i => { const r = CampusWorld.layout.rooms[i]; const q = r.toWorld(r.inner.w / 2, r.inner.h - 14); CampusWorld.avatar.x = q.x; CampusWorld.avatar.y = q.y; }, i);
  await enter(s1, 0); await sleep(1500);
  ok((await s1.evaluate(() => window.__plays.length)) === 1, 'audio.mp3 played once on entering a room');
  await sleep(3000);
  ok((await s1.evaluate(() => window.__plays.length)) === 1, 'no repeat while staying inside');
  const dur = await s1.evaluate(() => CampusWorld.enterAudio.duration);
  ok(dur > 0.5 && !(await s1.evaluate(() => CampusWorld.enterAudio.loop)), 'audio.mp3 loads (' + dur.toFixed(2) + 's) and does not loop');
  // a different room (bottom row, e.g. TCS-351 = index 7)
  await s2.evaluate(() => { const r = CampusWorld.layout.rooms[7]; const q = r.toWorld(r.inner.w / 2, r.inner.h - 14); CampusWorld.avatar.x = q.x; CampusWorld.avatar.y = q.y; }); await sleep(1500);
  ok((await s2.evaluate(() => [CampusWorld.currentRoomCode, window.__plays.length])).join() === 'TCS-351,1', 'sound also plays entering another room (TCS-351)');
  await s2.screenshot({ path: require('os').tmpdir() + '/room12.png' });
  await s1.evaluate(() => { const h = CampusWorld.layout.hall; CampusWorld.avatar.x = h.x + 400; CampusWorld.avatar.y = h.y + 150; }); await sleep(800);
  await s1.screenshot({ path: require('os').tmpdir() + '/hall12.png' });
  const hallPlays = await s1.evaluate(() => window.__plays.length);
  ok(hallPlays === 1, 'leaving to the hall plays nothing new');

  // faculty (TCS-308) + s1 in TCS-308 -> screen share with sound
  await enter(s1, 0); for (let i = 0; i < 60; i++) { await sleep(250); if (!(await s1.evaluate(() => !!CampusWorld.auto))) break; }
  await sleep(300); await s1.keyboard.press('s'); await sleep(2500);
  ok(await s1.evaluate(() => CampusWorld.seatedNow()), 's1 seated in TCS-308');
  await s1.click('#room-screen-btn'); await sleep(600);
  const id1 = await s1.evaluate(() => Net.myId);
  await fac.evaluate(id => CampusWorld.classAction('grant', id), id1); await sleep(600);
  await s1.click('#room-screen-btn'); await sleep(4500);
  const hasAudio = await s1.evaluate(() => CampusWorld.screen.hasAudio);
  ok(hasAudio, 'sharer captured a stream with audio');
  const v = await fac.evaluate(async () => {
    const vid = document.getElementById('screen-video'), st = vid.srcObject;
    return { audioTracks: st ? st.getAudioTracks().length : 0, videoTracks: st ? st.getVideoTracks().length : 0, muted: vid.muted, paused: vid.paused, w: vid.videoWidth,
             pill: document.getElementById('viewer-audio').textContent.trim(), btnHidden: document.getElementById('viewer-sound').hidden };
  });
  ok(v.audioTracks === 1 && v.videoTracks === 1 && !v.muted && !v.paused && v.w > 0, 'faculty has audio+video tracks, unmuted, playing ' + JSON.stringify(v));
  const rs = await fac.evaluate(async () => { const out = []; for (const x of RTC.subs.values()) { if (x.kind !== 'screen') continue; const st = await x.pc.getStats(); st.forEach(r => { if (r.type === 'inbound-rtp') out.push({ kind: r.kind, bytes: r.bytesReceived, energy: r.totalAudioEnergy || 0, frames: r.framesDecoded || 0 }); }); } return out; });
  const au = rs.find(r => r.kind === 'audio'), vi = rs.find(r => r.kind === 'video');
  ok(au && au.bytes > 3000 && au.energy > 0, 'faculty is RECEIVING real shared audio (bytes/energy): ' + JSON.stringify(au));
  ok(vi && vi.frames > 20, 'faculty is DECODING shared video frames: ' + JSON.stringify(vi));
  await fac.screenshot({ path: require('os').tmpdir() + '/fac-share-audio.png' });
  // student 2 (not in room) -> make s2 join TCS-308 to check a student viewer
  await s2.evaluate(() => { const r = CampusWorld.layout.rooms[0]; const q = r.toWorld(r.inner.w / 2, r.inner.h - 14); CampusWorld.avatar.x = q.x; CampusWorld.avatar.y = q.y; }); await sleep(4500);
  const v2 = await s2.evaluate(() => { const vid = document.getElementById('screen-video'); return { audio: vid.srcObject ? vid.srcObject.getAudioTracks().length : 0, muted: vid.muted, pill: document.getElementById('viewer-audio').textContent.trim() }; });
  ok(v2.audio === 1 && !v2.muted && true, 'late-joining student attached sound ' + JSON.stringify(v2));
  const rs2 = await s2.evaluate(async () => { const out = []; for (const x of RTC.subs.values()) { if (x.kind !== 'screen') continue; const st = await x.pc.getStats(); st.forEach(r => { if (r.type === 'inbound-rtp') out.push({ kind: r.kind, bytes: r.bytesReceived, energy: r.totalAudioEnergy || 0, frames: r.framesDecoded || 0 }); }); } return out; });
  const au2 = rs2.find(r => r.kind === 'audio');
  ok(au2 && au2.bytes > 3000 && au2.energy > 0, 'late-joining student is RECEIVING real shared audio: ' + JSON.stringify(au2));
  // classroom "mute speakers" applies to shared sound
  await s2.evaluate(() => RTC.setDeafened(true));
  ok(await s2.evaluate(() => document.getElementById('screen-video').muted), 'mute speakers also mutes the shared sound');
  await b.close();
})().catch(e => { console.log('ERR', e); process.exit(1); });
