/* JobFlow AI - onboarding questionnaire definitions (shared by extension + web app)
 *
 * Questions adapt to where the candidate lives and where they want to work.
 * Every option carries a machine-readable meaning so the autofill engine can
 * answer real application questions ("Do you require sponsorship?") reliably.
 */
(function (root) {
  const Countries = root.JobFlowCountries || (typeof require !== 'undefined' ? require('./countries.js') : null);

  const yesNo = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' }
  ];

  // Region-specific work-authorization statuses. auth = can legally work now;
  // sponsor = what to answer to "Will you require visa sponsorship?"
  const STATUS_OPTIONS = {
    GCC: (place) => [
      { value: 'citizen', label: `${place} national / citizen`, auth: true, sponsor: false },
      { value: 'golden', label: 'Golden visa or long-term residence', auth: true, sponsor: false },
      { value: 'employment', label: 'Employment visa (new employer would transfer it)', auth: true, sponsor: true },
      { value: 'family', label: 'Family / spouse sponsored visa (can work with a permit)', auth: true, sponsor: false },
      { value: 'freelance', label: 'Freelance or self-sponsored visa', auth: true, sponsor: false },
      { value: 'visit', label: 'Visit visa or visa being cancelled', auth: false, sponsor: true },
      { value: 'none', label: `Not in ${place} - I would need a visa`, auth: false, sponsor: true }
    ],
    US: () => [
      { value: 'citizen', label: 'U.S. citizen', auth: true, sponsor: false },
      { value: 'greencard', label: 'Green card holder (permanent resident)', auth: true, sponsor: false },
      { value: 'ead', label: 'Work permit / EAD, OPT or TN (may need sponsorship later)', auth: true, sponsor: true },
      { value: 'h1b', label: 'H-1B, L-1, O-1 or similar (needs transfer/sponsorship)', auth: true, sponsor: true },
      { value: 'none', label: 'Not authorized - I would need sponsorship', auth: false, sponsor: true }
    ],
    UK: () => [
      { value: 'citizen', label: 'British or Irish citizen', auth: true, sponsor: false },
      { value: 'settled', label: 'Settled / pre-settled status or ILR', auth: true, sponsor: false },
      { value: 'graduate', label: 'Graduate, partner or dependant visa', auth: true, sponsor: true },
      { value: 'skilled', label: 'Skilled Worker visa (a new employer must sponsor)', auth: true, sponsor: true },
      { value: 'none', label: 'No right to work - I would need sponsorship', auth: false, sponsor: true }
    ],
    EU: () => [
      { value: 'citizen', label: 'EU / EEA / Swiss citizen', auth: true, sponsor: false },
      { value: 'resident', label: 'Residence permit with full work rights', auth: true, sponsor: false },
      { value: 'permit', label: 'Blue Card or employer-tied work permit', auth: true, sponsor: true },
      { value: 'none', label: 'No work rights - I would need a visa', auth: false, sponsor: true }
    ],
    CA: () => [
      { value: 'citizen', label: 'Canadian citizen', auth: true, sponsor: false },
      { value: 'pr', label: 'Permanent resident', auth: true, sponsor: false },
      { value: 'open', label: 'Open work permit (PGWP, spousal)', auth: true, sponsor: true },
      { value: 'closed', label: 'Employer-specific work permit', auth: true, sponsor: true },
      { value: 'none', label: 'Not authorized - I would need sponsorship / LMIA', auth: false, sponsor: true }
    ],
    AU: () => [
      { value: 'citizen', label: 'Australian or NZ citizen / permanent resident', auth: true, sponsor: false },
      { value: 'fullrights', label: 'Visa with full work rights', auth: true, sponsor: false },
      { value: 'temp', label: 'Temporary visa (would need sponsorship to stay)', auth: true, sponsor: true },
      { value: 'none', label: 'Not authorized - I would need sponsorship', auth: false, sponsor: true }
    ],
    IN: () => [
      { value: 'citizen', label: 'Indian citizen or OCI card holder', auth: true, sponsor: false },
      { value: 'none', label: 'I would need an employment visa', auth: false, sponsor: true }
    ],
    SG: () => [
      { value: 'citizen', label: 'Singapore citizen or PR', auth: true, sponsor: false },
      { value: 'pass', label: 'Employment Pass / S Pass (new employer must apply)', auth: true, sponsor: true },
      { value: 'dependant', label: 'Dependant pass with letter of consent', auth: true, sponsor: false },
      { value: 'none', label: 'I would need an Employment Pass', auth: false, sponsor: true }
    ],
    OTHER: (place) => [
      { value: 'citizen', label: `Citizen of ${place}`, auth: true, sponsor: false },
      { value: 'resident', label: 'Permanent resident', auth: true, sponsor: false },
      { value: 'permit', label: 'Work visa or permit', auth: true, sponsor: true },
      { value: 'none', label: 'I would need a work visa', auth: false, sponsor: true }
    ]
  };

  const MARKETS = [
    { value: 'GCC', label: 'UAE & GCC' },
    { value: 'US', label: 'United States' },
    { value: 'UK', label: 'United Kingdom' },
    { value: 'EU', label: 'Europe (EU / EEA)' },
    { value: 'CA', label: 'Canada' },
    { value: 'AU', label: 'Australia / NZ' },
    { value: 'IN', label: 'India' },
    { value: 'SG', label: 'Singapore' },
    { value: 'REMOTE', label: 'Remote, anywhere' }
  ];

  function homeRegion(ctx) {
    return Countries.regionOf(ctx.country);
  }

  function placeName(region, ctx) {
    if (region === homeRegion(ctx) && ctx.country) {
      const c = Countries.getCountry(ctx.country);
      if (c && region !== 'EU') return c.name;
    }
    return { GCC: 'the GCC', US: 'the U.S.', UK: 'the UK', EU: 'the EU', CA: 'Canada', AU: 'Australia', IN: 'India', SG: 'Singapore' }[region] ||
      Countries.getCountry(ctx.country)?.name || 'your country';
  }

  /** Regions we need eligibility answers for: home + every selected market (except remote). */
  function eligibilityRegions(ctx) {
    const set = new Set();
    if (ctx.country) set.add(homeRegion(ctx));
    (ctx.answers?.targetMarkets || []).forEach((m) => {
      if (m === 'home') set.add(homeRegion(ctx));
      else if (m !== 'REMOTE') set.add(m);
    });
    return Array.from(set);
  }

  function statusQuestion(region) {
    return {
      id: `status_${region}`,
      section: 'eligibility',
      type: 'single',
      when: (ctx) => eligibilityRegions(ctx).includes(region),
      title: (ctx) => region === homeRegion(ctx)
        ? `What's your work status in ${placeName(region, ctx)}?`
        : `Can you work in ${placeName(region, ctx)}?`,
      help: 'Used to answer "Are you authorized to work…?" questions truthfully.',
      options: (ctx) => STATUS_OPTIONS[region](placeName(region, ctx))
    };
  }

  function sponsorQuestion(region) {
    return {
      id: `sponsor_${region}`,
      section: 'eligibility',
      type: 'single',
      when: (ctx) => eligibilityRegions(ctx).includes(region) && Boolean(ctx.answers?.[`status_${region}`]),
      title: (ctx) => `For jobs in ${placeName(region, ctx)}: will you need visa sponsorship from the employer?`,
      help: 'We pre-selected this from your status above. Change it if you prefer a different answer.',
      options: () => yesNo,
      defaultValue: (ctx) => {
        const opt = STATUS_OPTIONS[region](placeName(region, ctx)).find((o) => o.value === ctx.answers?.[`status_${region}`]);
        return opt ? (opt.sponsor ? 'yes' : 'no') : undefined;
      }
    };
  }

  const REGIONS = Object.keys(STATUS_OPTIONS);

  const QUESTIONS = [
    // ------------------------------------------------------------ where
    {
      id: 'targetMarkets',
      section: 'location',
      type: 'multi',
      title: 'Where are you looking for jobs?',
      help: 'Pick all that apply. We only ask eligibility questions for these places.',
      options: (ctx) => {
        const home = homeRegion(ctx);
        const homeName = Countries.getCountry(ctx.country)?.name;
        const list = MARKETS.filter((m) => m.value !== home);
        return [{ value: 'home', label: homeName ? `${homeName} (where I live)` : 'Where I live' }, ...list];
      },
      defaultValue: () => ['home']
    },
    {
      id: 'workModes',
      section: 'location',
      type: 'multi',
      title: 'Which work setups are you open to?',
      options: () => [
        { value: 'onsite', label: 'On-site' },
        { value: 'hybrid', label: 'Hybrid' },
        { value: 'remote', label: 'Remote' }
      ],
      defaultValue: () => ['onsite', 'hybrid', 'remote']
    },
    {
      id: 'relocate',
      section: 'location',
      type: 'single',
      title: 'Are you willing to relocate for the right role?',
      options: () => [
        { value: 'yes', label: 'Yes, anywhere' },
        { value: 'country', label: 'Only within my country' },
        { value: 'no', label: 'No' }
      ]
    },
    {
      id: 'commute',
      section: 'location',
      type: 'single',
      title: (ctx) => `Can you reliably commute to an office in ${ctx.city || 'your city'}?`,
      options: () => yesNo,
      defaultValue: () => 'yes'
    },

    // ------------------------------------------------------- eligibility
    ...REGIONS.flatMap((r) => [statusQuestion(r), sponsorQuestion(r)]),

    // -------------------------------------------------------- experience
    {
      id: 'seniority',
      section: 'preferences',
      type: 'single',
      title: 'What level are you targeting?',
      options: () => [
        { value: 'internship', label: 'Internship' },
        { value: 'entry', label: 'Entry level' },
        { value: 'associate', label: 'Associate' },
        { value: 'mid', label: 'Mid-senior' },
        { value: 'senior', label: 'Senior / Lead' },
        { value: 'manager', label: 'Manager' },
        { value: 'director', label: 'Director or above' }
      ]
    },
    {
      id: 'employmentStatus',
      section: 'experience',
      type: 'single',
      title: 'What is your current employment status?',
      options: () => [
        { value: 'employed', label: 'Employed full-time' },
        { value: 'freelance', label: 'Freelance / contract' },
        { value: 'student', label: 'Student / recent graduate' },
        { value: 'unemployed', label: 'Not currently working' }
      ]
    },
    {
      id: 'noticePeriod',
      section: 'experience',
      type: 'single',
      title: 'How soon can you start?',
      options: () => [
        { value: '0', label: 'Immediately' },
        { value: '7', label: '1 week' },
        { value: '14', label: '2 weeks' },
        { value: '30', label: '1 month' },
        { value: '60', label: '2 months' },
        { value: '90', label: '3 months or more' }
      ]
    },
    {
      id: 'educationLevel',
      section: 'experience',
      type: 'single',
      title: 'Highest level of education completed',
      options: () => [
        { value: 'highschool', label: 'High school' },
        { value: 'diploma', label: 'Diploma / associate degree' },
        { value: 'bachelor', label: "Bachelor's degree" },
        { value: 'master', label: "Master's degree / MBA" },
        { value: 'phd', label: 'Doctorate (PhD)' }
      ]
    },
    {
      id: 'englishLevel',
      section: 'experience',
      type: 'single',
      title: 'How would you rate your English?',
      options: () => [
        { value: 'native', label: 'Native or bilingual' },
        { value: 'fluent', label: 'Fluent / full professional' },
        { value: 'professional', label: 'Professional working' },
        { value: 'conversational', label: 'Conversational' },
        { value: 'basic', label: 'Basic' }
      ]
    },

    // --------------------------------------------------------- the basics
    {
      id: 'over18',
      section: 'basics',
      type: 'single',
      title: 'Are you 18 years or older?',
      options: () => yesNo,
      defaultValue: () => 'yes'
    },
    {
      id: 'drivingLicense',
      section: 'basics',
      type: 'single',
      title: (ctx) => `Do you hold a valid driving licence${ctx.country ? ` in ${Countries.getCountry(ctx.country)?.name || 'your country'}` : ''}?`,
      options: () => yesNo
    },
    {
      id: 'backgroundCheck',
      section: 'basics',
      type: 'single',
      title: 'Are you willing to undergo a background check if required?',
      options: () => yesNo,
      defaultValue: () => 'yes'
    },
    {
      id: 'securityClearance',
      section: 'basics',
      type: 'single',
      when: (ctx) => eligibilityRegions(ctx).includes('US'),
      title: 'Do you hold an active U.S. security clearance?',
      options: () => [
        { value: 'none', label: 'No clearance' },
        { value: 'public', label: 'Public trust' },
        { value: 'secret', label: 'Secret' },
        { value: 'topsecret', label: 'Top Secret / TS-SCI' }
      ],
      defaultValue: () => 'none'
    },

    // ------------------------------------------ voluntary self-ID (US EEO)
    {
      id: 'eeoGender',
      section: 'eeo',
      type: 'single',
      when: (ctx) => eligibilityRegions(ctx).includes('US'),
      title: 'Gender (voluntary, U.S. equal-opportunity forms)',
      help: 'Optional. "Decline" is always a valid answer and never affects your application.',
      options: () => [
        { value: 'decline', label: 'Decline to self-identify' },
        { value: 'male', label: 'Male' },
        { value: 'female', label: 'Female' },
        { value: 'nonbinary', label: 'Non-binary' }
      ],
      defaultValue: () => 'decline'
    },
    {
      id: 'eeoRace',
      section: 'eeo',
      type: 'single',
      when: (ctx) => eligibilityRegions(ctx).includes('US'),
      title: 'Race / ethnicity (voluntary)',
      options: () => [
        { value: 'decline', label: 'Decline to self-identify' },
        { value: 'asian', label: 'Asian' },
        { value: 'black', label: 'Black or African American' },
        { value: 'hispanic', label: 'Hispanic or Latino' },
        { value: 'white', label: 'White' },
        { value: 'mena', label: 'Middle Eastern or North African' },
        { value: 'native', label: 'American Indian or Alaska Native' },
        { value: 'pacific', label: 'Native Hawaiian or Pacific Islander' },
        { value: 'multi', label: 'Two or more races' }
      ],
      defaultValue: () => 'decline'
    },
    {
      id: 'eeoVeteran',
      section: 'eeo',
      type: 'single',
      when: (ctx) => eligibilityRegions(ctx).includes('US'),
      title: 'Veteran status (voluntary)',
      options: () => [
        { value: 'decline', label: 'Decline to self-identify' },
        { value: 'no', label: 'I am not a protected veteran' },
        { value: 'yes', label: 'I am a protected veteran' }
      ],
      defaultValue: () => 'decline'
    },
    {
      id: 'eeoDisability',
      section: 'eeo',
      type: 'single',
      when: (ctx) => eligibilityRegions(ctx).includes('US'),
      title: 'Disability status (voluntary)',
      options: () => [
        { value: 'decline', label: 'Decline to self-identify' },
        { value: 'no', label: "No, I don't have a disability" },
        { value: 'yes', label: 'Yes, I have a disability' }
      ],
      defaultValue: () => 'decline'
    }
  ];

  const SECTIONS = [
    { id: 'location', title: 'Where you want to work', subtitle: 'So we only apply to jobs that fit.' },
    { id: 'eligibility', title: 'Work eligibility', subtitle: 'Answered once, reused on every application.' },
    { id: 'experience', title: 'Experience & availability', subtitle: 'The questions recruiters ask most.' },
    { id: 'basics', title: 'A few standard checks', subtitle: 'Common yes/no screening questions.' },
    { id: 'eeo', title: 'Voluntary self-identification', subtitle: 'Only shown because you selected U.S. jobs.' }
  ];

  const resolve = (v, ctx) => (typeof v === 'function' ? v(ctx) : v);

  /** Materialize the questions visible for a context: {country, city, answers}. */
  function visibleQuestions(ctx) {
    return QUESTIONS.filter((q) => !q.when || q.when(ctx)).map((q) => ({
      id: q.id,
      section: q.section,
      type: q.type,
      title: resolve(q.title, ctx),
      help: resolve(q.help, ctx),
      options: resolve(q.options, ctx),
      defaultValue: q.defaultValue ? q.defaultValue(ctx) : undefined
    }));
  }

  /** Fill defaults for unanswered visible questions (does not overwrite). */
  function applyDefaults(ctx) {
    const answers = { ...(ctx.answers || {}) };
    let changed = true;
    // defaults can unlock more questions (e.g. sponsor_* depends on status_*)
    for (let i = 0; i < 4 && changed; i++) {
      changed = false;
      for (const q of visibleQuestions({ ...ctx, answers })) {
        if (answers[q.id] === undefined && q.defaultValue !== undefined) {
          answers[q.id] = q.defaultValue;
          changed = true;
        }
      }
    }
    return answers;
  }

  function missingRequired(ctx) {
    return visibleQuestions(ctx).filter((q) => {
      if (q.section === 'eeo') return false;
      const v = ctx.answers?.[q.id];
      return v === undefined || v === null || (Array.isArray(v) && v.length === 0);
    });
  }

  /**
   * Eligibility for a place mentioned in a job question.
   * target: ISO country code, "EU" or "GCC" (null = candidate's home country)
   */
  function eligibilityFor(target, ctx) {
    const region = target ? Countries.regionOf(target) : Countries.regionOf(ctx.country);
    // "Other" lumps dozens of unrelated countries together: the home status only covers home
    if (region === 'OTHER' && target && target !== ctx.country) {
      return { known: false, authorized: false, sponsorship: true, region };
    }
    const status = ctx.answers?.[`status_${region}`];
    const sponsorAnswer = ctx.answers?.[`sponsor_${region}`];
    if (!status) {
      // Not a market they selected and not home: be truthful and conservative
      return { known: false, authorized: false, sponsorship: true, region };
    }
    const place = placeName(region, ctx);
    const opt = STATUS_OPTIONS[region](place).find((o) => o.value === status);
    // GCC countries don't share work rights: a UAE visa doesn't let you work in Qatar
    let authorized = opt ? opt.auth : false;
    let sponsorship = sponsorAnswer ? sponsorAnswer === 'yes' : (opt ? opt.sponsor : true);
    if (region === 'GCC' && target && ctx.country && target !== 'GCC' && target !== ctx.country && Countries.regionOf(ctx.country) === 'GCC') {
      authorized = false;
      sponsorship = true;
    }
    return { known: true, authorized, sponsorship, region, status };
  }

  const api = {
    QUESTIONS,
    SECTIONS,
    MARKETS,
    STATUS_OPTIONS,
    visibleQuestions,
    applyDefaults,
    missingRequired,
    eligibilityRegions,
    eligibilityFor
  };
  root.JobFlowQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
