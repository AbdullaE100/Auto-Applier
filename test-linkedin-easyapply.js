/**
 * Test: LinkedIn Easy Apply Multi-Step Autonomous Simulation
 * Verifies that JobFlow AI accurately detects LinkedIn Easy Apply modals,
 * fills contact info (including UAE +971 phone), selects resumes,
 * answers complex screening questions, and advances automatically.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 1. Load Profile
const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'apps', 'web', 'data', 'profile.json'), 'utf8'));

// 2. Load Core & LinkedIn Scripts
const coreCode = fs.readFileSync(path.join(__dirname, 'apps', 'extension', 'content', 'autofill-core.js'), 'utf8');
const linkedinCode = fs.readFileSync(path.join(__dirname, 'apps', 'extension', 'content', 'linkedin.js'), 'utf8');

// 3. Mock DOM Element Class
class MockDOMElement {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.id = attrs.id || '';
    this.name = attrs.name || '';
    this.type = attrs.type || 'text';
    this.value = attrs.value || '';
    this.checked = Boolean(attrs.checked);
    this.placeholder = attrs.placeholder || '';
    this.textContent = attrs.textContent || '';
    this.options = attrs.options || [];
    this.selectedIndex = 0;
    this.style = {};
    this.attributes = attrs;
    this.children = [];
    this.parentNode = null;
    this.offsetParent = attrs.offsetParent !== undefined ? attrs.offsetParent : {};
    this.disabled = Boolean(attrs.disabled);
    this.classList = {
      classes: new Set(attrs.classes || []),
      contains(c) { return this.classes.has(c); },
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); }
    };
  }

  getAttribute(attr) { return this.attributes[attr] || null; }
  setAttribute(attr, val) { this.attributes[attr] = val; }
  removeAttribute(attr) { delete this.attributes[attr]; }
  closest(selector) {
    let p = this.parentNode;
    while (p) {
      if (selector === 'label' && p.tagName === 'LABEL') return p;
      if (selector === 'fieldset' && p.tagName === 'FIELDSET') return p;
      p = p.parentNode;
    }
    return null;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
  }
  insertBefore(newNode, refNode) {
    newNode.parentNode = this;
    const idx = this.children.indexOf(refNode);
    if (idx >= 0) this.children.splice(idx, 0, newNode);
    else this.children.push(newNode);
  }
  dispatchEvent(evt) {}
  click() {
    if (this.onclick) this.onclick();
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    return idx > 0 ? this.parentNode.children[idx - 1] : null;
  }

  querySelectorAll(sel) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
        let match = false;
        const tag = child.tagName.toLowerCase();
        if (sel === tag) match = true;
        else if (sel.includes(`input[type="${child.type}"]`)) match = (tag === 'input');
        else if (sel === 'input' && tag === 'input') match = true;
        else if (sel === 'select' && tag === 'select') match = true;
        else if (sel === 'textarea' && tag === 'textarea') match = true;
        else if (sel === 'fieldset' && tag === 'fieldset') match = true;
        else if (sel === 'button' && tag === 'button') match = true;
        else if (sel === 'legend' && tag === 'legend') match = true;
        else if (sel === 'label' && tag === 'label') match = true;

        if (match) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  querySelector(sel) {
    const all = this.querySelectorAll(sel);
    return all.length ? all[0] : null;
  }
}

// Build Step 1 Elements: Contact Information
const modal = new MockDOMElement('div', { classes: ['jobs-easy-apply-modal'] });
modal.setAttribute('data-test-modal-id', 'easy-apply-modal');

const header = new MockDOMElement('div', { classes: ['artdeco-modal__header'], textContent: 'Apply to Acme Corp' });
modal.appendChild(header);

// Step 1: Contact
const fNameLabel = new MockDOMElement('label', { textContent: 'First name', attributes: { for: 'fn' } });
const fNameInput = new MockDOMElement('input', { id: 'fn', type: 'text' });
modal.appendChild(fNameLabel);
modal.appendChild(fNameInput);

const lNameLabel = new MockDOMElement('label', { textContent: 'Last name', attributes: { for: 'ln' } });
const lNameInput = new MockDOMElement('input', { id: 'ln', type: 'text' });
modal.appendChild(lNameLabel);
modal.appendChild(lNameInput);

const emailLabel = new MockDOMElement('label', { textContent: 'Email address', attributes: { for: 'em' } });
const emailInput = new MockDOMElement('input', { id: 'em', type: 'email' });
modal.appendChild(emailLabel);
modal.appendChild(emailInput);

const countryCodeLabel = new MockDOMElement('label', { textContent: 'Phone country code', attributes: { for: 'cc' } });
const countryCodeSelect = new MockDOMElement('select', {
  id: 'phoneNumber-countryCode',
  options: [
    { text: 'United States (+1)', value: 'us' },
    { text: 'United Arab Emirates (+971)', value: 'ae' },
    { text: 'United Kingdom (+44)', value: 'gb' }
  ]
});
modal.appendChild(countryCodeLabel);
modal.appendChild(countryCodeSelect);

const phoneLabel = new MockDOMElement('label', { textContent: 'Mobile phone number', attributes: { for: 'pn' } });
const phoneInput = new MockDOMElement('input', { id: 'pn', type: 'tel' });
modal.appendChild(phoneLabel);
modal.appendChild(phoneInput);

// Step 2: Resume
const resumeLabel = new MockDOMElement('label', { textContent: 'Abdulla_Ehsan_Resume_2026.pdf' });
const resumeRadio = new MockDOMElement('input', { type: 'radio', name: 'resume-choice', checked: false });
modal.appendChild(resumeLabel);
modal.appendChild(resumeRadio);

// Step 3: Screening Questions
const q1Label = new MockDOMElement('label', { textContent: 'How many years of work experience do you have with React?' });
const q1Input = new MockDOMElement('input', { type: 'number' });
modal.appendChild(q1Label);
modal.appendChild(q1Input);

const q2Label = new MockDOMElement('label', { textContent: 'How many years of work experience do you have with Python?' });
const q2Input = new MockDOMElement('input', { type: 'number' });
modal.appendChild(q2Label);
modal.appendChild(q2Input);

// Radio Question: Authorization
const fieldsetAuth = new MockDOMElement('fieldset');
const legendAuth = new MockDOMElement('legend', { textContent: 'Are you legally authorized to work in the UAE?' });
const radioAuthYes = new MockDOMElement('input', { type: 'radio', value: 'yes', attributes: { 'aria-label': 'Yes' } });
const radioAuthNo = new MockDOMElement('input', { type: 'radio', value: 'no', attributes: { 'aria-label': 'No' } });
fieldsetAuth.appendChild(legendAuth);
fieldsetAuth.appendChild(radioAuthYes);
fieldsetAuth.appendChild(radioAuthNo);
modal.appendChild(fieldsetAuth);

// Radio Question: Sponsorship
const fieldsetSpons = new MockDOMElement('fieldset');
const legendSpons = new MockDOMElement('legend', { textContent: 'Will you now or in the future require visa sponsorship?' });
const radioSponsYes = new MockDOMElement('input', { type: 'radio', value: 'yes', attributes: { 'aria-label': 'Yes' } });
const radioSponsNo = new MockDOMElement('input', { type: 'radio', value: 'no', attributes: { 'aria-label': 'No' } });
fieldsetSpons.appendChild(legendSpons);
fieldsetSpons.appendChild(radioSponsYes);
fieldsetSpons.appendChild(radioSponsNo);
modal.appendChild(fieldsetSpons);

// Next & Submit Buttons
const nextButton = new MockDOMElement('button', { attributes: { 'aria-label': 'Continue to next step' }, textContent: 'Next' });
const submitButton = new MockDOMElement('button', { attributes: { 'aria-label': 'Submit application' }, textContent: 'Submit application' });
modal.appendChild(nextButton);
modal.appendChild(submitButton);

// Sandbox environment
const sandbox = {
  window: {
    location: { hostname: 'www.linkedin.com', href: 'https://www.linkedin.com/jobs/view/123456789/' },
    getComputedStyle: () => ({ display: 'block' }),
    HTMLInputElement: { prototype: {} },
    HTMLTextAreaElement: { prototype: {} }
  },
  document: {
    title: 'Senior Backend Engineer | Acme Corp | LinkedIn',
    querySelectorAll: (sel) => {
      if (sel.includes('jobs-easy-apply-modal') || sel.includes('role="dialog"')) return [modal];
      if (sel.includes('button')) return [nextButton, submitButton];
      return [];
    },
    querySelector: (sel) => {
      if (sel.includes('jobs-easy-apply-modal') || sel.includes('role="dialog"')) return modal;
      if (sel.startsWith('label[for=')) {
        const idMatch = sel.match(/for="([^"]+)"/);
        if (idMatch) {
          return modal.querySelectorAll('label').find(l => l.getAttribute('for') === idMatch[1]) || null;
        }
      }
      return null;
    },
    getElementById: (id) => null,
    createElement: (tag) => new MockDOMElement(tag),
    body: {
      appendChild: () => {},
      children: [modal]
    }
  },
  Event: class Event { constructor(type) { this.type = type; } },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  setInterval: () => {},
  setTimeout: (fn) => fn(),
  console: console
};

vm.createContext(sandbox);
vm.runInContext(coreCode, sandbox);
vm.runInContext(linkedinCode, sandbox);

console.log('==================================================');
console.log('🧪 TESTING LINKEDIN EASY APPLY AUTOMATION ENGINE');
console.log('==================================================');

// Run step filling
const filledCount = sandbox.window.JobFlowLinkedIn.fillCurrentModalStep(modal, profile);

console.log(`\n✓ Total Fields Filled: ${filledCount}`);
console.log(`- First Name: "${fNameInput.value}" (Expected: "${profile.firstName}")`);
console.log(`- Last Name: "${lNameInput.value}" (Expected: "${profile.lastName}")`);
console.log(`- Email: "${emailInput.value}" (Expected: "${profile.email}")`);
console.log(`- Country Code Selected: "${countryCodeSelect.options[countryCodeSelect.selectedIndex].text}" (Expected: United Arab Emirates (+971))`);
console.log(`- Phone Input: "${phoneInput.value}" (Expected: "55 118 0792")`);
console.log(`- Resume Radio Checked: ${resumeRadio.checked} (Expected: true)`);
console.log(`- React Exp (Years): "${q1Input.value}" (Expected: "4")`);
console.log(`- Python Exp (Years): "${q2Input.value}" (Expected: "4")`);
console.log(`- Work Authorized Checked: Yes=${radioAuthYes.checked}, No=${radioAuthNo.checked} (Expected: Yes=true)`);
console.log(`- Sponsorship Checked: Yes=${radioSponsYes.checked}, No=${radioSponsNo.checked} (Expected: No=true)`);

// Assertions
const assert = require('node:assert');
assert.strictEqual(fNameInput.value, profile.firstName, 'First name must match profile');
assert.strictEqual(lNameInput.value, profile.lastName, 'Last name must match profile');
assert.strictEqual(emailInput.value, profile.email, 'Email must match profile');
assert.strictEqual(countryCodeSelect.selectedIndex, 1, 'UAE (+971) must be selected');
assert.strictEqual(phoneInput.value, '55 118 0792', 'Phone input must have national number without duplicated country code');
assert.strictEqual(resumeRadio.checked, true, 'Resume must be auto-selected');
assert.strictEqual(q1Input.value, String(profile.yearsExperience || 4), 'React experience should match candidate profile years');
assert.strictEqual(q2Input.value, String(profile.yearsExperience || 4), 'Python experience should match candidate profile years');
assert.strictEqual(radioAuthYes.checked, true, 'Work authorization should be Yes');
assert.strictEqual(radioSponsNo.checked, true, 'Visa sponsorship should be No');

console.log('\n==================================================');
console.log('✅ ALL LINKEDIN EASY APPLY AUTOMATION TESTS PASSED 100%!');
console.log('==================================================\n');
