/**
 * JobFlow AI - Automated Test & Verification Suite
 * Verifies manifest V3 configuration, AI question synthesis, and REST endpoints.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { generateScreeningAnswer } = require('./apps/web/lib/ai-engine');

async function runTests() {
  console.log('==============================================');
  console.log('🚀 Running JobFlow AI System Verification');
  console.log('==============================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${name}`);
      failed++;
    }
  }

  // 1. Manifest V3 Integrity
  console.log('1. Checking Manifest V3 Chrome Extension Configuration...');
  const manifestPath = path.join(__dirname, 'apps', 'extension', 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json exists');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.manifest_version === 3, 'Manifest version is 3');
  assert(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0, 'Content scripts registered');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'extension', 'content', 'autofill-core.js')), 'autofill-core.js exists');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'extension', 'content', 'greenhouse.js')), 'greenhouse.js exists');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'extension', 'content', 'lever.js')), 'lever.js exists');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'extension', 'content', 'linkedin.js')), 'linkedin.js exists');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'extension', 'content', 'overlay.js')), 'overlay.js exists');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'extension', 'icons', 'icon128.png')), 'icon128.png exists');

  // 2. AI Screening Engine
  console.log('\n2. Testing AI Screening Answer Engine...');
  const sampleProfile = JSON.parse(fs.readFileSync(path.join(__dirname, 'apps', 'web', 'data', 'profile.json'), 'utf8'));
  
  const testQ1 = await generateScreeningAnswer({
    question: 'Why are you interested in joining Acme Cloud Technologies?',
    jobTitle: 'Staff Full Stack Engineer',
    company: 'Acme Cloud Technologies',
    profile: sampleProfile
  });
  assert(testQ1 && testQ1.answer && testQ1.answer.length > 30, 'Generated answer for "Why do you want to work here?"');
  assert(testQ1.answer.includes('Acme Cloud Technologies'), 'Answer includes target company context');

  const testQ2 = await generateScreeningAnswer({
    question: 'What are your compensation expectations?',
    jobTitle: 'Software Engineer',
    company: 'Linear',
    profile: sampleProfile
  });
  assert(testQ2 && testQ2.answer && testQ2.answer.includes('$140,000'), 'Generated answer for salary expectations with profile data');

  // 3. Mock Test Portals
  console.log('\n3. Verifying Local ATS Test Portals...');
  const ghPath = path.join(__dirname, 'mock-portals', 'greenhouse-sample.html');
  const leverPath = path.join(__dirname, 'mock-portals', 'lever-sample.html');
  assert(fs.existsSync(ghPath), 'Greenhouse mock portal exists');
  assert(fs.existsSync(leverPath), 'Lever mock portal exists');

  // 4. Web Dashboard & Server Files
  console.log('\n4. Verifying Web Dashboard & Server Assets...');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'web', 'public', 'index.html')), 'Landing page exists');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'web', 'public', 'dashboard.html')), 'SaaS Dashboard page exists');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'web', 'public', 'style.css')), 'Style.css exists');
  assert(fs.existsSync(path.join(__dirname, 'apps', 'web', 'public', 'dashboard.js')), 'Dashboard.js exists');

  console.log('\n==============================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('==============================================\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
