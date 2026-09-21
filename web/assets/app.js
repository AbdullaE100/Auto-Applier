/* JobFlow AI - dashboard */
(async function () {
  const cfg = window.JOBFLOW_CONFIG;
  const Countries = window.JobFlowCountries;
  const $ = (sel) => document.querySelector(sel);
  const content = $('#content');

  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData.session;
  if (!session) return location.replace(`login.html?next=${encodeURIComponent(location.hash.replace('#', ''))}`);
  const user = session.user;
  $('#user-email').textContent = user.email;

  const STATUSES = [
    { value: 'submitted', label: 'Applied' },
    { value: 'interviewing', label: 'Interviewing' },
    { value: 'offer', label: 'Offer' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'withdrawn', label: 'Withdrawn' }
  ];

  const state = { profile: null, usage: null, applications: [], answers: [], plans: [], waitlist: null };

  // ------------------------------------------------------------- data
  async function load() {
    const [profile, usage, apps, answers, plans, waitlist] = await Promise.all([
      sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
      sb.rpc('get_usage'),
      sb.from('applications').select('*').order('applied_at', { ascending: false }).limit(1000),
      sb.from('saved_answers').select('*').order('updated_at', { ascending: false }).limit(500),
      sb.from('plans').select('*').order('sort_order'),
      sb.from('waitlist').select('*').eq('user_id', user.id).maybeSingle()
    ]);
    for (const r of [profile, usage, apps, answers, plans]) if (r.error) throw r.error;
    state.profile = profile.data || {};
    state.usage = usage.data;
    state.applications = apps.data || [];
    state.answers = answers.data || [];
    state.plans = plans.data || [];
    state.waitlist = waitlist.data;
    const pending = state.answers.filter((a) => !a.answer).length;
    $('#pending-count').textContent = pending;
    $('#pending-count').hidden = pending === 0;
  }

  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const statusPill = (s) => {
    const cls = { interviewing: 'pill-accent', offer: 'pill-success', rejected: 'pill-warning' }[s] || '';
    return `<span class="pill ${cls}">${esc(STATUSES.find((x) => x.value === s)?.label || s)}</span>`;
  };

  function download(filename, text, type = 'text/csv') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ------------------------------------------------------------ views
  const views = {
    overview() {
      const p = state.profile;
      const u = state.usage;
      const apps = state.applications;
      const weekAgo = Date.now() - 7 * 864e5;
      const thisWeek = apps.filter((a) => new Date(a.applied_at).getTime() >= weekAgo).length;
      const interviews = apps.filter((a) => ['interviewing', 'offer'].includes(a.status)).length;
      const pending = state.answers.filter((a) => !a.answer).length;
      const days = Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - (13 - i));
        const next = d.getTime() + 864e5;
        return { d, n: apps.filter((a) => { const t = new Date(a.applied_at).getTime(); return t >= d.getTime() && t < next; }).length };
      });
      const max = Math.max(1, ...days.map((x) => x.n));
      const pct = u ? Math.min(100, Math.round((u.used / Math.max(1, u.monthlyLimit)) * 100)) : 0;

      content.innerHTML = `
        <div class="page-head">
          <div><h1>Hi${p.first_name ? `, ${esc(p.first_name)}` : ''}</h1><p>Here's how your job search is going.</p></div>
          ${!p.onboarding_completed ? '<span class="pill pill-warning">Finish setup in the extension to start applying</span>' : ''}
        </div>

        ${!apps.length ? `<div class="card panel-card" style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
          <div><h2 style="margin:0">Ready for your first application?</h2><p class="muted">Install the extension, open LinkedIn Jobs and press Start on the JobFlow bar.</p></div>
          <a class="btn btn-primary" href="${esc(cfg.chromeStoreUrl)}" target="_blank" rel="noopener">Get the extension</a>
        </div>` : ''}

        <div class="grid-4" style="margin-bottom:16px">
          <div class="card stat-card"><div class="k">This month</div><div class="v">${u?.used ?? 0}</div><div class="s">of ${u?.monthlyLimit ?? '—'} applications</div></div>
          <div class="card stat-card"><div class="k">Last 7 days</div><div class="v">${thisWeek}</div><div class="s">applications sent</div></div>
          <div class="card stat-card"><div class="k">Interviews</div><div class="v">${interviews}</div><div class="s">${apps.length ? `${Math.round((interviews / apps.length) * 100)}% response rate` : 'mark them in Applications'}</div></div>
          <div class="card stat-card"><div class="k">AI answers today</div><div class="v">${u?.aiUsedToday ?? 0}</div><div class="s">of ${u?.aiDailyLimit ?? '—'} per day</div></div>
        </div>

        <div class="grid-2">
          <div class="card panel-card">
            <h2>Applications, last 14 days</h2>
            <div class="bars">${days.map((x) => `<div class="bar" title="${x.n} on ${x.d.toDateString()}"><i style="height:${Math.round((x.n / max) * 100)}%"></i><span>${x.d.getDate()}</span></div>`).join('')}</div>
          </div>
          <div class="card panel-card">
            <h2>${esc(u?.planName || 'Free')} plan <a href="#plan" style="font-size:13px">Details</a></h2>
            <div class="meter"><div style="width:${pct}%"></div></div>
            <p class="muted" style="font-size:13px">${u?.remaining ?? 0} applications left · resets ${u ? fmtDate(u.periodEnd) : ''}</p>
            ${pending ? `<div class="alert alert-warning" style="margin-top:16px"><strong>${pending} question${pending > 1 ? 's' : ''}</strong> from applications need your answer. <a href="#answers">Answer now</a></div>` : ''}
          </div>
        </div>

        <div class="card" style="margin-top:16px">
          <div class="panel-card" style="padding-bottom:0"><h2>Recent applications <a href="#applications" style="font-size:13px">View all</a></h2></div>
          ${apps.length ? `<div class="table-wrap"><table class="table"><tbody>
            ${apps.slice(0, 6).map((a) => `<tr><td class="company">${esc(a.company)}</td><td>${esc(a.job_title)}</td><td class="subtle">${esc(a.platform)}</td><td class="subtle">${fmtDate(a.applied_at)}</td><td>${statusPill(a.status)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty-state"><p>No applications yet.</p></div>'}
        </div>`;
    },

    applications() {
      const render = () => {
        const q = ($('#app-search')?.value || '').toLowerCase();
        const status = $('#app-status')?.value || '';
        const rows = state.applications.filter((a) => (!status || a.status === status) &&
          (!q || `${a.company} ${a.job_title} ${a.location}`.toLowerCase().includes(q)));
        $('#app-table').innerHTML = rows.length ? `<table class="table">
          <thead><tr><th>Company</th><th>Role</th><th>Source</th><th>Applied</th><th>Status</th></tr></thead>
          <tbody>${rows.map((a) => `<tr data-id="${a.id}">
            <td class="company">${/^https?:\/\//i.test(a.job_url || '') ? `<a href="${esc(a.job_url)}" target="_blank" rel="noopener">${esc(a.company)}</a>` : esc(a.company)}</td>
            <td>${esc(a.job_title)}${a.location ? `<div class="subtle" style="font-size:12px">${esc(a.location)}</div>` : ''}</td>
            <td class="subtle">${esc(a.platform)}</td>
            <td class="subtle" style="white-space:nowrap">${fmtDate(a.applied_at)}</td>
            <td><select class="input status-select" aria-label="Status">${STATUSES.map((s) => `<option value="${s.value}" ${s.value === a.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select></td>
          </tr>`).join('')}</tbody></table>`
          : `<div class="empty-state"><h3>${state.applications.length ? 'No matches' : 'No applications yet'}</h3><p>${state.applications.length ? 'Try a different search or filter.' : 'Applications you send with JobFlow show up here automatically.'}</p></div>`;
      };

      content.innerHTML = `
        <div class="page-head">
          <div><h1>Applications</h1><p>${state.applications.length} total. Update statuses as you hear back.</p></div>
          <button class="btn btn-secondary" id="export-csv" ${state.applications.length ? '' : 'disabled'}>Export CSV</button>
        </div>
        <div class="toolbar">
          <input class="input" id="app-search" placeholder="Search company or role">
          <select class="input" id="app-status" style="max-width:180px"><option value="">All statuses</option>${STATUSES.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}</select>
        </div>
        <div class="card table-wrap" id="app-table"></div>`;
      render();
      $('#app-search').oninput = render;
      $('#app-status').onchange = render;

      $('#app-table').onchange = async (e) => {
        if (!e.target.classList.contains('status-select')) return;
        const id = e.target.closest('tr').dataset.id;
        const { error } = await sb.from('applications').update({ status: e.target.value }).eq('id', id);
        if (error) return toast(error.message);
        state.applications.find((a) => a.id === id).status = e.target.value;
        toast('Status updated');
      };
      $('#export-csv').onclick = () => {
        const cols = ['company', 'job_title', 'location', 'platform', 'status', 'applied_at', 'job_url'];
        const csv = [cols.join(','), ...state.applications.map((a) => cols.map((c) => `"${String(a[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
        download(`jobflow-applications-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      };
    },

    answers() {
      const sorted = [...state.answers].sort((a, b) => Number(Boolean(a.answer)) - Number(Boolean(b.answer)));
      content.innerHTML = `
        <div class="page-head">
          <div><h1>Saved answers</h1><p>Questions from real applications. Your answers here are reused automatically and always beat AI.</p></div>
        </div>
        <div class="card">${sorted.length ? sorted.map((a) => `
          <div class="answer-row ${a.answer ? '' : 'pending'}" data-id="${a.id}">
            <div>
              <div class="q">${esc(a.question)}</div>
              <div class="meta">${a.answer ? (a.source === 'user' ? '<span class="pill pill-success">Your answer</span>' : '<span class="pill pill-accent">AI answer · check it</span>') : '<span class="pill pill-warning">Needs your answer</span>'}${a.times_used ? `<span>Used ${a.times_used}×</span>` : ''}</div>
            </div>
            ${a.options?.length
              ? `<select class="input answer-input"><option value="">Choose…</option>${a.options.map((o) => `<option ${o === a.answer ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
              : `<input class="input answer-input" value="${esc(a.answer || '')}" placeholder="Type your answer">`}
            <div style="display:flex;gap:6px"><button class="btn btn-primary save-answer">Save</button><button class="icon-btn delete-answer" aria-label="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2"/></svg></button></div>
          </div>`).join('') : '<div class="empty-state"><h3>Nothing here yet</h3><p>When an application asks something new, it shows up here so you can answer once.</p></div>'}
        </div>`;

      content.onclick = async (e) => {
        const row = e.target.closest('.answer-row');
        if (!row) return;
        const id = row.dataset.id;
        if (e.target.classList.contains('save-answer')) {
          const value = row.querySelector('.answer-input').value.trim();
          if (!value) return toast('Enter an answer first');
          const { error } = await sb.from('saved_answers').update({ answer: value, source: 'user' }).eq('id', id);
          if (error) return toast(error.message);
          Object.assign(state.answers.find((a) => a.id === id), { answer: value, source: 'user' });
          toast('Saved. JobFlow will use this from now on.');
          await load();
          views.answers();
        }
        if (e.target.classList.contains('delete-answer')) {
          const { error } = await sb.from('saved_answers').delete().eq('id', id);
          if (error) return toast(error.message);
          state.answers = state.answers.filter((a) => a.id !== id);
          views.answers();
        }
      };
    },

    profile() {
      const p = state.profile;
      const prefs = p.preferences || {};
      const f = (id, label, value, type = 'text', extra = '') => `<div class="field ${extra}"><label for="${id}">${label}</label><input class="input" id="${id}" type="${type}" value="${esc(value ?? '')}"></div>`;
      content.innerHTML = `
        <div class="page-head">
          <div><h1>Profile</h1><p>What JobFlow puts on your applications. To redo eligibility questions, open the extension and click “Edit answers”.</p></div>
          ${p.cv_path ? '<button class="btn btn-secondary" id="cv-download">Download my CV</button>' : ''}
        </div>
        <form class="card panel-card" id="profile-form">
          <div class="form-grid">
            ${f('first_name', 'First name', p.first_name)}
            ${f('last_name', 'Last name', p.last_name)}
            ${f('email', 'Email on applications', p.email, 'email')}
            <div class="field"><label for="phone">Mobile (without country code)</label>
              <div style="display:grid;grid-template-columns:120px 1fr;gap:8px">
                <select class="input" id="phone_country_code">${Countries.COUNTRIES.map((c) => `<option value="${c.dial}" ${c.dial === p.phone_country_code ? 'selected' : ''}>${c.code} +${c.dial}</option>`).join('')}</select>
                <input class="input" id="phone" value="${esc(p.phone || '')}">
              </div></div>
            <div class="field"><label for="country">Country</label><select class="input" id="country">${Countries.COUNTRIES.map((c) => `<option value="${c.code}" ${c.code === p.country ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
            ${f('city', 'City', p.city)}
            ${f('current_title', 'Current title', p.current_title)}
            ${f('current_company', 'Current company', p.current_company)}
            ${f('years_experience', 'Years of experience', p.years_experience, 'number')}
            ${f('linkedin_url', 'LinkedIn URL', p.linkedin_url, 'url')}
            <div class="field full"><label for="skills">Skills (comma separated)</label><input class="input" id="skills" value="${esc((p.skills || []).join(', '))}"></div>
            <div class="field full"><label for="summary">Summary</label><textarea class="input" id="summary">${esc(p.summary || '')}</textarea></div>
            <div class="field full"><label for="roles">Target job titles (comma separated)</label><input class="input" id="roles" value="${esc((prefs.roles || []).join(', '))}"></div>
            <div class="field"><label for="salaryAmount">Expected salary</label>
              <div style="display:grid;grid-template-columns:1fr 90px 110px;gap:8px">
                <input class="input" id="salaryAmount" type="number" value="${esc(prefs.salaryAmount || '')}">
                <input class="input" id="salaryCurrency" value="${esc(prefs.salaryCurrency || '')}" maxlength="3">
                <select class="input" id="salaryPeriod"><option value="month" ${prefs.salaryPeriod === 'month' ? 'selected' : ''}>/ month</option><option value="year" ${prefs.salaryPeriod !== 'month' ? 'selected' : ''}>/ year</option></select>
              </div></div>
            ${f('locations', 'Preferred locations', prefs.locations)}
          </div>
          <div class="form-actions"><button class="btn btn-primary btn-lg" type="submit">Save profile</button></div>
        </form>`;

      $('#cv-download')?.addEventListener('click', async () => {
        const { data, error } = await sb.storage.from('cvs').createSignedUrl(p.cv_path, 60);
        if (error) return toast(error.message);
        window.open(data.signedUrl, '_blank');
      });

      $('#profile-form').onsubmit = async (e) => {
        e.preventDefault();
        const v = (id) => $(`#${id}`).value.trim();
        const years = v('years_experience') === '' ? null : Math.max(0, Math.min(60, Math.round(Number(v('years_experience')))));
        const update = {
          first_name: v('first_name'), last_name: v('last_name'), email: v('email'), phone: v('phone').replace(/\D/g, ''),
          phone_country_code: v('phone_country_code'), country: v('country'), city: v('city'), current_title: v('current_title'),
          current_company: v('current_company') || null, years_experience: years, linkedin_url: v('linkedin_url') || null,
          skills: v('skills').split(',').map((s) => s.trim()).filter(Boolean), summary: v('summary') || null,
          preferences: { ...prefs, roles: v('roles').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5), salaryAmount: Number(v('salaryAmount')) || null, salaryCurrency: v('salaryCurrency').toUpperCase(), salaryPeriod: v('salaryPeriod'), locations: v('locations') }
        };
        const { data, error } = await sb.from('profiles').update(update).eq('id', user.id).select('*').single();
        if (error) return toast(error.message);
        state.profile = data;
        toast('Profile saved');
      };
    },

    plan() {
      const u = state.usage;
      content.innerHTML = `
        <div class="page-head"><div><h1>Plan & usage</h1><p>Paid plans are coming soon. Join the waitlist and we'll let you know first.</p></div></div>
        <div class="grid-4" style="margin-bottom:16px">
          <div class="card stat-card"><div class="k">Current plan</div><div class="v">${esc(u?.planName)}</div><div class="s">${esc(u?.status)}</div></div>
          <div class="card stat-card"><div class="k">Applications used</div><div class="v">${u?.used}</div><div class="s">of ${u?.monthlyLimit} this month</div></div>
          <div class="card stat-card"><div class="k">Resets</div><div class="v" style="font-size:20px">${u ? fmtDate(u.periodEnd) : ''}</div></div>
          <div class="card stat-card"><div class="k">AI answers</div><div class="v">${u?.aiUsedToday}</div><div class="s">of ${u?.aiDailyLimit} today</div></div>
        </div>
        <div class="plan-grid">${state.plans.map((pl) => `
          <div class="card plan-card ${pl.id === u?.plan ? 'current' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:18px">${esc(pl.name)}</h2>${pl.id === u?.plan ? '<span class="pill pill-accent">Current</span>' : ''}</div>
            <div class="price">$${(pl.price_cents / 100).toFixed(0)} <small>/ month</small></div>
            <p class="muted">${pl.monthly_applications.toLocaleString()} applications / month<br>${pl.daily_ai_answers.toLocaleString()} AI answers / day</p>
            ${pl.id === u?.plan ? '' : pl.price_cents === 0 ? '' : state.waitlist?.plan_id === pl.id
              ? '<button class="btn btn-secondary" disabled>On the waitlist</button>'
              : `<button class="btn btn-primary join-waitlist" data-plan="${pl.id}">Join waitlist</button>`}
          </div>`).join('')}
        </div>`;
      content.onclick = async (e) => {
        const b = e.target.closest('.join-waitlist');
        if (!b) return;
        const { error } = await sb.from('waitlist').upsert({ user_id: user.id, plan_id: b.dataset.plan });
        if (error) return toast(error.message);
        state.waitlist = { plan_id: b.dataset.plan };
        toast("You're on the waitlist");
        views.plan();
      };
    },

    settings() {
      const S = window.JobFlowSettings;
      const s = S.normalize(state.profile.settings);
      const opt = (name, value, label, desc) => `<label class="card" style="padding:14px;display:flex;gap:10px;cursor:pointer;align-items:flex-start">
        <input type="radio" name="${name}" value="${value}" ${String(s[name]) === String(value) ? 'checked' : ''} style="margin-top:3px"><span><strong>${label}</strong><br><span class="muted" style="font-size:13px">${desc}</span></span></label>`;
      const check = (name, label, desc) => `<label class="card" style="padding:14px;display:flex;gap:10px;cursor:pointer;align-items:flex-start">
        <input type="checkbox" name="${name}" ${s[name] ? 'checked' : ''} style="margin-top:3px"><span><strong>${label}</strong><br><span class="muted" style="font-size:13px">${desc}</span></span></label>`;
      content.innerHTML = `
        <div class="page-head"><div><h1>Settings</h1><p>The same settings as in the extension. Pace and mode apply from the next job, titles and locations from the next search.</p></div></div>
        <form id="settings-form" style="display:flex;flex-direction:column;gap:22px">
          <div><h2 style="font-size:16px;margin-bottom:10px">How applications are sent</h2><div class="grid-2" style="grid-template-columns:1fr 1fr">
            ${opt('mode', 'review', 'Fill, then I submit', 'Stops on the final screen so you click Submit.')}
            ${opt('mode', 'auto', 'Fully automatic', 'Fills, submits and moves on. Only stops to ask about unknown questions.')}</div></div>
          <div><h2 style="font-size:16px;margin-bottom:10px">Limits & pace</h2><div class="form-grid">
            <div class="field"><label for="dailyLimit">Applications per day</label><input class="input" type="number" min="1" max="50" id="dailyLimit" name="dailyLimit" value="${s.dailyLimit}"></div>
            <div class="field full">${check('noDailyLimit', 'No daily limit', 'Apply until your monthly applications run out. LinkedIn may pause accounts that apply too fast.')}</div>
            <div class="field"><label for="maxPerRun">Applications per run</label><input class="input" type="number" min="1" max="50" id="maxPerRun" name="maxPerRun" value="${s.maxPerRun}"></div>
            <div class="field"><label for="pace">Pace between applications</label><select class="input" id="pace" name="pace">
              ${[['careful', 'Careful (1–2 min)'], ['normal', 'Normal (30–60s)'], ['fast', 'Fast (15–30s)'], ['turbo', 'Turbo (6–12s, risky)']].map(([v, l]) => `<option value="${v}" ${s.pace === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          </div></div>
          <div><h2 style="font-size:16px;margin-bottom:10px">Questions JobFlow doesn’t know</h2><div class="grid-2" style="grid-template-columns:1fr 1fr">
            ${check('useAI', 'Let AI answer from my profile', 'Only facts from your CV and questionnaire.')}
            ${check('rememberAnswers', 'Remember my pop-up answers', 'Reused on every future application.')}
            ${opt('whenUnknown', 'ask', 'Ask me in a pop-up', 'Answer on the spot, then JobFlow continues.')}
            ${opt('whenUnknown', 'skip', 'Skip the job', 'The question is saved here for you to answer later.')}</div>
            <div class="field" style="margin-top:12px;max-width:320px"><label for="askTimeoutSec">If I don’t answer the pop-up</label><select class="input" id="askTimeoutSec" name="askTimeoutSec">
              ${[[0, 'Wait for me'], [60, 'Skip after 1 minute'], [300, 'Skip after 5 minutes']].map(([v, l]) => `<option value="${v}" ${s.askTimeoutSec === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
          <div><h2 style="font-size:16px;margin-bottom:10px">Which jobs to apply to</h2><div class="form-grid">
            <div class="field"><label for="titleInclude">Only titles containing</label><input class="input" id="titleInclude" name="titleInclude" value="${esc(s.titleInclude)}" placeholder="engineer, developer"></div>
            <div class="field"><label for="titleExclude">Never titles containing</label><input class="input" id="titleExclude" name="titleExclude" value="${esc(s.titleExclude)}" placeholder="senior, lead"></div>
            <div class="field full"><label for="skipCompanies">Never apply to these companies</label><input class="input" id="skipCompanies" name="skipCompanies" value="${esc(s.skipCompanies)}"></div>
            <div class="field full"><label for="searchKeywords">Job titles to apply for</label><input class="input" id="searchKeywords" name="searchKeywords" value="${esc(s.searchKeywords)}" placeholder="Product manager, Data analyst (empty = your job preferences)"></div>
            <div class="field full"><label for="searchLocations">Locations</label><input class="input" id="searchLocations" name="searchLocations" value="${esc(s.searchLocations)}" placeholder="Dubai, Abu Dhabi, Remote (empty = your preferences)"></div>
          </div><div class="grid-2" style="grid-template-columns:1fr 1fr;margin-top:12px">
            ${check('keepSearching', 'Keep going with related searches', 'When a search runs out, open the next search from your roles and locations.')}
            ${check('matchSearchTitles', 'Only apply when the job title matches', 'Skip loosely related jobs LinkedIn search also returns.')}
            ${check('skipPromoted', 'Skip promoted jobs', 'Paid listings with more applicants.')}
            ${check('skipJobBoards', 'Skip job boards and bulk recruiters', 'Re-posted listings (Hire Feed, Hired, Synthires…) that just collect CVs.')}
            ${check('followCompanies', 'Follow companies I apply to', 'Off means JobFlow unticks LinkedIn’s Follow box.')}</div></div>
          <div class="form-actions" style="justify-content:flex-start"><button class="btn btn-primary btn-lg" type="submit">Save settings</button></div>
        </form>

        <div class="card panel-card" style="margin-top:32px">
          <h2>Your data</h2>
          <p class="muted" style="margin-bottom:14px">Download everything JobFlow stores about you, or ask us to delete your account.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-secondary" id="export-json">Export my data (JSON)</button>
            <a class="btn btn-ghost" style="color:var(--danger)" href="mailto:${esc(cfg.supportEmail)}?subject=${encodeURIComponent('Delete my JobFlow account')}&body=${encodeURIComponent(`Please delete the JobFlow account for ${user.email}.`)}">Request account deletion</a>
          </div>
        </div>`;

      $('#settings-form').onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const settings = S.normalize({
          mode: fd.get('mode'), dailyLimit: fd.get('dailyLimit'), noDailyLimit: fd.get('noDailyLimit') === 'on', maxPerRun: fd.get('maxPerRun'), pace: fd.get('pace'),
          useAI: fd.get('useAI') === 'on', rememberAnswers: fd.get('rememberAnswers') === 'on', whenUnknown: fd.get('whenUnknown'),
          askTimeoutSec: fd.get('askTimeoutSec'), titleInclude: fd.get('titleInclude'), titleExclude: fd.get('titleExclude'),
          skipCompanies: fd.get('skipCompanies'), keepSearching: fd.get('keepSearching') === 'on', searchKeywords: fd.get('searchKeywords'), searchLocations: fd.get('searchLocations'), matchSearchTitles: fd.get('matchSearchTitles') === 'on', skipPromoted: fd.get('skipPromoted') === 'on', skipJobBoards: fd.get('skipJobBoards') === 'on', followCompanies: fd.get('followCompanies') === 'on'
        });
        const { error } = await sb.from('profiles').update({ settings }).eq('id', user.id);
        if (error) return toast(error.message);
        state.profile.settings = settings;
        toast('Settings saved');
      };
      $('#export-json').onclick = () => {
        const { cv_path, ...profile } = state.profile;
        download(`jobflow-data-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), profile, applications: state.applications, savedAnswers: state.answers }, null, 2), 'application/json');
      };
    }
  };

  function route() {
    const tab = (location.hash.replace('#', '') || 'overview').split('?')[0];
    const view = views[tab] ? tab : 'overview';
    document.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === view));
    content.onclick = null;
    content.onchange = null;
    views[view]();
    document.title = `${view[0].toUpperCase()}${view.slice(1)} · JobFlow AI`;
    $('#sidebar').classList.remove('open');
    window.scrollTo(0, 0);
  }

  $('#signout').onclick = async () => { await sb.auth.signOut(); location.replace('login.html'); };
  $('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
  window.addEventListener('hashchange', route);

  try {
    await load();
    route();
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">Couldn't load your dashboard: ${esc(err.message)}</div>`;
  }
})();
