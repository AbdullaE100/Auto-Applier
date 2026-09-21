/* Renders the extension icons from the logo mark. Run: node scripts/make-icons.js */
const { chromium } = require('playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const p = await b.newPage();
  for (const size of [128, 48, 32, 16]) {
    const r = Math.round(size * 0.22), inner = Math.round(size * (size <= 16 ? 0.78 : 0.62)), sw = size <= 16 ? 3 : size <= 32 ? 2.8 : 2.4;
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent"><div id="i" style="width:${size}px;height:${size}px;border-radius:${r}px;background:#16181d;display:grid;place-items:center;color:#fff">
      <svg width="${inner}" height="${inner}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h8"/><path d="M5 12h13"/><path d="M5 17h5"/><path d="m14.5 8.5 3.5 3.5-3.5 3.5"/></svg></div></body></html>`);
    await p.locator('#i').screenshot({ path: `extension/icons/icon${size}.png`, omitBackground: true });
  }
  await b.close();
})();
