const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../extension/shared/questions.js');
const A = require('../extension/shared/answer-engine.js');

const uaeProfile = {
  firstName: 'Abdulla', lastName: 'Ehsan', email: 'a@example.com', phone: '551180792', phoneCountryCode: '971',
  city: 'Dubai', country: 'AE', yearsExperience: 2, skills: ['Python', 'Node.js', 'LangChain'],
  answers: {
    targetMarkets: ['home', 'UK', 'REMOTE'], workModes: ['hybrid', 'remote'], relocate: 'yes', commute: 'yes',
    status_GCC: 'employment', sponsor_GCC: 'no', status_UK: 'none', sponsor_UK: 'yes',
    noticePeriod: '30', educationLevel: 'bachelor', englishLevel: 'fluent', over18: 'yes', drivingLicense: 'yes',
    backgroundCheck: 'yes', employmentStatus: 'employed'
  },
  preferences: { salaryAmount: 20000, salaryCurrency: 'AED', salaryPeriod: 'month' }
};
const ans = (question, options, fieldType, profile = uaeProfile, job) => A.answer({ question, options, fieldType: fieldType || (options ? 'select' : 'text') }, profile, job)?.answer ?? null;

test('questionnaire adapts to location', () => {
  const ids = Q.visibleQuestions({ country: 'AE', answers: { targetMarkets: ['home', 'US'] } }).map((q) => q.id);
  assert.ok(ids.includes('status_GCC'));
  assert.ok(ids.includes('status_US'));
  assert.ok(ids.includes('eeoGender'));
  assert.ok(!ids.includes('status_UK'));
  const ukOnly = Q.visibleQuestions({ country: 'GB', answers: { targetMarkets: ['home'] } }).map((q) => q.id);
  assert.ok(ukOnly.includes('status_UK') && !ukOnly.includes('eeoGender') && !ukOnly.includes('securityClearance'));
  const q = Q.visibleQuestions({ country: 'AE', answers: {} }).find((x) => x.id === 'status_GCC');
  assert.match(q.title, /United Arab Emirates/);
});

test('defaults cascade (sponsor from status)', () => {
  const a = Q.applyDefaults({ country: 'US', answers: { targetMarkets: ['home'], status_US: 'h1b' } });
  assert.equal(a.sponsor_US, 'yes');
  assert.equal(a.eeoGender, 'decline');
});

test('eligibility questions are country aware', () => {
  assert.equal(ans('Are you legally authorized to work in the United Arab Emirates?', ['Yes', 'No']), 'Yes');
  assert.equal(ans('Will you now or in the future require visa sponsorship?', ['Yes', 'No']), 'No');
  assert.equal(ans('Do you have the right to work in the UK?', ['Yes', 'No']), 'No');
  assert.equal(ans('Will you require sponsorship to work in the UK?', ['Yes', 'No']), 'Yes');
  assert.equal(ans('Are you authorized to work in the United States?', ['Select an option', 'Yes', 'No']), 'No');
  assert.equal(ans('Are you authorized to work in Qatar?', ['Yes', 'No']), 'No');
  assert.equal(ans('Are you based in the UAE?', ['Yes', 'No']), 'Yes');
});

test('experience, notice, salary', () => {
  assert.equal(ans('How many years of work experience do you have with Python?', null, 'number'), null); // left to AI (per-skill)
  assert.equal(ans('How many years of work experience do you have?', null, 'number'), '2');
  assert.equal(ans('How many years of experience do you have with Kubernetes?', null, 'number'), null);
  assert.equal(ans('Years of experience', ['0-1 years', '1-3 years', '3-5 years', '5+ years']), '1-3 years');
  assert.equal(ans('What is your notice period?', ['Immediately', '1 month', '2 months', '3 months']), '1 month');
  assert.equal(ans('What is your notice period in days?', null, 'number'), '30');
  assert.equal(ans('What is your expected monthly salary in AED?', null, 'number'), '20000');
  assert.equal(ans('What is your expected annual salary?', null, 'number'), '240000');
});

test('education, language, checks, EEO', () => {
  assert.equal(ans("Have you completed the following level of education: Bachelor's Degree?", ['Yes', 'No']), 'Yes');
  assert.equal(ans("Do you have a Master's degree?", ['Yes', 'No']), 'No');
  assert.equal(ans('What is your level of proficiency in English?', ['None', 'Conversational', 'Professional', 'Native or bilingual']), 'Professional');
  assert.equal(ans('Are you comfortable working in a hybrid setting?', ['Yes', 'No']), 'Yes');
  assert.equal(ans('Are you willing to relocate?', ['Yes', 'No']), 'Yes');
  assert.equal(ans('Do you have a valid UAE driving license?', ['Yes', 'No']), 'Yes');
  assert.equal(ans('Gender', ['Male', 'Female', 'Decline to self-identify']), 'Decline to self-identify');
  assert.equal(ans('Are you a protected veteran?', ['I am a protected veteran', 'I am not a protected veteran', "I don't wish to answer"]), "I don't wish to answer");
  assert.equal(ans('Tell us about a project you are proud of', null, 'textarea'), null);
});

test('contact fields', () => {
  assert.equal(A.contactValue('First name', uaeProfile), 'Abdulla');
  assert.equal(A.contactValue('Mobile phone number', uaeProfile), '551180792');
  assert.equal(A.contactValue('Location (city)', uaeProfile), 'Dubai');
  assert.equal(A.normalizeQuestion('Are you authorized to work in the U.S.? *'), 'are you authorized to work in the u s');
});

const usCitizen = { ...uaeProfile, country: 'US', city: 'Austin', answers: { ...uaeProfile.answers, targetMarkets: ['home'], status_US: 'citizen', sponsor_US: 'no', eeoGender: 'male', eeoRace: 'hispanic', eeoVeteran: 'no', relocate: 'country', noticePeriod: '0' }, preferences: { salaryAmount: 120000, salaryCurrency: 'USD', salaryPeriod: 'year' }, education: [{ degree: 'BSc', field: 'Computer Science' }] };

test('review findings: sponsorship phrasing and job location', () => {
  assert.equal(ans('Are you legally authorized to work in the United States without sponsorship?', ['Yes', 'No'], 'radio', usCitizen), 'Yes');
  assert.equal(ans('Can you work in the US without requiring visa sponsorship?', ['Yes', 'No'], 'radio', usCitizen), 'Yes');
  assert.equal(ans('Are you authorized to work in Indiana?', ['Yes', 'No'], 'radio', usCitizen), 'Yes'); // Indiana is not India
  // UAE candidate, US job, question names no country -> job location decides
  const usJob = { location: 'New York, United States (On-site)' };
  assert.equal(ans('Are you legally authorized to work in this country?', ['Yes', 'No'], 'radio', uaeProfile, usJob), 'No');
  assert.equal(ans('Will you now or in the future require sponsorship for employment visa status?', ['Yes', 'No'], 'radio', uaeProfile, usJob), 'Yes');
  assert.equal(ans('Are you legally authorized to work in this country?', ['Yes', 'No'], 'radio', uaeProfile, { location: 'Remote' }), null);
  assert.equal(ans('Are you legally authorized to work in this country?', ['Yes', 'No'], 'radio', uaeProfile, { location: 'Dubai, United Arab Emirates' }), 'Yes');
});

test('review findings: option matching and contact labels', () => {
  assert.equal(ans('Gender', ['Female', 'Male', 'Decline to self-identify'], 'select', usCitizen), 'Male');
  assert.equal(ans('Race/Ethnicity', ['Black or African American (Not Hispanic or Latino)', 'Hispanic or Latino', 'White (Not Hispanic or Latino)', 'Decline'], 'select', usCitizen), 'Hispanic or Latino');
  const asian = { ...usCitizen, answers: { ...usCitizen.answers, eeoRace: 'asian' } };
  assert.equal(ans('Race', ['Caucasian', 'Asian', 'Decline to answer'], 'select', asian), 'Asian');
  for (const l of ['Years of experience in mobile development', 'Experience with email marketing', 'What is your hourly rate?', 'Portfolio management experience', 'Website development skills', 'Excellent communication (cell)']) {
    assert.equal(A.contactValue(l, uaeProfile), null, l);
  }
  assert.equal(A.contactValue('Mobile phone number*', uaeProfile), '551180792');
  assert.equal(A.contactValue('Email address', uaeProfile), 'a@example.com');
  assert.equal(A.contactValue('LinkedIn Profile URL', uaeProfile), undefined);
});

test('review findings: consent, degree subject, currency, notice, relocation', () => {
  assert.equal(ans('What are your salary expectations in terms of annual base?', null, 'number', usCitizen), '120000');
  assert.equal(ans('I agree to the privacy policy', ['Yes', 'No'], 'radio', usCitizen), 'Yes');
  assert.equal(ans("Do you have a bachelor's degree in Nursing?", ['Yes', 'No'], 'radio', usCitizen), null);
  assert.equal(ans("Do you have a bachelor's degree in Computer Science or related field?", ['Yes', 'No'], 'radio', usCitizen), 'Yes');
  assert.equal(ans('Expected salary in AED per month?', null, 'number', usCitizen), null);
  assert.equal(ans('What is your notice period?', ['15 days', '30 days', '60 days', 'Immediately'], 'select', usCitizen), 'Immediately');
  assert.equal(ans('What is your notice period?', ['15 days', '30 days', '60 days'], 'select', uaeProfile), '30 days');
  assert.equal(ans('Are you willing to relocate to Dubai?', ['Yes', 'No'], 'radio', usCitizen), 'No');
  assert.equal(ans('Are you willing to relocate to Austin, United States?', ['Yes', 'No'], 'radio', usCitizen), 'Yes');
});

test('non-English questions keep distinct keys', () => {
  const a = A.normalizeQuestion('您有多少年的产品开发使用经验?');
  const b = A.normalizeQuestion('您有多少年的英语使用经验?');
  assert.ok(a.length > 5);
  assert.notEqual(a, b);
  assert.equal(A.normalizeQuestion('How many years of Python? Required'), 'how many years of python');
});

test('search queue is built from the profile: every target role in every target location', () => {
  const S = require('../extension/shared/settings.js');
  const urls = S.searchQueue({
    currentTitle: 'AI Engineer',
    city: 'Dubai',
    preferences: { roles: ['Product Manager', 'Data Analyst'], locations: 'Dubai, United Arab Emirates', workModes: ['remote'] }
  }, {});
  assert.ok(urls.length >= 4, urls.length);
  assert.ok(urls.every((u) => new URL(u).searchParams.get('f_AL') === 'true'));
  const pairs = urls.map((u) => `${new URL(u).searchParams.get('keywords').replace(/"/g, '')}|${new URL(u).searchParams.get('location') || 'remote'}`);
  assert.ok(pairs.includes('Product Manager|Dubai'));
  assert.ok(pairs.includes('Data Analyst|Dubai'));
  assert.ok(pairs.some((p) => p.startsWith('AI Engineer|')));
  assert.ok(urls.some((u) => new URL(u).searchParams.get('f_WT') === '2'), 'a remote search');
  const keys = urls.map((u) => { const q = new URL(u).searchParams; return ['keywords', 'location', 'f_TPR', 'f_WT'].map((k) => q.get(k)).join('|'); });
  assert.equal(new Set(keys).size, keys.length, 'no duplicate searches');
  assert.ok(urls.some((u) => !new URL(u).searchParams.get('f_TPR')), 'a wider search without the date filter');
  // the user's own keywords win over the profile roles
  const custom = S.searchQueue({ city: 'Dubai' }, { searchKeywords: 'Solutions Engineer' });
  assert.equal(new URL(custom[0]).searchParams.get('keywords'), '"Solutions Engineer"', 'exact-phrase search');
});

// ------------------------------------------------------------ regression tests (Sep 2026 review)
const usCit2 = {
  ...uaeProfile, city: 'Austin', country: 'US',
  answers: { ...uaeProfile.answers, targetMarkets: ['home'], status_US: 'citizen', sponsor_US: 'no' },
  preferences: { salaryAmount: 120000, salaryCurrency: 'USD', salaryPeriod: 'year' }
};

test('sponsorship wording that mentions "work authorization" is still a sponsorship question', () => {
  assert.equal(ans('Do you require sponsorship for work authorization?', ['Yes', 'No'], 'radio', usCit2), 'No');
  assert.equal(ans('Will you now or in the future require sponsorship for employment visa status (e.g. H-1B) to maintain work authorization?', ['Yes', 'No'], 'radio', usCit2), 'No');
  assert.equal(ans('Are you authorized to work in the US without sponsorship?', ['Yes', 'No'], 'radio', usCit2), 'Yes');
});

test('job country comes from the most specific part of the location', () => {
  const C = require('../extension/shared/countries.js');
  assert.equal(C.detectCountryInLocation('Sydney, New South Wales, Australia'), 'AU');
  assert.equal(C.detectCountryInLocation('Albuquerque, New Mexico, United States'), 'US');
  assert.equal(C.detectCountryInLocation('Dublin, California, United States'), 'US');
  assert.equal(C.detectCountryInLocation('Dubai, United Arab Emirates'), 'AE');
  const q = 'Are you legally authorized to work in this country?';
  assert.equal(ans(q, ['Yes', 'No'], 'radio', usCit2, { location: 'Dublin, California, United States' }), 'Yes');
  // No location at all is not "at home"
  assert.equal(ans(q, ['Yes', 'No'], 'radio', usCit2, { location: '' }), null);
});

test('"other" region status only covers the home country', () => {
  const egypt = { ...uaeProfile, country: 'EG', city: 'Cairo', answers: { targetMarkets: ['home'], status_OTHER: 'citizen', sponsor_OTHER: 'no' } };
  const e = Q.eligibilityFor('PK', { country: 'EG', answers: egypt.answers });
  assert.equal(e.authorized, false);
  assert.equal(e.sponsorship, true);
});

test('salary brackets must contain the amount; "$" with a named currency is that currency', () => {
  const opts = ['Less than 50k', '50k-100k', '100k-150k', '150k+'];
  assert.equal(ans('Expected annual salary (USD)', opts, 'select', usCit2), '100k-150k');
  assert.equal(ans('Expected annual salary', ['$50,000 - $100,000', '$100,000 - $150,000', '$150,000+'], 'select', usCit2), '$100,000 - $150,000');
  assert.equal(ans('Expected annual salary', ['Under $50,000', '$50,000 - $80,000'], 'select', usCit2), null);
  assert.equal(ans('Expected annual salary (CAD $)', null, 'number', usCit2), null);
});

test('no "Yes" in free text, no 0 years when unknown, recruiter is not employment', () => {
  assert.equal(ans('What degree have you obtained?', null, 'text'), null);
  assert.equal(ans('Have you completed a bachelor\'s degree?', null, 'text'), 'Yes');
  assert.equal(ans('How many years of work experience do you have?', null, 'number', { ...uaeProfile, yearsExperience: null }), null);
  assert.equal(ans('Are you currently working with a recruiter?', ['Yes', 'No']), null);
  assert.equal(ans('Are you currently working?', ['Yes', 'No']), 'Yes');
});

test('only jobs matching what the user applies for', () => {
  const S = require('../extension/shared/settings.js');
  const titles = ['AI Engineer'];
  assert.equal(S.filterJob({}, { title: 'Lead – AI Engineering, Automation', titles }), null);
  assert.equal(S.filterJob({}, { title: 'Senior AI Engineer (GenAI)', titles }), null);
  assert.ok(S.filterJob({}, { title: 'Software developer C++', titles }));
  assert.ok(S.filterJob({}, { title: 'Security Engineer', titles }));
  assert.equal(S.filterJob({ matchSearchTitles: false }, { title: 'Security Engineer', titles }), null);
  assert.equal(S.filterJob({}, { title: 'Senior Product Manager', titles: ['Product manager'] }), null);
  assert.deepEqual(S.searchTitles({ preferences: { roles: ['AI Engineer'] } }, { searchKeywords: 'Product manager, Data analyst' }), ['Product manager', 'Data analyst']);
  assert.deepEqual(S.PACE_MS.turbo.length, 2);
});
