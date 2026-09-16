/**
 * JobFlow AI - Background Service Worker
 * Mediates API requests between injected content scripts and the SaaS backend.
 */

const API_BASE = 'http://localhost:3000';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[JobFlow AI] Extension installed successfully.');
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_PROFILE') {
    fetchProfileAndCredits()
      .then(data => sendResponse({ success: true, ...data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (request.type === 'GENERATE_ANSWER') {
    fetch(`${API_BASE}/api/ai/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload)
    })
      .then(res => res.json())
      .then(data => sendResponse({ success: true, ...data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.type === 'LOG_APPLICATION') {
    fetch(`${API_BASE}/api/applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload)
    })
      .then(res => res.json())
      .then(data => {
        updateBadge();
        sendResponse({ success: true, ...data });
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function fetchProfileAndCredits() {
  const [profileRes, creditsRes] = await Promise.all([
    fetch(`${API_BASE}/api/profile`),
    fetch(`${API_BASE}/api/credits`)
  ]);

  const profile = await profileRes.json();
  const credits = await creditsRes.json();
  return { profile, credits };
}

async function updateBadge() {
  try {
    const res = await fetch(`${API_BASE}/api/credits`);
    const data = await res.json();
    if (data && data.remaining !== undefined) {
      chrome.action.setBadgeText({ text: String(data.remaining) });
      chrome.action.setBadgeBackgroundColor({ color: '#4f46e5' });
    }
  } catch {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#94a3b8' });
  }
}
