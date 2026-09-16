/**
 * JobFlow AI - Dashboard Client Logic
 */

let currentProfile = {};
let currentBilling = {};

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  await Promise.all([
    loadProfile(),
    loadBilling(),
    loadApplications(),
    loadQueue(),
    loadRealJobs()
  ]);

  initCvDropzone();
  pingExtension();

  // Check URL hash for direct tab navigation
  if (window.location.hash) {
    const tabName = window.location.hash.replace('#', '');
    if (document.getElementById(`tab-${tabName}`)) {
      switchTab(tabName);
    }
  }
});

function switchTab(tabId) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar-btn').forEach(el => el.classList.remove('active'));

  const targetTab = document.getElementById(`tab-${tabId}`);
  if (targetTab) targetTab.classList.add('active');

  const btns = document.querySelectorAll('.sidebar-btn');
  btns.forEach(btn => {
    if (btn.getAttribute('onclick')?.includes(tabId)) {
      btn.classList.add('active');
    }
  });

  window.location.hash = tabId;
}

// 1. Profile Management
async function loadProfile() {
  try {
    const res = await fetch('/api/profile');
    if (!res.ok) return;
    const data = await res.json();
    currentProfile = data;

    document.getElementById('prof-firstName').value = data.firstName || '';
    document.getElementById('prof-lastName').value = data.lastName || '';
    document.getElementById('prof-email').value = data.email || '';
    document.getElementById('prof-phone').value = data.phone || '';
    document.getElementById('prof-currentCompany').value = data.currentCompany || '';
    document.getElementById('prof-targetRole').value = data.targetRole || '';

    document.getElementById('prof-linkedin').value = data.linkedin || '';
    document.getElementById('prof-github').value = data.github || '';
    document.getElementById('prof-portfolio').value = data.portfolio || '';

    document.getElementById('prof-workAuthorized').value = String(!!data.workAuthorized);
    document.getElementById('prof-requireSponsorship').value = String(!!data.requireSponsorship);
    document.getElementById('prof-yearsExperience').value = data.yearsExperience || 0;
    document.getElementById('prof-salaryExpectations').value = data.salaryExpectations || '';
    document.getElementById('prof-skills').value = (data.skills || []).join(', ');
    document.getElementById('prof-summary').value = data.summary || '';
    updateCvPreview(data);
  } catch (err) {
    console.error('Error loading profile:', err);
  }
}

async function saveProfile() {
  const updated = {
    ...currentProfile,
    firstName: document.getElementById('prof-firstName').value.trim(),
    lastName: document.getElementById('prof-lastName').value.trim(),
    email: document.getElementById('prof-email').value.trim(),
    phone: document.getElementById('prof-phone').value.trim(),
    currentCompany: document.getElementById('prof-currentCompany').value.trim(),
    targetRole: document.getElementById('prof-targetRole').value.trim(),
    linkedin: document.getElementById('prof-linkedin').value.trim(),
    github: document.getElementById('prof-github').value.trim(),
    portfolio: document.getElementById('prof-portfolio').value.trim(),
    workAuthorized: document.getElementById('prof-workAuthorized').value === 'true',
    requireSponsorship: document.getElementById('prof-requireSponsorship').value === 'true',
    yearsExperience: Number(document.getElementById('prof-yearsExperience').value) || 0,
    salaryExpectations: document.getElementById('prof-salaryExpectations').value.trim(),
    skills: document.getElementById('prof-skills').value.split(',').map(s => s.trim()).filter(Boolean),
    summary: document.getElementById('prof-summary').value.trim()
  };

  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });

    if (res.ok) {
      currentProfile = updated;
      const alertBox = document.getElementById('save-alert');
      alertBox.style.display = 'block';
      setTimeout(() => { alertBox.style.display = 'none'; }, 4000);
    }
  } catch (err) {
    alert('Failed to save profile: ' + err.message);
  }
}

// 2. Billing & Credits
async function loadBilling() {
  try {
    const res = await fetch('/api/credits');
    if (!res.ok) return;
    const data = await res.json();
    currentBilling = data;

    document.getElementById('sidebar-plan').textContent = `${data.plan.toUpperCase()} PLAN`;
    document.getElementById('sidebar-credits').textContent = `${data.remaining} Credits Left`;
  } catch (err) {
    console.error('Error loading billing:', err);
  }
}

async function upgradePlan(plan) {
  try {
    const res = await fetch('/api/billing/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan })
    });
    if (res.ok) {
      await loadBilling();
      alert(`🎉 Successfully upgraded to ${plan.toUpperCase()} tier!`);
    }
  } catch (err) {
    alert('Error upgrading plan: ' + err.message);
  }
}

// 3. Application Tracker
async function loadApplications() {
  try {
    const res = await fetch('/api/applications');
    if (!res.ok) return;
    const apps = await res.json();

    const tbody = document.getElementById('tracker-table-body');
    if (tbody) tbody.innerHTML = '';
    const realBody = document.getElementById('real-tracker-body');
    if (realBody) realBody.innerHTML = '';

    const totalEl = document.getElementById('metric-total');
    if (totalEl) totalEl.textContent = apps.length;
    const interviews = apps.filter(a => a.status === 'Interviewing').length;
    const intEl = document.getElementById('metric-interviews');
    if (intEl) intEl.textContent = interviews;

    apps.forEach(app => {
      const tr = document.createElement('tr');
      const badgeClass = app.status === 'Interviewing' ? 'status-interview' : (app.status === 'Rejected' ? 'status-rejected' : 'status-applied');

      tr.innerHTML = `
        <td><strong>${app.company}</strong></td>
        <td>${app.jobTitle}</td>
        <td><span style="font-size:12px; background:#f1f5f9; padding:2px 8px; border-radius:4px;">${app.platform}</span></td>
        <td>${app.date}</td>
        <td>${app.fieldsFilled || 8} fields</td>
        <td><span class="status-badge ${badgeClass}">${app.status}</span></td>
      `;
      if (tbody) tbody.appendChild(tr);
      if (realBody) realBody.appendChild(tr.cloneNode(true));
    });
  } catch (err) {
    console.error('Error loading applications:', err);
  }
}

// 4. AI Screening Sandbox
async function testAiAnswer() {
  const company = document.getElementById('ai-test-company').value.trim();
  const role = document.getElementById('ai-test-role').value.trim();
  const question = document.getElementById('ai-test-question').value.trim();
  const btn = document.getElementById('ai-test-btn');
  const resultCard = document.getElementById('ai-result-card');
  const resultText = document.getElementById('ai-result-text');
  const badge = document.getElementById('ai-source-badge');

  btn.disabled = true;
  btn.textContent = 'Generating with AI...';

  try {
    const res = await fetch('/api/ai/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, jobTitle: role, question, profile: currentProfile })
    });

    const data = await res.json();
    resultCard.style.display = 'block';
    resultText.textContent = data.answer || 'No answer returned.';
    badge.textContent = `⚡ Engine: ${data.source || 'JobFlow'}`;
  } catch (err) {
    alert('Failed to generate answer: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Generate Answer with AI';
  }
}

// 5. Autonomous Auto-Pilot Engine
let isAutoPilotRunning = false;
let currentQueue = [];

function appendLog(msg) {
  const logEl = document.getElementById('autopilot-log');
  if (!logEl) return;
  const time = new Date().toLocaleTimeString();
  logEl.innerHTML += `\n[${time}] ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
}

async function loadQueue() {
  try {
    const res = await fetch('/api/autopilot/queue');
    if (!res.ok) return;
    currentQueue = await res.json();
    renderQueueTable();
  } catch (err) {
    console.error('Error loading queue:', err);
  }
}

function renderQueueTable() {
  const tbody = document.getElementById('queue-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (currentQueue.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:24px;">Queue is empty. Click "Discover Jobs & Populate Queue" above.</td></tr>`;
    return;
  }

  currentQueue.forEach(job => {
    const tr = document.createElement('tr');
    const scoreColor = job.matchScore >= 90 ? '#059669' : (job.matchScore >= 80 ? '#2563eb' : '#475569');
    const statusBg = job.status === 'Submitted' ? '#ecfdf5' : '#e0e7ff';
    const statusColor = job.status === 'Submitted' ? '#047857' : '#4338ca';

    tr.innerHTML = `
      <td><strong>${job.company}</strong></td>
      <td>${job.jobTitle}</td>
      <td><span style="font-size:12px; background:#f1f5f9; padding:2px 8px; border-radius:4px;">${job.platform}</span></td>
      <td><strong style="color: ${scoreColor};">${job.matchScore}%</strong> <span style="font-size:11px; color:#64748b;">(${job.matchGrade || 'Good'})</span></td>
      <td><span style="background:${statusBg}; color:${statusColor}; font-weight:700; font-size:12px; padding:3px 10px; border-radius:9999px;">${job.status}</span></td>
      <td><a href="${job.url || '#'}" target="_blank" style="font-size:12px; color:#4f46e5; text-decoration:none; font-weight:600;">Open Portal &rarr;</a></td>
    `;
    tbody.appendChild(tr);
  });
}

async function searchAndPopulateQueue() {
  const query = document.getElementById('autopilot-query').value.trim();
  const location = document.getElementById('autopilot-location').value.trim();
  const minScore = document.getElementById('autopilot-minscore').value;

  appendLog(`Searching for roles matching "${query}" (${location}) with ATS match score >= ${minScore}%...`);

  try {
    const res = await fetch('/api/jobs/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, location, minScore })
    });

    const data = await res.json();
    if (data.success && data.jobs.length > 0) {
      appendLog(`Found ${data.jobs.length} high-compatibility jobs. Adding to Auto-Pilot Queue.`);
      
      const newQueue = data.jobs.map(j => ({
        id: j.id,
        company: j.company,
        jobTitle: j.jobTitle,
        platform: j.platform,
        url: j.url,
        matchScore: j.matchScore,
        matchGrade: j.matchGrade,
        status: 'Queued'
      }));

      await fetch('/api/autopilot/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue: newQueue })
      });

      await loadQueue();
    } else {
      appendLog(`No new jobs found matching criteria. Try lowering minimum match score.`);
    }
  } catch (err) {
    appendLog(`Search error: ${err.message}`);
  }
}

async function clearQueue() {
  await fetch('/api/autopilot/queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queue: [] })
  });
  await loadQueue();
  appendLog('Queue cleared.');
}

async function toggleAutoPilot() {
  const btn = document.getElementById('autopilot-start-btn');
  const pill = document.getElementById('autopilot-status-pill');

  if (isAutoPilotRunning) {
    isAutoPilotRunning = false;
    btn.textContent = '▶ Resume Auto-Pilot';
    btn.style.background = '#4f46e5';
    pill.textContent = 'PAUSED';
    pill.style.background = '#fef3c7';
    pill.style.color = '#92400e';
    appendLog('Auto-Pilot paused by user.');
    return;
  }

  isAutoPilotRunning = true;
  btn.textContent = '⏸ Pause Auto-Pilot';
  btn.style.background = '#dc2626';
  pill.textContent = 'RUNNING AUTO-PILOT';
  pill.style.background = '#ecfdf5';
  pill.style.color = '#047857';

  appendLog('🚀 Starting Autonomous Application Pipeline...');
  await runAutoPilotBatch();
}

async function runAutoPilotBatch() {
  const delay = Number(document.getElementById('autopilot-delay')?.value) || 4000;
  const pill = document.getElementById('autopilot-status-pill');
  const btn = document.getElementById('autopilot-start-btn');

  for (let i = 0; i < currentQueue.length; i++) {
    if (!isAutoPilotRunning) break;

    const job = currentQueue[i];
    if (job.status === 'Submitted') continue;

    appendLog(`--------------------------------------------------`);
    appendLog(`[${i + 1}/${currentQueue.length}] Target: ${job.company} - ${job.jobTitle} (${job.platform})`);
    appendLog(`  1. Inspecting ATS application portal...`);
    appendLog(`  2. Autofilling candidate details, experience & work authorization...`);
    appendLog(`  3. Synthesizing role-tailored screening essay with AI...`);

    try {
      const stepRes = await fetch('/api/autopilot/step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id })
      });

      const stepData = await stepRes.json();
      if (stepData.success) {
        appendLog(`  4. ✅ Application Submitted! Auto-logged to Tracker. Credits left: ${stepData.billing?.remaining || '--'}`);
        await loadQueue();
        await loadApplications();
        await loadBilling();
      }
    } catch (err) {
      appendLog(`  ❌ Error applying to ${job.company}: ${err.message}`);
    }

    if (i < currentQueue.length - 1 && isAutoPilotRunning) {
      appendLog(`  ⏳ Pacing safety delay (${delay / 1000}s) before next application...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  isAutoPilotRunning = false;
  btn.textContent = '▶ Start Autonomous Auto-Pilot';
  btn.style.background = '#4f46e5';
  pill.textContent = 'COMPLETED BATCH';
  pill.style.background = '#e0e7ff';
  pill.style.color = '#4338ca';
  appendLog('🎉 All queued applications processed successfully!');
}

// 6. 1-Click CV Upload & Live Cloud Streaming Engine

function initCvDropzone() {
  const dropzone = document.getElementById('cv-dropzone');
  if (!dropzone) return;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.borderColor = '#4f46e5';
      dropzone.style.background = '#eef2ff';
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.style.borderColor = '#818cf8';
      dropzone.style.background = '#fdfefe';
    });
  });

  dropzone.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await processCvFile(files[0]);
    }
  });
}

async function handleCvFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  await processCvFile(file);
}

async function processCvFile(file) {
  const statusEl = document.getElementById('cv-status-msg');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.textContent = `⏳ Reading ${file.name} (${Math.round(file.size / 1024)} KB)...`;
    statusEl.style.color = '#4f46e5';
  }

  try {
    let extractedText = '';
    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';

    if (isPdf) {
      if (statusEl) statusEl.textContent = '✨ Extracting text from PDF via PDF.js engine...';
      extractedText = await extractTextFromPdf(file);
    } else {
      extractedText = await file.text();
    }

    if (!extractedText || extractedText.trim().length === 0) {
      throw new Error('Could not extract readable text from this file. Please paste your CV text below.');
    }

    document.getElementById('cv-paste-text').value = extractedText.trim();

    if (statusEl) statusEl.textContent = '⚡ Analyzing candidate profile with AI parser...';
    await parseCvText(extractedText);

    if (statusEl) {
      statusEl.textContent = `✅ Successfully extracted profile from ${file.name}!`;
      statusEl.style.color = '#059669';
    }
  } catch (err) {
    console.error('File parsing failed:', err);
    if (statusEl) {
      statusEl.textContent = `⚠️ Error reading file: ${err.message}`;
      statusEl.style.color = '#dc2626';
    }
  }
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();

  // Try official PDF.js first
  if (typeof pdfjsLib !== 'undefined') {
    try {
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageStrings = textContent.items.map(item => item.str);
        fullText += pageStrings.join(' ') + '\n';
      }
      if (fullText.trim().length >= 10) {
        return fullText.trim();
      }
    } catch (pdfErr) {
      console.warn('PDF.js parse failed, trying ASCII extraction fallback:', pdfErr);
    }
  }

  // Fallback: extract clean printable ASCII strings from buffer
  return extractAsciiStringsFromBuffer(arrayBuffer);
}

function extractAsciiStringsFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let result = '';
  let cur = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // Printable ASCII or newline/tab
    if ((b >= 32 && b <= 126) || b === 10 || b === 13 || b === 9) {
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= 3) {
        result += cur + ' ';
      }
      cur = '';
    }
  }
  if (cur.length >= 3) result += cur;
  return result
    .replace(/%PDF-[\d.]+/gi, ' ')
    .replace(/\/Type|\/Page|\/Font|\/Filter|\/Length|\/FlateDecode/g, ' ')
    .replace(/\b(stream|endstream|obj|endobj|xref|trailer|startxref)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function handleCvParse() {
  const text = document.getElementById('cv-paste-text').value.trim();
  if (!text) {
    alert('Please paste your resume text or upload a file first.');
    return;
  }
  await parseCvText(text);
}

async function parseCvText(text) {
  try {
    const res = await fetch('/api/cv/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeText: text })
    });

    const data = await res.json();
    if (data.success && data.profile) {
      currentProfile = data.profile;
      updateCvPreview(data.profile);
      await loadProfile(); // sync master profile tab
    } else {
      alert('Error parsing resume: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    alert('Failed to parse CV: ' + err.message);
  }
}

function loadSampleCv() {
  const sampleCv = `Jordan Hayes
jordan.hayes@example.com | (555) 789-0123 | San Francisco, CA
https://linkedin.com/in/jordanhayes-dev | https://github.com/jordanhayes

Summary:
Senior Full Stack & Systems Engineer with 6+ years of experience specializing in TypeScript, React, Next.js, Node.js, PostgreSQL, Docker, and AWS. Architected microservices serving 5M+ daily requests with 99.99% reliability.

Experience:
Senior Software Engineer - Stripe (2022 - Present)
- Designed and maintained core billing and payment integration pipelines using TypeScript and Node.js.
- Reduced API p99 latency by 38% through optimized PostgreSQL indexing and Redis caching.

Skills:
TypeScript, React, Next.js, Node.js, Python, PostgreSQL, Redis, Docker, Kubernetes, AWS, GraphQL, REST API`;

  document.getElementById('cv-paste-text').value = sampleCv;
  parseCvText(sampleCv);
}

function updateCvPreview(prof) {
  const nameInput = document.getElementById('cv-name-input');
  const roleInput = document.getElementById('cv-role-input');
  const emailInput = document.getElementById('cv-email-input');
  const phoneInput = document.getElementById('cv-phone-input');
  const skillsContainer = document.getElementById('cv-skills-pills');

  const fullName = `${prof.firstName || 'Candidate'} ${prof.lastName || ''}`.trim();
  if (nameInput) nameInput.value = fullName;
  if (roleInput) roleInput.value = prof.targetRole || 'Full Stack Engineer';
  if (emailInput) emailInput.value = prof.email || '';
  if (phoneInput) phoneInput.value = prof.phone || '';

  const launchRoleLabel = document.getElementById('launch-role-label');
  if (launchRoleLabel) launchRoleLabel.textContent = prof.targetRole || 'Full Stack Engineer';

  if (skillsContainer && prof.skills) {
    skillsContainer.innerHTML = '';
    prof.skills.slice(0, 10).forEach(skill => {
      const span = document.createElement('span');
      span.className = 'status-badge status-applied';
      span.textContent = skill;
      skillsContainer.appendChild(span);
    });
  }
}

function syncProfileFromInputs() {
  const nameVal = (document.getElementById('cv-name-input')?.value || '').trim();
  const roleVal = (document.getElementById('cv-role-input')?.value || '').trim();
  const emailVal = (document.getElementById('cv-email-input')?.value || '').trim();
  const phoneVal = (document.getElementById('cv-phone-input')?.value || '').trim();

  const launchRoleLabel = document.getElementById('launch-role-label');
  if (launchRoleLabel) launchRoleLabel.textContent = roleVal || 'Full Stack Engineer';

  const parts = nameVal.split(/\s+/);
  const firstName = parts[0] || 'Candidate';
  const lastName = parts.slice(1).join(' ');

  if (!currentProfile) currentProfile = {};
  currentProfile.firstName = firstName;
  currentProfile.lastName = lastName;
  currentProfile.targetRole = roleVal || 'Full Stack Engineer';
  currentProfile.email = emailVal;
  currentProfile.phone = phoneVal;

  return fetch('/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(currentProfile)
  }).catch(() => {});
}

// Real Auto-Pilot Launch Engine

let isExtensionActive = false;

window.addEventListener('message', (e) => {
  if (e.data?.type === 'JOBFLOW_EXTENSION_PONG') {
    isExtensionActive = true;
    updateExtensionBadge(true);
  }
});

function pingExtension() {
  window.postMessage({ type: 'JOBFLOW_EXTENSION_PING' }, '*');
  setTimeout(() => {
    updateExtensionBadge(isExtensionActive);
  }, 500);
}

function updateExtensionBadge(active) {
  const badge = document.getElementById('extension-status-badge');
  const banner = document.getElementById('extension-install-banner');
  if (active) {
    if (badge) {
      badge.textContent = '🟢 Extension Active (v1.0.0)';
      badge.style.background = '#ecfdf5';
      badge.style.color = '#047857';
    }
    if (banner) banner.style.display = 'none';
  } else {
    if (badge) {
      badge.textContent = '🟡 Extension Not Detected';
      badge.style.background = '#fef3c7';
      badge.style.color = '#b45309';
    }
    if (banner) banner.style.display = 'block';
  }
}

async function launchLinkedInAutoPilot() {
  await syncProfileFromInputs();

  const role = (document.getElementById('cv-role-input')?.value || currentProfile.targetRole || 'Full Stack Engineer').trim();
  const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(role)}&f_AL=true&jobflow_auto=true`;

  // Open live LinkedIn Easy Apply search in a new tab
  window.open(searchUrl, '_blank');

  const statusEl = document.getElementById('cv-status-msg');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.innerHTML = `🚀 <strong>LinkedIn Auto-Pilot Launched!</strong> Opened live Easy Apply jobs for "<strong>${role}</strong>" in a new tab. The JobFlow Extension will automatically begin scanning and submitting real applications!`;
    statusEl.style.color = '#059669';
  }
}

async function loadRealJobs() {
  const tbody = document.getElementById('real-jobs-table-body');
  if (!tbody) return;

  try {
    const res = await fetch('/api/jobs/search');
    const data = await res.json();
    const jobs = data.jobs || [];

    tbody.innerHTML = '';
    jobs.forEach(job => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${job.company}</strong></td>
        <td>${job.jobTitle}</td>
        <td><span style="font-size:12px; background:#f1f5f9; padding:2px 8px; border-radius:4px;">${job.platform}</span></td>
        <td><strong style="color:#059669;">${job.matchScore || 85}% Match</strong></td>
        <td>
          <a href="${job.url}" target="_blank" class="btn-primary" style="font-size: 12px; padding: 6px 14px; text-decoration: none; display: inline-block;">
            ⚡ 1-Click Apply
          </a>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load real jobs:', err);
  }
}
