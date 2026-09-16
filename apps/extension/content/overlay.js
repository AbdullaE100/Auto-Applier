/**
 * JobFlow AI - Floating Interactive Overlay Widget
 * Injected on ATS pages to provide 1-click autofill, live progress, and review safeguards.
 */

window.JobFlowOverlay = {
  activePlatform: null,
  profile: null,
  credits: null,

  async init() {
    // Handshake with JobFlow SaaS Dashboard
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      window.__JOBFLOW_EXTENSION_ACTIVE__ = true;
      window.postMessage({ type: 'JOBFLOW_EXTENSION_PONG', version: '1.0.0' }, '*');
      window.addEventListener('message', (e) => {
        if (e.data?.type === 'JOBFLOW_EXTENSION_PING') {
          window.postMessage({ type: 'JOBFLOW_EXTENSION_PONG', version: '1.0.0' }, '*');
        }
      });
      if (window.location.pathname.startsWith('/dashboard') || window.location.pathname === '/') {
        return; // Don't render ATS application widget on the dashboard
      }
    }

    // Detect active ATS platform
    if (window.JobFlowGreenhouse && window.JobFlowGreenhouse.detect()) {
      this.activePlatform = 'Greenhouse';
    } else if (window.JobFlowLever && window.JobFlowLever.detect()) {
      this.activePlatform = 'Lever';
    } else if (window.JobFlowAshby && window.JobFlowAshby.detect()) {
      this.activePlatform = 'Ashby';
    } else if (window.JobFlowLinkedIn && window.JobFlowLinkedIn.detect()) {
      this.activePlatform = 'LinkedIn';
    } else if (window.location.href.includes('/mock/')) {
      this.activePlatform = window.location.href.includes('lever') ? 'Lever' : 'Greenhouse';
    }

    if (!this.activePlatform) {
      // Check if page has general job application form attributes
      const form = document.querySelector('form');
      if (form && (document.querySelector('input[type="file"]') || document.querySelector('input[name*="resume"]'))) {
        this.activePlatform = 'Job Application';
      }
    }

    if (this.activePlatform) {
      this.renderWidget();
      await this.loadProfileAndCredits();

      // ZERO-CLICK AUTOFILL: Automatically runs on page load for ATS pages!
      setTimeout(async () => {
        if (this.activePlatform === 'LinkedIn') {
          if (window.JobFlowLinkedIn) {
            window.JobFlowLinkedIn.initModalWatcher(this.profile);
          }
        } else {
          await this.executeAutofill(false, true);
        }
      }, 500);
    }
  },

  showToast(message) {
    let toast = document.getElementById('jobflow-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'jobflow-toast';
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999999;
        background: #0f172a;
        color: #ffffff;
        padding: 12px 18px;
        border-radius: 12px;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
        border-left: 4px solid #10b981;
        transition: opacity 0.3s ease;
      `;
      document.body.appendChild(toast);
    }
    toast.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
      <span>${message}</span>
    `;
    setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
      }
    }, 5000);
  },

  async loadProfileAndCredits() {
    try {
      const response = await this.sendMessage({ type: 'GET_PROFILE' });
      if (response && response.success) {
        this.profile = response.profile;
        this.credits = response.credits;
        this.updateBadgeCredits();
      }
    } catch (err) {
      console.warn('[JobFlow] Backend connection notice:', err);
    }
  },

  sendMessage(msg) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(msg, (response) => {
          resolve(response || { success: false, error: 'No response from background worker' });
        });
      } else {
        // Direct fallback to localhost API if running outside extension context
        this.fallbackApiCall(msg).then(resolve);
      }
    });
  },

  async fallbackApiCall(msg) {
    try {
      if (msg.type === 'GET_PROFILE') {
        const res = await fetch('http://localhost:3000/api/profile');
        const credRes = await fetch('http://localhost:3000/api/credits');
        const profile = await res.json();
        const credits = await credRes.json();
        return { success: true, profile, credits };
      } else if (msg.type === 'GENERATE_ANSWER') {
        const res = await fetch('http://localhost:3000/api/ai/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.payload)
        });
        return await res.json();
      } else if (msg.type === 'LOG_APPLICATION') {
        const res = await fetch('http://localhost:3000/api/applications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.payload)
        });
        return await res.json();
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
    return { success: false };
  },

  async requestAiAnswer(payload) {
    const res = await this.sendMessage({
      type: 'GENERATE_ANSWER',
      payload: {
        ...payload,
        profile: this.profile
      }
    });
    return res;
  },

  renderWidget() {
    if (document.getElementById('jobflow-root')) return;

    const container = document.createElement('div');
    container.id = 'jobflow-root';
    container.innerHTML = `
      <div class="jobflow-badge" id="jobflow-trigger">
        <div class="jobflow-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
          </svg>
        </div>
        <div class="jobflow-label">
          <span class="jobflow-brand">JobFlow AI</span>
          <span class="jobflow-sub">${this.activePlatform} Detected</span>
        </div>
      </div>

      <div class="jobflow-panel" id="jobflow-panel" style="display: none;">
        <div class="jobflow-panel-header">
          <div class="jobflow-panel-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <span>JobFlow Copilot</span>
          </div>
          <button class="jobflow-close-btn" id="jobflow-close">&times;</button>
        </div>

        <div class="jobflow-panel-body">
          <div class="jobflow-status-card">
            <div class="jobflow-status-row">
              <span class="jobflow-status-text">Target: <strong>${this.activePlatform}</strong></span>
              <span class="jobflow-credits-pill" id="jobflow-credits">10 Credits</span>
            </div>
            <div class="jobflow-user-greet" id="jobflow-greet">Ready to auto-fill</div>
          </div>

          <div id="jobflow-progress-box" class="jobflow-progress-box" style="display: none;">
            <div class="jobflow-spinner"></div>
            <span id="jobflow-progress-text">Auto-filling form...</span>
          </div>

          <div class="jobflow-actions">
            <button class="jobflow-btn jobflow-btn-primary" id="jobflow-fill-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>1-Click Auto Fill</span>
            </button>

            <button class="jobflow-btn jobflow-btn-secondary" id="jobflow-ai-only-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <span>AI Answer Essays</span>
            </button>
          </div>

          <div class="jobflow-footer-links">
            <a href="http://localhost:3000/dashboard" target="_blank" class="jobflow-link">
              Edit Resume & Preferences &rarr;
            </a>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    // Event handlers
    const trigger = document.getElementById('jobflow-trigger');
    const panel = document.getElementById('jobflow-panel');
    const closeBtn = document.getElementById('jobflow-close');
    const fillBtn = document.getElementById('jobflow-fill-btn');
    const aiBtn = document.getElementById('jobflow-ai-only-btn');

    trigger.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });

    fillBtn.addEventListener('click', () => this.executeAutofill(false));
    aiBtn.addEventListener('click', () => this.executeAutofill(true));
  },

  updateBadgeCredits() {
    const credEl = document.getElementById('jobflow-credits');
    const greetEl = document.getElementById('jobflow-greet');
    if (this.credits && credEl) {
      credEl.textContent = `${this.credits.remaining} Credits (${this.credits.plan.toUpperCase()})`;
    }
    if (this.profile && greetEl && this.profile.firstName) {
      greetEl.textContent = `Applying as ${this.profile.firstName} ${this.profile.lastName}`;
    }
  },

  async executeAutofill(aiOnly = false) {
    const fillBtn = document.getElementById('jobflow-fill-btn');
    const progressBox = document.getElementById('jobflow-progress-box');
    const progressText = document.getElementById('jobflow-progress-text');

    fillBtn.disabled = true;
    progressBox.style.display = 'flex';
    progressText.textContent = 'Analyzing form structure...';

    // Ensure profile is loaded
    if (!this.profile) {
      await this.loadProfileAndCredits();
    }

    if (!this.profile) {
      progressText.textContent = 'Please configure your profile in Dashboard first!';
      fillBtn.disabled = false;
      return;
    }

    const onProgress = (msg) => {
      progressText.textContent = msg;
    };

    let result = { count: 0 };
    try {
      if (this.activePlatform === 'Greenhouse' && window.JobFlowGreenhouse) {
        result = await window.JobFlowGreenhouse.autofill(this.profile, onProgress);
      } else if (this.activePlatform === 'Lever' && window.JobFlowLever) {
        result = await window.JobFlowLever.autofill(this.profile, onProgress);
      } else if (this.activePlatform === 'Ashby' && window.JobFlowAshby) {
        result = await window.JobFlowAshby.autofill(this.profile, onProgress);
      } else if (this.activePlatform === 'LinkedIn' && window.JobFlowLinkedIn) {
        result = await window.JobFlowLinkedIn.autoApply(this.profile, { autoSubmit: false }, onProgress);
      } else {
        // Generic fallback
        result = await window.JobFlowGreenhouse.autofill(this.profile, onProgress);
      }

      progressText.innerHTML = `<strong>Done!</strong> Filled ${result.count} fields.<br><small style="color:#059669">Please review answers before clicking Submit.</small>`;
      if (result.count > 0) {
        this.showToast(`⚡ Auto-Filled ${result.count} fields with AI! Ready for review.`);
      }

      // Log application to tracker
      this.sendMessage({
        type: 'LOG_APPLICATION',
        payload: {
          company: document.title.split('-')[0].trim() || 'Target Company',
          jobTitle: document.title || 'Software Engineer',
          platform: this.activePlatform,
          url: window.location.href,
          fieldsFilled: result.count
        }
      });

    } catch (err) {
      progressText.textContent = `Autofill note: ${err.message}`;
    } finally {
      fillBtn.disabled = false;
    }
  }
};

// Auto-boot when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.JobFlowOverlay.init());
} else {
  window.JobFlowOverlay.init();
}
