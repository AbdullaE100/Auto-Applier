/* JobFlow AI - background service worker
 * The only place content scripts talk to the backend through. Keeps a short
 * cache of the user's profile so every page doesn't hit the database. */
importScripts('../config.js', '../lib/supabase.js', '../shared/countries.js', '../shared/questions.js', '../shared/answer-engine.js', '../shared/settings.js', '../shared/client.js');

const Api = self.JobFlowApi;
const CACHE_TTL_MS = 5 * 60 * 1000;
let contextCache = null; // { at, value }

function onboardingUrl(step) {
  return chrome.runtime.getURL(`onboarding/onboarding.html${step ? `#${step}` : ''}`);
}

const JOB_TAB_URLS = [
  'https://www.linkedin.com/*',
  'https://boards.greenhouse.io/*', 'https://job-boards.greenhouse.io/*', 'https://jobs.lever.co/*',
  'https://jobs.ashbyhq.com/*', 'https://apply.workable.com/*'
];

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: onboardingUrl() });
  }
  if (reason === 'update') refreshJobTabs();
  refreshBadge();
});

/** After an update, open job tabs still run the old, disconnected script: refresh them so nobody has to.
 * A tab that was mid-run picks the run up again after the refresh. */
async function refreshJobTabs() {
  try {
    const { batchLease: lease } = await chrome.storage.session.get('batchLease');
    if (lease?.tabId != null && Date.now() - lease.at < 3 * 60 * 1000) {
      await chrome.storage.local.set({ 'jobflow.resumeAfterUpdate': { tabId: lease.tabId, at: Date.now() } });
    }
    const tabs = await chrome.tabs.query({ url: JOB_TAB_URLS });
    for (const tab of tabs) {
      // LinkedIn tabs only on /jobs, and never a tab with a half-typed form on a career site
      if (/linkedin\.com/.test(tab.url || '') && !/linkedin\.com\/jobs/.test(tab.url || '')) continue;
      chrome.tabs.reload(tab.id).catch(() => {});
    }
  } catch (err) {
    console.warn('[JobFlow] could not refresh tabs after update', err);
  }
}

chrome.runtime.onStartup.addListener(refreshBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['jobflow.auth']) {
    contextCache = null;
    refreshBadge();
  }
});

let contextInFlight = null;

async function buildContext(force = false) {
  if (!force && contextCache && Date.now() - contextCache.at < CACHE_TTL_MS) return contextCache.value;
  if (contextInFlight) return contextInFlight;
  contextInFlight = loadContext().finally(() => { contextInFlight = null; });
  return contextInFlight;
}

async function loadContext() {

  let value;
  try {
    const session = await Api.getSession();
    if (!session) {
      value = { signedIn: false };
    } else {
      const [profile, usage, savedAnswers] = await Promise.all([
        Api.getProfile(),
        Api.getUsage().catch(() => null),
        Api.getUserAnswers().catch(() => ({}))
      ]);
      value = {
        signedIn: true,
        email: session.user.email,
        onboarded: Boolean(profile?.onboardingCompleted),
        profile,
        usage,
        savedAnswers
      };
    }
  } catch (err) {
    // Not cached: a network blip shouldn't sign the user out for five minutes
    return { signedIn: false, error: err.message };
  }
  contextCache = { at: Date.now(), value };
  return value;
}

async function refreshBadge() {
  const ctx = await buildContext(true);
  if (!ctx.signedIn) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#a15c07' });
    return;
  }
  if (!ctx.onboarded) {
    chrome.action.setBadgeText({ text: '…' });
    chrome.action.setBadgeBackgroundColor({ color: '#0f6e58' });
    return;
  }
  chrome.action.setBadgeText({ text: '' });
}

async function canApply() {
  const ctx = await buildContext();
  if (!ctx.signedIn) return { ok: false, reason: 'signed_out', message: 'Sign in to JobFlow first.' };
  if (!ctx.onboarded) return { ok: false, reason: 'not_onboarded', message: 'Finish setting up your profile first.' };
  const usage = await Api.getUsage();
  if (usage.remaining <= 0) {
    return { ok: false, reason: 'credit_limit_reached', message: `You've used all ${usage.monthlyLimit} applications this month.`, usage };
  }
  const s = self.JobFlowSettings.normalize(ctx.profile.settings);
  const limit = s.noDailyLimit ? null : s.dailyLimit;
  const today = await Api.countApplicationsToday();
  if (limit != null && today >= limit) {
    return { ok: false, reason: 'daily_limit', message: `Daily limit of ${limit} applications reached. Change it in settings.`, usage };
  }
  return { ok: true, usage, todayCount: today, dailyLimit: limit };
}

const handlers = {
  async GET_CONTEXT(payload) {
    return buildContext(Boolean(payload?.force));
  },

  async ANSWER_QUESTION(payload) {
    const ctx = await buildContext();
    if (!ctx.signedIn) return { answer: null, error: 'signed_out' };
    const res = await Api.answerQuestion(payload);
    return res;
  },

  async CAN_APPLY() {
    return canApply();
  },

  async RECORD_APPLICATION(payload) {
    const res = await Api.recordApplication(payload);
    if (contextCache?.value?.usage && res?.usage) contextCache.value.usage = res.usage;
    return res;
  },

  async SAVE_ANSWER(payload) {
    if (!payload?.question) return { ok: false };
    await Api.saveAnswer(payload);
    if (payload.answer != null && contextCache?.value?.savedAnswers) {
      contextCache.value.savedAnswers[self.JobFlowAnswers.normalizeQuestion(payload.question)] = String(payload.answer);
    }
    return { ok: true };
  },

  async GET_CV_FILE() {
    const ctx = await buildContext();
    const path = ctx.profile?.cvPath;
    if (!path) return null;
    const blob = await Api.downloadCv(path);
    if (blob.size > 10 * 1024 * 1024) return null;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { base64: btoa(binary), name: ctx.profile.cvFileName || 'CV.pdf', type: blob.type };
  },

  async SAVE_SETTINGS(payload) {
    const settings = self.JobFlowSettings.normalize(payload);
    await Api.saveProfile({ settings });
    contextCache = null;
    return { ok: true, settings };
  },

  // Only one LinkedIn tab may run a batch at a time (two tabs double the pace LinkedIn sees)
  async ACQUIRE_BATCH(_payload, sender) {
    const tabId = sender?.tab?.id;
    const { batchLease: lease } = await chrome.storage.session.get('batchLease');
    if (lease && lease.tabId !== tabId && Date.now() - lease.at < 90 * 1000) return { ok: false };
    await chrome.storage.session.set({ batchLease: { tabId, at: Date.now() } });
    // Memory Saver must not discard the tab while it's applying in the background
    if (tabId != null) chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => {});
    return { ok: true };
  },

  async RELEASE_BATCH(_payload, sender) {
    const { batchLease: lease } = await chrome.storage.session.get('batchLease');
    if (lease?.tabId === sender?.tab?.id) await chrome.storage.session.remove('batchLease');
    if (sender?.tab?.id != null) chrome.tabs.update(sender.tab.id, { autoDiscardable: true }).catch(() => {});
    return { ok: true };
  },

  async NOTIFY(payload, sender) {
    const tabId = sender?.tab?.id;
    chrome.notifications.create(`jobflow:${tabId ?? 'x'}:${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: String(payload?.title || 'JobFlow').slice(0, 80),
      message: String(payload?.message || '').slice(0, 240),
      priority: 2
    });
    return { ok: true };
  },

  async OPEN_SETTINGS() {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  },

  async OPEN_ONBOARDING(payload) {
    await chrome.tabs.create({ url: onboardingUrl(payload?.step) });
    return { ok: true };
  },

  async OPEN_DASHBOARD(payload) {
    const base = self.JOBFLOW_CONFIG.webAppUrl.replace(/\/$/, '');
    await chrome.tabs.create({ url: `${base}/app.html${payload?.tab ? `#${payload.tab}` : ''}` });
    return { ok: true };
  },

  /** Was this tab mid-run when the extension updated? (one-shot) */
  async SHOULD_RESUME(_payload, sender) {
    const key = 'jobflow.resumeAfterUpdate';
    const { [key]: r } = await chrome.storage.local.get(key);
    if (!r || r.tabId !== sender?.tab?.id) return { resume: false };
    await chrome.storage.local.remove(key);
    return { resume: Date.now() - r.at < 2 * 60 * 1000 };
  },

  async INVALIDATE() {
    contextCache = null;
    refreshBadge();
    return { ok: true };
  }
};

// Clicking a notification brings back the LinkedIn tab that sent it
chrome.notifications?.onClicked.addListener((id) => {
  const tabId = Number(String(id).split(':')[1]);
  if (!Number.isFinite(tabId)) return;
  chrome.tabs.update(tabId, { active: true }).then((tab) => chrome.windows.update(tab.windowId, { focused: true })).catch(() => {});
  chrome.notifications.clear(id);
});

// Unthrottled clock for content scripts running in background tabs (see Clock in content/linkedin.js)
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'jobflow-clock' || port.sender?.id !== chrome.runtime.id) return;
  const timers = new Set();
  port.onMessage.addListener((msg) => {
    const t = setTimeout(() => {
      timers.delete(t);
      try { port.postMessage({ id: msg?.id }); } catch (_) { /* tab went away */ }
    }, Math.max(0, Math.min(Number(msg?.ms) || 0, 25000)));
    timers.add(t);
  });
  port.onDisconnect.addListener(() => { timers.forEach(clearTimeout); timers.clear(); });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = handlers[request?.type];
  if (!handler) return false;
  // Only accept messages from our own extension (content scripts + pages)
  if (sender.id !== chrome.runtime.id) return false;

  handler(request.payload, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err.message, code: err.code || 'error' }));
  return true;
});
