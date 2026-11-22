const { chromium } = require('playwright');
exports.launch = () => chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
exports.newPage = async (browser, w = 1366, h = 800) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE.ERR', m.text().slice(0, 200)); });
  // deterministic screen capture source for tests (canvas stream)
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const g = c.getContext('2d'); let n = 0;
      setInterval(() => { g.fillStyle = `hsl(${n++ % 360},70%,50%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('SHARED SCREEN ' + n, 40, 180); }, 100);
      return c.captureStream(15);
    };
  });
  return page;
};
exports.login = async (page, role, id, pw) => {
  await page.goto('http://localhost:3000/');
  if (role === 'faculty') await page.click('[data-role=faculty]');
  await page.fill('#userId', id);
  await page.fill('#password', pw);
  await page.click('#submit-btn');
  await page.waitForSelector('#world-canvas', { timeout: 8000 });
};
