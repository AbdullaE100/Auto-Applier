/* Simulated LinkedIn Easy Apply flows against the real content scripts (jsdom). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const EXT = path.join(__dirname, '..', 'extension');
const SCRIPTS = ['shared/countries.js', 'shared/questions.js', 'shared/answer-engine.js', 'shared/settings.js', 'content/autofill-core.js', 'content/bridge.js', 'content/linkedin.js'];

const profile = {
  firstName: 'Abdulla', lastName: 'Ehsan', email: 'abdulla@example.com', phone: '551180792', phoneCountryCode: '971',
  city: 'Dubai', country: 'AE', yearsExperience: 2, skills: ['Python', 'Node.js'], currentTitle: 'AI Engineer',
  answers: { targetMarkets: ['home'], workModes: ['hybrid', 'onsite'], relocate: 'no', commute: 'yes', status_GCC: 'golden', sponsor_GCC: 'no', noticePeriod: '30', educationLevel: 'bachelor', englishLevel: 'fluent', over18: 'yes', backgroundCheck: 'yes', drivingLicense: 'yes' },
  preferences: { roles: ['AI Engineer'], salaryAmount: 20000, salaryCurrency: 'AED', salaryPeriod: 'month' },
  settings: { mode: 'auto', dailyLimit: 25, useAI: true, whenUnknown: 'ask' }
};

function setup(steps, { savedAnswers = {}, aiAnswer = (p) => ({ answer: p.fieldType === 'number' ? '2' : 'I build AI agents in Python.', source: 'ai' }) } = {}) {
  const dom = new JSDOM(`<body>
    <div class="search-reusables__filters-bar"><button id="searchFilter_applyWithLinkedin" aria-checked="true">Easy Apply</button></div>
    <div class="jobs-search__job-details--container">
      <h1 class="job-details-jobs-unified-top-card__job-title">Backend Engineer</h1>
      <div class="job-details-jobs-unified-top-card__company-name">Acme</div>
      <div class="job-details-jobs-unified-top-card__primary-description-container">Dubai, United Arab Emirates · 2 days ago</div>
      <button id="jobs-apply-button-id" class="jobs-apply-button" aria-label="Easy Apply to Backend Engineer at Acme">Easy Apply</button>
    </div></body>`, { url: 'https://www.linkedin.com/jobs/search/?currentJobId=4242', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const d = window.document;
  window.Element.prototype.getClientRects = function () { return [1]; };
  window.CSS = { escape: (s) => String(s).replace(/[^\w-]/g, (c) => `\\${c}`) };
  window.setInterval = () => 0; // disable background watchers in tests

  const calls = [];
  window.chrome = {
    runtime: {
      id: 'test',
      sendMessage: async ({ type, payload }) => {
        calls.push({ type, payload });
        if (type === 'GET_CONTEXT') return { ok: true, data: { signedIn: true, onboarded: true, profile, savedAnswers } };
        if (type === 'ANSWER_QUESTION') return { ok: true, data: aiAnswer(payload) };
        if (type === 'CAN_APPLY') return { ok: true, data: { ok: true } };
        if (type === 'RECORD_APPLICATION') return { ok: true, data: { usage: { remaining: 29 } } };
        return { ok: true, data: { ok: true } };
      }
    },
    storage: { onChanged: { addListener() {} } }
  };

  const state = { i: 0, submitted: false, captured: {}, filterClicked: false };
  d.getElementById('searchFilter_applyWithLinkedin').onclick = () => { state.filterClicked = true; };
  d.getElementById('jobs-apply-button-id').onclick = () => {
    const m = d.createElement('div');
    m.className = 'artdeco-modal jobs-easy-apply-modal';
    m.setAttribute('role', 'dialog');
    const render = () => {
      m.innerHTML = `<button aria-label="Dismiss"></button><h2>Apply to Acme</h2><div role="progressbar" aria-valuenow="${state.i * 30}"></div><form>${steps[state.i].html}</form>`;
    };
    render();
    m.addEventListener('click', (e) => {
      const b = e.target.closest('footer button');
      if (!b) return;
      const step = steps[state.i];
      const ok = step.validate ? step.validate(m, state.captured) : true;
      if (!ok) {
        if (!m.querySelector('.artdeco-inline-feedback--error')) m.querySelector('form').insertAdjacentHTML('beforeend', '<div class="artdeco-inline-feedback--error">Please enter a valid answer</div>');
        return;
      }
      if (/submit/i.test(b.textContent)) {
        state.submitted = true;
        m.className = 'artdeco-modal';
        m.innerHTML = '<h2>Your application was sent to Acme</h2><button>Done</button>';
        m.querySelector('button').onclick = () => m.remove();
        return;
      }
      state.i++;
      render();
    });
    d.body.appendChild(m);
  };

  for (const s of SCRIPTS) window.eval(fs.readFileSync(path.join(EXT, s), 'utf8'));
  return { window, d, state, calls, L: window.JobFlowLinkedIn };
}

const contactStep = {
  html: `<h3>Contact info</h3>
    <div class="fb-dash-form-element"><label for="cc">Phone country code</label><select id="cc"><option value="">Select an option</option><option value="us">United States (+1)</option><option value="ae">United Arab Emirates (+971)</option></select></div>
    <div class="fb-dash-form-element"><label for="ph">Mobile phone number</label><input type="text" id="ph" value="+97"></div>
    <div class="jobs-document-upload-redesign-card__container"><input type="radio" id="jobsDocumentCardToggle-1" checked><input type="radio" id="jobsDocumentCardToggle-2"></div>
    <footer><button aria-label="Continue to next step">Next</button></footer>`,
  validate: (m, c) => { c.cc = m.querySelector('#cc').value; c.ph = m.querySelector('#ph').value; c.resume2 = m.querySelector('#jobsDocumentCardToggle-2').checked; return c.cc && c.ph.length > 6; }
};

const questionsStep = {
  html: `<h3>Additional Questions</h3>
    <div class="fb-dash-form-element"><label for="yrs-numeric">How many years of work experience do you have with Python?</label><input type="text" id="yrs-numeric"></div>
    <fieldset data-test-form-builder-radio-button-form-component="true"><legend><span aria-hidden="true">Will you now or in the future require visa sponsorship?</span></legend>
      <input type="radio" name="sp" id="sy" value="Yes"><label for="sy">Yes</label><input type="radio" name="sp" id="sn" value="No"><label for="sn">No</label></fieldset>
    <div class="fb-dash-form-element"><label for="sal">What is your expected monthly salary in AED?</label><input type="text" id="sal-numeric"></div>
    <div class="fb-dash-form-element"><label for="why">Why do you want to join Acme?</label><textarea id="why"></textarea></div>
    <div class="fb-dash-form-element"><label for="notice">Notice period</label><select id="notice"><option>Select an option</option><option>Immediately</option><option>1 month</option><option>3 months</option></select></div>
    <label><input type="checkbox" id="follow" checked>Follow Acme</label>
    <footer><button aria-label="Review your application">Review</button></footer>`,
  validate: (m, c) => {
    c.years = m.querySelector('#yrs-numeric').value;
    c.sponsor = m.querySelector('#sn').checked ? 'No' : m.querySelector('#sy').checked ? 'Yes' : '';
    c.why = m.querySelector('#why').value;
    c.notice = m.querySelector('#notice').value;
    return c.years && c.sponsor && c.why && c.notice;
  }
};

const reviewStep = { html: '<h3>Review your application</h3><footer><button aria-label="Submit application">Submit application</button></footer>' };

test('auto mode completes a multi-step application and records it', async () => {
  const { state, calls, L } = setup([contactStep, questionsStep, reviewStep]);
  assert.equal(L.findEasyApplyButton().id, 'jobs-apply-button-id');
  const res = await L.runApplication(profile, { mode: 'auto' });
  assert.equal(res.status, 'submitted', res.message);
  assert.equal(state.filterClicked, false);
  assert.equal(state.submitted, true);
  assert.equal(state.captured.cc, 'ae');
  assert.equal(state.captured.ph, '551180792');
  assert.equal(state.captured.resume2, false);
  assert.equal(state.captured.years, '2');
  assert.equal(state.captured.sponsor, 'No');
  assert.equal(state.captured.notice, '1 month');
  assert.match(state.captured.why, /AI agents/);
  const rec = calls.find((c) => c.type === 'RECORD_APPLICATION');
  assert.equal(rec.payload.externalId, '4242');
  assert.equal(rec.payload.company, 'Acme');
  assert.equal(rec.payload.aiAnswers, 2); // python years + motivation
});

test('review mode stops at submit without clicking it', async () => {
  const { state, calls, L } = setup([contactStep, questionsStep, reviewStep]);
  const res = await L.runApplication(profile, { mode: 'review' });
  assert.equal(res.status, 'review');
  assert.equal(state.submitted, false);
  assert.ok(!calls.some((c) => c.type === 'RECORD_APPLICATION'));
});

const k8sStep = {
  html: `<h3>Additional</h3><div class="fb-dash-form-element"><label for="k8s-numeric" class="fb-dash-form-element__label--is-required">How many years of experience do you have with Kubernetes?</label><input type="text" id="k8s-numeric"></div>
    <fieldset><legend class="fb-dash-form-element__label--is-required">Which cloud do you use most?</legend><input type="radio" name="cl" id="c1" value="AWS"><label for="c1">AWS</label><input type="radio" name="cl" id="c2" value="GCP"><label for="c2">GCP</label></fieldset>
    <footer><button aria-label="Continue to next step">Next</button></footer>`,
  validate: (m, c) => { c.k8s = m.querySelector('#k8s-numeric').value; c.cloud = m.querySelector('#c2').checked ? 'GCP' : m.querySelector('#c1').checked ? 'AWS' : ''; return Boolean(c.k8s && c.cloud); }
};

test('fully automatic mode asks the user in a pop-up, remembers the answers and submits', async () => {
  const { window, state, calls, L } = setup([k8sStep, reviewStep], { aiAnswer: () => ({ answer: null, needsUser: true }) });
  await L.loadContext(true);
  const run = L.runApplication(profile, { mode: 'auto', batch: true });
  // wait for the dialog
  let host;
  for (let i = 0; i < 60 && !(host = window.document.getElementById('jobflow-ask')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(host, 'pop-up shown');
  const root = host.shadowRoot;
  assert.equal(root.querySelectorAll('.q').length, 2);
  root.getElementById('save').click(); // nothing answered yet -> stays open
  assert.ok(window.document.getElementById('jobflow-ask'));
  root.querySelector('#f0').value = '1';
  root.querySelector('input[name="f1"][value="GCP"]').checked = true;
  root.getElementById('save').click();
  const res = await run;
  assert.equal(res.status, 'submitted', res.message);
  assert.equal(state.captured.k8s, '1');
  assert.equal(state.captured.cloud, 'GCP');
  const saved = calls.filter((c) => c.type === 'SAVE_ANSWER' && c.payload.answer);
  assert.deepEqual(saved.map((c) => c.payload.answer).sort(), ['1', 'GCP']);
  assert.equal(L.context.savedAnswers['which cloud do you use most'], 'GCP');
});

test('saved answers are reused without calling AI', async () => {
  const { state, calls, L } = setup([k8sStep, reviewStep], {
    savedAnswers: { 'how many years of experience do you have with kubernetes': '1', 'which cloud do you use most': 'AWS' },
    aiAnswer: () => { throw new Error('AI should not be called'); }
  });
  await L.loadContext(true);
  const res = await L.runApplication(profile, { mode: 'auto', batch: true });
  assert.equal(res.status, 'submitted', res.message);
  assert.equal(state.captured.cloud, 'AWS');
  assert.ok(!calls.some((c) => c.type === 'ANSWER_QUESTION'));
});

test('batch mode set to skip unknown questions skips the job and saves the question', async () => {
  const k8s = {
    html: `<h3>Additional</h3><div class="fb-dash-form-element"><label for="k8s-numeric" class="fb-dash-form-element__label--is-required">How many years of experience do you have with Kubernetes?</label><input type="text" id="k8s-numeric"></div>
      <footer><button aria-label="Continue to next step">Next</button></footer>`,
    validate: (m) => Boolean(m.querySelector('#k8s-numeric').value)
  };
  const { state, calls, L } = setup([k8s, reviewStep], { aiAnswer: () => ({ answer: null, needsUser: true }) });
  L.batchStopRequested = false;
  const res = await L.runApplication({ ...profile, settings: { ...profile.settings, whenUnknown: 'skip' } }, { mode: 'auto', batch: true });
  assert.equal(res.status, 'skipped', res.message);
  assert.equal(state.submitted, false);
  const saved = calls.filter((c) => c.type === 'SAVE_ANSWER');
  assert.ok(saved.some((c) => /Kubernetes/.test(c.payload.question) && c.payload.answer === null));
});

test('safety: a screening question mentioning "applied" is not mistaken for a submission', async () => {
  const q = {
    html: `<h3>Additional</h3><fieldset><legend class="fb-dash-form-element__label--is-required">Have you applied to Acme before? Your application was sent?</legend>
      <input type="radio" name="ap" id="a1" value="Yes"><label for="a1">Yes</label><input type="radio" name="ap" id="a2" value="No"><label for="a2">No</label></fieldset>
      <footer><button aria-label="Review your application">Review</button></footer>`,
    validate: (m) => m.querySelector('#a1').checked || m.querySelector('#a2').checked
  };
  const { d, L } = setup([q, reviewStep]);
  d.getElementById('jobs-apply-button-id').click();
  assert.equal(L.successVisible(), false);
});

test('safety: stops at once when LinkedIn pauses Easy Apply', async () => {
  const { d, state, L } = setup([contactStep, reviewStep]);
  d.body.insertAdjacentHTML('beforeend', '<div role="dialog"><h2>Easy Apply paused</h2><p>We noticed you’re applying at a fast pace, so we’ve briefly paused Easy Apply.</p></div>');
  const res = await L.runApplication(profile, { mode: 'auto', batch: true });
  assert.equal(res.status, 'failed');
  assert.equal(res.blocked, true);
  assert.equal(res.stopBatch, true);
  assert.equal(state.submitted, false);
});

test('safety: claims dressed as "I certify" are never ticked automatically', async () => {
  const step = {
    html: `<h3>Additional</h3>
      <div class="fb-dash-form-element"><fieldset><legend>I certify that I hold an active CPA licence</legend><input type="checkbox" id="cpa"><label for="cpa">I certify that I hold an active CPA licence</label></fieldset></div>
      <div class="fb-dash-form-element"><fieldset><legend>Privacy</legend><input type="checkbox" id="pp"><label for="pp">I agree to the privacy policy</label></fieldset></div>
      <footer><button aria-label="Review your application">Review</button></footer>`
  };
  const { d, L } = setup([step, reviewStep], { aiAnswer: () => ({ answer: null }) });
  d.getElementById('jobs-apply-button-id').click();
  const modal = L.findModal();
  await L.fillStep(modal, profile, L.jobInfo(), { filled: 0, ai: 0, answers: [] });
  assert.equal(d.getElementById('cpa').checked, false);
  assert.equal(d.getElementById('pp').checked, true);
});

test('number fields get a clean number, and answers never land in a re-rendered question', async () => {
  const step = {
    html: `<h3>Additional</h3><div class="fb-dash-form-element"><label for="n-numeric" class="fb-dash-form-element__label--is-required">Years with SQL? Enter a whole number</label><input type="text" id="n-numeric"></div>
      <footer><button aria-label="Review your application">Review</button></footer>`
  };
  const { d, L } = setup([step, reviewStep]);
  d.getElementById('jobs-apply-button-id').click();
  const [field] = L.collectFields(L.findModal());
  assert.equal(field.kind, 'number');
  assert.equal(await L.applyAnswer(field, '3.6 years', profile), true);
  assert.equal(d.getElementById('n-numeric').value, '4');
  field.el.remove();
  assert.equal(await L.applyAnswer(field, '5', profile), false);
});

test('safety: LinkedIn’s invisible reCAPTCHA frame is not treated as a security check', async () => {
  const { d, L } = setup([contactStep, reviewStep]);
  d.body.insertAdjacentHTML('beforeend', '<iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor" style="width:0;height:0;visibility:hidden"></iframe>');
  L.isVisible = null;
  assert.equal(L.blockedReason(), null);
});

test('AI drafts suggestions from the CV; the user approves them in the pop-up', async () => {
  const { window, state, calls, L } = setup([k8sStep, reviewStep], {
    aiAnswer: (p) => ({ answer: null, needsUser: true, suggestion: /cloud/i.test(p.question) ? 'GCP' : '2' })
  });
  await L.loadContext(true);
  const run = L.runApplication(profile, { mode: 'auto', batch: true });
  let host;
  for (let i = 0; i < 60 && !(host = window.document.getElementById('jobflow-ask')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(host, 'pop-up shown');
  const root = host.shadowRoot;
  assert.match(root.getElementById('t').textContent, /Check 2 suggested answers/);
  assert.equal(root.querySelector('#f0').value, '2');
  assert.equal(root.querySelector('input[name="f1"][value="GCP"]').checked, true);
  assert.equal(root.getElementById('save').textContent, 'Approve & continue');
  root.getElementById('save').click();
  const res = await run;
  assert.equal(res.status, 'submitted', res.message);
  assert.equal(state.captured.k8s, '2');
  assert.equal(state.captured.cloud, 'GCP');
  assert.equal(calls.filter((c) => c.type === 'ANSWER_QUESTION').length, 2, 'AI asked once per question');
});

test('background tab: waits are timed by the service worker, not throttled page timers', async () => {
  const { window, L } = setup([contactStep, reviewStep]);
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => true });
  const posted = [];
  window.chrome.runtime.connect = () => {
    const listeners = [];
    return {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      onDisconnect: { addListener() {} },
      postMessage: (m) => { posted.push(m); setImmediate(() => listeners.forEach((fn) => fn({ id: m.id }))); }
    };
  };
  const t0 = Date.now();
  const p = L.sleep(45000);
  // pretend the 45s passed while the worker answered each 20s chunk
  const realNow = Date.now;
  let fake = t0;
  window.Date.now = () => fake;
  Date.now = () => fake;
  const tick = setInterval(() => { fake += 20000; }, 5);
  await p;
  clearInterval(tick);
  Date.now = realNow;
  assert.ok(posted.length >= 2, `chunks sent: ${posted.length}`);
  assert.ok(posted.every((m) => m.ms <= 20000));
  assert.ok(realNow() - t0 < 2000, 'resolved without waiting on page timers');
});
