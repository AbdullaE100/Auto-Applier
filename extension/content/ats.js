/* JobFlow AI - company career sites (Greenhouse, Lever, Ashby, Workable)
 * Adds a floating "Autofill" button. Nothing is filled until the user clicks it,
 * and JobFlow never submits these forms - the user reviews and submits. */
(() => {
  if (/(^|\.)linkedin\.com$/.test(location.hostname) || window.JobFlowATS) return;

  const Bridge = window.JobFlowBridge;
  const Engine = window.JobFlowAnswers;
  const Core = window.JobFlowCore;
  const Settings = window.JobFlowSettings;
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isVisible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

  const PLATFORMS = [
    { name: 'Greenhouse', test: () => /greenhouse\.io$/.test(location.hostname) || !!document.querySelector('#application_form, form[action*="greenhouse"], #grnhse_app') },
    { name: 'Lever', test: () => /lever\.co$/.test(location.hostname) && /\/apply/.test(location.pathname) || !!document.querySelector('.application-form, form#application-form') },
    { name: 'Ashby', test: () => /ashbyhq\.com$/.test(location.hostname) && /application/.test(location.pathname) || !!document.querySelector('[class*="ashby-application-form"]') },
    { name: 'Workable', test: () => /workable\.com$/.test(location.hostname) && /apply/.test(location.pathname) }
  ];

  function detect() {
    return PLATFORMS.find((p) => { try { return p.test(); } catch (_) { return false; } })?.name || null;
  }

  function findForm() {
    const forms = Array.from(document.querySelectorAll('form')).filter((f) => f.querySelectorAll('input, select, textarea').length >= 3);
    return forms.sort((a, b) => b.querySelectorAll('input, select, textarea').length - a.querySelectorAll('input, select, textarea').length)[0] || null;
  }

  function labelFor(el) {
    const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (byFor) return clean(byFor.textContent);
    const wrap = el.closest('label');
    if (wrap) return clean(wrap.textContent);
    const group = el.closest('fieldset, .field, .application-question, [class*="question"], [class*="field"], li, div');
    const legend = group?.querySelector('legend, label, .application-label, [class*="label"]');
    return clean(legend?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || '');
  }

  // AI only answers required questions; optional ones stay for the user
  function isRequired(f) {
    const el = f.el || f.els?.[0];
    return Boolean(el && (el.required || el.getAttribute('aria-required') === 'true')) || /\*\s*$/.test(f.question);
  }

  /** Hosted career sites put the employer in the first path segment: jobs.lever.co/<company>/... */
  function companyName() {
    const site = document.querySelector('meta[property="og:site_name"]')?.content;
    if (site && !/greenhouse|lever|ashby|workable/i.test(site)) return clean(site);
    const slug = location.pathname.split('/').filter(Boolean)[0] || '';
    if (slug && !/^(j|jobs?|embed)$/i.test(slug)) return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return document.title.split(/[-|@]/).pop().trim();
  }

  function collect(form) {
    const fields = [];
    const radioNames = new Set();
    for (const el of form.querySelectorAll('input, select, textarea')) {
      if (!isVisible(el) && el.type !== 'file' && el.type !== 'radio' && el.type !== 'checkbox') continue;
      if (el.disabled || el.readOnly || ['hidden', 'submit', 'button', 'search', 'password'].includes(el.type)) continue;
      if (el.type === 'file') { fields.push({ kind: 'file', el, question: labelFor(el) }); continue; }
      if (el.type === 'radio') {
        if (radioNames.has(el.name)) continue;
        radioNames.add(el.name);
        const els = Array.from(form.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`));
        // Lever wraps each option in its own <li>, so el.parentElement.parentElement is just the option list
        const group = el.closest('fieldset, [role="radiogroup"], .application-question, .field, [class*="application-form-field"]') || el.parentElement?.parentElement;
        const optionIds = new Set(els.map((r) => r.id).filter(Boolean));
        const heading = group && Array.from(group.querySelectorAll('legend, .application-label, [class*="question-title"], label'))
          .find((l) => !l.querySelector('input') && !optionIds.has(l.getAttribute('for')) && clean(l.textContent));
        fields.push({ kind: 'radio', els, question: clean(heading?.textContent || labelFor(group || el)), options: els.map((r) => clean(document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent || r.closest('label')?.textContent || r.value)), answered: els.some((r) => r.checked) });
        continue;
      }
      if (el.type === 'checkbox') {
        fields.push({ kind: 'checkbox', el, question: labelFor(el), answered: el.checked });
        continue;
      }
      if (el.tagName === 'SELECT') {
        const cur = el.options[el.selectedIndex];
        fields.push({ kind: 'select', el, question: labelFor(el), options: Array.from(el.options).map((o) => clean(o.text)), answered: Boolean(cur?.value) && !Engine.isPlaceholder(cur.text) });
        continue;
      }
      fields.push({ kind: el.tagName === 'TEXTAREA' ? 'textarea' : el.type === 'number' ? 'number' : 'text', el, question: labelFor(el), answered: Boolean(el.value.trim()) });
    }
    return fields;
  }

  async function autofill(onProgress) {
    const ctx = await Bridge.getContext(true);
    if (!ctx.signedIn || !ctx.onboarded) {
      Bridge.openOnboarding();
      return { filled: 0, message: ctx.signedIn ? 'Finish your JobFlow setup first.' : 'Sign in to JobFlow first.' };
    }
    const allowed = await Bridge.canApply().catch((e) => ({ ok: false, message: e.message }));
    if (!allowed.ok) return { filled: 0, message: allowed.message };
    const profile = ctx.profile;
    const form = findForm();
    if (!form) return { filled: 0, message: 'No application form found on this page.' };

    const job = {
      title: clean(document.querySelector('h1, .app-title, .posting-headline h2')?.textContent) || document.title,
      company: clean(document.querySelector('.company-name, [class*="company"]')?.textContent) || location.hostname.split('.')[0],
      description: clean(document.querySelector('#content, .posting-page, [class*="description"]')?.textContent).slice(0, 3000),
      location: clean(document.querySelector('.location, .posting-categories .location, [class*="location"]')?.textContent).slice(0, 150)
    };
    if (!job.location) delete job.location;

    let filled = 0;
    const needs = [];
    for (const f of collect(form)) {
      if (f.answered) continue;
      if (f.kind === 'file') {
        if (/resume|cv/i.test(f.question) && !f.el.files?.length) {
          onProgress?.('Attaching your CV…');
          const file = await Bridge.getCvFile();
          if (file) {
            const dt = new DataTransfer();
            dt.items.add(file);
            f.el.files = dt.files;
            f.el.dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
          }
        }
        continue;
      }
      if (f.kind === 'checkbox') {
        if (/\b(i )?(agree|consent)\b|acknowledge|privacy (policy|notice)|terms (and|&) conditions|terms of (use|service)/i.test(f.question) &&
            !/certif|licen[cs]|years|degree|experience|authori[sz]ed|eligible|\bhave\b|\bhold\b/i.test(f.question)) { f.el.click(); filled++; }
        continue;
      }

      let answer = f.kind === 'text' || f.kind === 'number' ? Engine.contactValue(f.question, profile) : null;
      if (!answer) answer = Engine.answer({ question: f.question, fieldType: f.kind, options: f.options }, profile, job)?.answer || null;
      if (!answer && Settings.normalize(profile.settings).useAI && isRequired(f) && f.question.length > 3) {
        onProgress?.(`Answering: ${f.question.slice(0, 40)}…`);
        const res = await Bridge.answerWithAI({ question: f.question, fieldType: f.kind, options: f.options?.filter((o) => !Engine.isPlaceholder(o)), job });
        answer = res?.answer || null;
      }
      if (!answer) { needs.push(f); continue; }

      let ok = false;
      if (f.kind === 'radio') {
        const i = f.options.indexOf(answer);
        if (i >= 0) { f.els[i].click(); ok = true; }
      } else if (f.kind === 'select') {
        const i = f.options.indexOf(answer);
        if (i >= 0) { f.el.selectedIndex = i; f.el.dispatchEvent(new Event('change', { bubbles: true })); Core.markFieldFilled(f.el); ok = true; }
      } else {
        ok = Core.setInputValue(f.el, answer);
      }
      if (ok) filled++;
      else needs.push(f);
      await sleep(40);
    }

    needs.forEach((f) => (f.el || f.els?.[0])?.closest('div')?.classList.add('jf-needs-answer'));
    return { filled, needs: needs.length, message: `Filled ${filled} field${filled === 1 ? '' : 's'}${needs.length ? ` · ${needs.length} left for you` : ''}. Review, then submit.` };
  }

  function mountButton(platform) {
    if (document.getElementById('jobflow-root')) return;
    const root = document.createElement('div');
    root.id = 'jobflow-root';
    root.className = 'jf-fab';
    root.innerHTML = `
      <button type="button" class="jf-fab-btn" id="jf-fab-btn"><span class="jf-mark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h8"/><path d="M5 12h13"/><path d="M5 17h5"/><path d="m14.5 8.5 3.5 3.5-3.5 3.5"/></svg></span> Autofill with JobFlow</button>
      <div class="jf-fab-status" id="jf-fab-status" hidden></div>`;
    document.body.appendChild(root);
    const btn = root.querySelector('#jf-fab-btn');
    const status = root.querySelector('#jf-fab-status');
    btn.onclick = async () => {
      btn.disabled = true;
      status.hidden = false;
      status.textContent = `Filling your ${platform} application…`;
      try {
        const res = await autofill((m) => { status.textContent = m; });
        status.textContent = res.message;
        if (res.filled > 0) {
          // Count it once the user actually submits the form
          const form = findForm();
          form?.addEventListener('submit', () => {
            Bridge.recordApplication({ platform, company: companyName(), jobTitle: clean(document.querySelector('h1')?.textContent) || document.title, url: location.href, externalId: location.pathname, fieldsFilled: res.filled }).catch(() => {});
          }, { once: true });
        }
      } catch (err) {
        status.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    };
  }

  window.JobFlowATS = { detect, autofill };

  let tries = 0;
  const boot = () => {
    const platform = detect();
    if (platform && findForm()) return mountButton(platform);
    if (++tries < 10) setTimeout(boot, 1000);
  };
  boot();
})();
