// Browser end-to-end test (needs: npm i -D playwright, a running server on :3000 and the demo accounts set up - see README "Testing").
const L = require('./lib');
const { execFileSync } = require('child_process');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
(async () => {
  const b = await L.launch(); const p = await L.newPage(b);
  await L.login(p, 'student', '2510012706', 'Student#2510012706');
  await sleep(1500);
  await p.screenshot({ path: require('os').tmpdir() + '/hall.png' });
  await p.evaluate(() => { CampusWorld.toggleNoticeModal(false); });
  // logout, then forgot-password via UI with an admin-issued code
  await p.click('#account-btn'); await p.click('#logout-btn'); await sleep(500);
  await p.click('[data-go=forgot]'); await p.fill('#userId', '2510012706'); await p.click('#submit-btn'); await sleep(800);
  ok(await p.isVisible('#code'), 'forgot step 2 (code field) shown');
  const out = execFileSync('node', ['scripts/admin.js', 'reset-code', 'student', '2510012706'], { cwd: require('path').join(__dirname, '../..') }).toString();
  const code = out.match(/: (\d{6})/)[1];
  await p.fill('#code', '000000'); await p.fill('#password', 'Reset#Pass2026'); await p.fill('#confirm', 'Reset#Pass2026'); await p.click('#submit-btn'); await sleep(700);
  ok(/wrong or has expired/.test(await p.textContent('#auth-feedback')), 'wrong code rejected in UI');
  await p.screenshot({ path: require('os').tmpdir() + '/forgot.png' });
  await p.fill('#code', code); await p.click('#submit-btn'); await sleep(900);
  ok(/Password updated/.test(await p.textContent('.auth-banner')), 'reset success banner on login');
  await p.fill('#password', 'Reset#Pass2026'); await p.click('#submit-btn');
  await p.waitForSelector('#world-canvas'); ok(true, 'logged in with the reset password');
  await b.close();
})().catch(e => { console.log('ERR', e); process.exit(1); });
