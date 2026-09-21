/* JobFlow AI - country reference data (shared by extension + web app) */
(function (root) {
  // ISO2 | name | dial code | currency | region
  const RAW = `
AE|United Arab Emirates|971|AED|GCC
SA|Saudi Arabia|966|SAR|GCC
QA|Qatar|974|QAR|GCC
KW|Kuwait|965|KWD|GCC
BH|Bahrain|973|BHD|GCC
OM|Oman|968|OMR|GCC
US|United States|1|USD|US
GB|United Kingdom|44|GBP|UK
IE|Ireland|353|EUR|EU
DE|Germany|49|EUR|EU
FR|France|33|EUR|EU
NL|Netherlands|31|EUR|EU
ES|Spain|34|EUR|EU
IT|Italy|39|EUR|EU
PT|Portugal|351|EUR|EU
BE|Belgium|32|EUR|EU
LU|Luxembourg|352|EUR|EU
AT|Austria|43|EUR|EU
CH|Switzerland|41|CHF|EU
SE|Sweden|46|SEK|EU
NO|Norway|47|NOK|EU
DK|Denmark|45|DKK|EU
FI|Finland|358|EUR|EU
IS|Iceland|354|ISK|EU
PL|Poland|48|PLN|EU
CZ|Czechia|420|CZK|EU
SK|Slovakia|421|EUR|EU
HU|Hungary|36|HUF|EU
RO|Romania|40|RON|EU
BG|Bulgaria|359|BGN|EU
GR|Greece|30|EUR|EU
CY|Cyprus|357|EUR|EU
MT|Malta|356|EUR|EU
HR|Croatia|385|EUR|EU
SI|Slovenia|386|EUR|EU
EE|Estonia|372|EUR|EU
LV|Latvia|371|EUR|EU
LT|Lithuania|370|EUR|EU
CA|Canada|1|CAD|CA
AU|Australia|61|AUD|AU
NZ|New Zealand|64|NZD|AU
IN|India|91|INR|IN
PK|Pakistan|92|PKR|OTHER
BD|Bangladesh|880|BDT|OTHER
LK|Sri Lanka|94|LKR|OTHER
NP|Nepal|977|NPR|OTHER
SG|Singapore|65|SGD|SG
MY|Malaysia|60|MYR|OTHER
ID|Indonesia|62|IDR|OTHER
PH|Philippines|63|PHP|OTHER
VN|Vietnam|84|VND|OTHER
TH|Thailand|66|THB|OTHER
HK|Hong Kong|852|HKD|OTHER
CN|China|86|CNY|OTHER
JP|Japan|81|JPY|OTHER
KR|South Korea|82|KRW|OTHER
TW|Taiwan|886|TWD|OTHER
EG|Egypt|20|EGP|OTHER
JO|Jordan|962|JOD|OTHER
LB|Lebanon|961|LBP|OTHER
IQ|Iraq|964|IQD|OTHER
TR|Turkey|90|TRY|OTHER
IL|Israel|972|ILS|OTHER
MA|Morocco|212|MAD|OTHER
TN|Tunisia|216|TND|OTHER
DZ|Algeria|213|DZD|OTHER
NG|Nigeria|234|NGN|OTHER
KE|Kenya|254|KES|OTHER
GH|Ghana|233|GHS|OTHER
ZA|South Africa|27|ZAR|OTHER
ET|Ethiopia|251|ETB|OTHER
UG|Uganda|256|UGX|OTHER
TZ|Tanzania|255|TZS|OTHER
BR|Brazil|55|BRL|OTHER
MX|Mexico|52|MXN|OTHER
AR|Argentina|54|ARS|OTHER
CO|Colombia|57|COP|OTHER
CL|Chile|56|CLP|OTHER
PE|Peru|51|PEN|OTHER
UA|Ukraine|380|UAH|OTHER
RU|Russia|7|RUB|OTHER
KZ|Kazakhstan|7|KZT|OTHER
UZ|Uzbekistan|998|UZS|OTHER
AZ|Azerbaijan|994|AZN|OTHER
GE|Georgia|995|GEL|OTHER
AM|Armenia|374|AMD|OTHER
IR|Iran|98|IRR|OTHER
AF|Afghanistan|93|AFN|OTHER
SY|Syria|963|SYP|OTHER
YE|Yemen|967|YER|OTHER
SD|Sudan|249|SDG|OTHER
PS|Palestine|970|ILS|OTHER
RS|Serbia|381|RSD|OTHER
BA|Bosnia and Herzegovina|387|BAM|OTHER
AL|Albania|355|ALL|OTHER
MK|North Macedonia|389|MKD|OTHER
MD|Moldova|373|MDL|OTHER
BY|Belarus|375|BYN|OTHER`;

  const COUNTRIES = RAW.trim().split('\n').map((line) => {
    const [code, name, dial, currency, region] = line.split('|');
    return { code, name, dial, currency, region };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const REGION_NAMES = {
    GCC: 'the GCC',
    US: 'the United States',
    UK: 'the United Kingdom',
    EU: 'the EU / EEA',
    CA: 'Canada',
    AU: 'Australia / New Zealand',
    IN: 'India',
    SG: 'Singapore',
    OTHER: 'your country'
  };

  const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));

  function getCountry(code) {
    return byCode.get(String(code || '').toUpperCase()) || null;
  }

  // Aliases used in job questions ("authorized to work in the U.S."). Matched as whole words.
  const ALIASES = {
    AE: ['uae', 'u.a.e.', 'united arab emirates', 'emirates', 'dubai', 'abu dhabi', 'sharjah', 'ajman'],
    SA: ['saudi', 'saudi arabia', 'ksa', 'riyadh', 'jeddah', 'dammam'],
    QA: ['qatar', 'doha'],
    KW: ['kuwait'],
    BH: ['bahrain', 'manama'],
    OM: ['oman', 'muscat'],
    GCC: ['gcc', 'gulf cooperation council'],
    US: ['united states', 'united states of america', 'u.s.', 'u.s', 'usa', 'us citizen', 'us-based', 'in the us', 'within the us'],
    GB: ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'london', 'scotland', 'wales'],
    CA: ['canada'],
    AU: ['australia'],
    NZ: ['new zealand'],
    IN: ['india', 'bangalore', 'bengaluru', 'mumbai', 'hyderabad', 'pune', 'new delhi'],
    SG: ['singapore'],
    DE: ['germany', 'berlin', 'munich'],
    FR: ['france', 'paris'],
    NL: ['netherlands', 'amsterdam'],
    IE: ['ireland', 'dublin'],
    EU: ['european union', 'eu', 'eea', 'europe', 'schengen']
  };
  // Country names that are also common words/places elsewhere (US states, first names)
  const AMBIGUOUS_NAMES = new Set(['GE', 'JO']);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = (w) => new RegExp(`(?<![a-z0-9])${escapeRe(w)}(?![a-z0-9])`, 'i');
  const ALIAS_RES = Object.entries(ALIASES).map(([code, words]) => [code, words.map(wordRe)]);
  const NAME_RES = COUNTRIES.filter((c) => !AMBIGUOUS_NAMES.has(c.code)).map((c) => [c.code, wordRe(c.name.toLowerCase())]);

  /** Returns the ISO code (or "EU"/"GCC") a text refers to, if any. Whole-word matches only. */
  function detectCountryInText(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return null;
    // Earliest mention wins ("UK or EU" -> UK)
    let best = null;
    for (const [code, res] of ALIAS_RES) {
      for (const re of res) {
        const m = re.exec(t);
        if (m && (!best || m.index < best.index)) best = { code, index: m.index };
      }
    }
    for (const [code, re] of NAME_RES) {
      const m = re.exec(t);
      if (m && (!best || m.index < best.index)) best = { code, index: m.index };
    }
    return best ? best.code : null;
  }

  /** Country of a job location ("Dublin, California, United States"): the most specific
   * part is the LAST one, so a state or city named after a country doesn't win. */
  function detectCountryInLocation(location) {
    const parts = String(location || '').split(/[,·|]/).map((x) => x.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const code = detectCountryInText(parts[i]);
      if (code) return code;
    }
    return null;
  }

  function regionOf(code) {
    if (code === 'EU') return 'EU';
    if (code === 'GCC') return 'GCC';
    return getCountry(code)?.region || 'OTHER';
  }

  const api = { COUNTRIES, REGION_NAMES, getCountry, detectCountryInText, detectCountryInLocation, regionOf };
  root.JobFlowCountries = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
