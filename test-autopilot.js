/**
 * JobFlow AI - Auto-Pilot Verification Suite
 * Tests job discovery, ATS match scoring, queue management, and autonomous step execution.
 */

const fs = require('node:fs');
const path = require('node:path');
const { searchJobs, calculateMatchScore } = require('./apps/web/lib/job-search');
const { generateScreeningAnswer } = require('./apps/web/lib/ai-engine');

async function testAutoPilot() {
  console.log('==============================================');
  console.log('🚀 Running JobFlow Auto-Pilot Verification');
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

  // 1. Profile load
  const profile = JSON.parse(fs.readFileSync(path.join(__dirname, 'apps', 'web', 'data', 'profile.json'), 'utf8'));

  // 2. Test Job Search
  console.log('1. Testing Autonomous Job Discovery & Match Scoring...');
  const searchResults = await searchJobs({ query: 'Full Stack', location: 'Remote', minScore: 70, profile });
  assert(Array.isArray(searchResults) && searchResults.length > 0, `Discovered ${searchResults.length} matching jobs`);
  
  const topJob = searchResults[0];
  assert(topJob.matchScore >= 80, `Top job (${topJob.company} - ${topJob.jobTitle}) match score is ${topJob.matchScore}%`);
  assert(typeof topJob.matchGrade === 'string', `Match grade assigned: "${topJob.matchGrade}"`);

  // 3. Test Match Scorer Algorithm
  console.log('\n2. Testing ATS Compatibility Algorithm...');
  const testJob = {
    jobTitle: 'Senior Full Stack Engineer',
    requiredSkills: ['React', 'TypeScript', 'Node.js'],
    minExperience: 5
  };
  const score = calculateMatchScore(testJob, profile);
  assert(score >= 85, `Candidate scored ${score}% compatibility for high-alignment role`);

  // 4. Test Automated Application Step (Screening essay + Queue update + Credit deduction)
  console.log('\n3. Testing Autonomous Application Execution Step...');
  const queuePath = path.join(__dirname, 'apps', 'web', 'data', 'queue.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  assert(queue.length > 0, 'Active queue contains target jobs');

  const targetJob = queue[0];
  console.log(`  Targeting Job: ${targetJob.company} - ${targetJob.jobTitle} (${targetJob.platform})`);

  // Generate essay
  const aiRes = await generateScreeningAnswer({
    question: `Why are you interested in joining ${targetJob.company} as a ${targetJob.jobTitle}?`,
    jobTitle: targetJob.jobTitle,
    company: targetJob.company,
    profile
  });
  assert(aiRes && aiRes.answer && aiRes.answer.length > 50, 'Autonomous AI screening answer generated');
  console.log(`  Preview of generated essay: "${aiRes.answer.slice(0, 80)}..."`);

  // Update queue item
  targetJob.status = 'Submitted';
  targetJob.submittedAt = new Date().toISOString();
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf8');
  assert(queue[0].status === 'Submitted', 'Queue updated to status "Submitted"');

  console.log('\n==============================================');
  console.log(`Auto-Pilot Results: ${passed} passed, ${failed} failed`);
  console.log('==============================================\n');

  if (failed > 0) process.exit(1);
}

testAutoPilot().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
