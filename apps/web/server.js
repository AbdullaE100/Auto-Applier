const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { generateScreeningAnswer } = require('./lib/ai-engine');
const { searchJobs } = require('./lib/job-search');
const { parseResume } = require('./lib/cv-parser');
const { runAutonomousApplySession } = require('./lib/live-job-engine');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MOCK_DIR = path.join(__dirname, '..', '..', 'mock-portals');

// Helper to read JSON
function readJson(filename) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, filename), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// Helper to write JSON
function writeJson(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf8');
}

// Read request body helper
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// Send JSON response with CORS
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// Static file MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip'
};

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // --- API ROUTES ---

  // Health Check
  if (pathname === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { status: 'healthy', version: '1.0.0', time: new Date().toISOString() });
  }

  // Profile API
  if (pathname === '/api/profile') {
    if (req.method === 'GET') {
      const profile = readJson('profile.json') || {};
      return sendJson(res, 200, profile);
    }
    if (req.method === 'POST') {
      try {
        const body = await parseBody(req);
        writeJson('profile.json', body);
        return sendJson(res, 200, { success: true, profile: body });
      } catch (err) {
        return sendJson(res, 400, { error: 'Invalid profile payload' });
      }
    }
  }

  // --- CV UPLOAD & PARSING API ---
  if (pathname === '/api/cv/parse' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const text = body.resumeText || '';
      if (!text) return sendJson(res, 400, { error: 'Please provide resume text or upload a CV file.' });

      const parsedProfile = await parseResume(text);
      writeJson('profile.json', parsedProfile);
      return sendJson(res, 200, { success: true, profile: parsedProfile });
    } catch (err) {
      return sendJson(res, 500, { error: 'Failed to parse resume: ' + err.message });
    }
  }

  // --- STREAMING LIVE AUTONOMOUS APPLY API (Server-Sent Events) ---
  if (pathname === '/api/cv/auto-apply/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const profile = readJson('profile.json') || {};
    
    try {
      await runAutonomousApplySession({
        profile,
        onEvent: (evt) => {
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }
      });
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    } finally {
      res.end();
    }
    return;
  }

  // Credits & Billing API
  if (pathname === '/api/credits') {
    if (req.method === 'GET') {
      const billing = readJson('billing.json') || { plan: 'free', total: 10, remaining: 10, used: 0 };
      return sendJson(res, 200, billing);
    }
  }

  if (pathname === '/api/credits/consume' && req.method === 'POST') {
    const billing = readJson('billing.json') || { plan: 'free', total: 10, remaining: 10, used: 0 };
    if (billing.remaining <= 0 && billing.plan === 'free') {
      return sendJson(res, 403, { error: 'Monthly credit limit reached. Please upgrade to Pro.' });
    }
    billing.used += 1;
    if (billing.plan !== 'turbo') {
      billing.remaining = Math.max(0, billing.remaining - 1);
    }
    writeJson('billing.json', billing);
    return sendJson(res, 200, { success: true, billing });
  }

  if (pathname === '/api/billing/upgrade' && req.method === 'POST') {
    const body = await parseBody(req);
    const targetPlan = body.plan || 'pro';
    const plans = {
      free: { plan: 'free', total: 10, remaining: 10, used: 0 },
      pro: { plan: 'pro', total: 150, remaining: 150, used: 0 },
      turbo: { plan: 'turbo', total: 9999, remaining: 9999, used: 0 }
    };
    const newBilling = plans[targetPlan] || plans.pro;
    writeJson('billing.json', newBilling);
    return sendJson(res, 200, { success: true, billing: newBilling });
  }

  // AI Answer Generation API
  if (pathname === '/api/ai/answer' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const profile = body.profile || readJson('profile.json') || {};
      const answerData = await generateScreeningAnswer({
        question: body.question || 'Why are you interested in this role?',
        jobTitle: body.jobTitle || 'Software Engineer',
        company: body.company || 'Company',
        profile
      });
      return sendJson(res, 200, answerData);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // Applications History Tracker API
  if (pathname === '/api/applications') {
    if (req.method === 'GET') {
      const apps = readJson('applications.json') || [];
      return sendJson(res, 200, apps);
    }
    if (req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const apps = readJson('applications.json') || [];
        const newApp = {
          id: 'app_' + Date.now(),
          company: body.company || 'Company',
          jobTitle: body.jobTitle || 'Software Engineer',
          platform: body.platform || 'Direct',
          status: 'Applied',
          date: new Date().toISOString().split('T')[0],
          fieldsFilled: body.fieldsFilled || 8,
          url: body.url || ''
        };
        apps.unshift(newApp);
        writeJson('applications.json', apps);

        // Deduct credit
        const billing = readJson('billing.json');
        if (billing && billing.remaining > 0) {
          billing.used += 1;
          if (billing.plan !== 'turbo') billing.remaining -= 1;
          writeJson('billing.json', billing);
        }

        return sendJson(res, 201, { success: true, application: newApp });
      } catch (err) {
        return sendJson(res, 400, { error: 'Failed to record application' });
      }
    }
  }

  // --- JOB DISCOVERY & SEARCH API ---
  if (pathname === '/api/jobs/search' && (req.method === 'POST' || req.method === 'GET')) {
    try {
      const body = req.method === 'POST' ? await parseBody(req) : {};
      const profile = readJson('profile.json') || {};
      const results = await searchJobs({
        query: body.query || profile.targetRole || 'Full Stack Engineer',
        location: body.location || 'Remote',
        minScore: Number(body.minScore) || 50,
        profile
      });
      return sendJson(res, 200, { success: true, count: results.length, jobs: results });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // --- AUTOPILOT QUEUE API ---
  if (pathname === '/api/autopilot/queue') {
    if (req.method === 'GET') {
      const queue = readJson('queue.json') || [];
      return sendJson(res, 200, queue);
    }
    if (req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const queue = Array.isArray(body.queue) ? body.queue : [body];
        writeJson('queue.json', queue);
        return sendJson(res, 200, { success: true, queue });
      } catch (err) {
        return sendJson(res, 400, { error: 'Failed to update queue' });
      }
    }
  }

  // Execute an automated application step in the queue
  if (pathname === '/api/autopilot/step' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const jobId = body.jobId;
      const queue = readJson('queue.json') || [];
      const jobIndex = queue.findIndex(q => q.id === jobId);

      if (jobIndex === -1) {
        return sendJson(res, 404, { error: 'Job not found in queue' });
      }

      const job = queue[jobIndex];
      const profile = readJson('profile.json') || {};

      // 1. Synthesize custom screening answer via AI
      const aiResponse = await generateScreeningAnswer({
        question: `Why are you interested in joining ${job.company} as a ${job.jobTitle}?`,
        jobTitle: job.jobTitle,
        company: job.company,
        profile
      });

      // 2. Mark queue item as Submitted
      job.status = 'Submitted';
      job.submittedAt = new Date().toISOString();
      job.aiAnswerPreview = aiResponse.answer.slice(0, 120) + '...';
      writeJson('queue.json', queue);

      // 3. Record in application tracker
      const apps = readJson('applications.json') || [];
      const newApp = {
        id: 'app_' + Date.now(),
        company: job.company,
        jobTitle: job.jobTitle,
        platform: job.platform,
        status: 'Applied',
        date: new Date().toISOString().split('T')[0],
        fieldsFilled: 10,
        url: job.url || ''
      };
      apps.unshift(newApp);
      writeJson('applications.json', apps);

      // 4. Deduct credit
      const billing = readJson('billing.json');
      if (billing && billing.remaining > 0) {
        billing.used += 1;
        if (billing.plan !== 'turbo') billing.remaining -= 1;
        writeJson('billing.json', billing);
      }

      return sendJson(res, 200, {
        success: true,
        job,
        application: newApp,
        billing: billing || {}
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // --- MOCK ATS PORTAL ROUTES FOR IMMEDIATE TESTING ---
  if (pathname === '/mock/greenhouse') {
    const filePath = path.join(MOCK_DIR, 'greenhouse-sample.html');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(filePath));
    }
  }

  if (pathname === '/mock/lever') {
    const filePath = path.join(MOCK_DIR, 'lever-sample.html');
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(filePath));
    }
  }

  // --- SERVE EXTENSION ASSETS FOR TEST BED ---
  if (pathname.startsWith('/apps/extension/')) {
    const relPath = pathname.replace('/apps/extension/', '');
    const extFilePath = path.join(__dirname, '..', 'extension', relPath);
    if (fs.existsSync(extFilePath) && fs.statSync(extFilePath).isFile()) {
      const ext = path.extname(extFilePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      return res.end(fs.readFileSync(extFilePath));
    }
  }

  // --- STATIC WEB DASHBOARD & LANDING PAGE ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (pathname === '/dashboard') {
    filePath = path.join(PUBLIC_DIR, 'dashboard.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'text/html';

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    res.writeHead(200, { 'Content-Type': contentType });
    return res.end(fs.readFileSync(filePath));
  }

  // 404 Not Found
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404 Not Found - JobFlow AI');
});

server.listen(PORT, () => {
  console.log(`\n🚀 JobFlow AI Server running at http://localhost:${PORT}`);
  console.log(`   - Landing Page: http://localhost:${PORT}`);
  console.log(`   - SaaS Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`   - Mock Greenhouse Test Portal: http://localhost:${PORT}/mock/greenhouse`);
  console.log(`   - Mock Lever Test Portal: http://localhost:${PORT}/mock/lever`);
  console.log(`   - Extension API Base: http://localhost:${PORT}/api/\n`);
});
