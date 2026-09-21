/* End-to-end: load the real extension in Chromium against a mock Supabase and
 * walk through onboarding + popup. Screenshots go to tests/screenshots/. */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createMock } = require('./mock-supabase');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'screenshots');
const EXECUTABLE = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const mock = createMock();
  await mock.listen();

  const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-ext-'));
  copyDir(path.join(ROOT, 'extension'), extDir);
  fs.writeFileSync(path.join(extDir, 'config.js'),
    "self.JOBFLOW_CONFIG = { supabaseUrl: 'http://127.0.0.1:54321', supabaseAnonKey: 'anon', webAppUrl: 'http://127.0.0.1:5173', supportEmail: 'x@y.z' };\n");

  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-profile-'));
  const context = await chromium.launchPersistentContext(userDir, {
    executablePath: EXECUTABLE,
    headless: false,
    viewport: { width: 1280, height: 860 },
    args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--no-sandbox']
  });

  const errors = [];
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
    const extId = sw.url().split('/')[2];
    console.log('extension id', extId);

    // onInstalled opens onboarding automatically
    let page = await context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    if (!page || !page.url().includes('onboarding')) {
      page = await context.newPage();
      await page.goto(`chrome-extension://${extId}/onboarding/onboarding.html`);
    }
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForSelector('#send-code-btn');
    await page.screenshot({ path: `${SHOTS}/01-account.png` });

    // --- sign in with email code
    await page.fill('#email', 'test@jobflow.dev');
    await page.click('#send-code-btn');
    await page.waitForSelector('#code');
    await page.fill('#code', '000000');
    await page.click('#verify-btn');
    await page.waitForSelector('#auth-error:not([hidden])');
    assert.match(await page.textContent('#auth-error'), /not valid/);
    await page.fill('#code', '123456');
    await page.click('#verify-btn');

    // --- CV
    await page.waitForSelector('#dropzone', { timeout: 10000 });
    await page.screenshot({ path: `${SHOTS}/02-cv-empty.png` });
    await page.setInputFiles('#cv-input', path.join(__dirname, 'fixtures', 'sample-cv.pdf'));
    await page.waitForSelector('.file-card .pill-success', { timeout: 20000 });
    await page.screenshot({ path: `${SHOTS}/03-cv-parsed.png` });
    assert.ok(Object.keys(mock.db.files).length === 1, 'CV uploaded to storage');
    await page.click('#next-btn');

    // --- details (prefilled from parse)
    await page.waitForSelector('#firstName');
    assert.equal(await page.inputValue('#firstName'), 'Abdulla');
    assert.equal(await page.inputValue('#phone'), '551180792');
    assert.equal(await page.inputValue('#phoneCountryCode'), '971');
    assert.equal(await page.inputValue('#country'), 'AE');
    await page.fill('#city', '');
    await page.click('#next-btn');
    await page.waitForSelector('#city.invalid');
    await page.screenshot({ path: `${SHOTS}/04-details-validation.png`, fullPage: true });
    await page.fill('#city', 'Dubai');
    await page.fill('#yearsExperience', '2');
    await page.click('#next-btn');

    // --- location & eligibility
    await page.waitForSelector('.question');
    const titles = await page.$$eval('.question h3', (els) => els.map((e) => e.textContent));
    assert.ok(titles.some((t) => /work status in United Arab Emirates/.test(t)), 'UAE status question shown');
    await page.click('#next-btn'); // should block: missing answers
    await page.waitForSelector('.question.missing');
    await page.click('.option[data-qid="targetMarkets"][data-value="UK"]');
    await page.waitForSelector('#q-status_UK');
    await page.click('.option[data-qid="relocate"][data-value="yes"]');
    await page.click('.option[data-qid="status_GCC"][data-value="employment"]');
    await page.waitForSelector('#q-sponsor_GCC .option[aria-checked="true"]');
    await page.click('.option[data-qid="status_UK"][data-value="none"]');
    await page.screenshot({ path: `${SHOTS}/05-location.png`, fullPage: true });
    await page.click('#next-btn');

    // --- experience & checks
    await page.waitForSelector('.option[data-qid="noticePeriod"]');
    const expIds = await page.$$eval('.question', (els) => els.map((e) => e.id));
    assert.ok(!expIds.includes('q-eeoGender'), 'no US EEO questions for UAE/UK candidate');
    for (const [qid, v] of [['employmentStatus', 'employed'], ['noticePeriod', '30'], ['educationLevel', 'bachelor'], ['englishLevel', 'fluent'], ['drivingLicense', 'yes']]) {
      await page.click(`.option[data-qid="${qid}"][data-value="${v}"]`);
    }
    await page.screenshot({ path: `${SHOTS}/06-experience.png`, fullPage: true });
    await page.click('#next-btn');

    // --- preferences
    await page.waitForSelector('#salaryAmount');
    assert.equal(await page.inputValue('#salaryCurrency'), 'AED');
    await page.fill('#salaryAmount', '20000');
    await page.click('.option[data-qid="seniority"][data-value="associate"]');
    await page.screenshot({ path: `${SHOTS}/07-preferences.png`, fullPage: true });
    await page.click('#next-btn');

    // --- automation
    await page.waitForSelector('.tile[data-group="mode"]');
    await page.screenshot({ path: `${SHOTS}/08-automation.png`, fullPage: true });
    await page.click('#next-btn');

    // --- done
    await page.waitForSelector('#start-btn');
    await page.screenshot({ path: `${SHOTS}/09-done.png` });
    const saved = mock.db.profiles[0];
    assert.equal(saved.onboarding_completed, true);
    assert.equal(saved.answers.sponsor_GCC, 'yes');
    assert.equal(saved.preferences.salaryPeriod, 'month');
    assert.deepEqual(saved.preferences.roles, ['AI Engineer']);
    assert.equal(saved.settings.mode, 'review');

    // --- mobile layout
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`chrome-extension://${extId}/onboarding/onboarding.html#location`);
    await page.reload();
    await page.waitForSelector('.question');
    await page.screenshot({ path: `${SHOTS}/10-mobile-location.png` });

    // --- popup
    const popup = await context.newPage();
    popup.on('pageerror', (e) => errors.push(`popup pageerror: ${e.message}`));
    await popup.setViewportSize({ width: 360, height: 600 });
    await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
    await popup.waitForSelector('#go');
    await popup.screenshot({ path: `${SHOTS}/11-popup.png` });
    assert.match(await popup.textContent('.meter-head'), /30/);

    // --- popup mode switch
    await popup.click('[data-mode="auto"]');
    await popup.waitForFunction(() => document.querySelector('[data-mode="auto"]').getAttribute('aria-checked') === 'true');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(mock.db.profiles[0].settings.mode, 'auto');

    // --- settings page
    const settingsPage = await context.newPage();
    settingsPage.on('pageerror', (e) => errors.push(`settings pageerror: ${e.message}`));
    await settingsPage.setViewportSize({ width: 1100, height: 900 });
    await settingsPage.goto(`chrome-extension://${extId}/settings/settings.html`);
    await settingsPage.waitForSelector('.tile[data-key="mode"]');
    assert.equal(await settingsPage.getAttribute('.tile[data-key="mode"][data-value="auto"]', 'aria-checked'), 'true');
    await settingsPage.fill('#dailyLimit', '40');
    await settingsPage.click('button[data-key="pace"][data-value="careful"]');
    await settingsPage.click('button[data-key="askTimeoutSec"][data-value="60"]');
    await settingsPage.fill('#titleExclude', 'senior, lead');
    await settingsPage.waitForSelector('#savebar:not([hidden])');
    await settingsPage.screenshot({ path: `${SHOTS}/12-settings.png`, fullPage: true });
    await settingsPage.click('#save');
    await settingsPage.waitForSelector('#savebar[hidden]', { state: 'attached' });
    const st = mock.db.profiles[0].settings;
    assert.equal(st.dailyLimit, 40);
    assert.equal(st.pace, 'careful');
    assert.equal(st.askTimeoutSec, 60);
    assert.equal(st.titleExclude, 'senior, lead');

    // --- service worker answers content-script messages
    const answer = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CAN_APPLY' }));
    assert.equal(answer.ok, true);
    assert.equal(answer.data.ok, true);

    const filtered = errors.filter((e) => !/favicon|Failed to load resource.*(403|404|406)/.test(e));
    if (filtered.length) console.log('Browser errors:\n' + filtered.join('\n'));
    assert.equal(filtered.length, 0, 'no browser errors');
    console.log('E2E extension onboarding: PASS');
  } catch (err) {
    console.error('E2E FAILED:', err);
    console.log('Browser errors:\n' + errors.join('\n'));
    console.log('Mock log tail:\n' + mock.log.slice(-15).join('\n'));
    const pages = context.pages();
    if (pages.length) await pages[pages.length - 1].screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    await context.close();
    await mock.close();
  }
})();
