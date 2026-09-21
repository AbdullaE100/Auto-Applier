/* JobFlow AI - toolbar popup */
(async function () {
  const root = document.getElementById('root');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const send = (type, payload) => chrome.runtime.sendMessage({ type, payload });
  const openOnboarding = (step) => { send('OPEN_ONBOARDING', { step }); window.close(); };

  let res;
  try {
    res = await send('GET_CONTEXT', { force: true });
  } catch (err) {
    res = { ok: false, error: err.message };
  }
  const ctx = res?.data || { signedIn: false, error: res?.error };

  if (ctx.error && /not configured/.test(ctx.error)) {
    root.innerHTML = `<div class="alert alert-error">${esc(ctx.error)}</div>`;
    return;
  }

  if (!ctx.signedIn) {
    root.innerHTML = `
      <div class="empty">
        <h2>Apply to jobs 10× faster</h2>
        <p>Upload your CV, answer a few quick questions, and JobFlow fills LinkedIn Easy Apply forms for you.</p>
        <button class="btn btn-primary btn-lg btn-block" id="start">Get started, it's free</button>
        <button class="btn btn-ghost btn-block" id="signin">I already have an account</button>
      </div>`;
    document.getElementById('start').onclick = () => openOnboarding();
    document.getElementById('signin').onclick = () => openOnboarding();
    return;
  }

  const p = ctx.profile || {};
  const u = ctx.usage;
  if (u) {
    const pill = document.getElementById('plan-pill');
    pill.textContent = `${u.planName} plan`;
    pill.className = `pill ${u.plan === 'free' ? '' : 'pill-accent'}`;
    pill.hidden = false;
  }

  if (!ctx.onboarded) {
    root.innerHTML = `
      <div class="empty">
        <h2>Finish setting up</h2>
        <p>A few more steps and JobFlow can start filling applications for you.</p>
        <button class="btn btn-primary btn-lg btn-block" id="resume">Continue setup</button>
      </div>
      <div class="foot"><span>${esc(ctx.email)}</span><button id="signout">Sign out</button></div>`;
    document.getElementById('resume').onclick = () => openOnboarding();
    bindSignout();
    return;
  }

  const initials = `${(p.firstName || '?')[0]}${(p.lastName || '')[0] || ''}`.toUpperCase();
  const pct = u ? Math.min(100, Math.round((u.used / Math.max(1, u.monthlyLimit)) * 100)) : 0;
  const resetDate = u ? new Date(u.periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const role = (p.preferences?.roles || [p.currentTitle])[0] || '';
  const s = self.JobFlowSettings.normalize(p.settings);

  root.innerHTML = `
    <div class="profile">
      <div class="avatar">${esc(initials)}</div>
      <div style="min-width:0">
        <div class="name">${esc(`${p.firstName} ${p.lastName}`)}</div>
        <div class="sub">${esc(role)}${p.city ? ` · ${esc(p.city)}` : ''}</div>
      </div>
    </div>

    ${u ? `<div class="card box">
      <div class="meter-head"><span class="muted">Applications this month</span><span><strong>${u.remaining}</strong> <span class="subtle">left</span></span></div>
      <div class="meter ${u.remaining <= Math.ceil(u.monthlyLimit * 0.1) ? 'low' : ''}"><div style="width:${pct}%"></div></div>
      <div class="meter-foot"><span>${u.used} of ${u.monthlyLimit} used</span><span>Resets ${esc(resetDate)}</span></div>
    </div>` : ''}

    <div class="card box">
      <div class="toggle-row" style="margin-bottom:10px"><span class="muted">Applying mode</span><span class="subtle">${s.noDailyLimit ? 'No daily limit' : `${esc(s.dailyLimit)}/day`} · ${esc(s.maxPerRun)}/run</span></div>
      <div class="mode-switch" role="radiogroup" aria-label="Applying mode">
        <button type="button" data-mode="review" aria-checked="${s.mode === 'review'}"><strong>Review</strong><span>I click Submit</span></button>
        <button type="button" data-mode="auto" aria-checked="${s.mode === 'auto'}"><strong>Automatic</strong><span>Hands-free</span></button>
      </div>
    </div>

    ${u && u.remaining <= 0 ? '<div class="alert alert-warning">You\'ve used this month\'s applications. Upgrade for more.</div>' : ''}

    <button class="btn btn-primary btn-lg btn-block" id="go">Find jobs on LinkedIn</button>

    <div class="links">
      <button class="btn btn-secondary" id="settings">Settings</button>
      <button class="btn btn-secondary" id="dash">Dashboard</button>
    </div>
    <div class="foot"><span>${esc(ctx.email)}</span><button id="signout">Sign out</button></div>`;

  document.getElementById('go').onclick = () => {
    const url = new URL('https://www.linkedin.com/jobs/search/');
    if (role) url.searchParams.set('keywords', role);
    const loc = (p.preferences?.locations || '').split(',')[0].trim();
    if (loc && !/remote/i.test(loc)) url.searchParams.set('location', loc);
    url.searchParams.set('f_AL', 'true');
    chrome.tabs.create({ url: url.toString() });
    window.close();
  };
  document.getElementById('settings').onclick = () => { send('OPEN_SETTINGS'); window.close(); };
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.getAttribute('aria-checked') === 'true') return;
      document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
      const res = await send('SAVE_SETTINGS', { ...s, mode: btn.dataset.mode });
      if (!res?.ok) {
        document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === s.mode)));
        return;
      }
      s.mode = btn.dataset.mode;
    };
  });
  document.getElementById('dash').onclick = () => { send('OPEN_DASHBOARD'); window.close(); };
  bindSignout();

  function bindSignout() {
    document.getElementById('signout').onclick = async () => {
      await self.JobFlowApi.signOut();
      await send('INVALIDATE');
      location.reload();
    };
  }
})();
