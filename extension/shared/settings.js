/* JobFlow AI - auto-apply settings schema (shared by extension + web app) */
(function (root) {
  const DEFAULTS = {
    mode: 'review',            // 'review' = fill and let me submit, 'auto' = submit automatically
    dailyLimit: 20,            // applications per day (ceiling 50 - LinkedIn throttles above that)
    noDailyLimit: false,       // user opted out of the daily cap (monthly credits, pace and LinkedIn stop-checks still apply)
    maxPerRun: 10,             // stop a session after this many submissions
    pace: 'normal',            // 'careful' | 'normal' | 'fast' - delay between jobs
    useAI: true,               // let AI answer from my profile when my saved answers don't cover a question
    whenUnknown: 'ask',        // 'ask' = pop up and ask me, 'skip' = skip the job
    askTimeoutSec: 0,          // 0 = wait for me; otherwise skip the job after this many seconds
    rememberAnswers: true,     // save what I type in the pop-up for next time
    followCompanies: false,    // leave LinkedIn's "Follow company" box ticked?
    skipPromoted: false,       // skip promoted job cards
    skipJobBoards: true,       // skip listings re-posted by job boards and bulk recruiters (see JOB_BOARDS)
    titleInclude: '',          // comma-separated: only apply if the title contains one of these
    titleExclude: '',          // comma-separated: never apply if the title contains one of these
    skipCompanies: '',         // comma-separated company names to never apply to
    keepSearching: true,       // when a search runs out, move on to the next search built from the profile
    searchKeywords: '',        // comma-separated job titles to search (defaults to the profile's target roles)
    searchLocations: '',       // comma-separated places to search (defaults to the profile's locations + city)
    matchSearchTitles: true    // only apply when the job title matches one of the titles being searched
  };

  // Gaps between submitted applications. LinkedIn pauses Easy Apply for members who apply
  // "at a fast pace", so even Fast keeps a human rhythm.
  const PACE_MS = {
    careful: [60000, 120000],
    normal: [30000, 60000],
    fast: [15000, 30000],
    turbo: [6000, 12000]       // noticeably riskier: LinkedIn pauses Easy Apply for "unusually fast" applying
  };
  const MAX_DAILY = 50;
  const MAX_PER_RUN = 50;
  const BREAK_EVERY = [6, 10];              // submissions between longer breaks
  const BREAK_MS = [3 * 60000, 6 * 60000];  // length of a break

  const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

  // Companies that re-post other employers' jobs as "Easy Apply" to collect CVs. Exact names only.
  const JOB_BOARDS = ['hire feed', 'hirefeed', 'hired', 'synthires', 'quik hire staffing', 'jobs via dice', 'jobot', 'crossover', 'turing', 'mercor', 'braintrust', 'toptal', 'jobgether', 'jobright.ai', 'jobright'];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Whole-word match: "intern" matches "Intern" and "AI Intern", not "International". */
  const hasTerm = (text, term) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, 'iu').test(text);

  /** Merge stored settings with defaults, migrating older keys. */
  function normalize(raw) {
    const s = { ...DEFAULTS, ...(raw || {}) };
    // v1 used a single "unknownQuestion" field
    if (raw && raw.unknownQuestion && raw.useAI === undefined) {
      s.useAI = raw.unknownQuestion === 'ai';
      s.whenUnknown = 'ask';
    }
    delete s.unknownQuestion;
    s.mode = s.mode === 'auto' ? 'auto' : 'review';
    s.dailyLimit = clampInt(s.dailyLimit, 1, MAX_DAILY, DEFAULTS.dailyLimit);
    s.maxPerRun = clampInt(s.maxPerRun, 1, MAX_PER_RUN, DEFAULTS.maxPerRun);
    s.askTimeoutSec = clampInt(s.askTimeoutSec, 0, 3600, 0);
    if (!PACE_MS[s.pace]) s.pace = DEFAULTS.pace;
    if (!['ask', 'skip'].includes(s.whenUnknown)) s.whenUnknown = 'ask';
    for (const k of ['noDailyLimit', 'useAI', 'rememberAnswers', 'followCompanies', 'skipPromoted', 'skipJobBoards', 'keepSearching', 'matchSearchTitles']) s[k] = Boolean(s[k]);
    return s;
  }

  function clampInt(v, min, max, fallback) {
    if (v === '' || v == null) return fallback; // a cleared field means "default", not 0
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  const STOP_WORDS = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'in', 'for', 'to', 'with', '&', '-', '–', '/']);
  const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}+#.]+/u).filter((w) => w && !STOP_WORDS.has(w));
  /** "AI Engineer" matches "Lead – AI Engineering" and "Senior AI Engineer (GenAI)"; "Engineer" alone doesn't match "AI Engineer" searches. */
  function titleMatches(title, wanted) {
    const have = words(title);
    const need = words(wanted);
    return need.length > 0 && need.every((w) => have.some((h) => h === w || (w.length >= 4 && h.startsWith(w))));
  }

  /** Job titles a run searches for: settings first, else the profile's target roles and current title. */
  function searchTitles(profile = {}, settings = {}) {
    const s = normalize(settings);
    const own = String(s.searchKeywords || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (own.length) return own;
    const prefs = profile.preferences || {};
    return [...(prefs.roles || []), profile.currentTitle].map((r) => String(r || '').trim()).filter(Boolean)
      .filter((t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
  }

  /** Returns a reason string if a job should be skipped by the user's filters, else null.
   * titles: the job titles being searched (for matchSearchTitles). */
  function filterJob(settings, { title = '', company = '', promoted = false, titles = [] } = {}) {
    const s = normalize(settings);
    const t = title.toLowerCase();
    const c = company.toLowerCase();
    if (s.skipPromoted && promoted) return 'promoted job';
    if (s.skipJobBoards && JOB_BOARDS.includes(c.replace(/\s+/g, ' ').trim())) return `re-posted by a job board (${company.trim()})`;
    const skipCo = list(s.skipCompanies).find((x) => hasTerm(c, x));
    if (skipCo) return `company on your skip list (${skipCo})`;
    const ex = list(s.titleExclude).find((x) => hasTerm(t, x));
    if (ex) return `title contains "${ex}"`;
    const inc = list(s.titleInclude);
    if (inc.length && !inc.some((x) => hasTerm(t, x))) return 'title doesn’t match your keywords';
    if (s.matchSearchTitles && titles.length && !titles.some((w) => titleMatches(title, w))) return `title doesn’t match what you’re applying for (${titles.slice(0, 3).join(', ')})`;
    return null;
  }

  function paceDelay(settings) {
    const [min, max] = PACE_MS[normalize(settings).pace];
    return Math.round(min + Math.random() * (max - min));
  }

  /** LinkedIn Easy Apply searches built from the profile: every title in every place, then wider
   * nets (the whole country, remote, older posts) so a run keeps finding jobs after the first search runs dry. */
  function searchQueue(profile = {}, settings = {}) {
    const s = normalize(settings);
    const prefs = profile.preferences || {};
    const titles = searchTitles(profile, s);
    const own = String(s.searchLocations || '').split(',').map((x) => x.trim()).filter(Boolean);
    const places = own.length ? own : String(prefs.locations || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!own.length && profile.city) places.push(profile.city);
    const home = root.JobFlowCountries?.getCountry?.(profile.country)?.name;
    // Work modes are a questionnaire answer (profile.answers), older profiles kept them in preferences
    const workModes = profile.answers?.workModes || prefs.workModes || [];
    const wantsRemote = workModes.includes('remote') || places.some((p) => /^remote$/i.test(p));

    const seen = new Set();
    const urls = [];
    const add = (title, place, { remote = false, anyTime = false } = {}) => {
      const key = `${title}|${place}|${remote}|${anyTime}`.toLowerCase();
      if (!title || seen.has(key)) return;
      seen.add(key);
      const url = new URL('https://www.linkedin.com/jobs/search/');
      // Quoted = exact phrase. Unquoted "AI Engineer" also returns Cloud Engineer, Zoho Developer...
      url.searchParams.set('keywords', /\s/.test(title) && !/["()]|\b(OR|AND|NOT)\b/.test(title) ? `"${title}"` : title);
      url.searchParams.set('f_AL', 'true');                    // Easy Apply only
      if (!anyTime) url.searchParams.set('f_TPR', 'r2592000'); // posted in the last month
      url.searchParams.set('sortBy', 'DD');                    // newest first
      if (place) url.searchParams.set('location', place);
      if (remote) url.searchParams.set('f_WT', '2');
      urls.push(url.toString());
    };
    const cities = places.filter((p) => !/^remote$/i.test(p));
    // 1. every title in every chosen place
    for (const t of titles) for (const p of (cities.length ? cities : [home || ''])) add(t, p);
    // 2. the whole country (catches Abu Dhabi, Sharjah... when the city was Dubai)
    if (home) for (const t of titles) add(t, home);
    // 3. remote roles open to the home country - worldwide remote is mostly jobs they can't legally take
    if (wantsRemote) for (const t of titles) add(t, home || '', { remote: true });
    // 4. same places without the "last month" filter
    for (const t of titles) for (const p of (cities.length ? cities : [home || ''])) add(t, p, { anyTime: true });
    if (home) for (const t of titles) add(t, home, { anyTime: true });
    return urls.slice(0, 40);
  }

  const rand = ([min, max]) => Math.round(min + Math.random() * (max - min));
  const breakAfter = () => rand(BREAK_EVERY);
  const breakDelay = () => rand(BREAK_MS);

  const api = { DEFAULTS, PACE_MS, MAX_DAILY, MAX_PER_RUN, JOB_BOARDS, normalize, titleMatches, searchTitles, filterJob, paceDelay, breakAfter, breakDelay, searchQueue };
  root.JobFlowSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
