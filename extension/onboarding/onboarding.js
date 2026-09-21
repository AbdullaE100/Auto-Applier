/* JobFlow AI - onboarding & settings flow */
(function () {
  const Api = self.JobFlowApi;
  const Countries = self.JobFlowCountries;
  const Questions = self.JobFlowQuestions;

  const DRAFT_KEY = 'jobflow.onboardingDraft';

  const STEPS = [
    { id: 'account', label: 'Account' },
    { id: 'cv', label: 'Upload CV' },
    { id: 'details', label: 'Your details' },
    { id: 'location', label: 'Location & eligibility', sections: ['location', 'eligibility'] },
    { id: 'experience', label: 'Experience & checks', sections: ['experience', 'basics', 'eeo'] },
    { id: 'preferences', label: 'Job preferences' },
    { id: 'automation', label: 'Auto-apply settings' },
    { id: 'done', label: 'Ready' }
  ];

  const state = {
    stepIndex: 0,
    session: null,
    profile: { answers: {}, preferences: {}, settings: {} },
    busy: false,
    errors: {},
    auth: { email: '', codeSent: false, resendAt: 0 },
    cv: { status: 'idle', file: null, stages: {}, error: '' },
    editing: false
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = {
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    upload: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    file: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    google: '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>'
  };

  // ---------------------------------------------------------------- utils
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 3200);
  }

  const qctx = () => ({ country: state.profile.country, city: state.profile.city, answers: state.profile.answers || {} });

  async function saveDraft() {
    try {
      await chrome.storage.local.set({ [DRAFT_KEY]: { stepIndex: state.stepIndex, profile: state.profile, savedAt: Date.now() } });
    } catch (_) { /* best effort */ }
  }

  async function persist(partial, { silent = false } = {}) {
    try {
      const saved = await Api.saveProfile(partial);
      // Only take back what we saved - unsaved local edits (e.g. parsed CV fields) must survive
      const merged = { ...state.profile, id: saved.id };
      for (const k of Object.keys(partial)) merged[k] = saved[k];
      state.profile = merged;
      chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {});
      if (!silent) toast('Saved');
      return true;
    } catch (err) {
      toast(`Couldn't save: ${err.message}`);
      return false;
    }
  }

  function setBusy(busy, label) {
    state.busy = busy;
    const next = $('#next-btn');
    if (next) {
      next.disabled = busy;
      if (busy && label) next.innerHTML = `<span class="spinner"></span> ${esc(label)}`;
    }
  }

  function goTo(index) {
    state.stepIndex = Math.max(0, Math.min(index, STEPS.length - 1));
    state.errors = {};
    history.replaceState(null, '', `#${STEPS[state.stepIndex].id}`);
    saveDraft();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------------------------------------------- rail
  function renderRail() {
    const firstIncomplete = state.profile.onboardingCompleted ? STEPS.length : state.stepIndex;
    $('#steps').innerHTML = STEPS.map((s, i) => {
      const done = i < state.stepIndex || (state.profile.onboardingCompleted && i !== state.stepIndex);
      const clickable = state.session && i > 0 && (i <= firstIncomplete || state.profile.onboardingCompleted);
      const cls = i === state.stepIndex ? 'active' : done ? 'done' : '';
      return `<li><button class="step ${cls}" data-step="${i}" data-clickable="${Boolean(clickable)}" ${i === state.stepIndex ? 'aria-current="step"' : ''}>
        <span class="dot">${done && i !== state.stepIndex ? icon.check : i + 1}</span>${esc(s.label)}</button></li>`;
    }).join('');
    $('#progress-bar').style.width = `${Math.round((state.stepIndex / (STEPS.length - 1)) * 100)}%`;
    $('#mobile-step').textContent = `Step ${state.stepIndex + 1} of ${STEPS.length}`;
    $('#rail-foot').innerHTML = state.session
      ? `<div class="who"><span class="pill pill-success">Signed in</span><span>${esc(state.session.user.email)}</span></div>
         <button class="btn btn-ghost" id="signout-btn" style="justify-content:flex-start;padding:0 6px;height:30px">Sign out</button>`
      : '<span>Your data is encrypted and only used to fill your applications.</span>';
  }

  function renderNav({ back = true, nextLabel = 'Continue', skip = null, status = '' } = {}) {
    const showBack = back && state.stepIndex > (state.session ? 1 : 0);
    $('#nav').innerHTML = `<div class="nav-inner">
      ${showBack ? '<button class="btn btn-ghost" id="back-btn">← Back</button>' : ''}
      <span class="nav-status">${esc(status)}</span>
      <span class="spacer"></span>
      ${skip ? `<button class="btn btn-ghost" id="skip-btn">${esc(skip)}</button>` : ''}
      ${nextLabel ? `<button class="btn btn-primary btn-lg" id="next-btn">${esc(nextLabel)}</button>` : ''}
    </div>`;
    $('#nav').hidden = false;
  }

  // ---------------------------------------------------------------- steps
  const views = {
    // ---------------------------------------------------- 1. account
    account() {
      const a = state.auth;
      $('#panel').innerHTML = `
        <div class="hero-grid">
          <div>
            <span class="pill pill-accent" style="margin-bottom:14px">5-minute setup</span>
            <h1>Apply to jobs in minutes, not evenings.</h1>
            <p class="lead">Set up your profile once. JobFlow fills every LinkedIn Easy Apply form and screening question for you, truthfully, from your CV and answers.</p>
            <ul class="benefits">
              <li><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/></svg></span><div><strong>Upload your CV once</strong><span>AI pulls out your details. You review everything.</span></div></li>
              <li><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg></span><div><strong>Answers that fit where you live</strong><span>Visa, work rights and notice questions tailored to your country.</span></div></li>
              <li><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg></span><div><strong>You stay in control</strong><span>Review before submit, daily limits, and a full application log.</span></div></li>
            </ul>
          </div>
          <div class="card auth-card">
            <h2 style="font-size:18px">Create your account</h2>
            <button class="btn btn-secondary btn-lg btn-block" id="google-btn">${icon.google} Continue with Google</button>
            <div class="divider">or use your email</div>
            ${!a.codeSent ? `
              <div class="field">
                <label for="email">Email</label>
                <input class="input" id="email" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(a.email)}">
              </div>
              <button class="btn btn-primary btn-lg btn-block" id="send-code-btn">Email me a sign-in code</button>
            ` : `
              <p class="muted" style="font-size:13px">We sent a sign-in code to <strong>${esc(a.email)}</strong>.</p>
              <input class="input code-input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="Enter code">
              <button class="btn btn-primary btn-lg btn-block" id="verify-btn">Verify & continue</button>
              <div style="display:flex;justify-content:space-between;font-size:13px">
                <a href="#" id="change-email">Use a different email</a>
                <a href="#" id="resend-code">Resend code</a>
              </div>
            `}
            <div id="auth-error" class="alert alert-error" hidden></div>
            <p class="legal">By continuing you agree to the <a href="${esc(self.JOBFLOW_CONFIG.webAppUrl)}/terms.html" target="_blank">Terms</a> and <a href="${esc(self.JOBFLOW_CONFIG.webAppUrl)}/privacy.html" target="_blank">Privacy Policy</a>.</p>
          </div>
        </div>`;
      $('#nav').hidden = true;

      const showError = (msg) => { const e = $('#auth-error'); e.textContent = msg; e.hidden = false; };
      const afterSignIn = async (session) => {
        state.session = session;
        await loadProfile();
        goTo(state.profile.onboardingCompleted ? STEPS.length - 1 : 1);
      };

      // Only offer Google if it's switched on in Supabase (Authentication -> Providers)
      fetch(`${self.JOBFLOW_CONFIG.supabaseUrl}/auth/v1/settings`, { headers: { apikey: self.JOBFLOW_CONFIG.supabaseAnonKey } })
        .then((r) => r.json())
        .then((st) => {
          if (!st?.external?.google) {
            $('#google-btn')?.setAttribute('hidden', '');
            document.querySelector('.auth-card .divider')?.setAttribute('hidden', '');
          }
        })
        .catch(() => {});

      $('#google-btn').onclick = async () => {
        try {
          $('#google-btn').disabled = true;
          await afterSignIn(await Api.signInWithGoogle());
        } catch (err) {
          showError(err.message);
          $('#google-btn').disabled = false;
        }
      };
      if (!a.codeSent) {
        const send = async () => {
          const email = $('#email').value.trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Enter a valid email address.');
          $('#send-code-btn').disabled = true;
          $('#send-code-btn').innerHTML = '<span class="spinner"></span> Sending…';
          try {
            await Api.signInWithEmail(email);
            Object.assign(state.auth, { email, codeSent: true, resendAt: Date.now() + 60000 });
            views.account();
            $('#code').focus();
          } catch (err) {
            showError(err.message);
            $('#send-code-btn').disabled = false;
            $('#send-code-btn').textContent = 'Email me a sign-in code';
          }
        };
        $('#send-code-btn').onclick = send;
        $('#email').onkeydown = (e) => { if (e.key === 'Enter') send(); };
      } else {
        const verify = async () => {
          const code = $('#code').value.replace(/\D/g, '');
          if (code.length < 6 || code.length > 8) return showError('Enter the code from the email.');
          $('#verify-btn').disabled = true;
          $('#verify-btn').innerHTML = '<span class="spinner"></span> Verifying…';
          try {
            await afterSignIn(await Api.verifyEmailCode(state.auth.email, code));
          } catch (err) {
            showError(err.message);
            $('#verify-btn').disabled = false;
            $('#verify-btn').textContent = 'Verify & continue';
          }
        };
        $('#verify-btn').onclick = verify;
        $('#code').oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 8); if (e.target.value.length === 8) verify(); };
        $('#change-email').onclick = (e) => { e.preventDefault(); state.auth.codeSent = false; views.account(); };
        $('#resend-code').onclick = async (e) => {
          e.preventDefault();
          const wait = Math.ceil((state.auth.resendAt - Date.now()) / 1000);
          if (wait > 0) return showError(`You can request a new code in ${wait}s.`);
          try {
            await Api.signInWithEmail(state.auth.email);
            state.auth.resendAt = Date.now() + 60000;
            toast('New code sent');
          } catch (err) { showError(err.message); }
        };
      }
    },

    // ---------------------------------------------------- 2. CV upload
    cv() {
      const c = state.cv;
      const p = state.profile;
      const stageRow = (key, label) => {
        const st = c.stages[key] || 'pending';
        const mark = st === 'done' ? icon.check : st === 'active' ? '<span class="spinner"></span>' : st === 'fail' ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';
        return `<li class="${st}"><span class="mark">${mark}</span>${esc(label)}</li>`;
      };
      $('#panel').innerHTML = `
        <h1>Upload your CV</h1>
        <p class="lead">We read it on your computer, then AI extracts your details. You'll review every field on the next step.</p>
        <label class="dropzone" id="dropzone" tabindex="0">
          <span class="big-ic">${icon.upload}</span>
          <strong>Drop your CV here or click to browse</strong>
          <span class="subtle">PDF, DOCX or TXT · up to 10 MB</span>
          <input type="file" id="cv-input" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden>
        </label>
        ${c.file || p.cvFileName ? `
          <div class="card file-card">
            <span class="big-ic" style="color:var(--accent)">${icon.file}</span>
            <div style="min-width:0;flex:1">
              <div class="name">${esc(c.file ? c.file.name : p.cvFileName)}</div>
              <div class="meta">${c.file ? `${Math.round(c.file.size / 1024)} KB` : 'Uploaded earlier'}</div>
            </div>
            ${c.status === 'done' || (!c.file && p.cvFileName) ? '<span class="pill pill-success">Ready</span>' : ''}
          </div>` : ''}
        ${c.status !== 'idle' ? `<ul class="checklist">
          ${stageRow('read', 'Reading your CV')}
          ${stageRow('upload', 'Storing it securely')}
          ${stageRow('parse', 'Extracting your details with AI')}
        </ul>` : ''}
        ${c.error ? `<div class="alert alert-error" style="margin-top:16px">${esc(c.error)}</div>` : ''}`;

      const input = $('#cv-input');
      const zone = $('#dropzone');
      input.onchange = () => input.files[0] && handleCv(input.files[0]);
      zone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
      ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
      zone.addEventListener('drop', (e) => e.dataTransfer.files[0] && handleCv(e.dataTransfer.files[0]));

      const ready = c.status === 'done' || (!c.file && p.cvFileName) || c.status === 'failed-parse';
      renderNav({
        nextLabel: c.status === 'working' ? 'Working…' : 'Continue',
        skip: ready ? null : 'Enter details manually'
      });
      $('#next-btn').disabled = c.status === 'working' || !ready;
      const skip = $('#skip-btn');
      if (skip) skip.onclick = () => goTo(2);
      $('#next-btn').onclick = () => goTo(2);
    },

    // ---------------------------------------------------- 3. details
    details() {
      const p = state.profile;
      const err = state.errors;
      const countryOptions = (selected) => ['<option value="">Select country</option>', ...Countries.COUNTRIES.map((c) =>
        `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${esc(c.name)}</option>`)].join('');
      const dialOptions = (selected) => Countries.COUNTRIES
        .map((c) => `<option value="${c.dial}" ${c.dial === selected ? 'selected' : ''}>${c.code} +${c.dial}</option>`)
        .filter((v, i, arr) => arr.indexOf(v) === i).join('');
      const field = (id, label, value, opts = {}) => `
        <div class="field ${opts.full ? 'full' : ''}">
          <label for="${id}">${esc(label)}${opts.optional ? ' <span class="subtle">(optional)</span>' : ''}</label>
          <input class="input ${err[id] ? 'invalid' : ''}" id="${id}" type="${opts.type || 'text'}" value="${esc(value)}" ${opts.attrs || ''}>
          ${err[id] ? `<span class="error-text">${esc(err[id])}</span>` : opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ''}
        </div>`;

      const looksEmpty = !p.firstName && !p.currentTitle && !(p.skills || []).length;
      // Profiles saved before work history was stored have details but no roles or education
      const noHistory = !looksEmpty && !(p.experience || []).length && !(p.education || []).length;
      const history = [
        (p.experience || []).length ? `${p.experience.length} role${p.experience.length === 1 ? '' : 's'}` : '',
        (p.education || []).length ? `${p.education.length} education entr${p.education.length === 1 ? 'y' : 'ies'}` : ''
      ].filter(Boolean).join(' and ');
      $('#panel').innerHTML = `
        <h1>Check your details</h1>
        <p class="lead">${p.cvFileName && !looksEmpty ? 'We filled these in from your CV. ' : ''}Recruiters see exactly what's here, so make sure it's right.</p>
        ${p.cvPath && (looksEmpty || noHistory) ? `<div class="alert alert-info" style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px;flex-wrap:wrap">
          <span>${looksEmpty
            ? `Your CV <strong>${esc(p.cvFileName)}</strong> is uploaded but hasn't been read yet.`
            : `Your work history and education from <strong>${esc(p.cvFileName)}</strong> aren't saved yet, so the AI can't use them for "years with X" or degree questions.`}</span>
          <button class="btn btn-primary" id="reparse-btn" type="button">Fill in from my CV</button>
        </div>
        <div id="reparse-error" class="alert alert-error" style="margin-bottom:20px" hidden></div>` : ''}
        <div class="form-grid">
          <div class="section-title full">Contact</div>
          ${field('firstName', 'First name', p.firstName, { attrs: 'autocomplete="given-name"' })}
          ${field('lastName', 'Last name', p.lastName, { attrs: 'autocomplete="family-name"' })}
          ${field('email', 'Email', p.email || state.session?.user.email, { type: 'email' })}
          <div class="field">
            <label for="phone">Mobile phone</label>
            <div class="phone-row">
              <select class="input" id="phoneCountryCode">${dialOptions(p.phoneCountryCode || Countries.getCountry(p.country)?.dial || '')}</select>
              <input class="input ${err.phone ? 'invalid' : ''}" id="phone" inputmode="tel" value="${esc(p.phone)}" placeholder="50 123 4567">
            </div>
            ${err.phone ? `<span class="error-text">${esc(err.phone)}</span>` : ''}
          </div>
          <div class="field">
            <label for="country">Country you live in</label>
            <select class="input ${err.country ? 'invalid' : ''}" id="country">${countryOptions(p.country)}</select>
            ${err.country ? `<span class="error-text">${esc(err.country)}</span>` : '<span class="hint">Your eligibility questions depend on this.</span>'}
          </div>
          ${field('city', 'City', p.city, { attrs: 'autocomplete="address-level2"' })}
          <div class="field">
            <label for="nationality">Nationality <span class="subtle">(optional)</span></label>
            <select class="input" id="nationality"><option value="">Prefer not to say</option>${Countries.COUNTRIES.map((c) => `<option value="${esc(c.name)}" ${c.name === p.nationality ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
            <span class="hint">Often asked on GCC applications.</span>
          </div>

          <div class="section-title full">Experience</div>
          ${field('currentTitle', 'Current or most recent job title', p.currentTitle)}
          ${field('currentCompany', 'Current or most recent company', p.currentCompany, { optional: true })}
          ${field('yearsExperience', 'Years of professional experience', p.yearsExperience ?? '', { type: 'number', attrs: 'min="0" max="60" step="1"', hint: 'Full-time work only. Used for "years of experience" questions.' })}
          <div class="field full">
            <label>Skills</label>
            <div class="chips" id="skills-chips"></div>
            <span class="hint">Press Enter or comma to add. We only claim experience with skills listed here.</span>
          </div>
          ${history ? `<div class="field full"><span class="hint">From your CV: ${esc(history)}. The AI answers experience and degree questions from these.</span></div>` : ''}
          <div class="field full">
            <label for="summary">Professional summary <span class="subtle">(optional)</span></label>
            <textarea class="input" id="summary" maxlength="1200">${esc(p.summary)}</textarea>
          </div>

          <div class="section-title full">Links</div>
          ${field('linkedinUrl', 'LinkedIn profile URL', p.linkedinUrl, { type: 'url', optional: true, attrs: 'placeholder="https://linkedin.com/in/…"' })}
          ${field('portfolioUrl', 'Portfolio or website', p.portfolioUrl, { type: 'url', optional: true })}
          ${field('githubUrl', 'GitHub', p.githubUrl, { type: 'url', optional: true })}
        </div>`;

      chipsInput($('#skills-chips'), p.skills || [], (skills) => { state.profile.skills = skills; }, 'Add a skill');
      $('#reparse-btn')?.addEventListener('click', async () => {
        const btn = $('#reparse-btn');
        const showErr = (m) => { const e = $('#reparse-error'); e.textContent = m; e.hidden = false; btn.disabled = false; btn.textContent = 'Try again'; };
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Reading your CV…';
        let file;
        try {
          const { data: signed, error: signErr } = await Api.getClient().storage.from('cvs').createSignedUrl(p.cvPath, 120);
          if (signErr) throw signErr;
          const res = await fetch(signed.signedUrl);
          if (!res.ok) throw new Error(`storage returned ${res.status}`);
          const blob = await res.blob();
          file = new File([blob], p.cvFileName || 'cv.pdf', { type: blob.type || 'application/pdf' });
        } catch (err) {
          console.warn('[JobFlow] CV download failed', err);
          return showErr(`Couldn't download your uploaded CV (${err.message}). Go back to Upload CV and drop the file in again.`);
        }
        let text;
        try {
          text = await self.JobFlowCvReader.readCv(file);
        } catch (err) {
          return showErr(err.message);
        }
        try {
          const parsed = await Api.parseCv(text);
          applyParsed(parsed.profile);
          saveDraft();
          toast('Filled in from your CV. Check everything below.');
          views.details();
        } catch (err) {
          console.warn('[JobFlow] parse-cv failed', err);
          showErr(`The AI couldn't read your CV: ${err.message}`);
        }
      });
      $('#country').onchange = (e) => {
        const c = Countries.getCountry(e.target.value);
        if (c) $('#phoneCountryCode').value = c.dial;
      };

      renderNav({});
      $('#next-btn').onclick = async () => {
        const read = (id) => ($(`#${id}`).value || '').trim();
        const next = {
          firstName: read('firstName'), lastName: read('lastName'), email: read('email'),
          phoneCountryCode: read('phoneCountryCode'), phone: read('phone').replace(/\D/g, '').replace(/^0+/, ''),
          country: read('country'), city: read('city'), nationality: read('nationality'),
          currentTitle: read('currentTitle'), currentCompany: read('currentCompany'),
          yearsExperience: read('yearsExperience') === '' ? null : Number(read('yearsExperience')),
          summary: read('summary'), linkedinUrl: read('linkedinUrl'), portfolioUrl: read('portfolioUrl'), githubUrl: read('githubUrl'),
          skills: state.profile.skills || [],
          // Parsed from the CV - the AI needs them for "years with X", degree and "describe your experience" questions
          experience: Array.isArray(state.profile.experience) ? state.profile.experience : [],
          education: Array.isArray(state.profile.education) ? state.profile.education : []
        };
        const errors = {};
        if (!next.firstName) errors.firstName = 'Required';
        if (!next.lastName) errors.lastName = 'Required';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) errors.email = 'Enter a valid email';
        if (next.phone.length < 6) errors.phone = 'Enter your mobile number without the country code';
        if (!next.country) errors.country = 'Required';
        if (!next.city) errors.city = 'Required';
        if (!next.currentTitle) errors.currentTitle = 'Required';
        if (next.yearsExperience === null || !(next.yearsExperience >= 0 && next.yearsExperience <= 60)) errors.yearsExperience = 'Enter a number between 0 and 60';
        for (const k of ['linkedinUrl', 'portfolioUrl', 'githubUrl']) {
          if (next[k] && !/^https?:\/\//i.test(next[k])) next[k] = `https://${next[k]}`;
        }
        Object.assign(state.profile, next);
        if (Object.keys(errors).length) {
          state.errors = errors;
          views.details();
          $('.invalid')?.focus();
          return;
        }
        setBusy(true, 'Saving…');
        const ok = await persist(next, { silent: true });
        setBusy(false);
        if (ok) goTo(3); else renderNav({});
      };
    },

    // ---------------------------------------------------- 4/5. questionnaire
    questions(step) {
      const ctx = qctx();
      state.profile.answers = Questions.applyDefaults(ctx);
      const visible = Questions.visibleQuestions(qctx()).filter((q) => step.sections.includes(q.section));
      const missing = new Set(state.errors.missing || []);
      const sections = Questions.SECTIONS.filter((s) => step.sections.includes(s.id) && visible.some((q) => q.section === s.id));

      $('#panel').innerHTML = `
        <h1>${esc(step.label)}</h1>
        <p class="lead">${step.id === 'location'
          ? `Tailored to ${esc(Countries.getCountry(state.profile.country)?.name || 'your country')}. These answers are reused on every application, so you never type them again.`
          : 'Quick taps. You can change any of these later from the extension.'}</p>
        ${sections.map((s) => `
          <div class="q-section">
            <h2>${esc(s.title)}</h2>
            <p>${esc(s.subtitle)}</p>
            ${visible.filter((q) => q.section === s.id).map((q) => questionCard(q, missing.has(q.id))).join('')}
          </div>`).join('')}`;

      $('#panel').onclick = (e) => {
        const opt = e.target.closest('.option');
        if (!opt) return;
        const { qid, value, multi } = opt.dataset;
        const answers = { ...state.profile.answers };
        if (multi === 'true') {
          const set = new Set(answers[qid] || []);
          set.has(value) ? set.delete(value) : set.add(value);
          answers[qid] = Array.from(set);
        } else {
          answers[qid] = value;
          // changing a status re-derives its sponsorship default
          if (qid.startsWith('status_')) delete answers[qid.replace('status_', 'sponsor_')];
        }
        state.profile.answers = answers;
        state.errors.missing = (state.errors.missing || []).filter((id) => id !== qid);
        const y = window.scrollY;
        views.questions(step);
        window.scrollTo(0, y);
        saveDraft();
      };

      renderNav({});
      $('#next-btn').onclick = async () => {
        const stillMissing = Questions.missingRequired(qctx()).filter((q) => step.sections.includes(q.section));
        if (stillMissing.length) {
          state.errors.missing = stillMissing.map((q) => q.id);
          views.questions(step);
          document.querySelector('.question.missing')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          toast(`${stillMissing.length} question${stillMissing.length > 1 ? 's' : ''} left on this page`);
          return;
        }
        setBusy(true, 'Saving…');
        const ok = await persist({ answers: state.profile.answers }, { silent: true });
        setBusy(false);
        if (ok) goTo(state.stepIndex + 1); else renderNav({});
      };
    },

    // ---------------------------------------------------- 6. preferences
    preferences() {
      const p = state.profile;
      const prefs = { salaryPeriod: Countries.regionOf(p.country) === 'GCC' ? 'month' : 'year', ...p.preferences };
      if (!prefs.roles?.length && p.currentTitle) prefs.roles = [p.currentTitle];
      if (!prefs.salaryCurrency) prefs.salaryCurrency = Countries.getCountry(p.country)?.currency || 'USD';
      state.profile.preferences = prefs;
      const currencies = Array.from(new Set(['USD', 'EUR', 'GBP', 'AED', 'SAR', ...Countries.COUNTRIES.map((c) => c.currency)]));
      const seniority = Questions.visibleQuestions(qctx()).find((q) => q.id === 'seniority');

      $('#panel').innerHTML = `
        <h1>What are you looking for?</h1>
        <p class="lead">We use this to search LinkedIn for you and to answer salary questions consistently.</p>
        <div class="form-grid">
          <div class="field full">
            <label>Job titles you want</label>
            <div class="chips ${state.errors.roles ? 'invalid' : ''}" id="roles-chips"></div>
            ${state.errors.roles ? `<span class="error-text">${esc(state.errors.roles)}</span>` : '<span class="hint">Add 1-5 titles, e.g. "Backend Engineer", "AI Engineer".</span>'}
          </div>
          <div class="field full">
            <label for="locations">Preferred job locations <span class="subtle">(optional)</span></label>
            <input class="input" id="locations" value="${esc(prefs.locations || p.city || '')}" placeholder="Dubai, Abu Dhabi, Remote">
          </div>
          <div class="field full">
            <label for="salaryAmount">Expected salary</label>
            <div class="salary-row">
              <input class="input ${state.errors.salaryAmount ? 'invalid' : ''}" id="salaryAmount" type="number" min="0" step="100" value="${esc(prefs.salaryAmount || '')}" placeholder="e.g. 20000">
              <select class="input" id="salaryCurrency">${currencies.map((c) => `<option ${c === prefs.salaryCurrency ? 'selected' : ''}>${c}</option>`).join('')}</select>
              <div class="segmented" role="radiogroup" id="salaryPeriod">
                <button type="button" data-v="month" aria-checked="${prefs.salaryPeriod === 'month'}">Per month</button>
                <button type="button" data-v="year" aria-checked="${prefs.salaryPeriod === 'year'}">Per year</button>
              </div>
            </div>
            ${state.errors.salaryAmount ? `<span class="error-text">${esc(state.errors.salaryAmount)}</span>` : '<span class="hint">Converted automatically when a form asks for monthly vs. yearly.</span>'}
          </div>
        </div>
        <div style="margin-top:28px">${questionCard(seniority, (state.errors.missing || []).includes('seniority'))}</div>`;

      chipsInput($('#roles-chips'), prefs.roles || [], (roles) => { state.profile.preferences.roles = roles.slice(0, 5); }, 'Add a job title');
      $('#salaryPeriod').onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        state.profile.preferences.salaryPeriod = b.dataset.v;
        $('#salaryPeriod').querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      };
      $('#panel').onclick = (e) => {
        const opt = e.target.closest('.option');
        if (!opt) return;
        state.profile.answers = { ...state.profile.answers, seniority: opt.dataset.value };
        opt.parentElement.querySelectorAll('.option').forEach((o) => o.setAttribute('aria-checked', String(o === opt)));
      };

      renderNav({});
      $('#next-btn').onclick = async () => {
        const pr = state.profile.preferences;
        pr.locations = $('#locations').value.trim();
        pr.salaryAmount = Number($('#salaryAmount').value) || null;
        pr.salaryCurrency = $('#salaryCurrency').value;
        const errors = {};
        if (!pr.roles?.length) errors.roles = 'Add at least one job title';
        if (!pr.salaryAmount) errors.salaryAmount = 'Enter the salary you expect';
        if (!state.profile.answers.seniority) errors.missing = ['seniority'];
        if (Object.keys(errors).length) { state.errors = errors; views.preferences(); return; }
        setBusy(true, 'Saving…');
        const ok = await persist({ preferences: pr, answers: state.profile.answers }, { silent: true });
        setBusy(false);
        if (ok) goTo(state.stepIndex + 1); else renderNav({});
      };
    },

    // ---------------------------------------------------- 7. automation
    automation() {
      const s = self.JobFlowSettings.normalize(state.profile.settings);
      state.profile.settings = s;
      const tile = (group, value, title, desc, badge) => `
        <button type="button" class="tile" role="radio" data-group="${group}" data-value="${value}" aria-checked="${String(s[group]) === String(value)}">
          <strong>${esc(title)} ${badge ? `<span class="pill pill-accent">${esc(badge)}</span>` : ''}</strong><span>${esc(desc)}</span>
        </button>`;

      $('#panel').innerHTML = `
        <h1>How should JobFlow apply?</h1>
        <p class="lead">You can change any of this later from Settings in the extension menu or on the JobFlow bar.</p>

        <div class="q-section">
          <h2>Submitting</h2>
          <div class="tiles" role="radiogroup">
            ${tile('mode', 'review', 'Fill, then I submit', 'JobFlow completes every step and waits for you to click Submit.', 'Recommended to start')}
            ${tile('mode', 'auto', 'Fully automatic', 'Fills, submits and moves on by itself. Only stops to ask about questions it can’t answer.')}
          </div>
        </div>

        <div class="q-section">
          <h2>Daily limit</h2>
          <p>Applying at a human pace protects your LinkedIn account.</p>
          <div class="tiles" role="radiogroup">
            ${tile('dailyLimit', 10, '10 per day', 'Careful and targeted')}
            ${tile('dailyLimit', 25, '25 per day', 'A solid daily routine', 'Recommended')}
            ${tile('dailyLimit', 50, '50 per day', 'High volume')}
          </div>
        </div>

        <div class="q-section">
          <h2>When a question isn't covered by your answers</h2>
          <div class="tiles" role="radiogroup">
            ${tile('useAI', true, 'Let AI answer from my profile, then ask me', 'AI only uses facts from your CV and answers. Anything it isn’t sure about pops up for you to answer.', 'Recommended')}
            ${tile('useAI', false, 'Always ask me', 'A pop-up asks you about every new question. Your answer is remembered for next time.')}
          </div>
        </div>

        <div class="alert alert-warning">LinkedIn doesn't allow automated applying in its terms. Use sensible limits to keep your account safe. You're responsible for what's submitted.</div>`;

      $('#panel').onclick = (e) => {
        const t = e.target.closest('.tile');
        if (!t) return;
        const raw = t.dataset.value;
        const v = t.dataset.group === 'dailyLimit' ? Number(raw) : t.dataset.group === 'useAI' ? raw === 'true' : raw;
        state.profile.settings = { ...state.profile.settings, [t.dataset.group]: v };
        t.parentElement.querySelectorAll('.tile').forEach((x) => x.setAttribute('aria-checked', String(x === t)));
      };

      renderNav({ nextLabel: state.profile.onboardingCompleted ? 'Save settings' : 'Finish setup' });
      $('#next-btn').onclick = async () => {
        setBusy(true, 'Finishing…');
        const ok = await persist({ settings: self.JobFlowSettings.normalize(state.profile.settings), onboardingCompleted: true }, { silent: true });
        setBusy(false);
        if (ok) {
          await chrome.storage.local.remove(DRAFT_KEY);
          goTo(STEPS.length - 1);
        } else renderNav({});
      };
    },

    // ---------------------------------------------------- 8. done
    done() {
      const p = state.profile;
      const country = Countries.getCountry(p.country)?.name || '';
      const e = Questions.eligibilityFor(null, qctx());
      const roles = (p.preferences?.roles || []).join(', ');
      $('#panel').innerHTML = `
        <div class="done-hero">
          <div class="big"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></div>
          <h1>You're ready to apply</h1>
          <p class="lead" style="margin:8px auto 0">Open LinkedIn and JobFlow takes it from there. A bar at the bottom of the jobs page lets you start, pause and see progress.</p>
        </div>
        <div class="summary">
          <div class="card"><div class="k">Applying as</div><div class="v">${esc(`${p.firstName} ${p.lastName}`)} · ${esc(p.currentTitle || '')}</div></div>
          <div class="card"><div class="k">Looking for</div><div class="v">${esc(roles || '—')}</div></div>
          <div class="card"><div class="k">Based in</div><div class="v">${esc([p.city, country].filter(Boolean).join(', '))} · ${e.authorized ? 'authorized to work' : 'needs a work visa'}</div></div>
          <div class="card"><div class="k">Mode</div><div class="v">${p.settings?.mode === 'auto' ? 'Fully automatic' : 'Review before submit'} · ${esc(p.settings?.dailyLimit || 25)}/day</div></div>
        </div>
        <div class="cta-row">
          <button class="btn btn-primary btn-lg" id="start-btn">Start applying on LinkedIn →</button>
          <button class="btn btn-secondary btn-lg" id="dash-btn">Open dashboard</button>
        </div>
        <p class="subtle" style="text-align:center;margin-top:18px;font-size:13px">Need to change something? Click any step on the left.</p>`;
      $('#nav').hidden = true;
      $('#start-btn').onclick = () => {
        const role = (p.preferences?.roles || [p.currentTitle || ''])[0] || '';
        const location = (p.preferences?.locations || '').split(',')[0].trim() || country;
        const url = new URL('https://www.linkedin.com/jobs/search/');
        url.searchParams.set('keywords', role);
        if (location && !/remote/i.test(location)) url.searchParams.set('location', location);
        url.searchParams.set('f_AL', 'true');
        chrome.tabs.create({ url: url.toString() });
      };
      $('#dash-btn').onclick = () => chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD' });
    }
  };

  function questionCard(q, isMissing) {
    if (!q) return '';
    const value = state.profile.answers?.[q.id];
    const multi = q.type === 'multi';
    return `<div class="card question ${isMissing ? 'missing' : ''}" id="q-${esc(q.id)}">
      <h3>${esc(q.title)} ${multi ? '<span class="q-type">· choose all that apply</span>' : ''}</h3>
      ${q.help ? `<p class="q-help">${esc(q.help)}</p>` : ''}
      ${isMissing ? '<p class="error-text" style="margin-top:6px">Please choose an answer.</p>' : ''}
      <div class="options" role="${multi ? 'group' : 'radiogroup'}" aria-label="${esc(q.title)}">
        ${q.options.map((o) => {
          const checked = multi ? (value || []).includes(o.value) : value === o.value;
          return `<button type="button" class="option" role="${multi ? 'checkbox' : 'radio'}" data-qid="${esc(q.id)}" data-value="${esc(o.value)}" data-multi="${multi}" aria-checked="${checked}">
            <span class="box"></span><span>${esc(o.label)}</span></button>`;
        }).join('')}
      </div>
    </div>`;
  }

  function chipsInput(container, initial, onChange, placeholder) {
    let items = [...initial];
    const draw = () => {
      container.innerHTML = items.map((s, i) => `<span class="chip">${esc(s)}<button type="button" data-i="${i}" aria-label="Remove ${esc(s)}">×</button></span>`).join('') +
        `<input type="text" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">`;
      const input = container.querySelector('input');
      input.onkeydown = (e) => {
        if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
          e.preventDefault();
          const v = input.value.trim().replace(/,$/, '');
          if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) items.push(v);
          onChange(items);
          draw();
          container.querySelector('input').focus();
        } else if (e.key === 'Backspace' && !input.value && items.length) {
          items.pop();
          onChange(items);
          draw();
          container.querySelector('input').focus();
        }
      };
      input.onblur = () => {
        const v = input.value.trim();
        if (v && !items.some((x) => x.toLowerCase() === v.toLowerCase())) { items.push(v); onChange(items); draw(); }
      };
    };
    container.onclick = (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) { items.splice(Number(b.dataset.i), 1); onChange(items); draw(); }
      else container.querySelector('input')?.focus();
    };
    draw();
  }

  // ---------------------------------------------------------------- CV
  async function handleCv(file) {
    const c = state.cv;
    Object.assign(c, { file, status: 'working', stages: { read: 'active' }, error: '' });
    views.cv();
    let text;
    try {
      text = await self.JobFlowCvReader.readCv(file);
      c.stages.read = 'done';
    } catch (err) {
      Object.assign(c, { status: 'idle', error: err.message, stages: { read: 'fail' } });
      return views.cv();
    }

    c.stages.upload = 'active';
    c.stages.parse = 'active';
    views.cv();

    const uploadP = Api.uploadCv(file)
      .then((path) => { c.stages.upload = 'done'; return path; })
      .catch((err) => { c.stages.upload = 'fail'; console.warn('CV upload failed', err); return null; })
      .finally(() => state.stepIndex === 1 && views.cv());

    const parseP = Api.parseCv(text)
      .then((res) => { c.stages.parse = 'done'; return res.profile; })
      .catch((err) => { c.stages.parse = 'fail'; c.error = `AI couldn't read your CV (${err.message}). You can enter your details manually on the next step.`; return null; })
      .finally(() => state.stepIndex === 1 && views.cv());

    const [path, parsed] = await Promise.all([uploadP, parseP]);
    const p = state.profile;
    if (parsed) applyParsed(parsed);
    if (path) {
      p.cvPath = path;
      p.cvFileName = file.name;
      persist({ cvPath: path, cvFileName: file.name }, { silent: true });
    }
    c.status = parsed ? 'done' : 'failed-parse';
    saveDraft();
    if (state.stepIndex === 1) {
      views.cv();
      if (parsed) toast('Got it! Review your details next.');
    }
  }

  function applyParsed(parsed) {
    const p = state.profile;
    {
      // Only fill fields the user hasn't set yet
      for (const [k, v] of Object.entries(parsed)) {
        const empty = p[k] === undefined || p[k] === null || p[k] === '' || (Array.isArray(p[k]) && p[k].length === 0);
        if (empty && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) p[k] = v;
      }
      if (parsed.phone) {
        const digits = parsed.phone.replace(/[^\d+]/g, '');
        const match = digits.startsWith('+') && Countries.COUNTRIES
          .filter((co) => digits.slice(1).startsWith(co.dial))
          .sort((a, b) => b.dial.length - a.dial.length)[0];
        if (match) {
          p.phoneCountryCode = match.dial;
          p.phone = digits.slice(1 + match.dial.length).replace(/^0+/, '');
        } else {
          p.phone = digits.replace(/^\+/, '').replace(/^0+/, '');
        }
      }
    }
  }

  // ---------------------------------------------------------------- boot
  async function loadProfile() {
    const [remote, draftRes] = await Promise.all([
      Api.getProfile(),
      chrome.storage.local.get(DRAFT_KEY)
    ]);
    const draft = draftRes[DRAFT_KEY];
    state.profile = { answers: {}, preferences: {}, settings: {}, ...remote };
    // A local draft newer than the server copy wins for unsaved questionnaire answers
    if (draft?.profile && !remote?.onboardingCompleted) {
      state.profile = {
        ...draft.profile,
        ...Object.fromEntries(Object.entries(remote || {}).filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && !v.length))),
        answers: { ...(draft.profile.answers || {}), ...(remote?.answers || {}) },
        preferences: { ...(draft.profile.preferences || {}), ...(remote?.preferences || {}) }
      };
      return draft.stepIndex;
    }
    return null;
  }

  function render() {
    renderRail();
    const step = STEPS[state.stepIndex];
    $('#panel').onclick = null;
    if (step.sections) views.questions(step);
    else views[step.id]();
    document.title = `${step.label} · JobFlow AI`;
  }

  document.addEventListener('click', async (e) => {
    const stepBtn = e.target.closest('.step[data-clickable="true"]');
    if (stepBtn) return goTo(Number(stepBtn.dataset.step));
    if (e.target.id === 'back-btn') return goTo(state.stepIndex - 1);
    if (e.target.id === 'signout-btn') {
      await Api.signOut();
      await chrome.storage.local.remove(DRAFT_KEY);
      chrome.runtime.sendMessage({ type: 'INVALIDATE' }).catch(() => {});
      location.hash = '';
      location.reload();
    }
  });

  async function boot() {
    try {
      state.session = await Api.getSession();
    } catch (err) {
      $('#panel').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
      return;
    }
    let target = 0;
    if (state.session) {
      const draftStep = await loadProfile().catch(() => null);
      const hash = location.hash.replace('#', '');
      const hashIndex = STEPS.findIndex((s) => s.id === hash);
      if (hashIndex > 0) target = hashIndex;
      else if (state.profile.onboardingCompleted) target = STEPS.length - 1;
      else if (draftStep) target = draftStep;
      else target = state.profile.cvFileName ? 2 : 1;
    }
    goTo(target);
  }

  boot();
})();
