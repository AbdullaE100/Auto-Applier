/**
 * JobFlow AI - LinkedIn Easy Apply controller
 *
 * Manual:  open any Easy Apply form -> the current step is filled; the HUD can
 *          fill the rest and stop at the review screen.
 * Batch:   the JobFlow bar on /jobs pages walks the result list, fills every
 *          step and either pauses for review or submits (user setting).
 * Unknown required questions are answered by AI from the profile when allowed;
 * otherwise JobFlow pauses for the user (and remembers their answer) or skips.
 */
(() => {
  if (!/(^|\.)linkedin\.com$/.test(window.location.hostname)) return;
  if (window.JobFlowLinkedIn) return;

  const Bridge = window.JobFlowBridge;
  const Engine = window.JobFlowAnswers;
  const Core = window.JobFlowCore;
  const Settings = window.JobFlowSettings;

  const TAG = '[JobFlow]';
  const log = (...args) => console.log(TAG, ...args);
  // Chrome throttles timers in background tabs (to once a minute after a few minutes). While this tab
  // is hidden, waits are timed by the extension's service worker instead: its messages arrive at once.
  const Clock = {
    port: null,
    seq: 0,
    pending: new Map(),
    failedAt: 0,
    connect() {
      if (this.port) return this.port;
      if (!globalThis.chrome?.runtime?.connect || Date.now() - this.failedAt < 5000) return null;
      try {
        const port = chrome.runtime.connect({ name: 'jobflow-clock' });
        port.onMessage.addListener((m) => this.pending.get(m?.id)?.());
        port.onDisconnect.addListener(() => {
          this.port = null;
          this.failedAt = Date.now();
          for (const done of [...this.pending.values()]) done();
        });
        this.port = port;
      } catch (_) {
        this.failedAt = Date.now();
      }
      return this.port;
    },
    wait(ms) {
      return new Promise((resolve) => {
        const port = this.connect();
        if (!port) return setTimeout(resolve, ms);
        const id = ++this.seq;
        const done = () => { if (this.pending.delete(id)) resolve(); };
        this.pending.set(id, done);
        setTimeout(done, ms); // whichever arrives first
        try { port.postMessage({ id, ms }); } catch (_) { /* the timer still resolves it */ }
      });
    }
  };
  const sleep = async (ms) => {
    if (!document.hidden) return new Promise((r) => setTimeout(r, ms));
    // Short chunks keep the service worker awake through long pace delays and breaks
    const end = Date.now() + ms;
    do await Clock.wait(Math.max(0, Math.min(20000, end - Date.now())));
    while (Date.now() < end);
  };
  /** Desktop notification, only when the user can't see this tab. */
  const notifyIfHidden = (title, message) => {
    if (document.hidden) window.JobFlowBridge?.send('NOTIFY', { title, message }).catch(() => {});
  };
  const jitter = (min, max) => Math.round(min + Math.random() * (max - min));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const isVisible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 &&
    window.getComputedStyle(el).visibility !== 'hidden';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sameSearch = (a, b) => {
    try {
      const p = (u) => { const q = new URL(u).searchParams; return ['keywords', 'location', 'f_TPR', 'f_WT'].map((k) => q.get(k) || '').join('|').toLowerCase(); };
      return p(a) === p(b);
    } catch (_) {
      return false;
    }
  };

  async function waitFor(fn, timeout = 8000, interval = 200) {
    const end = Date.now() + timeout;
    for (;;) {
      try {
        const v = fn();
        if (v) return v;
      } catch (_) { /* keep polling */ }
      // Checked after the attempt so a throttled background tab still gets one last look
      if (Date.now() >= end) return null;
      await sleep(interval);
    }
  }

  const SEL = {
    detailsPane: '.jobs-search__job-details--container, .jobs-search__job-details, .scaffold-layout__detail, .jobs-details, .job-view-layout',
    applyButton: '#jobs-apply-button-id, button.jobs-apply-button, a.jobs-apply-button, .jobs-apply-button--top-card button',
    modal: '.jobs-easy-apply-modal, [data-test-modal-id="easy-apply-modal"], div[role="dialog"]',
    group: '.fb-dash-form-element, .jobs-easy-apply-form-element, [data-test-form-element], .jobs-easy-apply-form-section__grouping',
    fieldError: '.artdeco-inline-feedback--error, [data-test-form-element-error-messages]',
    card: ['li[data-occludable-job-id]', 'div.job-card-container[data-job-id]'],
    cardLink: 'a.job-card-list__title--link, a.job-card-container__link, a[href*="/jobs/view/"]',
    companyName: '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name',
    jobTitle: '.job-details-jobs-unified-top-card__job-title, .jobs-unified-top-card__job-title',
    jobLocation: '.job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__tertiary-description-container',
    description: '#job-details, .jobs-description__content, .jobs-box__html-content',
    nextPage: 'button[aria-label="View next page"], button.jobs-search-pagination__button--next'
  };

  const L = {
    isBatchRunning: false,
    isProcessing: false,
    session: { applied: 0, skipped: 0, paused: 0 },
    handledModals: new WeakSet(),
    context: null,

    detect: () => true,

    async loadContext(force = false) {
      this.context = await Bridge.getContext(force);
      return this.context;
    },

    // ------------------------------------------------------------- finders
    findModal() {
      const dialogs = Array.from(document.querySelectorAll(SEL.modal)).filter(isVisible);
      return dialogs.find((el) => {
        if (el.classList.contains('jobs-easy-apply-modal')) return true;
        if (el.querySelector('.jobs-easy-apply-content, [data-easy-apply-next-button]')) return true;
        const header = norm(el.querySelector('h1, h2, h3')?.textContent);
        return (header.startsWith('apply to') || header.includes('easy apply')) && el.querySelector('form');
      }) || null;
    },

    findEasyApplyButton() {
      const scope = document.querySelector(SEL.detailsPane) || document;
      const candidates = [...scope.querySelectorAll(SEL.applyButton), ...scope.querySelectorAll('button, a[role="button"]')];
      return candidates.find((el) => {
        if (!isVisible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        if (el.hasAttribute('aria-checked') || el.hasAttribute('aria-pressed')) return false; // the "Easy Apply" search filter pill
        if (el.closest('.jobs-search-box, .search-reusables__filters-bar, .search-reusables__primary-filter, [data-occludable-job-id], #jobflow-bar, #jobflow-root, header')) return false;
        return `${norm(el.textContent)} ${norm(el.getAttribute('aria-label'))}`.includes('easy apply');
      }) || null;
    },

    alreadyApplied() {
      const pane = document.querySelector(SEL.detailsPane);
      return Boolean(pane && Array.from(pane.querySelectorAll('.artdeco-inline-feedback__message, .jobs-s-apply span'))
        .some((e) => /^applied\b/i.test(clean(e.textContent))));
    },

    navButtons(modal) {
      const buttons = Array.from(modal.querySelectorAll('button')).filter((b) => isVisible(b) && !b.disabled && !b.closest('#jobflow-hud'));
      const match = (fn) => buttons.find((b) => fn(norm(b.textContent), norm(b.getAttribute('aria-label')))) || null;
      return {
        submit: match((t, a) => t === 'submit application' || a.includes('submit application') || t === 'submit'),
        review: match((t, a) => t === 'review' || a.includes('review your application')),
        next: match((t, a) => t === 'next' || a.includes('continue to next step'))
      };
    },

    errors(modal) {
      return Array.from(modal.querySelectorAll(SEL.fieldError)).filter(isVisible).map((e) => clean(e.textContent)).filter(Boolean);
    },

    signature(modal) {
      if (!modal || !modal.isConnected) return 'closed';
      const progress = modal.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') || '';
      const labels = Array.from(modal.querySelectorAll('label, legend, h3')).map((l) => norm(l.textContent)).join('|');
      return `${progress}#${labels}`;
    },

    jobInfo() {
      const modalHeader = clean(this.findModal()?.querySelector('h2, h3')?.textContent);
      const url = new URL(window.location.href);
      return {
        company: clean(document.querySelector(SEL.companyName)?.textContent) || modalHeader.replace(/^apply to\s*/i, '') || 'Unknown company',
        jobTitle: clean(document.querySelector(SEL.jobTitle)?.textContent) || document.title.split('|')[0].trim(),
        location: clean(document.querySelector(SEL.jobLocation)?.textContent).split('·')[0].trim().slice(0, 150),
        externalId: url.searchParams.get('currentJobId') || (url.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1] || null,
        url: `https://www.linkedin.com/jobs/view/${url.searchParams.get('currentJobId') || (url.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1] || ''}`,
        description: clean(document.querySelector(SEL.description)?.textContent).slice(0, 3000)
      };
    },

    // ------------------------------------------------------------ fields
    questionText(el, group) {
      return this.rawQuestionText(el, group).replace(/\s*\*?\s*required\s*$/i, '').trim();
    },

    rawQuestionText(el, group) {
      const legend = group?.querySelector('legend');
      if (legend) return clean(legend.querySelector('[aria-hidden="true"]')?.textContent || legend.textContent);
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) return clean(label.querySelector('[aria-hidden="true"]')?.textContent || label.textContent);
      }
      const l = group?.querySelector('label, .fb-dash-form-element__label, span[aria-hidden="true"]');
      return clean(l?.textContent || el.getAttribute('aria-label') || el.placeholder || '');
    },

    optionLabel(input) {
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : input.closest('label');
      return clean(label?.textContent || input.value);
    },

    isNumeric(el, group) {
      return el.type === 'number' || /numeric/i.test(el.id) || /whole number|decimal number|larger than/i.test(group?.textContent || '');
    },

    clickChoice(input) {
      const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      (label || input).click();
      if (!input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      Core.markFieldFilled(input);
    },

    selectOption(sel, label) {
      const idx = Array.from(sel.options).findIndex((o) => clean(o.text) === label);
      if (idx < 0) return false;
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      Core.markFieldFilled(sel);
      return true;
    },

    /** Collect every question on the current step as a uniform list. */
    collectFields(modal) {
      const fields = [];
      const seen = new Set();
      const groups = Array.from(modal.querySelectorAll(`${SEL.group}, fieldset`)).filter((g) => !g.closest('#jobflow-hud'));

      for (const group of groups) {
        if (seen.has(group) || Array.from(seen).some((s) => s.contains(group))) continue;

        const radios = Array.from(group.querySelectorAll('input[type="radio"]'));
        const checkboxes = Array.from(group.querySelectorAll('input[type="checkbox"]'));
        const select = group.querySelector('select');
        const textarea = group.querySelector('textarea');
        const input = group.querySelector('input:not([type]), input[type="text"], input[type="tel"], input[type="email"], input[type="number"], input[type="url"]');

        if (radios.length) {
          // Resume picker cards are radios too - LinkedIn preselects your latest CV
          if (radios.some((r) => /documentcard/i.test(r.id)) || group.closest('.jobs-document-upload-redesign-card__container, .jobs-resume-picker')) continue;
          seen.add(group);
          fields.push({ kind: 'radio', group, els: radios, question: this.questionText(radios[0], group), options: radios.map((r) => this.optionLabel(r)), answered: radios.some((r) => r.checked) });
        } else if (checkboxes.length) {
          seen.add(group);
          fields.push({ kind: 'checkbox', group, els: checkboxes, question: this.questionText(checkboxes[0], group), options: checkboxes.map((c) => this.optionLabel(c)), answered: checkboxes.some((c) => c.checked) });
        } else if (select) {
          seen.add(group);
          const cur = select.options[select.selectedIndex];
          fields.push({ kind: 'select', group, el: select, question: this.questionText(select, group), options: Array.from(select.options).map((o) => clean(o.text)), answered: Boolean(cur && cur.value && !Engine.isPlaceholder(cur.text)) });
        } else if (textarea) {
          seen.add(group);
          fields.push({ kind: 'textarea', group, el: textarea, question: this.questionText(textarea, group), answered: Boolean(textarea.value.trim()) });
        } else if (input) {
          seen.add(group);
          const q = this.questionText(input, group);
          const tooShortPhone = /phone|mobile/i.test(q) && input.value && input.value.replace(/\D/g, '').length < 7;
          fields.push({ kind: this.isNumeric(input, group) ? 'number' : 'text', group, el: input, question: q, answered: Boolean(input.value.trim()) && !tooShortPhone, combobox: input.getAttribute('role') === 'combobox' });
        }
      }
      // Follow-ups ("For how many years long?", "If yes, please specify") mean nothing on their own:
      // carry the question they follow, for the AI, the pop-up and the saved-answer key
      for (let i = 1; i < fields.length; i++) {
        const q = fields[i].question || '';
        if (/^(if (yes|so|no|other|applicable)\b|for how (many|long)|how long\b|please (specify|explain|elaborate|describe)|(specify|explain|elaborate)\b|which one|what (was|is) it\b)/i.test(q.trim()) && fields[i - 1].question) {
          fields[i].question = `${fields[i - 1].question.replace(/[?:.\s]+$/, '')}: ${q}`;
        }
      }
      return fields;
    },

    isRequired(field) {
      return Boolean(field.group.querySelector('.fb-dash-form-element__label--is-required, [data-test-checkbox-form-required], [aria-required="true"], [required]')) ||
        /\*\s*$/.test(field.question) || Boolean(field.group.querySelector(SEL.fieldError));
    },

    /** Types into a LinkedIn typeahead like a person would, then picks the best suggestion. */
    async fillTypeahead(field, text, profile) {
      const input = field.el;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus();
      setter.call(input, '');
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
      await sleep(300);
      let typed = '';
      for (const ch of String(text).split(',')[0].trim()) {
        typed += ch;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
        setter.call(input, typed);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        await sleep(jitter(40, 90));
      }
      const scope = field.group || document;
      const options = await waitFor(() => {
        const found = Array.from(scope.querySelectorAll('[role="option"]')).filter(isVisible);
        return found.length ? found : null;
      }, 4000);
      if (!options) return false;
      const country = window.JobFlowCountries?.getCountry(profile.country)?.name?.toLowerCase();
      const want = norm(String(text).split(',')[0]);
      const pick = options.find((o) => norm(o.textContent) === norm(text)) ||
        options.find((o) => norm(o.textContent).startsWith(want) && (!country || norm(o.textContent).includes(country))) ||
        options.find((o) => norm(o.textContent).startsWith(want));
      if (!pick) {
        // Nothing sensible to pick: clear it rather than choose a random city or company
        setter.call(input, '');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
        return false;
      }
      pick.click();
      await sleep(300);
      Core.markFieldFilled(input);
      return true;
    },

    matchOption(options, answer) {
      const a = norm(answer);
      let i = options.findIndex((o) => o === answer);
      if (i < 0) i = options.findIndex((o) => norm(o) === a);
      return i;
    },

    async applyAnswer(field, answer, profile) {
      if (answer == null || answer === '') return false;
      // The step may have re-rendered while AI or the user was answering: never write into a different question
      const anchor = field.el || field.els?.[0];
      if (!anchor?.isConnected || this.questionText(anchor, field.group) !== field.question) return false;
      switch (field.kind) {
        case 'radio': {
          const i = this.matchOption(field.options, answer);
          if (i < 0) return false;
          this.clickChoice(field.els[i]);
          return true;
        }
        case 'checkbox': {
          const parts = field.els.length > 1 ? String(answer).split(/\s*[|;]\s*/) : [String(answer)];
          const idx = parts.map((p) => this.matchOption(field.options, p));
          if (!idx.length || idx.some((i) => i < 0)) return false;
          idx.forEach((i) => { if (!field.els[i].checked) this.clickChoice(field.els[i]); });
          return true;
        }
        case 'select': {
          const i = this.matchOption(field.options, answer);
          return i >= 0 && this.selectOption(field.el, field.options[i]);
        }
        case 'number': {
          const m = String(answer).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
          if (!m) return false;
          const whole = /whole number|integer/i.test(field.group?.textContent || '');
          const value = whole ? String(Math.round(Number(m[0]))) : m[0];
          return Core.setInputValue(field.el, value) && field.el.value === value;
        }
        default:
          if (field.combobox) return this.fillTypeahead(field, String(answer), profile);
          return Core.setInputValue(field.el, String(answer)) && Boolean(field.el.value);
      }
    },

    /** Answers that need no network call: profile, saved answers, onboarding answers. */
    localAnswer(field, profile, job) {
      const q = field.question;
      const fieldType = field.kind;
      const real = (field.options || []).filter((o) => !Engine.isPlaceholder(o));

      if (fieldType === 'text' || fieldType === 'number') {
        const v = Engine.contactValue(q, profile);
        if (v) return { answer: String(v), source: 'profile' };
      }
      if (fieldType === 'select') {
        if (/country code|phone/i.test(q) && profile.phoneCountryCode) {
          const hits = field.options.filter((o) => o.includes(`(+${profile.phoneCountryCode})`) || o.endsWith(`+${profile.phoneCountryCode}`));
          // +1, +7, +44... are shared: "Canada (+1)" comes before "United States (+1)" alphabetically
          const home = self.JobFlowCountries?.getCountry?.(profile.country)?.name?.toLowerCase();
          const opt = (home && hits.find((o) => o.toLowerCase().includes(home))) || hits[0];
          if (opt) return { answer: opt, source: 'profile' };
        }
        if (/e-?mail/i.test(q)) {
          const opt = field.options.find((o) => norm(o) === norm(profile.email)) || real[0];
          if (opt) return { answer: opt, source: 'profile' };
        }
      }
      if (fieldType === 'checkbox' && field.els.length === 1) {
        if (/follow/i.test(q + field.options[0])) return { skip: true };
        const text = `${q} ${field.options[0]}`;
        // Only pure privacy / terms consent. "I certify I have 5 years of Java" is a claim, not consent.
        if (/\b(i )?(agree|consent)\b|acknowledge|privacy (policy|notice|statement)|terms (and|&) conditions|terms of (use|service)|data (processing|protection)/i.test(text) &&
            !/certif|licen[cs]|years|degree|experience|authori[sz]ed|eligible|clearance|\bhave\b|\bhold\b|\bpossess/i.test(text)) {
          return { answer: field.options[0], source: 'profile' };
        }
      }

      // Answers the user gave before (dashboard or the pop-up)
      const savedKey = Engine.normalizeQuestion(q);
      const saved = savedKey ? this.context?.savedAnswers?.[savedKey] : null;
      if (saved != null) {
        if (!real.length) return { answer: saved, source: 'saved' };
        const match = real.find((o) => o === saved) || real.find((o) => norm(o) === norm(saved));
        if (match) return { answer: match, source: 'saved' };
      }

      return Engine.answer({ question: q, fieldType, options: field.options }, profile, job);
    },

    aiKey(field, job) {
      return `${job.company}|${Engine.normalizeQuestion(field.question) || field.question}`;
    },

    async aiAnswer(field, profile, job, stats) {
      if (!Settings.normalize(profile.settings).useAI || this.aiLimitHit) return null;
      this.aiSuggestions = this.aiSuggestions || new Map();
      const key = this.aiKey(field, job);
      if (this.aiSuggestions.has(key)) return null; // already asked: it's a suggestion for the pop-up
      const res = await Bridge.answerWithAI({
        question: field.question,
        fieldType: field.kind,
        options: field.options ? field.options.filter((o) => !Engine.isPlaceholder(o)) : undefined,
        maxLength: Number(field.el?.getAttribute('maxlength')) || undefined,
        job: { title: job.jobTitle, company: job.company, location: job.location, description: job.description }
      });
      if (res?.answer) {
        stats.ai++;
        return { answer: res.answer, source: 'ai', translation: res.translation || null };
      }
      if (res?.code === 'ai_limit_reached' || /ai_limit|AI answers/i.test(res?.error || '')) {
        stats.aiLimit = true;
        this.aiLimitHit = true;
      }
      // A network blip or timeout isn't an answer: leave it uncached so the next job asks again
      if (res?.error && !stats.aiLimit) return null;
      // A draft from the CV that the user approves in the pop-up
      this.aiSuggestions.set(key, { suggestion: res?.suggestion || null, translation: res?.translation || null });
      return null;
    },

    /**
     * Fills the current step. Returns the required questions it couldn't answer.
     * Optional questions are only filled from the profile or saved answers - never by AI -
     * unless allRequired is set (LinkedIn refused to move on, so everything empty counts).
     */
    async fillStep(modal, profile, job, stats, { allRequired = false } = {}) {
      await this.attachCv(modal, stats);
      const fields = this.collectFields(modal).filter((f) => !f.answered);
      const unknown = [];
      const needAI = [];
      const stopped = () => this.isBatchRunning && this.batchStopRequested;

      for (const field of fields) {
        if (stopped()) return [];
        const res = this.localAnswer(field, profile, job);
        if (res?.skip) continue;
        if (res && (await this.applyAnswer(field, res.answer, profile))) {
          stats.filled++;
          stats.answers?.push({ question: field.question, answer: res.answer, source: res.source || 'profile' });
          await sleep(jitter(60, 160));
        } else if (allRequired || this.isRequired(field)) {
          needAI.push(field);
        }
      }

      // AI calls run in parallel (3 at a time) - a step with 6 questions takes seconds, not a minute
      const results = new Map();
      for (let i = 0; i < needAI.length && !stats.aiLimit && !stopped(); i += 3) {
        const batch = needAI.slice(i, i + 3);
        const answers = await Promise.all(batch.map((f) => this.aiAnswer(f, profile, job, stats).catch(() => null)));
        batch.forEach((f, k) => results.set(f, answers[k]));
      }
      if (stopped()) return [];
      for (const field of needAI) {
        const res = results.get(field);
        if (res && (await this.applyAnswer(field, res.answer, profile))) {
          stats.filled++;
          stats.answers?.push({ question: field.question, answer: res.answer, source: 'ai' });
        } else {
          unknown.push(field);
        }
      }
      return unknown;
    },

    /** Uploads the user's CV when a step asks for a resume and none is chosen. */
    async attachCv(modal, stats) {
      const picked = modal.querySelector('input[type="radio"][id*="documentcard" i]:checked, .jobs-document-upload-redesign-card__container--selected, .jobs-resume-picker__resume--selected');
      if (picked) return;
      const inputs = Array.from(modal.querySelectorAll('input[type="file"]')).filter((i) => !i.files?.length && !i.closest('#jobflow-hud'));
      for (const input of inputs) {
        const around = norm(`${input.id} ${input.name} ${input.getAttribute('aria-label') || ''} ${input.closest(`${SEL.group}, section, .jobs-document-upload-redesign-card__container`)?.textContent || ''}`);
        if (!/resume|\bcv\b/.test(around) || /cover letter/.test(around)) continue;
        this.hud('Uploading your CV…');
        const file = await Bridge.getCvFile().catch(() => null);
        if (!file) return;
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        stats.filled++;
        await sleep(2500);
        return;
      }
    },

    /** Fields on the step that LinkedIn flagged with a validation error. */
    erroredFields(modal) {
      return this.collectFields(modal).filter((f) => f.group.querySelector(SEL.fieldError) && isVisible(f.group.querySelector(SEL.fieldError)));
    },

    // -------------------------------------------------------- ask-the-user dialog
    /**
     * Shows a pop-up over LinkedIn asking the user to answer questions JobFlow couldn't.
     * Resolves { action: 'save' | 'skip' | 'timeout' | 'stopped', values: Map<field, string>, remember }
     */
    askUser(fields, job, settings) {
      const s = Settings.normalize(settings);
      document.getElementById('jobflow-ask')?.remove();
      const host = document.createElement('div');
      host.id = 'jobflow-ask';
      host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;';
      const root = host.attachShadow({ mode: 'open' });
      const optionsOf = (f) => (f.options || []).filter((o) => !Engine.isPlaceholder(o));
      const suggested = fields.filter((f) => f.suggestion).length;

      root.innerHTML = `
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
          .scrim { position: fixed; inset: 0; background: rgba(14, 15, 17, .5); display: grid; place-items: center; padding: 16px; }
          .dlg { width: min(560px, 100%); max-height: calc(100vh - 32px); display: flex; flex-direction: column; background: #fff; color: #16181d;
                 border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,.28); overflow: hidden; }
          header { padding: 18px 20px 14px; border-bottom: 1px solid #e5e4df; }
          .eyebrow { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: #5b6068; }
          .bolt { width: 22px; height: 22px; border-radius: 6px; background: #16181d; color: #fff; display: grid; place-items: center; } .bolt svg { width: 14px; height: 14px; }
          h2 { margin: 10px 0 2px; font-size: 17px; line-height: 1.3; font-weight: 650; letter-spacing: -0.01em; }
          .hint { font-size: 12px; color: #7d828a; margin: -6px 0 8px; }
          .sug { font-size: 12px; color: #0f6e58; margin: -4px 0 8px; font-weight: 550; }
          .tr { font-size: 13px; color: #5b6068; margin: -6px 0 8px; }
          .note { margin-top: 8px; font-size: 12px; color: #a15c07; }
          .job { font-size: 13px; color: #5b6068; }
          .body { padding: 8px 20px 4px; overflow: auto; }
          .q { padding: 14px 0; border-bottom: 1px solid #efeee9; }
          .q:last-child { border-bottom: 0; }
          .q label.title { display: block; font-weight: 600; font-size: 14px; margin-bottom: 10px; line-height: 1.4; }
          .opts { display: grid; gap: 6px; }
          .opt { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border: 1px solid #d2d0c9; border-radius: 8px; cursor: pointer; font-size: 14px; }
          .opt:hover { background: #f7f7f5; }
          .opt:has(input:checked) { border-color: #16181d; box-shadow: inset 0 0 0 1px #16181d; }
          .opt input { accent-color: #0f6e58; margin: 0; }
          input.text, textarea { width: 100%; font-size: 14px; padding: 9px 12px; border: 1px solid #d2d0c9; border-radius: 8px; color: #16181d; background: #fff; }
          textarea { min-height: 110px; resize: vertical; line-height: 1.45; }
          input.text:focus, textarea:focus { outline: none; border-color: #0f6e58; box-shadow: 0 0 0 3px rgba(15,110,88,.2); }
          .missing .title { color: #c02d2d; }
          footer { padding: 12px 20px; border-top: 1px solid #e5e4df; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: #fafaf8; }
          .remember { display: flex; gap: 8px; align-items: center; font-size: 13px; color: #4b5058; margin-right: auto; }
          .remember input { accent-color: #0f6e58; }
          .timer { font-size: 12px; color: #a15c07; width: 100%; font-variant-numeric: tabular-nums; }
          button { font: 600 14px inherit; height: 36px; padding: 0 14px; border-radius: 7px; border: 0; cursor: pointer; }
          .ghost { background: #fff; color: #16181d; border: 1px solid #d2d0c9; }
          .ghost:hover { background: #f1f1ee; }
          .primary { background: #16181d; color: #fff; }
          .primary:hover { background: #2b2e35; }
          button:focus-visible, .opt:focus-within { outline: 3px solid rgba(15,110,88,.3); outline-offset: 1px; }
          @media (prefers-color-scheme: dark) {
            .dlg { background: #16181c; color: #ecedee; } .bolt { background: #ecedee; color: #16181c; } .eyebrow, .job, .hint, .tr { color: #9ba0a7; } .sug { color: #5fd0ae; } .note { color: #f2b45a; }
            header, footer, .q { border-color: #2a2d33; } footer { background: #121417; }
            .remember { color: #b3b7bd; }
            .opt { border-color: #3a3e46; } .opt:hover { background: #1e2025; } .opt:has(input:checked) { border-color: #ecedee; box-shadow: inset 0 0 0 1px #ecedee; }
            input.text, textarea { background: #0e0f11; color: #ecedee; border-color: #3a3e46; }
            .ghost { background: transparent; color: #ecedee; border-color: #3a3e46; } .ghost:hover { background: #1e2025; } .primary { background: #ecedee; color: #0e0f11; } .primary:hover { background: #fff; }
          }
        </style>
        <div class="scrim">
          <div class="dlg" role="dialog" aria-modal="true" aria-labelledby="t">
            <header>
              <div class="eyebrow"><span class="bolt"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h8"/><path d="M5 12h13"/><path d="M5 17h5"/><path d="m14.5 8.5 3.5 3.5-3.5 3.5"/></svg></span> JobFlow needs your answer</div>
              <h2 id="t">${suggested === fields.length
                ? (fields.length === 1 ? 'Check this suggested answer' : `Check ${fields.length} suggested answers`)
                : (fields.length === 1 ? 'One question needs your answer' : `${fields.length} questions need your answer`)}</h2>
              <div class="job">${esc(job.jobTitle)} · ${esc(job.company)}</div>
              ${s.aiLimitHit ? '<div class="note">Today’s AI answers are used up, so there are no suggestions. They reset tomorrow.</div>' : ''}
            </header>
            <form class="body" id="form">
              ${fields.map((f, i) => {
                const opts = optionsOf(f);
                const sug = f.suggestion ? String(f.suggestion) : '';
                const badge = sug ? '<div class="sug">Suggested from your CV. Edit it if anything is off.</div>' : '';
                const translated = f.translation && f.translation.trim().toLowerCase() !== String(f.question || '').trim().toLowerCase()
                  ? `<div class="tr">In English: ${esc(f.translation)}</div>` : '';
                const title = `<label class="title" for="f${i}">${esc(f.question || 'Question')}</label>${translated}${badge}`;
                if (opts.length) {
                  const multi = f.kind === 'checkbox' && opts.length > 1;
                  const picked = multi ? sug.split(/\s*[|;]\s*/).map((x) => x.toLowerCase()) : [sug.toLowerCase()];
                  return `<div class="q${sug ? ' has-sug' : ''}" data-i="${i}">${title}${multi ? '<div class="hint">Select all that apply</div>' : ''}<div class="opts" role="${multi ? 'group' : 'radiogroup'}">${opts.map((o, k) =>
                    `<label class="opt"><input type="${multi ? 'checkbox' : 'radio'}" name="f${i}" value="${esc(o)}" ${k === 0 ? `id="f${i}"` : ''} ${sug && picked.includes(o.toLowerCase()) ? 'checked' : ''}> <span>${esc(o)}</span></label>`).join('')}</div></div>`;
                }
                const long = f.kind === 'textarea' || sug.length > 70 || /^(describe|explain|tell us|please describe|how (have|do|would)|why|what (experience|makes))/i.test(f.question || '');
                if (long && f.kind !== 'number') return `<div class="q${sug ? ' has-sug' : ''}" data-i="${i}">${title}<textarea id="f${i}" name="f${i}" ${f.el?.getAttribute('maxlength') ? `maxlength="${esc(f.el.getAttribute('maxlength'))}"` : ''}>${esc(sug)}</textarea></div>`;
                return `<div class="q${sug ? ' has-sug' : ''}" data-i="${i}">${title}<input class="text" id="f${i}" name="f${i}" value="${esc(sug)}" ${f.kind === 'number' ? 'type="number" inputmode="decimal"' : 'type="text"'}></div>`;
              }).join('')}
            </form>
            <footer>
              <label class="remember"><input type="checkbox" id="remember" ${s.rememberAnswers ? 'checked' : ''}> Remember for future applications</label>
              <button type="button" class="ghost" id="skip">Skip this job</button>
              <button type="button" class="primary" id="save">${suggested ? 'Approve & continue' : 'Save & continue'}</button>
              ${s.askTimeoutSec ? '<div class="timer" id="timer"></div>' : ''}
            </footer>
          </div>
        </div>`;
      document.documentElement.appendChild(host);
      notifyIfHidden('JobFlow needs your answer', `${fields.length} question${fields.length === 1 ? '' : 's'} for ${job.jobTitle} at ${job.company}. Click to open.`);

      const prevTitle = document.title;
      let flash = true;
      const titleTimer = setInterval(() => { document.title = (flash = !flash) ? prevTitle : '(1) JobFlow needs your answer'; }, 1200);

      return new Promise((resolve) => {
        const deadline = Date.now() + s.askTimeoutSec * 1000;
        let tick = null;
        let stopWatchRef = null;
        const done = (result) => {
          clearInterval(stopWatchRef);
          clearInterval(titleTimer);
          clearInterval(tick);
          document.title = prevTitle;
          host.remove();
          resolve(result);
        };
        const collect = () => {
          const values = new Map();
          let firstMissing = null;
          fields.forEach((f, i) => {
            const q = root.querySelector(`.q[data-i="${i}"]`);
            const picked = Array.from(root.querySelectorAll(`input[name="f${i}"]:checked`)).map((x) => x.value);
            const input = root.querySelector(`#f${i}:not([type="radio"]):not([type="checkbox"])`);
            const v = picked.length ? picked.join(' | ') : (input?.value || '').trim();
            q.classList.toggle('missing', !v);
            if (v) values.set(f, v);
            else if (!firstMissing) firstMissing = q;
          });
          return { values, firstMissing };
        };
        root.getElementById('save').onclick = () => {
          const { values, firstMissing } = collect();
          if (firstMissing) return firstMissing.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
          done({ action: 'save', values, remember: root.getElementById('remember').checked });
        };
        root.getElementById('skip').onclick = () => done({ action: 'skip', values: new Map() });
        root.getElementById('form').onsubmit = (e) => { e.preventDefault(); root.getElementById('save').click(); };
        root.addEventListener('keydown', (e) => {
          e.stopPropagation(); // keep LinkedIn shortcuts from firing while typing
          if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); root.getElementById('save').click(); }
        });
        stopWatchRef = setInterval(() => {
          if (this.batchStopRequested && this.isBatchRunning) done({ action: 'stopped', values: new Map() });
        }, 500);
        if (s.askTimeoutSec) {
          const timer = root.getElementById('timer');
          const paint = () => {
            const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
            if (!left) return done({ action: 'timeout', values: new Map() });
            timer.textContent = `No answer in ${left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${left}s`} and this job will be skipped.`;
          };
          paint();
          tick = setInterval(paint, 1000);
        }
        setTimeout(() => root.querySelector('input:not([type="checkbox"]), textarea')?.focus(), 50);
      });
    },

    /** Ask about unknown fields and apply the answers. Returns 'answered' | 'skip' | 'stopped'. */
    async resolveUnknown(unknown, profile, job, { batch }) {
      const s = Settings.normalize(profile.settings);
      const optionsOf = (f) => (f.options || []).filter((o) => !Engine.isPlaceholder(o));
      if (s.whenUnknown === 'skip' && batch) {
        unknown.forEach((f) => Bridge.saveAnswer(f.question, null, optionsOf(f)));
        return 'skip';
      }
      // Fields LinkedIn flagged later never went through AI: draft suggestions for them too
      const fresh = unknown.filter((f) => !(this.aiSuggestions || new Map()).has(this.aiKey(f, job)));
      if (fresh.length && s.useAI && !this.aiLimitHit) {
        if (batch) this.setBar(`Drafting answers from your CV · ${job.company}`);
        const stats = { filled: 0, ai: 0 };
        await Promise.all(fresh.map((f) => this.aiAnswer(f, profile, job, stats).then((res) => {
          const prev = this.aiSuggestions.get(this.aiKey(f, job));
          if (res?.answer) this.aiSuggestions.set(this.aiKey(f, job), { suggestion: res.answer, translation: prev?.translation || null });
        }).catch(() => null)));
      }
      unknown.forEach((f) => {
        const got = this.aiSuggestions?.get(this.aiKey(f, job));
        f.suggestion = got?.suggestion || null;
        f.translation = got?.translation || null;
      });
      const drafted = unknown.filter((f) => f.suggestion).length;
      if (batch) this.setBar(`${drafted ? 'Check the suggested answers' : 'Waiting for your answer'} · ${job.company}`);
      this.hud(drafted ? `${drafted} suggested answer${drafted === 1 ? '' : 's'} to check.` : `${unknown.length} question(s) need your answer.`);
      const result = await this.askUser(unknown, job, { ...s, aiLimitHit: this.aiLimitHit });
      if (result.action !== 'save') {
        unknown.forEach((f) => Bridge.saveAnswer(f.question, null, optionsOf(f)));
        return result.action === 'stopped' ? 'stopped' : 'skip';
      }
      for (const [field, value] of result.values) {
        await this.applyAnswer(field, value, profile);
        if (result.remember) {
          Bridge.saveAnswer(field.question, value, optionsOf(field));
          if (this.context?.savedAnswers) this.context.savedAnswers[Engine.normalizeQuestion(field.question)] = value;
        }
      }
      if (batch) this.setBar(`Continuing · ${job.company}`);
      return 'answered';
    },

    // ------------------------------------------------------------------ HUD
    mountHUD(modal) {
      let hud = document.getElementById('jobflow-hud');
      if (hud && modal.contains(hud)) return hud;
      hud?.remove();
      hud = document.createElement('div');
      hud.id = 'jobflow-hud';
      hud.className = 'jf-hud';
      hud.innerHTML = `
        <div class="jf-hud-main"><span class="jf-mark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h8"/><path d="M5 12h13"/><path d="M5 17h5"/><path d="m14.5 8.5 3.5 3.5-3.5 3.5"/></svg></span><div><strong>JobFlow</strong><span id="jf-hud-text">Ready</span></div></div>
        <div class="jf-hud-actions">
          <button type="button" class="jf-btn jf-btn-ghost" id="jf-hud-fill">Fill this step</button>
          <button type="button" class="jf-btn" id="jf-hud-run">Fill to review</button>
        </div>`;
      const header = modal.querySelector('.artdeco-modal__header, header');
      if (header?.parentNode && modal.contains(header.parentNode)) header.parentNode.insertBefore(hud, header.nextSibling);
      else modal.prepend(hud);

      hud.querySelector('#jf-hud-fill').onclick = async () => {
        if (this.isProcessing) return this.hud('Already filling this application…');
        this.isProcessing = true;
        try {
          const ctx = await this.loadContext();
          if (!this.requireReady(ctx)) return;
          const allowed = await Bridge.canApply().catch((e) => ({ ok: false, message: e.message }));
          if (!allowed.ok) return this.hud(allowed.message);
          const stats = { filled: 0, ai: 0, answers: [] };
          const job = this.jobInfo();
          const unknown = await this.fillStep(this.findModal() || modal, ctx.profile, job, stats);
          if (unknown.length) await this.resolveUnknown(unknown, ctx.profile, job, { batch: false });
          this.hud(`Filled ${stats.filled} field${stats.filled === 1 ? '' : 's'}.`);
          this.watchManualSubmit(job, stats);
        } catch (err) {
          this.hud(err.message);
        } finally {
          this.isProcessing = false;
        }
      };
      hud.querySelector('#jf-hud-run').onclick = async () => {
        const ctx = await this.loadContext().catch(() => null);
        if (!this.requireReady(ctx)) return;
        const res = await this.runApplication(ctx.profile, { mode: 'review' });
        this.hud(res.message);
        if (res.status === 'review') this.watchManualSubmit(res.job, res.stats);
      };
      return hud;
    },

    hud(text, actions) {
      const el = document.getElementById('jf-hud-text');
      if (el) el.textContent = text;
      const box = document.querySelector('#jobflow-hud .jf-hud-actions');
      if (box && actions) box.innerHTML = actions;
    },

    highlight(fields) {
      fields.forEach((f) => {
        f.group.classList.add('jf-needs-answer');
        f.group.addEventListener('change', () => f.group.classList.remove('jf-needs-answer'), { once: true });
      });
      fields[0]?.group.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },

    requireReady(ctx) {
      if (!ctx?.signedIn) {
        this.hud('Sign in to JobFlow to autofill.');
        Bridge.openOnboarding();
        return false;
      }
      if (!ctx.onboarded) {
        this.hud('Finish your JobFlow setup first.');
        Bridge.openOnboarding();
        return false;
      }
      return true;
    },

    // ------------------------------------------------------ application flow
    async discard() {
      const modal = this.findModal();
      if (modal) modal.querySelector('button[aria-label="Dismiss"], .artdeco-modal__dismiss')?.click();
      else if (!this.saveDialog()) return;
      const discardBtn = await waitFor(() => Array.from(document.querySelectorAll('button')).find(
        (b) => isVisible(b) && (b.getAttribute('data-control-name') === 'discard_application_confirm_btn' || norm(b.textContent) === 'discard')
      ), 3000);
      discardBtn?.click();
      await waitFor(() => !this.findModal(), 3000);
    },

    /** LinkedIn's post-apply confirmation. Never matches the application form itself. */
    successVisible() {
      return Array.from(document.querySelectorAll('div[role="dialog"], [role="alert"], .artdeco-toast-item')).some((d) => {
        if (!isVisible(d)) return false;
        if (d.querySelector('form, .jobs-easy-apply-content, .fb-dash-form-element, select, textarea, input[type="text"], input[type="radio"]')) return false;
        if (Array.from(d.querySelectorAll('button')).some((b) => /^(next|review|submit|submit application)$/.test(norm(b.textContent)))) return false;
        return /your application was sent|application (was )?sent\b|application submitted/i.test(d.textContent);
      });
    },

    /** LinkedIn telling us to slow down or prove we're human. Any match stops the run at once. */
    blockedReason() {
      if (/^\/(checkpoint|authwall|login|uas\/login)/.test(window.location.pathname)) return 'LinkedIn asked you to verify your account';
      // LinkedIn loads an invisible 0x0 reCAPTCHA frame on every page: only a challenge the user can actually see counts
      const challenge = Array.from(document.querySelectorAll('iframe[src*="captcha" i], iframe[title*="captcha" i], iframe[src*="challenge" i], #captcha-internal'))
        .find((f) => { const r = f.getBoundingClientRect(); return isVisible(f) && r.width >= 120 && r.height >= 60; });
      if (challenge) return 'LinkedIn is showing a security check';
      const text = Array.from(document.querySelectorAll('div[role="dialog"], div[role="alertdialog"], [role="alert"], .artdeco-toast-item, .jobs-s-apply, .jobs-details-top-card__apply-error'))
        .filter((el) => isVisible(el) && !el.closest('#jobflow-bar, #jobflow-ask, #jobflow-hud'))
        .map((el) => el.textContent).join(' ').toLowerCase().replace(/\s+/g, ' ');
      if (/applying at a (fast|rapid|quick) pace|paused easy apply|easy apply (is|has been) (temporarily )?paused/.test(text)) return 'LinkedIn paused Easy Apply because applications were sent too quickly';
      if (/reached (the|your) (daily )?(easy apply |application )?limit|easy apply limit|limit (on|for) (easy apply|applications)/.test(text)) return 'LinkedIn’s daily Easy Apply limit was reached';
      if (/unusual activity|security (check|verification)|verify (it'?s|that it'?s) you|restricted your account|account (has been |is )?restricted/.test(text)) return 'LinkedIn flagged unusual activity on your account';
      return null;
    },

    /** "Save this application?" prompt LinkedIn shows after closing an unfinished form. */
    saveDialog() {
      return Array.from(document.querySelectorAll('div[role="dialog"], div[role="alertdialog"]'))
        .find((d) => isVisible(d) && /save this application/i.test(d.textContent)) || null;
    },

    findNextPage() {
      const btn = document.querySelector(SEL.nextPage);
      if (btn && !btn.disabled && isVisible(btn)) return btn;
      const active = document.querySelector('.artdeco-pagination__indicator--number.active, .artdeco-pagination__indicator--number.selected, .jobs-search-pagination__indicator-button--active');
      const li = active?.closest('li') || active;
      return li?.nextElementSibling?.querySelector('button') || null;
    },

    async closeSuccess() {
      const btn = await waitFor(() => Array.from(document.querySelectorAll('div[role="dialog"] button')).find((b) => {
        const t = norm(b.textContent);
        return isVisible(b) && (t === 'done' || t === 'not now' || norm(b.getAttribute('aria-label')) === 'dismiss');
      }), 5000);
      btn?.click();
    },

    /** Wait for the user to act. Resolves 'changed' | 'closed' | 'submitted' | 'timeout' | 'stopped'. */
    async waitForUser(modal, { watchSubmit = false, timeoutMs = 15 * 60 * 1000 } = {}) {
      const before = this.signature(modal);
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        await sleep(500);
        if (this.batchStopRequested) return 'stopped';
        if (watchSubmit && this.successVisible()) return 'submitted';
        const m = this.findModal();
        if (!m) {
          if (this.saveDialog()) return 'closed';
          const sent = this.successVisible() || (watchSubmit && (await waitFor(() => this.successVisible() || this.alreadyApplied(), 3000)));
          return sent ? 'submitted' : 'closed';
        }
        if (this.signature(m) !== before) return 'changed';
      }
      return 'timeout';
    },

    /**
     * Opens (if needed) and completes the current job's Easy Apply flow.
     * mode: 'review' (stop at Submit) | 'auto' (click Submit).
     * Returns { status: 'submitted'|'review'|'skipped'|'failed'|'stopped', message, stopBatch?, blocked? }
     */
    async runApplication(profile, { mode = 'review', batch = false } = {}) {
      if (this.isProcessing) return { status: 'failed', message: 'Already working on an application.' };
      this.isProcessing = true;
      const stats = { filled: 0, ai: 0, aiLimit: false, answers: [] };
      const job = this.jobInfo();
      const STOPPED = { status: 'stopped', message: 'Stopped.' };
      const stopped = () => batch && this.batchStopRequested;
      const blocked = () => {
        const reason = this.blockedReason();
        return reason ? { status: 'failed', message: reason, stopBatch: true, blocked: true } : null;
      };

      try {
        const block0 = blocked();
        if (block0) return block0;
        const allowed = await Bridge.canApply().catch((e) => ({ ok: false, message: e.message }));
        if (!allowed.ok) return { status: 'failed', message: allowed.message, stopBatch: true };

        let modal = this.findModal();
        if (!modal) {
          if (this.alreadyApplied()) return { status: 'skipped', message: 'Already applied.' };
          const btn = this.findEasyApplyButton();
          if (!btn) return { status: 'skipped', message: 'Not an Easy Apply job.' };
          btn.click();
          await waitFor(() => this.findModal() || this.blockedReason(), 8000);
          const block1 = blocked();
          if (block1) return block1;
          modal = this.findModal();
          if (!modal) return { status: 'failed', message: 'The application form did not open.' };
        }

        let stuck = 0;
        for (let step = 1, guard = 0; step <= 30 && guard < 60; step++, guard++) {
          if (stopped()) return STOPPED;
          const block2 = blocked();
          if (block2) return block2;
          modal = this.findModal();
          if (!modal) return { status: 'failed', message: 'The form closed unexpectedly.' };
          this.handledModals.add(modal);
          this.mountHUD(modal);
          this.hud(`Step ${step}: filling in your answers…`);

          await sleep(jitter(400, 800));
          const unknown = await this.fillStep(modal, profile, job, stats, { allRequired: stuck > 0 });
          if (stopped()) return STOPPED;
          if (unknown.length) {
            const outcome = await this.resolveUnknown(unknown, profile, job, { batch });
            if (outcome === 'stopped') return STOPPED;
            if (outcome === 'skip') return { status: 'skipped', message: `Skipped: "${unknown[0].question.slice(0, 70)}" needs your answer.` };
          }
          await sleep(jitter(400, 900));

          const { submit, review, next } = this.navButtons(modal);

          if (submit) {
            if (!Settings.normalize(profile.settings).followCompanies) {
              const follow = Array.from(modal.querySelectorAll('input[type="checkbox"]')).find((c) => /follow/i.test(this.optionLabel(c)) && c.checked);
              if (follow) (document.querySelector(`label[for="${CSS.escape(follow.id)}"]`) || follow).click();
            }

            if (mode !== 'auto') {
              submit.classList.add('jf-pulse');
              this.hud('Everything is filled in. Review it, then click “Submit application”.',
                batch ? '<button type="button" class="jf-btn jf-btn-ghost" id="jf-hud-skip">Skip this job</button>' : '');
              document.getElementById('jf-hud-skip')?.addEventListener('click', () => { this.skipRequested = true; });
              if (!batch) return { status: 'review', message: 'Everything is filled in. Review it, then click “Submit application”.', job, stats };

              this.setBar(`Review & submit · ${job.company}`);
              let outcome = await this.waitForUserOrSkip(modal, true);
              // The user went Back to edit a step: they're driving now. Refilling and clicking Next
              // would undo what they came back to fix, so just wait for them to submit.
              while (outcome === 'changed') {
                this.hud('Your turn: make your changes, then click “Submit application”.',
                  '<button type="button" class="jf-btn jf-btn-ghost" id="jf-hud-skip">Skip this job</button>');
                document.getElementById('jf-hud-skip')?.addEventListener('click', () => { this.skipRequested = true; });
                outcome = await this.waitForUserOrSkip(this.findModal() || modal, true);
              }
              if (outcome === 'submitted') return this.finishSubmitted(job, stats);
              if (outcome === 'stopped') return STOPPED;
              return { status: 'skipped', message: 'Not submitted.' };
            }

            this.hud('Submitting…');
            await sleep(jitter(900, 2000)); // a person glances over the review page first
            if (stopped()) return STOPPED;
            submit.click();
            await waitFor(() => this.successVisible() || this.blockedReason() || (!this.findModal() && this.alreadyApplied()), 15000);
            const block3 = blocked();
            if (block3) return block3;
            if (!(this.successVisible() || (!this.findModal() && this.alreadyApplied()))) {
              return { status: 'failed', message: this.errors(this.findModal() || modal)[0] || 'LinkedIn did not confirm the submission.' };
            }
            return this.finishSubmitted(job, stats);
          }

          const target = review || next;
          if (!target) return { status: 'failed', message: 'Could not find the Next button.' };
          if (stopped()) return STOPPED;
          const before = this.signature(modal);
          target.click();
          const moved = await waitFor(() => this.signature(this.findModal()) !== before, 3000);
          if (moved) { stuck = 0; continue; }
          await sleep(400);
          if (this.signature(this.findModal()) !== before) { stuck = 0; continue; }

          // LinkedIn refused to move on
          stuck++;
          step--;
          if (stuck >= 4) {
            return { status: 'skipped', message: `Stuck on: ${this.errors(modal).slice(0, 2).join('; ') || 'a required question'}` };
          }
          // Fields that have a value LinkedIn rejected (e.g. text in a number box): ask the user.
          // Empty ones get another pass on the next loop, this time with AI allowed for every field.
          const invalid = this.erroredFields(modal).filter((f) => f.answered);
          if (invalid.length) {
            const outcome = await this.resolveUnknown(invalid, profile, job, { batch });
            if (outcome === 'stopped') return STOPPED;
            if (outcome === 'skip') return { status: 'skipped', message: `Skipped: "${invalid[0].question.slice(0, 70)}" needs your answer.` };
          }
        }
        return { status: 'failed', message: 'Too many steps.' };
      } catch (err) {
        console.warn(TAG, err);
        return { status: 'failed', message: err.message };
      } finally {
        this.isProcessing = false;
        this.skipRequested = false;
      }
    },

    async waitForUserOrSkip(modal, watchSubmit = false) {
      this.skipRequested = false;
      let active = true;
      const skipWatch = (async () => {
        while (active && !this.skipRequested) await sleep(300);
        return 'skip';
      })();
      const outcome = await Promise.race([this.waitForUser(modal, { watchSubmit }), skipWatch]);
      active = false; // ends the skip watcher loop
      return outcome;
    },

    async finishSubmitted(job, stats) {
      await this.closeSuccess();
      log('Submitted', job.company, job.jobTitle, stats.answers);
      const app = {
        platform: 'LinkedIn', company: job.company, jobTitle: job.jobTitle, url: job.url,
        externalId: job.externalId, location: job.location, fieldsFilled: stats.filled, aiAnswers: stats.ai
      };
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await Bridge.recordApplication(app);
          if (res?.usage) this.renderUsage(res.usage);
          break;
        } catch (err) {
          if (err.code === 'credit_limit_reached') return { status: 'submitted', message: `Applied to ${job.company}. ${err.message}`, stopBatch: true };
          log('Could not record application', err.message);
          if (attempt < 3) await sleep(1500 * attempt);
        }
      }
      return { status: 'submitted', message: `Applied to ${job.company}.` };
    },

    /** Review mode: the user clicks Submit themselves - still count it once LinkedIn confirms. */
    async watchManualSubmit(job, stats) {
      if (this.watchingSubmit) return;
      this.watchingSubmit = true;
      try {
        for (;;) {
          const modal = this.findModal();
          if (!modal || this.isBatchRunning) return;
          const outcome = await this.waitForUser(modal, { watchSubmit: true });
          if (this.isBatchRunning) return;
          if (outcome === 'submitted') {
            const res = await this.finishSubmitted(this.jobInfo().externalId === job.externalId ? job : this.jobInfo(), stats);
            this.setBar(res.message);
            return;
          }
          if (outcome !== 'changed') return;
        }
      } finally {
        this.watchingSubmit = false;
      }
    },

    // ---------------------------------------------------- manual watcher
    initWatcher() {
      if (this.watcherStarted) return;
      this.watcherStarted = true;
      setInterval(async () => {
        if (this.isBatchRunning || this.isProcessing || !window.location.pathname.startsWith('/jobs')) return;
        const modal = this.findModal();
        if (!modal || this.handledModals.has(modal)) return;
        this.handledModals.add(modal);
        this.isProcessing = true; // claimed before any await so the HUD buttons can't race us
        try {
          this.mountHUD(modal);
          const ctx = await this.loadContext();
          if (!ctx.signedIn || !ctx.onboarded) {
            return this.hud(ctx.signedIn ? 'Finish your JobFlow setup to autofill.' : 'Sign in to JobFlow to autofill.',
              '<button type="button" class="jf-btn" id="jf-hud-setup">Set up JobFlow</button>');
          }
          const allowed = await Bridge.canApply().catch((e) => ({ ok: false, message: e.message }));
          if (!allowed.ok) return this.hud(`${allowed.message} JobFlow won’t fill this one.`, '');
          const stats = { filled: 0, ai: 0, answers: [] };
          const job = this.jobInfo();
          const unknown = await this.fillStep(modal, ctx.profile, job, stats);
          if (unknown.length) await this.resolveUnknown(unknown, ctx.profile, job, { batch: false });
          this.hud(`Filled ${stats.filled} field${stats.filled === 1 ? '' : 's'}. Click “Fill to review” to finish.`);
          this.watchManualSubmit(job, stats);
        } catch (err) {
          this.hud(err.message);
        } finally {
          this.isProcessing = false;
        }
      }, 1000);
      document.addEventListener('click', (e) => {
        if (e.target?.id === 'jf-hud-setup') Bridge.openOnboarding();
      });
    },

    // -------------------------------------------------------------- batch
    cards() {
      for (const sel of SEL.card) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length) return found;
      }
      return [];
    },

    cardId(card) {
      return card.getAttribute('data-occludable-job-id') || card.getAttribute('data-job-id') ||
        card.querySelector('[data-job-id]')?.getAttribute('data-job-id') ||
        (card.querySelector(SEL.cardLink)?.href.match(/\/jobs\/view\/(\d+)/) || [])[1] || null;
    },

    currentJobId() {
      const url = new URL(window.location.href);
      return url.searchParams.get('currentJobId') || (url.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1] || null;
    },

    setBar(text) {
      const el = document.getElementById('jf-bar-status');
      if (el) el.textContent = text;
    },

    renderUsage(usage) {
      const el = document.getElementById('jf-bar-usage');
      if (el && usage) el.textContent = `${usage.remaining} left this month`;
    },

    renderCounts() {
      const el = document.getElementById('jf-bar-counts');
      if (el) el.textContent = `Applied ${this.session.applied} · Skipped ${this.session.skipped}`;
    },

    async mountBar() {
      if (document.getElementById('jobflow-bar')) return;
      const bar = document.createElement('div');
      bar.id = 'jobflow-bar';
      bar.className = 'jf-bar';
      bar.innerHTML = `
        <span class="jf-bar-logo"><span class="jf-mark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h8"/><path d="M5 12h13"/><path d="M5 17h5"/><path d="m14.5 8.5 3.5 3.5-3.5 3.5"/></svg></span><span class="jf-bar-name">JobFlow</span></span>
        <span class="jf-dot" aria-hidden="true"></span>
        <span class="jf-bar-status" id="jf-bar-status">Loading…</span>
        <span class="jf-bar-meta" id="jf-bar-counts"></span>
        <span class="jf-bar-meta" id="jf-bar-usage"></span>
        <button type="button" class="jf-btn" id="jf-bar-start" hidden><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/></svg> Start</button>
        <button type="button" class="jf-btn jf-btn-danger" id="jf-bar-stop" hidden><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/></svg> Stop</button>
        <button type="button" class="jf-btn" id="jf-bar-setup" hidden>Set up JobFlow</button>
        <button type="button" class="jf-btn jf-btn-ghost" id="jf-bar-limit" hidden>Change limit</button>
        <button type="button" class="jf-bar-min" id="jf-bar-settings" aria-label="Settings" title="Settings"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/></svg></button>
        <button type="button" class="jf-bar-min" id="jf-bar-min" aria-label="Minimize" title="Minimize"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>`;
      document.body.appendChild(bar);
      bar.querySelector('#jf-bar-start').onclick = () => this.startBatch();
      bar.querySelector('#jf-bar-stop').onclick = () => this.stopBatch();
      bar.querySelector('#jf-bar-setup').onclick = () => Bridge.openOnboarding();
      bar.querySelector('#jf-bar-settings').onclick = () => Bridge.send('OPEN_SETTINGS').catch(() => {});
      bar.querySelector('#jf-bar-limit').onclick = () => Bridge.send('OPEN_SETTINGS').catch(() => {});
      bar.querySelector('#jf-bar-min').onclick = () => bar.classList.toggle('jf-bar-collapsed');
      await this.refreshBar();
    },

    async refreshBar() {
      let ctx;
      try {
        ctx = await this.loadContext(true);
      } catch (err) {
        return this.setBar(err.message);
      }
      const start = document.getElementById('jf-bar-start');
      const setup = document.getElementById('jf-bar-setup');
      if (!start) return;
      if (!ctx.signedIn || !ctx.onboarded) {
        start.hidden = true;
        setup.hidden = false;
        setup.textContent = ctx.signedIn ? 'Finish setup' : 'Sign in';
        this.setBar(ctx.signedIn ? 'Finish setting up to start applying' : 'Sign in to start applying');
        return;
      }
      setup.hidden = true;
      if (this.isBatchRunning) return;
      const st = Settings.normalize(ctx.profile.settings);
      this.renderUsage(ctx.usage);
      this.renderCounts();
      // Tell the truth up front: a "Ready" bar that stops on the first job is worse than no bar
      const allowed = await Bridge.canApply().catch((e) => ({ ok: false, message: e.message }));
      start.hidden = !allowed.ok;
      if (!allowed.ok) {
        if (allowed.reason === 'daily_limit') {
          document.getElementById('jf-bar-limit').hidden = false;
          return this.setBar(`Daily limit of ${allowed.message.match(/\d+/)?.[0] || ''} reached. Resets at midnight.`);
        }
        return this.setBar(allowed.message);
      }
      const cooldown = await this.getCooldown();
      if (cooldown) return this.setBar(`Paused: ${cooldown.reason}`);
      document.getElementById('jf-bar-limit').hidden = true;
      const today = allowed.todayCount ?? 0;
      const cap = allowed.dailyLimit === undefined ? st.dailyLimit : allowed.dailyLimit; // null = no daily limit
      const room = Math.max(0, Math.min(st.maxPerRun, cap == null ? Infinity : cap - today, allowed.usage?.remaining ?? Infinity));
      const todayText = cap == null ? `${today} today` : `${today}/${cap} today`;
      this.setBar(st.mode === 'auto'
        ? `Ready · fully automatic · up to ${room} this run (${todayText})`
        : `Ready · you review each one (${todayText})`);
    },

    setRunning(running) {
      this.isBatchRunning = running;
      const start = document.getElementById('jf-bar-start');
      const stop = document.getElementById('jf-bar-stop');
      if (start) start.hidden = running;
      if (stop) stop.hidden = !running;
      document.getElementById('jobflow-bar')?.classList.toggle('jf-bar-running', running);
    },

    /** The run survives moving to the next search: state lives in this tab's sessionStorage. */
    runState(patch) {
      try {
        const now = JSON.parse(sessionStorage.getItem('jobflow.run') || 'null');
        if (patch === null) { sessionStorage.removeItem('jobflow.run'); return null; }
        if (!patch) return now && Date.now() - now.at < 60 * 60 * 1000 ? now : null;
        const next = { ...(now || {}), ...patch, at: Date.now() };
        sessionStorage.setItem('jobflow.run', JSON.stringify(next));
        return next;
      } catch (_) {
        return null;
      }
    },

    async startBatch(opts = {}) {
      if (this.isBatchRunning) return;
      const ctx = await this.loadContext(true).catch((err) => { this.setBar(err.message); return null; });
      if (!ctx) return;
      if (!ctx.signedIn || !ctx.onboarded) return this.refreshBar();

      const cooldown = await this.getCooldown();
      if (cooldown && !this.cooldownOverride) {
        this.cooldownOverride = true;
        const until = new Date(cooldown.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return this.setBar(`Paused until ${until}: ${cooldown.reason}. Press Start again to override.`);
      }
      const lease = await Bridge.send('ACQUIRE_BATCH').catch(() => ({ ok: true }));
      if (lease && lease.ok === false) return this.setBar('JobFlow is already applying in another LinkedIn tab.');

      this.cooldownOverride = false;
      this.batchStopRequested = false;
      this.aiLimitHit = false;
      this.setRunning(true);
      // Keep the one-tab lease (90 s) alive through breaks, review waits and pop-ups
      const heartbeat = setInterval(() => Bridge.send('ACQUIRE_BATCH').catch(() => {}), 30000);
      try {
        await this.runBatch(ctx, opts.resume ? this.runState() : null);
      } catch (err) {
        console.warn(TAG, err);
        this.setBar(`Stopped: ${err.message}`);
      } finally {
        clearInterval(heartbeat);
        if (!this.movingToNextSearch) this.runState(null);
        this.setRunning(false);
        Bridge.send('RELEASE_BATCH').catch(() => {});
        notifyIfHidden('JobFlow finished', `${document.getElementById('jf-bar-status')?.textContent || 'Run ended.'} Applied to ${this.session.applied} this session.`);
        this.batchStopRequested = false;
      }
    },

    async getCooldown() {
      try {
        const got = await chrome.storage.local.get('jobflow.cooldown.v2');
        const c = got['jobflow.cooldown.v2'];
        return c && c.until > Date.now() ? c : null;
      } catch (_) {
        return null;
      }
    },

    setCooldown(reason, hours = 12) {
      try { chrome.storage.local.set({ 'jobflow.cooldown.v2': { reason, until: Date.now() + hours * 3600 * 1000 } }); } catch (_) { /* tests */ }
    },

    async runBatch(ctx, resumed = null) {
      const profile = ctx.profile;
      const settings = Settings.normalize(profile.settings);
      let mode = settings.mode;
      const searchTitles = Settings.searchTitles(profile, settings);
      const pageKeywords = new URL(location.href).searchParams.get('keywords')?.replace(/"/g, '').trim() || '';
      const chosenTitles = Boolean(String(settings.searchKeywords || '').trim());
      // The page's search is one of the titles the user wants
      const pageIsWanted = Boolean(pageKeywords) && searchTitles.some((t) => t.toLowerCase() === pageKeywords.toLowerCase() || Settings.titleMatches(pageKeywords, t));
      // Without titles in settings, a search the user typed themselves counts as what they want
      if (!chosenTitles && pageKeywords && !pageIsWanted) searchTitles.push(pageKeywords);
      const seen = new Set();
      const unseen = (c) => { const id = this.cardId(c); return Boolean(id) && !seen.has(id); };
      let appliedThisRun = resumed?.applied || 0;
      // Searches built from the profile, so a run doesn't end just because one search ran dry
      // Searches already done this run; the rest is rebuilt from the current settings, so titles and
      // locations changed mid-run take effect at the next search
      const done = [...(resumed?.done || []), location.href];
      let queue = Settings.searchQueue(profile, settings).filter((u) => !done.some((d) => sameSearch(u, d)));
      this.session.applied = resumed?.sessionApplied ?? this.session.applied;
      this.session.skipped = resumed?.sessionSkipped ?? this.session.skipped;
      this.movingToNextSearch = false;
      this.runState({ running: true, handoff: null, queue, done, applied: appliedThisRun, sessionApplied: this.session.applied, sessionSkipped: this.session.skipped });

      const nextSearch = async (force = false) => {
        if (!settings.keepSearching && !force) return false;
        const url = queue.shift();
        if (!url) return false;
        const title = new URL(url).searchParams.get('keywords')?.replace(/"/g, '');
        this.setBar(`Searching for “${title}” next…`);
        this.movingToNextSearch = true;
        done.push(url);
        this.runState({ running: true, handoff: url, handoffAt: Date.now(), queue, done, applied: appliedThisRun, sessionApplied: this.session.applied, sessionSkipped: this.session.skipped });
        await sleep(jitter(2000, 4000));
        location.href = url; // the run picks up again when the page reloads
        await sleep(20000);
        return true;
      };
      let failuresInRow = 0;
      let untilBreak = Settings.breakAfter();
      const protect = (reason) => {
        this.setCooldown(reason);
        notifyIfHidden('JobFlow stopped to protect your account', reason);
        this.setBar(`Stopped: ${reason}. JobFlow will stay paused for 12 hours to protect your account.`);
      };

      // Titles chosen in settings win over whatever search happens to be open
      if (!resumed && chosenTitles && !pageIsWanted && queue.length) {
        this.setBar(`Applying for ${searchTitles.slice(0, 3).join(', ')}: opening your search…`);
        if (await nextSearch(true)) return;
      }

      this.setBar('Finding jobs…');
      await waitFor(() => this.cards().length, 10000);

      while (!this.batchStopRequested) {
        const blocked = this.blockedReason();
        if (blocked) return protect(blocked);
        if (appliedThisRun >= settings.maxPerRun) return this.setBar(`Done · applied to ${appliedThisRun} (your per-run limit)`);
        Bridge.send('ACQUIRE_BATCH').catch(() => {}); // heartbeat for the one-tab lease
        const allowed = await Bridge.canApply().catch((e) => ({ ok: false, message: e.message }));
        if (!allowed.ok) return this.setBar(allowed.message);
        // Settings may have changed mid-run (settings page or dashboard): pick up pace, and a switch to review
        const fresh = await this.loadContext(true).catch(() => null);
        if (fresh?.profile) {
          const now = Settings.normalize(fresh.profile.settings);
          settings.pace = now.pace;
          if (mode === 'auto' && now.mode !== 'auto') {
            mode = 'review';
            this.setBar('Switched to review mode: JobFlow will stop at Submit from now on.');
          }
        }

        const card = this.cards().find(unseen);
        if (!card) {
          const cards = this.cards();
          cards[cards.length - 1]?.scrollIntoView?.({ block: 'end' });
          await sleep(1500);
          if (this.cards().some(unseen)) continue;
          const nextBtn = this.findNextPage();
          if (!nextBtn) {
            if (await nextSearch()) return;
            return this.setBar(`Done · applied to ${this.session.applied} this session. No more jobs in your searches.`);
          }
          this.setBar('Next page…');
          const first = this.cards()[0];
          const firstBefore = first ? this.cardId(first) : null;
          nextBtn.click();
          await waitFor(() => { const f = this.cards()[0]; return f && this.cardId(f) !== firstBefore; }, 10000);
          await sleep(jitter(1500, 3000));
          continue;
        }

        const jobId = this.cardId(card);
        seen.add(jobId);
        card.scrollIntoView?.({ block: 'center' });
        // LinkedIn renders cards lazily: an off-screen card has no title until it scrolls into view
        await waitFor(() => clean(card.querySelector(SEL.cardLink)?.textContent), 3000);
        const footer = card.querySelector('.job-card-container__footer-wrapper')?.textContent || '';
        if (/\bapplied\b/i.test(footer)) continue;

        const cardTitle = clean(card.querySelector(SEL.cardLink)?.textContent);
        const cardCompany = clean(card.querySelector('.artdeco-entity-lockup__subtitle, .job-card-container__primary-description')?.textContent);
        // No title yet? Don't judge it by an empty string - check the job's own page once it opens
        const filtered = Settings.filterJob(settings, { title: cardTitle, company: cardCompany, promoted: /\bpromoted\b/i.test(footer), titles: cardTitle ? searchTitles : [] });
        if (filtered) {
          this.session.skipped++;
          this.renderCounts();
          this.setBar(`Skipped ${cardCompany || 'job'}: ${filtered}`);
          await sleep(jitter(600, 1200));
          continue;
        }

        (card.querySelector(SEL.cardLink) || card).click();
        const opened = await waitFor(() => this.currentJobId() === jobId, 6000);
        if (!opened) continue; // never act on whatever job the pane still shows
        const paneReady = () => this.findEasyApplyButton() || this.alreadyApplied() || document.querySelector(`${SEL.detailsPane} ${SEL.jobTitle}`);
        if (!(await waitFor(paneReady, 6000))) {
          // LinkedIn sometimes leaves the first job's pane on a spinner: nudge it once
          (card.querySelector(SEL.cardLink) || card).click();
          await waitFor(paneReady, 6000);
        }
        await waitFor(() => this.findEasyApplyButton() || this.alreadyApplied(), 4000);
        await sleep(jitter(1500, 3000)); // read the job like a person would
        if (this.batchStopRequested) break;

        const job = this.jobInfo();
        if (!cardTitle) {
          const late = Settings.filterJob(settings, { title: job.jobTitle, company: job.company, titles: searchTitles });
          if (late) {
            this.session.skipped++;
            this.renderCounts();
            this.setBar(`Skipped ${job.company || 'job'}: ${late}`);
            await sleep(jitter(600, 1200));
            continue;
          }
        }
        this.setBar(`${job.company}: filling application…`);
        const res = await this.runApplication(profile, { mode, batch: true });
        log(job.company, res.status, res.message);

        if (res.status === 'submitted') { this.session.applied++; appliedThisRun++; failuresInRow = 0; untilBreak--; }
        else if (res.status === 'failed') { this.session.skipped++; failuresInRow++; }
        else if (res.status !== 'stopped') this.session.skipped++;
        this.runState({ applied: appliedThisRun, sessionApplied: this.session.applied, sessionSkipped: this.session.skipped, queue });
        if (res.status !== 'submitted' && (this.findModal() || this.saveDialog())) await this.discard();
        this.renderCounts();
        this.setBar(`${job.company}: ${res.message}`);

        if (res.blocked) return protect(res.message);
        if (res.stopBatch || res.status === 'stopped') break;
        if (failuresInRow >= 3) return this.setBar('Stopped after 3 failed applications in a row. Check the LinkedIn page, then press Start.');

        let wait = res.status === 'submitted' ? Settings.paceDelay(settings) : jitter(3000, 6000);
        let label = null;
        if (res.status === 'submitted' && untilBreak <= 0) {
          wait = Settings.breakDelay();
          untilBreak = Settings.breakAfter();
          label = `Applied to ${job.company}. Short break to keep a human pace · next job in`;
        } else if (res.status === 'submitted') {
          label = `Applied to ${job.company}. Next job in`;
        }
        // Live countdown on the bar
        const until = Date.now() + wait;
        let shown = null;
        while (Date.now() < until && !this.batchStopRequested) {
          const left = Math.ceil((until - Date.now()) / 1000);
          if (label && left !== shown) {
            shown = left;
            this.setBar(`${label} ${left >= 60 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${left}s`}`);
          }
          await sleep(250);
        }
      }

      if (this.batchStopRequested) this.setBar(`Stopped · applied to ${this.session.applied} this session`);
    },

    stopBatch() {
      this.batchStopRequested = true;
      this.setBar('Stopping after this step…');
    }
  };

  L.sleep = sleep; // exposed for tests
  window.JobFlowLinkedIn = L;

  // ------------------------------------------------------------------ boot
  const onJobsPage = () => window.location.pathname.startsWith('/jobs');
  const tick = () => {
    if (!document.body) return;
    const bar = document.getElementById('jobflow-bar');
    if (onJobsPage() && !bar) L.mountBar();
    if (!onJobsPage() && bar && !L.isBatchRunning) bar.remove();
  };
  L.initWatcher();
  tick();
  // Continue a run that moved itself to the next search. A reload or the user navigating away is
  // NOT a hand-off: that's often how people stop a run, so it must not start submitting again.
  const pending = L.runState();
  if (pending?.running) {
    const handedOff = pending.handoff && Date.now() - (pending.handoffAt || 0) < 2 * 60 * 1000 && sameSearch(pending.handoff, location.href);
    const resumeRun = () => setTimeout(() => L.mountBar().then(() => L.startBatch({ resume: true })).catch(() => {}), 2500);
    if (onJobsPage() && handedOff) {
      L.runState({ handoff: null });
      resumeRun();
    } else if (onJobsPage()) {
      // JobFlow refreshed this tab itself after an update: carry on with the run
      Bridge.send('SHOULD_RESUME').then((r) => (r?.resume ? resumeRun() : L.runState(null))).catch(() => L.runState(null));
    } else {
      L.runState(null);
    }
  }
  setInterval(tick, 1500);
  chrome.storage.onChanged.addListener((changes) => {
    if (changes['jobflow.auth']) { Bridge.invalidate(); L.refreshBar(); }
  });
})();
