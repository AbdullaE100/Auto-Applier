/* JobFlow AI - deterministic answer engine
 *
 * Answers common screening questions from the candidate's profile and
 * onboarding answers, without an AI call. It is deliberately conservative:
 * whenever a question adds a detail we can't verify (a subject, a currency,
 * a destination, a specific tool) it returns null so the caller falls back to
 * AI-from-profile or to the user. A wrong answer is worse than no answer.
 */
(function (root) {
  const Countries = root.JobFlowCountries || (typeof require !== 'undefined' ? require('./countries.js') : null);
  const Questions = root.JobFlowQuestions || (typeof require !== 'undefined' ? require('./questions.js') : null);

  const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function normalizeQuestion(q) {
    return String(q || '')
      .toLowerCase()
      .replace(/\*/g, '')
      .replace(/\(required\)|\brequired\s*$/g, '')
      // Keep letters and digits in every script (Chinese, Arabic, Cyrillic...) so non-English questions don't collapse to ''
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  /** Label with required markers, "(optional)" and trailing punctuation removed. */
  function cleanLabel(label) {
    return norm(label).replace(/\*/g, '').replace(/\((optional|required)\)|\s(required|optional)$/g, '').replace(/[?:.\s]+$/g, '').trim();
  }

  const isPlaceholder = (label) => /^(select|choose|please select|--|-)/i.test(norm(label)) || norm(label) === '';
  const realOptions = (options) => (options || []).filter((o) => !isPlaceholder(o));

  /** Whole-word match that ignores negated uses ("Not Hispanic", "non-veteran"). */
  function hasWord(text, word) {
    const t = norm(text);
    const re = new RegExp(`(?<![a-z0-9-])${escapeRe(norm(word))}(?![a-z0-9])`, 'g');
    let m;
    while ((m = re.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 5), m.index);
      if (!/\bnot\s$|\bnon-?$/.test(before)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- options
  const YES = /^(yes|y|true|i am|i do|i have|i will|i can|authorized|eligible|agree|accept)\b/;
  const NO = /^(no|n|false|i am not|i do not|i don't|i will not|i won't|i cannot|not )\b/;

  function pickYesNo(options, yes) {
    const clean = realOptions(options);
    const exact = clean.find((o) => norm(o) === (yes ? 'yes' : 'no'));
    if (exact) return exact;
    const hits = clean.filter((o) => (yes ? YES : NO).test(norm(o)) && !(yes ? NO : YES).test(norm(o)));
    return hits.length === 1 ? hits[0] : null;
  }

  function parseRange(label) {
    // "$50,000", "50k", "AED 10K" -> plain numbers
    const t = norm(label).replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/[$£€₹]/g, '')
      .replace(/(\d+(?:\.\d+)?)\s*k\b/g, (_, n) => String(Number(n) * 1000))
      .replace(/(\d+(?:\.\d+)?)\s*(?:m|mn)\b/g, (_, n) => String(Number(n) * 1000000));
    let m = t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
    if (m) return [Number(m[1]), Number(m[2])];
    m = t.match(/(\d+(?:\.\d+)?)\s*\+|(?:more than|over|above|at least)\s*(\d+(?:\.\d+)?)/);
    if (m) return [Number(m[1] || m[2]), Infinity];
    m = t.match(/(?:less than|under|below|fewer than)\s*(\d+(?:\.\d+)?)/);
    if (m) return [-Infinity, Number(m[1]) - 0.0001];
    m = t.match(/^(\d+(?:\.\d+)?)/);
    if (m) return [Number(m[1]), Number(m[1])];
    if (/\bnone\b|\bno experience\b/.test(t)) return [0, 0];
    return null;
  }

  function pickNumber(options, n, { exact = false } = {}) {
    let best = null;
    let bestDist = Infinity;
    for (const o of realOptions(options)) {
      const r = parseRange(o);
      if (!r) continue;
      if (n >= r[0] && n <= r[1]) return o;
      const dist = Math.min(Math.abs(r[0] - n), Math.abs(r[1] - n));
      if (dist < bestDist) { best = o; bestDist = dist; }
    }
    return exact ? null : best;
  }

  /** Days represented by a notice-period option ("Immediately", "2 weeks", "30 days", "1-2 months"). */
  function optionDays(label) {
    const t = norm(label);
    if (/immediate|right away|asap|\bnow\b|no notice/.test(t)) return 0;
    const m = t.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(day|week|month)/);
    if (m) {
      const hi = Number(m[2] || m[1]);
      return hi * ({ day: 1, week: 7, month: 30 }[m[3]]);
    }
    const words = { one: 1, two: 2, three: 3, four: 4, six: 6 };
    const w = t.match(/\b(one|two|three|four|six)\s*(week|month)/);
    if (w) return words[w[1]] * (w[2] === 'week' ? 7 : 30);
    if (/more than|over|\+/.test(t)) return 999;
    return null;
  }

  function pickDuration(options, days) {
    let best = null;
    let bestDist = Infinity;
    for (const o of realOptions(options)) {
      const d = optionDays(o);
      if (d === null) continue;
      const dist = Math.abs(d - days) + (d < days ? 0.5 : 0); // never claim to start sooner on a tie
      if (dist < bestDist) { best = o; bestDist = dist; }
    }
    return best;
  }

  /** Options containing a keyword as a whole, non-negated word; only returns a unique best match. */
  function pickByKeywords(options, keywords) {
    const clean = realOptions(options);
    for (const kw of keywords) {
      const hits = clean.filter((o) => hasWord(o, kw));
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) {
        const exact = hits.find((o) => norm(o) === norm(kw));
        if (exact) return exact;
        return hits.sort((a, b) => a.length - b.length)[0];
      }
    }
    return null;
  }

  // ------------------------------------------------------------- helpers
  const EDU_RANK = { highschool: 1, diploma: 2, bachelor: 3, master: 4, phd: 5 };

  // Explicit codes first: "CAD $" and "AUD $" are not US dollars
  const CURRENCY_HINTS = [
    [/\bcad\b|canadian dollars?/, 'CAD'], [/\baud\b|australian dollars?/, 'AUD'], [/\bsgd\b|singapore dollars?/, 'SGD'],
    [/\bnzd\b/, 'NZD'], [/\bhkd\b/, 'HKD'],
    [/£|\bgbp\b|pounds?\b/, 'GBP'], [/€|\beur\b|euros?\b/, 'EUR'],
    [/\baed\b|dirhams?\b/, 'AED'], [/\bsar\b|riyals?\b/, 'SAR'], [/\bqar\b/, 'QAR'], [/\bkwd\b/, 'KWD'],
    [/\binr\b|₹|rupees?\b|\blpa\b|lakhs?\b/, 'INR'], [/\$|\busd\b|dollars?\b/, 'USD']
  ];

  function salaryFor(profile, question) {
    const p = profile.preferences || {};
    const amount = Number(p.salaryAmount);
    if (!amount) return null;
    const q = norm(question);
    const mentioned = CURRENCY_HINTS.find(([re]) => re.test(q))?.[1];
    if (mentioned && p.salaryCurrency && mentioned !== String(p.salaryCurrency).toUpperCase()) return null; // don't convert currencies
    const period = p.salaryPeriod === 'month' ? 'month' : 'year';
    let value = amount;
    if (/\bmonth|monthly|per month|\/ ?mo\b/.test(q) && period === 'year') value = Math.round(amount / 12);
    if (/annual|yearly|per year|per annum|\bctc\b|\blpa\b/.test(q) && period === 'month') value = amount * 12;
    if (/hourly|per hour|daily rate|per day/.test(q)) return null;
    if (/\blpa\b|lakh/.test(q)) value = Math.round((value / 100000) * 10) / 10;
    return value;
  }

  /** Country the question is about: named in the question, else the job's location, else the candidate's home. */
  function targetPlace(q, profile, job) {
    const inQuestion = Countries.detectCountryInText(q);
    if (inQuestion) return { place: inQuestion, known: true };
    if (job) {
      // No location (LinkedIn changed its markup?) is not the same as "at home"
      const fromJob = job.location ? Countries.detectCountryInLocation(job.location) : null;
      if (fromJob) return { place: fromJob, known: true };
      return { place: null, known: false }; // e.g. "Remote" - we can't tell which country's rules apply
    }
    return { place: null, known: true }; // no job context: home country
  }

  function resolveDesire(desire, field) {
    if (desire == null) return null;
    const options = field.options || [];
    const hasOptions = realOptions(options).length > 0;
    switch (desire.kind) {
      case 'yesno':
        if (hasOptions) return pickYesNo(options, desire.value);
        // "What degree have you obtained?" is not answered with "Yes"
        if (!/^(do|does|are|is|have|has|will|would|can|could|did|were|was|should|may|if)\b/.test(norm(field.question))) return null;
        return desire.value ? 'Yes' : 'No';
      case 'number':
        // Salary brackets must actually contain the amount - "closest" is a different salary
        return hasOptions ? pickNumber(options, desire.value, { exact: desire.exact }) : String(desire.value);
      case 'duration':
        return hasOptions ? pickDuration(options, desire.days) : desire.text;
      case 'choice':
        return hasOptions ? pickByKeywords(options, desire.keywords) : (desire.text || null);
      case 'text':
        return hasOptions ? pickByKeywords(options, [desire.value]) : (desire.value || null);
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ the rules
  function desireFor(question, profile, job, fieldType) {
    const q = norm(question);
    const a = profile.answers || {};
    const ctx = { country: profile.country, city: profile.city, answers: a };

    // --- work authorization & sponsorship (country-aware)
    const withoutSponsor = /without (the )?(need (for|of) |needing |requiring |requirement (for|of) |any |a )?(visa |employer |company |work )?sponsor/.test(q);
    const asksSponsor = /sponsor|visa (support|assistance|transfer)|require (a )?(work )?visa|need (a )?(work )?visa|immigration support/.test(q);
    // "Do you require sponsorship for work authorization?" is a sponsorship question, not an authorization one
    if (asksSponsor && !withoutSponsor) {
      const t = targetPlace(q, profile, job);
      if (!t.known) return null;
      return { kind: 'yesno', value: Questions.eligibilityFor(t.place, ctx).sponsorship, source: 'eligibility' };
    }
    if (withoutSponsor || /authori[sz]ed to work|legally (authori[sz]ed|eligible|able|allowed|permitted)|eligible to work|right to work|permission to work|work authori[sz]ation|lawfully/.test(q)) {
      const t = targetPlace(q, profile, job);
      if (!t.known) return null;
      const e = Questions.eligibilityFor(t.place, ctx);
      return { kind: 'yesno', value: withoutSponsor ? e.authorized && !e.sponsorship : e.authorized, source: 'eligibility' };
    }
    if (/(are you|currently) (based|located|living|residing)|do you (currently )?(live|reside)|resident of|reside in/.test(q)) {
      const place = Countries.detectCountryInText(q);
      if (place && profile.country) {
        const same = place === profile.country ||
          (place === 'GCC' && Countries.regionOf(profile.country) === 'GCC') ||
          (place === 'EU' && Countries.regionOf(profile.country) === 'EU');
        return { kind: 'yesno', value: same };
      }
      return null;
    }
    if (/nationality|citizenship/.test(q) && !/\?$|do you|are you/.test(q) && profile.nationality) {
      return { kind: 'text', value: profile.nationality };
    }

    // --- location & work setup
    if (/relocat/.test(q)) {
      if (!a.relocate) return null;
      if (a.relocate === 'yes') return { kind: 'yesno', value: true };
      if (a.relocate === 'no') return { kind: 'yesno', value: false };
      const dest = Countries.detectCountryInText(q) || (job && Countries.detectCountryInLocation(job.location));
      if (!dest) return null;
      return { kind: 'yesno', value: dest === profile.country };
    }
    if (/\bcommut|able to (work|come) (from|to|in) (the|our) office|work (from|in) (the|our) office|on-?site|in-?office|hybrid/.test(q) && /(able|willing|comfortable|open|can you|are you|okay|ok with)/.test(q)) {
      const modes = a.workModes || [];
      const namedPlace = Countries.detectCountryInText(q);
      if (namedPlace && profile.country && namedPlace !== profile.country) return null; // office in another country
      if (/hybrid/.test(q)) return { kind: 'yesno', value: modes.includes('hybrid') && a.commute !== 'no' };
      return { kind: 'yesno', value: a.commute !== 'no' && (modes.includes('onsite') || modes.includes('hybrid')) };
    }
    if (/remote/.test(q) && /(comfortable|willing|open|ok|okay|able|interested)/.test(q) && !/office|on-?site/.test(q)) {
      return { kind: 'yesno', value: (a.workModes || []).includes('remote') };
    }

    // --- experience
    if (/how many years|years of (\w+ )?experience|(years|yrs)\b.*\b(experience|worked|working)/.test(q)) {
      if (profile.yearsExperience == null || profile.yearsExperience === '') return null;
      const total = Number(profile.yearsExperience);
      if (!Number.isFinite(total)) return null;
      const generic = /^(how many )?(total |overall )?years of (total |overall |professional |relevant |work |full-time )?(work )?experience( do you have)?( in total)?$|how many years of (total |overall |professional |relevant |work |full-time )?(work )?experience do you (currently )?have$/;
      if (generic.test(cleanLabel(q))) return { kind: 'number', value: total };
      return null; // a specific skill, tool or industry - AI estimates from the work history
    }
    if (/notice period|how soon can you (start|join)|when can you (start|join)|earliest (possible )?start|available to start|availability to (start|join)/.test(q)) {
      if (a.noticePeriod === undefined) return null;
      const days = Number(a.noticePeriod);
      if (/in days|\(days\)|number of days|how many days/.test(q)) return { kind: 'number', value: days };
      if (/in weeks|\(weeks\)|how many weeks/.test(q)) return { kind: 'number', value: Math.ceil(days / 7) };
      if (/in months|\(months\)|how many months/.test(q)) return { kind: 'number', value: Math.ceil(days / 30) };
      const text = days === 0 ? 'Immediately' : days <= 7 ? '1 week' : days <= 14 ? '2 weeks' : days <= 30 ? '1 month' : days <= 60 ? '2 months' : '3 months';
      return { kind: 'duration', days, text };
    }
    if (/currently employed|are you (currently )?working(?! (with|on|for|in|at|as|towards|toward|remotely|night|weekend|shift|overtime))|employment status/.test(q)) {
      if (!a.employmentStatus) return null;
      if (/employment status/.test(q)) {
        const map = { employed: ['employed', 'full-time', 'full time'], freelance: ['self-employed', 'freelance', 'contract'], student: ['student'], unemployed: ['unemployed', 'not employed', 'not currently employed'] };
        return { kind: 'choice', keywords: map[a.employmentStatus], text: { employed: 'Employed', freelance: 'Self-employed', student: 'Student', unemployed: 'Not employed' }[a.employmentStatus] };
      }
      return { kind: 'yesno', value: a.employmentStatus === 'employed' || a.employmentStatus === 'freelance' };
    }

    // --- education & language
    if (/(bachelor|master|mba|phd|doctorate|degree|diploma)/.test(q) && /(have|completed|hold|obtained|earned|possess)/.test(q)) {
      const rank = EDU_RANK[a.educationLevel];
      if (!rank) return null;
      // A named subject ("degree in Nursing") must match the candidate's education
      const subject = q.match(/(?:degree|bachelor'?s?|master'?s?|diploma|phd|doctorate)(?: degree)? (?:in|of) ([a-z &]+?)(?: or (?:a )?(?:related|equivalent|similar)[a-z ]*)?(?:\?|$|,| from| and)/);
      if (subject) {
        const fields = (profile.education || []).map((e) => norm(`${e.degree || ''} ${e.field || ''}`)).join(' | ');
        const words = subject[1].split(/\s+|&/).filter((w) => w.length > 3 && !['science', 'arts', 'related', 'field', 'equivalent', 'similar'].includes(w));
        if (!words.length || !words.every((w) => fields.includes(w))) return null;
      }
      const need = /phd|doctorate/.test(q) ? 5 : /master|mba/.test(q) ? 4 : /bachelor/.test(q) ? 3 : /diploma|associate/.test(q) ? 2 : 3;
      return { kind: 'yesno', value: rank >= need };
    }
    if (/highest (level of )?education|education level|degree level|level of education/.test(q)) {
      if (!a.educationLevel) return null;
      const map = {
        highschool: ['high school', 'secondary school', 'secondary'], diploma: ['diploma', 'associate'], bachelor: ["bachelor's", 'bachelor', 'undergraduate'],
        master: ["master's", 'master', 'mba', 'postgraduate'], phd: ['doctorate', 'phd', 'doctoral']
      };
      return { kind: 'choice', keywords: map[a.educationLevel], text: { highschool: 'High school', diploma: 'Diploma', bachelor: "Bachelor's degree", master: "Master's degree", phd: 'PhD' }[a.educationLevel] };
    }
    if (/\benglish\b/.test(q) && /(proficien|level|fluen|speak|communicat)/.test(q)) {
      if (!a.englishLevel) return null;
      const good = ['native', 'fluent', 'professional'].includes(a.englishLevel);
      const map = { native: ['native or bilingual', 'native', 'bilingual'], fluent: ['full professional', 'fluent', 'advanced', 'professional'], professional: ['professional working', 'professional', 'advanced'], conversational: ['conversational', 'limited working', 'intermediate'], basic: ['elementary', 'basic', 'beginner'] };
      return /^(do|are|can) you/.test(q) ? { kind: 'yesno', value: good } : { kind: 'choice', keywords: map[a.englishLevel], text: null };
    }

    // --- standard checks
    if (/driv(ing|er'?s?) ?licen[cs]e/.test(q)) {
      const named = Countries.detectCountryInText(q);
      if (named && profile.country && named !== profile.country) return null;
      return a.drivingLicense ? { kind: 'yesno', value: a.drivingLicense === 'yes' } : null;
    }
    if (/\b18 years|over 18|at least 18|legal (working )?age/.test(q)) return a.over18 ? { kind: 'yesno', value: a.over18 === 'yes' } : null;
    if (/background (check|screening|verification)|drug (test|screen)/.test(q) && /(willing|consent|agree|able|undergo|submit)/.test(q)) {
      return a.backgroundCheck ? { kind: 'yesno', value: a.backgroundCheck === 'yes' } : null;
    }
    if (/security clearance/.test(q)) {
      if (!a.securityClearance) return null;
      if (/^(do|are|can) you|active|hold|currently have/.test(q) && !/level|type/.test(q)) return { kind: 'yesno', value: a.securityClearance !== 'none' };
      return null;
    }
    if (/how did you (hear|find|learn)|where did you (hear|find)|source of (application|referral)/.test(q)) {
      return { kind: 'choice', keywords: ['linkedin', 'job board', 'online job', 'other'], text: 'LinkedIn' };
    }

    // --- voluntary self-identification (U.S. EEO)
    const decline = ['decline to self-identify', 'decline', 'prefer not to say', 'prefer not', "don't wish to answer", 'do not wish', 'choose not to disclose', 'not to answer', 'i do not want to answer'];
    if (/^(gender|sex)$|\bgender\b|what is your sex/.test(cleanLabel(q)) && !/identity other/.test(q)) {
      const v = a.eeoGender || 'decline';
      const map = { male: ['male', 'man'], female: ['female', 'woman'], nonbinary: ['non-binary', 'nonbinary'] };
      return { kind: 'choice', keywords: v === 'decline' ? decline : [...map[v], ...decline], text: null };
    }
    if (/\brace\b|ethnicity|ethnic (origin|background|group)/.test(q)) {
      const v = a.eeoRace || 'decline';
      const map = { asian: ['asian'], black: ['black or african american', 'black'], hispanic: ['hispanic or latino', 'hispanic', 'latino'], white: ['white'], mena: ['middle eastern', 'north african'], native: ['american indian or alaska native', 'american indian'], pacific: ['native hawaiian or other pacific islander', 'pacific islander'], multi: ['two or more races', 'two or more'] };
      return { kind: 'choice', keywords: v === 'decline' ? decline : [...map[v], ...decline], text: null };
    }
    if (/veteran/.test(q)) {
      const v = a.eeoVeteran || 'decline';
      const keywords = v === 'decline' ? decline
        : v === 'yes' ? ['i identify as one or more of the classifications of protected veteran', 'i am a protected veteran', 'protected veteran', 'yes']
          : ['i am not a protected veteran', 'not a protected veteran', 'no'];
      return { kind: 'choice', keywords, text: null };
    }
    if (/disabilit/.test(q)) {
      const v = a.eeoDisability || 'decline';
      const keywords = v === 'decline' ? decline : v === 'yes' ? ['yes, i have a disability', 'yes'] : ["no, i don't have a disability", 'no, i do not have a disability', 'no'];
      return { kind: 'choice', keywords, text: null };
    }

    // --- salary
    if (/salary|compensation|pay expectation|expected (pay|ctc)|expected ctc|remuneration|desired pay/.test(q)) {
      if (/current (salary|ctc|compensation|pay)|last drawn|previous salary/.test(q)) return null;
      const s = salaryFor(profile, q);
      return s ? { kind: 'number', value: s, exact: true } : null;
    }

    // --- consent (only genuine consent wording, never "in terms of")
    if (/^(i )?(agree|consent|acknowledge|accept)\b|privacy (policy|notice)|terms (and|&) conditions|terms of (use|service)|consent to (the )?(processing|collection|storage)/.test(q) &&
        !/certif|licen[cs]|years|degree|experience|authori[sz]ed|eligible|clearance|\bhave\b|\bhold\b|\bpossess/.test(q) &&
        (fieldType === 'checkbox' || fieldType === 'radio' || fieldType === 'select')) {
      return { kind: 'yesno', value: true };
    }

    return null;
  }

  /**
   * field: { question, fieldType: 'text'|'number'|'textarea'|'select'|'radio'|'checkbox', options?: string[] }
   * job:   { location?: string } optional - used to pick which country's work rules apply
   * Returns { answer: string, source } or null.
   */
  function answer(field, profile, job) {
    if (!field || !field.question || !profile) return null;
    if (field.fieldType === 'textarea') return null;
    const desire = desireFor(field.question, profile, job, field.fieldType);
    if (!desire) return null;
    const value = resolveDesire(desire, field);
    return value == null || value === '' ? null : { answer: String(value), source: desire.source || 'profile' };
  }

  /** Identity/contact fields. Labels must be short and specific ("Mobile phone number"). */
  function contactValue(label, profile) {
    const l = cleanLabel(label);
    if (/preferred (first )?name|nickname/.test(l) && !/pronoun/.test(l)) return profile.firstName;
    if (!l || l.split(' ').length > 6) return null;
    if (/year|experience|how many|rate|salary|marketing|development|management|skill|level/.test(l)) return null;
    const p = profile;
    const phoneNational = String(p.phone || '').replace(/\D/g, '');
    if (/^(legal )?(first|given) name$|^forename$/.test(l)) return p.firstName;
    if (/^(legal )?(last|family) name$|^surname$/.test(l)) return p.lastName;
    if (/^(legal |full |your )?name$|^full (legal )?name$/.test(l)) return [p.firstName, p.lastName].filter(Boolean).join(' ');
    if (/^(your )?e-?mail( address)?$/.test(l)) return p.email;
    if (/^(phone |mobile )?(country|dial(ing)?) code$/.test(l)) return p.phoneCountryCode ? `+${p.phoneCountryCode}` : null;
    if (/^(your |primary |mobile |cell |home )?(phone|mobile|telephone|cell ?phone)( number| no)?$|^mobile phone number$|^phone number \(mobile\)$/.test(l)) return phoneNational || null;
    if (/^linkedin( profile)?( url| link)?$/.test(l)) return p.linkedinUrl;
    if (/^github( profile)?( url| link)?$/.test(l)) return p.githubUrl;
    if (/^(personal )?(portfolio|website|web site|site)( url| link)?$/.test(l)) return p.portfolioUrl || null;
    if (/^(current )?city$|^location \(city\)$|^city of residence$|^town\/city$/.test(l)) return p.city;
    if (/^(current )?location$|^where are you (currently )?(based|located)$/.test(l)) {
      return [p.city, Countries.getCountry(p.country)?.name].filter(Boolean).join(', ');
    }
    if (/^(current )?country( of residence)?$/.test(l)) return Countries.getCountry(p.country)?.name || null;
    const edu = (p.education || [])[0] || {};
    if (/^(school|university|college|institution|school name|university name|name of (school|university|institution))$/.test(l)) return edu.school || null;
    if (/^(degree|degree type|qualification|highest degree)$/.test(l)) return edu.degree || null;
    if (/^(discipline|major|field of study|area of study|specialization|course|subject)$/.test(l)) return edu.field || null;
    if (/^(graduation|end|completion) (year|date)$|^year of graduation$/.test(l)) return (String(edu.end || '').match(/\d{4}/) || [null])[0];
    if (/^(current|most recent|present) (company|employer)( name)?$|^employer( name)?$/.test(l)) return p.currentCompany;
    if (/^(current|most recent|present) (job )?(title|position|role)$|^headline$/.test(l)) return p.currentTitle || p.headline;
    return null;
  }

  const api = { answer, contactValue, normalizeQuestion, pickYesNo, pickNumber, pickByKeywords, pickDuration, parseRange, isPlaceholder, desireFor, hasWord };
  root.JobFlowAnswers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
