/* End-to-end: landing page, login and dashboard against the mock Supabase. */
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createMock } = require('./mock-supabase');

const WEB = path.join(__dirname, '..', 'web');
const SHOTS = path.join(__dirname, 'screenshots');
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function staticServer(port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    if (p === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end("window.JOBFLOW_CONFIG = { supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon', chromeStoreUrl: 'https://chromewebstore.google.com', supportEmail: 'support@jobflow.ai' };");
    }
    const file = path.join(WEB, p);
    if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const mock = createMock();
  await mock.listen();
  // seed data as if the user had used the extension
  mock.db.profiles.push({ id: mock.user.id, email: 'abdulla@example.com', first_name: 'Abdulla', last_name: 'Ehsan', phone: '551180792', phone_country_code: '971', city: 'Dubai', country: 'AE', current_title: 'AI Engineer', current_company: 'BNESIM', years_experience: 2, skills: ['Python', 'LangChain'], answers: {}, preferences: { roles: ['AI Engineer'], salaryAmount: 20000, salaryCurrency: 'AED', salaryPeriod: 'month' }, settings: { mode: 'review', dailyLimit: 25, unknownQuestion: 'ai' }, onboarding_completed: true, cv_path: `${mock.user.id}/cv.pdf` });
  const companies = ['noon', 'Careem', 'Talabat', 'G42', 'Emirates NBD', 'Property Finder', 'Deliveroo'];
  companies.forEach((c, i) => mock.db.applications.push({ id: `app-${i}`, user_id: mock.user.id, platform: 'LinkedIn', company: c, job_title: i % 2 ? 'Backend Engineer' : 'AI Engineer', location: 'Dubai, UAE', job_url: `https://www.linkedin.com/jobs/view/${i}`, status: i === 1 ? 'interviewing' : 'submitted', applied_at: new Date(Date.now() - i * 1.6 * 864e5).toISOString() }));
  mock.db.saved_answers.push(
    { id: 'sa-1', user_id: mock.user.id, question: 'How many years of experience do you have with Kubernetes?', question_key: 'k8s', answer: null, source: 'pending', options: null, times_used: 0, updated_at: new Date().toISOString() },
    { id: 'sa-2', user_id: mock.user.id, question: 'Are you comfortable working from our Abu Dhabi office 3 days a week?', question_key: 'ad', answer: 'Yes', source: 'ai', options: ['Yes', 'No'], times_used: 2, updated_at: new Date().toISOString() }
  );

  const server = await staticServer(5173);
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  try {
    await page.goto('http://127.0.0.1:5173/');
    await page.waitForSelector('.hero h1');
    await page.screenshot({ path: `${SHOTS}/web-01-landing.png` });
    await page.screenshot({ path: `${SHOTS}/web-01-landing-full.png`, fullPage: true });

    await page.goto('http://127.0.0.1:5173/app.html#answers');
    await page.waitForURL(/login\.html/);
    await page.fill('#email', 'test@jobflow.dev');
    await page.click('#send');
    await page.fill('#code', '123456');
    await page.click('#verify');
    await page.waitForURL(/app\.html/);
    await page.waitForSelector('.answer-row');
    assert.equal(await page.textContent('#pending-count'), '1');
    await page.screenshot({ path: `${SHOTS}/web-03-answers.png` });

    await page.fill('.answer-row.pending .answer-input', '0');
    await page.click('.answer-row.pending .save-answer');
    await page.waitForFunction(() => !document.querySelector('.answer-row.pending'));
    assert.equal(mock.db.saved_answers.find((a) => a.id === 'sa-1').source, 'user');

    await page.click('a[data-tab="overview"]');
    await page.waitForSelector('.stat-card .v');
    await page.screenshot({ path: `${SHOTS}/web-02-overview.png` });

    await page.click('a[data-tab="applications"]');
    await page.waitForSelector('.status-select');
    await page.selectOption('tr[data-id="app-0"] .status-select', 'offer');
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === 'Status updated');
    assert.equal(mock.db.applications.find((a) => a.id === 'app-0').status, 'offer');
    await page.fill('#app-search', 'careem');
    assert.equal(await page.$$eval('#app-table tbody tr', (r) => r.length), 1);
    await page.fill('#app-search', '');
    await page.screenshot({ path: `${SHOTS}/web-04-applications.png` });

    await page.click('a[data-tab="profile"]');
    await page.waitForSelector('#profile-form');
    await page.fill('#city', 'Abu Dhabi');
    await page.click('#profile-form button[type="submit"]');
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === 'Profile saved');
    assert.equal(mock.db.profiles[0].city, 'Abu Dhabi');

    await page.click('a[data-tab="plan"]');
    await page.waitForSelector('.plan-card');
    await page.click('.join-waitlist[data-plan="pro"]');
    await page.waitForSelector('text=On the waitlist');
    await page.screenshot({ path: `${SHOTS}/web-05-plan.png` });

    await page.click('a[data-tab="settings"]');
    await page.check('input[name="mode"][value="auto"]');
    await page.click('#settings-form button[type="submit"]');
    await page.waitForFunction(() => document.getElementById('toast')?.textContent === 'Settings saved');
    assert.equal(mock.db.profiles[0].settings.mode, 'auto');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#menu-btn');
    await page.screenshot({ path: `${SHOTS}/web-06-mobile-menu.png` });
    await page.goto('http://127.0.0.1:5173/');
    await page.screenshot({ path: `${SHOTS}/web-07-mobile-landing.png` });

    for (const p of ['privacy.html', 'terms.html']) {
      await page.goto(`http://127.0.0.1:5173/${p}`);
      await page.waitForSelector('.legal-page h1');
    }

    const filtered = errors.filter((e) => !/Failed to load resource.*(404|406)/.test(e));
    assert.equal(filtered.length, 0, filtered.join('\n'));
    console.log('E2E web app: PASS');
  } catch (err) {
    console.error('E2E WEB FAILED:', err);
    console.log(errors.join('\n'));
    console.log(mock.log.slice(-12).join('\n'));
    await page.screenshot({ path: `${SHOTS}/web-failure.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
    await mock.close();
  }
})();
