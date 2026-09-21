/* JobFlow AI - settings page */
(async function () {
  const Api = self.JobFlowApi;
  const S = self.JobFlowSettings;
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let saved = null;
  let draft = null;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  const dirty = () => JSON.stringify(draft) !== JSON.stringify(saved);
  const syncSavebar = () => { $('#savebar').hidden = !dirty(); };

  let session;
  try {
    session = await Api.getSession();
  } catch (err) {
    $('#main').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    return;
  }
  if (!session) {
    $('#main').innerHTML = `<div class="card section"><h2>Sign in to change your settings</h2><p class="muted">Your settings are saved to your JobFlow account.</p><div><button class="btn btn-primary" id="signin">Sign in</button></div></div>`;
    $('#signin').onclick = () => chrome.runtime.sendMessage({ type: 'OPEN_ONBOARDING' });
    return;
  }
  $('#who').textContent = session.user.email;

  const profile = await Api.getProfile();
  saved = S.normalize(profile.settings);
  draft = { ...saved };
  const defaultTitles = S.searchTitles(profile, { searchKeywords: '' });
  const defaultPlaces = [...String(profile.preferences?.locations || '').split(','), profile.city]
    .map((x) => String(x || '').trim()).filter(Boolean)
    .filter((x, i, arr) => arr.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i).join(', ');

  const tile = (key, value, title, desc, badge) => `
    <button type="button" class="tile" role="radio" data-key="${key}" data-value="${esc(value)}" aria-checked="${String(draft[key]) === String(value)}">
      <strong>${esc(title)} ${badge ? `<span class="pill pill-accent">${esc(badge)}</span>` : ''}</strong><span>${esc(desc)}</span>
    </button>`;
  const toggle = (key, title, desc) => `
    <div class="row"><div class="text"><strong>${esc(title)}</strong><span>${esc(desc)}</span></div>
      <label class="switch control"><input type="checkbox" data-key="${key}" ${draft[key] ? 'checked' : ''} aria-label="${esc(title)}"><span class="track"></span></label></div>`;
  const seg = (key, options) => `<div class="segmented control" role="radiogroup">${options.map(([v, l]) =>
    `<button type="button" data-key="${key}" data-value="${esc(v)}" aria-checked="${String(draft[key]) === String(v)}">${esc(l)}</button>`).join('')}</div>`;

  function render() {
    $('#main').innerHTML = `
      <div class="page-title">
        <h1>Settings</h1>
        <p>Control how JobFlow applies for you. Pace and mode changes apply from the next job; new titles and locations from the next search.</p>
      </div>

      <section class="card section">
        <header><h2>What to apply for</h2><p>JobFlow searches LinkedIn for these titles and places, one search after another. Separate with commas.</p></header>
        <div class="fields">
          <div class="field full"><label for="searchKeywords">Job titles</label><input class="input" id="searchKeywords" data-key="searchKeywords" placeholder="${esc(defaultTitles.join(', ') || 'Product manager, Data analyst')}" value="${esc(draft.searchKeywords)}"><span class="hint">${defaultTitles.length ? `Empty = your job preferences (${esc(defaultTitles.join(', '))}).` : 'For example: Product manager, Data analyst.'}</span></div>
          <div class="field full"><label for="searchLocations">Locations</label><input class="input" id="searchLocations" data-key="searchLocations" placeholder="${esc(defaultPlaces || 'Dubai, Abu Dhabi, Remote')}" value="${esc(draft.searchLocations)}"><span class="hint">Add “Remote” for remote roles open to your country. Empty = ${esc(defaultPlaces || 'your city')}.</span></div>
        </div>
        ${toggle('matchSearchTitles', 'Only apply when the job title matches', 'LinkedIn search also returns loosely related jobs (a “Software developer C++” for “AI Engineer”). Skip any job whose title doesn’t contain one of your titles.')}
        ${toggle('keepSearching', 'Keep going when a search runs out', 'Moves on to the next title and place, then the whole country, remote roles and older posts, instead of stopping.')}
      </section>

      <section class="card section">
        <header><h2>How applications are sent</h2><p>Pick how hands-on you want to be.</p></header>
        <div class="tiles" role="radiogroup">
          ${tile('mode', 'review', 'Fill, then I submit', 'JobFlow completes every step and waits on the final screen for you to click Submit.')}
          ${tile('mode', 'auto', 'Fully automatic', 'JobFlow fills, submits and moves to the next job on its own. It only stops to ask you about questions it can’t answer.', 'Hands-free')}
        </div>
        ${draft.mode === 'auto' ? '<div class="alert alert-warning warn">Fully automatic submits real applications without showing them to you first. Start with a small per-run limit and check your dashboard.</div>' : ''}
      </section>

      <section class="card section">
        <header><h2>Limits & pace</h2><p>Applying at a human pace protects your LinkedIn account.</p></header>
        ${toggle('noDailyLimit', 'No daily limit', 'Keep applying until your monthly applications run out. Pace, breaks and LinkedIn’s own warnings still stop a run.')}
        ${draft.noDailyLimit ? '<div class="alert alert-warning warn">LinkedIn caps Easy Apply per day and pauses accounts that apply too fast. Without a limit, a long run is more likely to get your account paused.</div>' : `
        <div class="row"><div class="text"><strong>Applications per day</strong><span>Up to 50. LinkedIn slows down accounts that apply much faster than a person would.</span></div>
          <input class="input control" type="number" min="1" max="50" id="dailyLimit" data-key="dailyLimit" value="${draft.dailyLimit}"></div>`}
        <div class="row"><div class="text"><strong>Applications per run</strong><span>Each time you press Start, stop after this many.</span></div>
          <input class="input control" type="number" min="1" max="50" id="maxPerRun" data-key="maxPerRun" value="${draft.maxPerRun}"></div>
        <div class="row"><div class="text"><strong>Pace between applications</strong><span>Careful waits 1–2 minutes, Normal 30–60 seconds, Fast 15–30 seconds, Turbo 6–12 seconds. Longer breaks are added every few applications.</span></div>
          ${seg('pace', [['careful', 'Careful'], ['normal', 'Normal'], ['fast', 'Fast'], ['turbo', 'Turbo']])}</div>
        ${draft.pace === 'turbo' ? '<div class="alert alert-warning warn">Turbo is how accounts get Easy Apply paused. LinkedIn watches for members who apply “unusually fast”. If it pauses you, JobFlow stops for 12 hours.</div>' : ''}
      </section>

      <section class="card section">
        <header><h2>Questions JobFlow doesn’t know</h2><p>Your saved answers are always used first.</p></header>
        ${toggle('useAI', 'Let AI answer from my profile', 'Uses only facts from your CV and questionnaire. If it isn’t sure, it won’t guess.')}
        <div class="row"><div class="text"><strong>If a question still can’t be answered</strong><span>A pop-up appears over LinkedIn so you can answer it on the spot.</span></div>
          ${seg('whenUnknown', [['ask', 'Ask me'], ['skip', 'Skip the job']])}</div>
        ${draft.whenUnknown === 'ask' ? `<div class="row"><div class="text"><strong>If I don’t answer the pop-up</strong><span>Useful when you leave fully automatic mode running.</span></div>
          ${seg('askTimeoutSec', [['0', 'Wait for me'], ['60', 'Skip after 1 min'], ['300', 'Skip after 5 min']])}</div>` : ''}
        ${toggle('rememberAnswers', 'Remember my pop-up answers', 'Answer once and JobFlow reuses it on every future application. Edit them in your dashboard.')}
      </section>

      <section class="card section">
        <header><h2>Which jobs to apply to</h2><p>Filters are checked before a job is opened. Separate words with commas.</p></header>
        <div class="fields">
          <div class="field"><label for="titleInclude">Only titles containing</label><input class="input" id="titleInclude" data-key="titleInclude" placeholder="engineer, developer" value="${esc(draft.titleInclude)}"><span class="hint">Leave empty to allow any title.</span></div>
          <div class="field"><label for="titleExclude">Never titles containing</label><input class="input" id="titleExclude" data-key="titleExclude" placeholder="senior, lead, principal" value="${esc(draft.titleExclude)}"></div>
          <div class="field full"><label for="skipCompanies">Never apply to these companies</label><input class="input" id="skipCompanies" data-key="skipCompanies" placeholder="Current employer, Recruiting agency" value="${esc(draft.skipCompanies)}"></div>
        </div>
        ${toggle('skipPromoted', 'Skip promoted jobs', 'Promoted listings are paid ads and often get more applicants.')}
        ${toggle('skipJobBoards', 'Skip job boards and bulk recruiters', 'Listings re-posted by sites like Hire Feed, Hired or Synthires usually just collect CVs. Applying directly to the employer works better.')}
        ${toggle('followCompanies', 'Follow companies I apply to', 'LinkedIn ticks “Follow” by default. Off means JobFlow unticks it.')}
      </section>

      <section class="card section">
        <header><h2>Your profile</h2><p>Update what JobFlow puts on your applications.</p></header>
        <div class="links">
          <button class="btn btn-secondary" type="button" data-open="details">Edit details & CV</button>
          <button class="btn btn-secondary" type="button" data-open="location">Edit eligibility questions</button>
          <button class="btn btn-secondary" type="button" data-open="preferences">Edit job preferences</button>
          <button class="btn btn-ghost" type="button" id="dashboard">Saved answers & dashboard →</button>
        </div>
      </section>`;
  }

  render();

  $('#main').addEventListener('click', (e) => {
    const choice = e.target.closest('[data-key][data-value]');
    if (choice) {
      const key = choice.dataset.key;
      draft[key] = key === 'askTimeoutSec' ? Number(choice.dataset.value) : choice.dataset.value;
      render();
      syncSavebar();
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) chrome.runtime.sendMessage({ type: 'OPEN_ONBOARDING', payload: { step: open.dataset.open } });
    if (e.target.id === 'dashboard') chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', payload: { tab: 'answers' } });
  });
  $('#main').addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    if (e.target.type === 'checkbox') {
      draft[key] = e.target.checked;
      if (key === 'noDailyLimit') render();
    }
    else if (e.target.type === 'number') draft[key] = e.target.value === '' ? '' : Number(e.target.value);
    else draft[key] = e.target.value;
    syncSavebar();
  });
  $('#discard').onclick = () => { draft = { ...saved }; render(); syncSavebar(); };
  $('#save').onclick = async () => {
    const btn = $('#save');
    btn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: draft });
      if (!res?.ok) throw new Error(res?.error || 'Could not save');
      saved = S.normalize(res.data.settings);
      draft = { ...saved };
      render();
      syncSavebar();
      toast('Settings saved');
    } catch (err) {
      toast(`Couldn’t save: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  };
  window.addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
})();
