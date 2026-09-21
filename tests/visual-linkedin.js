/* Visual check of the injected LinkedIn UI (bar, HUD, ask pop-up). Screenshots to tests/screenshots/. */
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');
const EXT = path.join(__dirname, '..', 'extension');
const SHOTS = path.join(__dirname, 'screenshots');
const scripts = ['shared/countries.js', 'shared/questions.js', 'shared/answer-engine.js', 'shared/settings.js', 'content/autofill-core.js', 'content/bridge.js', 'content/linkedin.js'];

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    await page.route('https://www.linkedin.com/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>${fs.readFileSync(path.join(EXT, 'content/content.css'), 'utf8')} body{font-family:sans-serif;background:${scheme === 'dark' ? '#1b1f23' : '#f4f2ee'};margin:0}</style></head><body>
      <div style="display:flex;gap:16px;padding:24px"><ul style="width:380px;background:#fff;list-style:none;padding:0;margin:0">${[1, 2, 3].map((i) => `<li data-occludable-job-id="${i}" style="padding:16px;border-bottom:1px solid #ddd"><a class="job-card-list__title--link" href="/jobs/view/${i}">Product Analyst ${i}</a></li>`).join('')}</ul>
      <div class="jobs-search__job-details--container" style="flex:1;background:#fff;padding:24px"><h1 class="job-details-jobs-unified-top-card__job-title">Product Analyst</h1><div class="job-details-jobs-unified-top-card__company-name">Careem</div></div></div></body></html>` }));
    await page.addInitScript(() => {
      const profile = { firstName: 'Abdulla', lastName: 'Ehsan', email: 'a@x.com', country: 'AE', settings: { mode: 'auto', maxPerRun: 10, askTimeoutSec: 60 } };
      window.chrome = { runtime: { id: 't', sendMessage: async ({ type }) => type === 'GET_CONTEXT'
        ? { ok: true, data: { signedIn: true, onboarded: true, profile, usage: { remaining: 26 }, savedAnswers: {} } } : { ok: true, data: { ok: true } } },
        storage: { onChanged: { addListener() {} }, local: { get: async () => ({}), set() {} } } };
    });
    await page.goto('https://www.linkedin.com/jobs/search/?currentJobId=1');
    for (const s of scripts) await page.addScriptTag({ content: fs.readFileSync(path.join(EXT, s), 'utf8') });
    await page.waitForSelector('#jf-bar-start:not([hidden])');
    await page.screenshot({ path: `${SHOTS}/li-bar-${scheme}.png`, clip: { x: 240, y: 700, width: 800, height: 100 } });
    await page.evaluate(() => { const L = window.JobFlowLinkedIn; L.setRunning(true); L.setBar('Careem: filling application…'); L.session.applied = 3; L.renderCounts(); });
    await page.screenshot({ path: `${SHOTS}/li-bar-running-${scheme}.png`, clip: { x: 240, y: 700, width: 800, height: 100 } });
    await page.evaluate(() => {
      const d = document;
      const mk = (html) => { const g = d.createElement('div'); g.className = 'fb-dash-form-element'; g.innerHTML = html; return g; };
      const f1 = mk('<label for="q1">What is your expected monthly salary in AED?</label><input id="q1" type="text">');
      const f2 = mk('<fieldset><legend>Which BI tools have you used in production?</legend><input type="checkbox" id="c1"><label for="c1">Metabase</label><input type="checkbox" id="c2"><label for="c2">Tableau</label><input type="checkbox" id="c3"><label for="c3">Power BI</label></fieldset>');
      const f3 = mk('<fieldset><legend>Are you comfortable working from the Dubai office 4 days a week?</legend><input type="radio" name="r" id="r1"><label for="r1">Yes</label><input type="radio" name="r" id="r2"><label for="r2">No</label></fieldset>');
      d.body.append(f1, f2, f3);
      const L = window.JobFlowLinkedIn;
      const fields = L.collectFields(d.body);
      fields[0].suggestion = 'I built self-serve analytics in SQL and Metabase used by 100+ Aeroporti di Roma members, and modelled product and revenue data for BNESIM campaigns. I have not used Snowflake or Databricks in production.';
      fields[1].suggestion = 'Metabase';
      L.askUser(fields, { jobTitle: 'Product Analyst', company: 'Careem' }, { askTimeoutSec: 60, rememberAnswers: true });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/li-ask-${scheme}.png` });
    await page.close();
  }
  await browser.close();
  console.log('visual ok');
})().catch((e) => { console.error(e); process.exit(1); });
