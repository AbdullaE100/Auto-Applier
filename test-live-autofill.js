/**
 * Live End-to-End Autofill Verification
 * Simulates a candidate landing on a real Greenhouse portal and clicking JobFlow "1-Click Auto Fill".
 */

const fs = require('node:fs');
const path = require('node:path');

// 1. Load Profile
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'apps', 'web', 'data', 'profile.json'), 'utf8'));

// 2. Load Core & Greenhouse Logic
const coreCode = fs.readFileSync(path.join(__dirname, 'apps', 'extension', 'content', 'autofill-core.js'), 'utf8');
const ghCode = fs.readFileSync(path.join(__dirname, 'apps', 'extension', 'content', 'greenhouse.js'), 'utf8');
const aiEngine = require('./apps/web/lib/ai-engine');

// 3. Create simulated DOM environment
class MockElement {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.id = attrs.id || '';
    this.name = attrs.name || '';
    this.type = attrs.type || 'text';
    this.value = attrs.value || '';
    this.placeholder = attrs.placeholder || '';
    this.options = attrs.options || [];
    this.selectedIndex = 0;
    this.style = {};
    this.attributes = attrs;
    this.dispatchedEvents = [];
  }

  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, val) { this.attributes[name] = val; }
  closest(selector) { return null; }
  dispatchEvent(evt) { this.dispatchedEvents.push(evt.type); }
}

// Build form fields corresponding to mock-portals/greenhouse-sample.html
const formElements = [
  new MockElement('input', { id: 'first_name', name: 'job_application[first_name]' }),
  new MockElement('input', { id: 'last_name', name: 'job_application[last_name]' }),
  new MockElement('input', { id: 'email', name: 'job_application[email]', type: 'email' }),
  new MockElement('input', { id: 'phone', name: 'job_application[phone]', type: 'tel' }),
  new MockElement('input', { id: 'job_application_answers_attributes_0_text_value', name: 'linkedin' }),
  new MockElement('input', { id: 'job_application_answers_attributes_1_text_value', name: 'github' }),
  new MockElement('input', { id: 'job_application_answers_attributes_2_text_value', name: 'portfolio' }),
  new MockElement('select', {
    id: 'job_application_answers_attributes_3_boolean_value',
    name: 'authorized_to_work',
    options: [
      { text: '-- Please Select --', value: '' },
      { text: 'Yes, I am authorized', value: 'yes' },
      { text: 'No, I am not authorized', value: 'no' }
    ]
  }),
  new MockElement('select', {
    id: 'job_application_answers_attributes_4_boolean_value',
    name: 'sponsorship_required',
    options: [
      { text: '-- Please Select --', value: '' },
      { text: 'Yes, sponsorship required', value: 'yes' },
      { text: 'No, will not require sponsorship', value: 'no' }
    ]
  }),
  new MockElement('textarea', {
    id: 'job_application_answers_attributes_5_text_value',
    name: 'screening_question',
    placeholder: 'Why are you interested in joining Acme Cloud Technologies?'
  })
];

const mockForm = {
  querySelectorAll(sel) {
    if (sel.includes('select')) return formElements.filter(e => e.tagName === 'SELECT');
    if (sel.includes('textarea')) return formElements.filter(e => e.tagName === 'TEXTAREA');
    if (sel.includes('input')) return formElements.filter(e => e.tagName === 'INPUT');
    return formElements;
  },
  querySelector(sel) {
    return this.querySelectorAll(sel)[0];
  }
};

const mockDocument = {
  title: 'Staff Full Stack Engineer at Acme Cloud Technologies',
  querySelector(sel) {
    if (sel === '#application_form' || sel === 'form') return mockForm;
    return null;
  }
};

// Setup sandbox execution
const sandbox = {
  window: {},
  document: mockDocument,
  Event: class Event { constructor(type) { this.type = type; } },
  console: console
};

const vm = require('node:vm');
vm.createContext(sandbox);
vm.runInContext(coreCode, sandbox);
vm.runInContext(ghCode, sandbox);

// Inject mock AI request
sandbox.window.JobFlowOverlay = {
  async requestAiAnswer({ question, jobTitle, company }) {
    return await aiEngine.generateScreeningAnswer({ question, jobTitle, company, profile });
  }
};

async function verifyAutofill() {
  console.log('--------------------------------------------------');
  console.log('🔍 BEFORE AUTOFILL:');
  console.log('--------------------------------------------------');
  formElements.forEach(el => {
    console.log(`  [${el.tagName.padEnd(8)}] ID: ${(el.id || el.name).padEnd(46)} -> Value: "${el.value || (el.options?.[el.selectedIndex]?.text || '')}"`);
  });

  console.log('\n⚡ TRIGGERING JOBFLOW AUTOFILL ENGINE...\n');

  const result = await sandbox.window.JobFlowGreenhouse.autofill(profile, (progress) => {
    console.log(`  ⚙️  Progress: ${progress}`);
  });

  console.log('\n--------------------------------------------------');
  console.log('✨ AFTER AUTOFILL (Fields populated):');
  console.log('--------------------------------------------------');
  formElements.forEach(el => {
    const val = el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.value;
    const shortVal = val.length > 60 ? val.slice(0, 60) + '...' : val;
    console.log(`  [${el.tagName.padEnd(8)}] ID: ${(el.id || el.name).padEnd(46)} -> Value: "${shortVal}"`);
  });

  console.log('\n--------------------------------------------------');
  console.log(`🎯 Summary: Result: ${result.success ? 'SUCCESS' : 'FAILED'}, Fields Filled: ${result.count}`);
  console.log('--------------------------------------------------');
}

verifyAutofill();
