/**
 * JobFlow AI - End-to-End Consumer SaaS Flow Verification
 * Tests: 1. Resume Parsing -> 2. Target Job Matching -> 3. Autonomous Cloud Applying
 */

const { parseResume } = require('./apps/web/lib/cv-parser');
const { runAutonomousApplySession } = require('./apps/web/lib/live-job-engine');

async function testConsumerFlow() {
  console.log('==============================================');
  console.log('🚀 Testing 1-Click "Upload CV -> Auto-Apply" Flow');
  console.log('==============================================\n');

  let passed = 0;
  let failed = 0;

  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  // 1. Resume Parsing Test
  console.log('Step 1: Parsing Raw Resume with AI / NLP...');
  const sampleResume = `
  Jordan Hayes
  jordan.hayes@example.com | +1 (555) 789-0123
  https://linkedin.com/in/jordanhayes-dev
  San Francisco, CA

  Summary:
  Senior Full Stack Engineer with 6 years experience building React, TypeScript, and Node microservices on AWS and Docker.

  Experience:
  Senior Software Engineer at Stripe (2022 - Present)
  - Scaled payment infrastructure to 5M+ daily requests.
  - Implemented real-time fraud detection pipelines with PostgreSQL and Redis.

  Skills:
  TypeScript, React, Next.js, Node.js, Python, PostgreSQL, Redis, Docker, Kubernetes, AWS, GraphQL
  `;

  const parsed = await parseResume(sampleResume);
  assert(parsed.firstName === 'Jordan', `Extracted First Name: "${parsed.firstName}"`);
  assert(parsed.lastName === 'Hayes', `Extracted Last Name: "${parsed.lastName}"`);
  assert(parsed.email.includes('jordan.hayes'), `Extracted Email: "${parsed.email}"`);
  assert(parsed.skills.includes('TypeScript') && parsed.skills.includes('React'), `Extracted Core Skills: ${parsed.skills.slice(0, 4).join(', ')}`);
  assert(parsed.targetRole.includes('Engineer'), `Inferred Target Role: "${parsed.targetRole}"`);

  // 2. Autonomous Cloud Application Execution Test
  console.log('\nStep 2: Executing Autonomous Cloud Auto-Apply Run...');
  const events = [];
  const result = await runAutonomousApplySession({
    profile: parsed,
    onEvent: (evt) => {
      events.push(evt);
      if (evt.type === 'applying') {
        console.log(`  ⚡ Applying to: ${evt.company} - ${evt.jobTitle} (${evt.matchScore}% Match)`);
      } else if (evt.type === 'applied_success') {
        console.log(`  ✅ ${evt.message}`);
      }
    }
  });

  assert(result.count > 0, `Successfully submitted applications to ${result.count} companies`);
  assert(events.some(e => e.type === 'applied_success'), 'Received application success streaming events');
  assert(events.some(e => e.type === 'ai_answer'), 'Generated tailored AI screening essays per employer');

  console.log('\n==============================================');
  console.log(`SaaS Flow Results: ${passed} passed, ${failed} failed`);
  console.log('==============================================\n');

  if (failed > 0) process.exit(1);
}

testConsumerFlow().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
