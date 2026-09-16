/**
 * JobFlow AI - LinkedIn Easy Apply Autonomous Controller
 * Provides 100% automated handling of LinkedIn Easy Apply modal workflows:
 * - Automatic MutationObserver modal detection
 * - In-modal real-time JobFlow Auto-Pilot HUD
 * - Smart multi-step field filling (contact, UAE/US country codes, phone numbers)
 * - Resume auto-selection
 * - Comprehensive screening questions (numerical skills, Yes/No radio buttons, dropdowns, essays)
 * - Auto-advancing (Next -> Review -> Submit)
 */

window.JobFlowLinkedIn = {
  isProcessingModal: false,
  autoAdvanceEnabled: true,
  autoSubmitEnabled: false,
  watcherInitialized: false,
  appliedCount: 0,
  isBatchRunning: false,
  currentModal: null,

  detect() {
    return window.location.hostname.includes('linkedin.com');
  },

  // Locates the Easy Apply modal if open
  findEasyApplyModal() {
    const selectors = [
      '.jobs-easy-apply-modal',
      'div[data-test-modal-id="easy-apply-modal"]',
      'div[data-live-test-easy-apply-modal]',
      'div.artdeco-modal[role="dialog"]',
      'div[role="dialog"]'
    ];

    for (const sel of selectors) {
      const elements = Array.from(document.querySelectorAll(sel));
      for (const el of elements) {
        // Confirm it's actually an Easy Apply modal
        const isEasyApply = 
          el.classList.contains('jobs-easy-apply-modal') ||
          el.querySelector('[data-easy-apply-next-button]') ||
          el.querySelector('button[aria-label*="Continue to next step"]') ||
          el.querySelector('button[aria-label*="Review your application"]') ||
          el.querySelector('button[aria-label*="Submit application"]') ||
          el.querySelector('.jobs-easy-apply-content') ||
          (el.querySelector('.artdeco-modal__header') && 
           (el.querySelector('.artdeco-modal__header').textContent || '').toLowerCase().includes('apply'));

        if (isEasyApply && (el.offsetParent !== null || window.getComputedStyle(el).display !== 'none')) {
          return el;
        }
      }
    }
    return null;
  },

  isModalOpen() {
    return Boolean(this.findEasyApplyModal());
  },

  // Locates the "Easy Apply" button on the background LinkedIn job posting
  findEasyApplyButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    const easyApplyBtn = buttons.find(btn => {
      const text = (btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const isVisible = btn.offsetParent !== null && !btn.disabled;
      return isVisible && (text.includes('easy apply') || aria.includes('easy apply'));
    });
    return easyApplyBtn || null;
  },

  // Initialize automatic modal observer on document.body
  initModalWatcher(profile) {
    if (this.watcherInitialized) return;
    this.watcherInitialized = true;
    console.log('[JobFlow LinkedIn] Initializing automatic Easy Apply modal watcher...');

    const checkAndProcess = async () => {
      const modal = this.findEasyApplyModal();
      if (modal && !this.isProcessingModal && !modal.getAttribute('data-jobflow-active')) {
        console.log('[JobFlow LinkedIn] Easy Apply modal detected! Launching Auto-Pilot...');
        let p = profile || window.JobFlowOverlay?.profile;
        if (!p) {
          const res = await window.JobFlowOverlay?.sendMessage({ type: 'GET_PROFILE' });
          p = res?.profile;
        }
        this.processModalFlow(modal, p);
      }
    };

    // 1. Observer for DOM changes
    const observer = new MutationObserver(() => {
      checkAndProcess();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 2. Periodic poll fallback
    setInterval(checkAndProcess, 800);
  },

  // Injects the in-modal Auto-Pilot HUD inside the Easy Apply modal dialog
  mountModalHUD(modal) {
    let hud = document.getElementById('jobflow-modal-hud');
    if (hud) {
      if (modal.contains(hud)) return hud;
      hud.remove();
    }

    hud = document.createElement('div');
    hud.id = 'jobflow-modal-hud';
    hud.style.cssText = `
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
      color: #ffffff;
      padding: 12px 16px;
      border-radius: 12px;
      margin: 12px 16px 8px 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.35);
      border: 1px solid #4338ca;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      position: relative;
      z-index: 99999;
      animation: jf-hud-slide-down 0.25s ease-out;
    `;

    hud.innerHTML = `
      <style>
        @keyframes jf-hud-slide-down {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes jf-pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        .jf-pulse-dot {
          width: 8px;
          height: 8px;
          background: #10b981;
          border-radius: 50%;
          display: inline-block;
          animation: jf-pulse-dot 1.5s infinite ease-in-out;
        }
      </style>
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="jf-pulse-dot"></span>
          <span style="font-weight: 800; font-size: 13px; letter-spacing: 0.3px; color: #ffffff;">JobFlow AI Auto-Pilot</span>
          <span id="jf-hud-step-badge" style="background: rgba(99, 102, 241, 0.25); color: #a5b4fc; border: 1px solid #6366f1; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600;">
            Initializing...
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <label style="display: flex; align-items: center; gap: 5px; font-size: 11px; color: #cbd5e1; cursor: pointer; user-select: none;">
            <input type="checkbox" id="jf-hud-auto-advance" checked style="cursor: pointer;">
            <span>Auto-Advance</span>
          </label>
          <button id="jf-hud-action-btn" style="background: #4f46e5; color: #ffffff; border: none; padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; transition: all 0.2s;">
            ⚡ Auto-Fill Step
          </button>
        </div>
      </div>
      <div id="jf-hud-status" style="font-size: 12px; color: #e2e8f0; display: flex; align-items: center; gap: 6px;">
        <span id="jf-hud-status-text">Ready to automate application...</span>
      </div>
    `;

    // Insert at top of modal content or header
    const header = modal.querySelector('.artdeco-modal__header') || modal.querySelector('h2') || modal.firstChild;
    if (header && header.parentNode) {
      header.parentNode.insertBefore(hud, header.nextSibling);
    } else {
      modal.prepend(hud);
    }

    // Connect HUD controls
    const advCheckbox = hud.querySelector('#jf-hud-auto-advance');
    if (advCheckbox) {
      advCheckbox.checked = this.autoAdvanceEnabled;
      advCheckbox.addEventListener('change', (e) => {
        this.autoAdvanceEnabled = e.target.checked;
        this.updateHUDStatus(`Auto-Advance: ${this.autoAdvanceEnabled ? 'ENABLED' : 'PAUSED'}`);
      });
    }

    const actionBtn = hud.querySelector('#jf-hud-action-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', () => {
        const p = window.JobFlowOverlay?.profile;
        this.fillCurrentModalStep(modal, p);
      });
    }

    return hud;
  },

  updateHUDStatus(text, stepLabel = null) {
    const hud = document.getElementById('jobflow-modal-hud');
    if (!hud) return;
    const statusText = hud.querySelector('#jf-hud-status-text');
    if (statusText) statusText.innerHTML = text;

    if (stepLabel) {
      const stepBadge = hud.querySelector('#jf-hud-step-badge');
      if (stepBadge) stepBadge.textContent = stepLabel;
    }
  },

  // Main autonomous multi-step processor
  async processModalFlow(modal, profile, options = { autoSubmit: false }) {
    if (this.isProcessingModal) return;
    this.isProcessingModal = true;
    modal.setAttribute('data-jobflow-active', 'true');

    this.mountModalHUD(modal);

    const maxSteps = 12;
    let stepCount = 0;
    let totalFilled = 0;

    try {
      while (stepCount < maxSteps) {
        stepCount++;
        if (!this.findEasyApplyModal()) break;

        this.updateHUDStatus(`Analyzing step ${stepCount} fields...`, `Step ${stepCount}`);
        await this.sleep(400);

        // 1. Fill fields in current step
        const filledInStep = this.fillCurrentModalStep(modal, profile);
        totalFilled += filledInStep;

        this.updateHUDStatus(`Filled <strong>${filledInStep}</strong> fields on this step (Total: ${totalFilled}).`, `Step ${stepCount}`);
        await this.sleep(600);

        // 2. Identify Navigation Buttons: Next, Review, Submit application
        const submitBtn = this.findButton(modal, ['submit application', 'submit']);
        const reviewBtn = this.findButton(modal, ['review your application', 'review']);
        const nextBtn = this.findButton(modal, ['continue to next step', 'next', 'continue']);

        // Case A: Submit button is present (Final Step)
        if (submitBtn) {
          this.updateHUDStatus(`🎉 All steps completed! Ready to submit.`, `Ready to Submit`);
          submitBtn.style.boxShadow = '0 0 0 4px #10b981, 0 10px 25px rgba(16, 185, 129, 0.4)';
          submitBtn.style.transition = 'all 0.3s ease';

          const actionBtn = document.getElementById('jf-hud-action-btn');
          if (actionBtn) {
            actionBtn.textContent = '🚀 Submit Application Now';
            actionBtn.style.background = '#10b981';
            actionBtn.onclick = () => {
              submitBtn.click();
              this.handlePostSubmit();
            };
          }

          if (options.autoSubmit || this.autoSubmitEnabled) {
            this.updateHUDStatus(`Submitting application automatically in 2s...`, `Submitting`);
            await this.sleep(1800);
            submitBtn.click();
            await this.handlePostSubmit();
            return { success: true, count: totalFilled, status: 'Submitted' };
          } else {
            return { success: true, count: totalFilled, status: 'Ready for Review' };
          }
        }

        // Case B: Review button is present
        if (reviewBtn) {
          if (this.autoAdvanceEnabled) {
            this.updateHUDStatus(`Advancing to application review...`, `Reviewing`);
            await this.sleep(700);
            reviewBtn.click();
            await this.sleep(1000);
            continue;
          } else {
            this.updateHUDStatus(`Step complete. Click <strong>Review</strong> or enable Auto-Advance to continue.`);
            break;
          }
        }

        // Case C: Next button is present
        if (nextBtn) {
          if (this.autoAdvanceEnabled) {
            this.updateHUDStatus(`Advancing to next step...`, `Step ${stepCount} Done`);
            await this.sleep(700);
            nextBtn.click();
            await this.sleep(1000);
            continue;
          } else {
            this.updateHUDStatus(`Step complete. Click <strong>Next</strong> or enable Auto-Advance to continue.`);
            break;
          }
        }

        // If no recognizable progression button exists, exit loop safely
        break;
      }
    } catch (err) {
      console.warn('[JobFlow LinkedIn] Auto-Pilot step notice:', err);
      this.updateHUDStatus(`Notice: ${err.message}`);
    } finally {
      this.isProcessingModal = false;
      modal.removeAttribute('data-jobflow-active');
    }

    return { success: true, count: totalFilled, platform: 'LinkedIn' };
  },

  // Helper to find specific buttons by text or aria-label
  findButton(container, textKeywords) {
    const buttons = Array.from(container.querySelectorAll('button'));
    return buttons.find(b => {
      const text = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const isVisible = b.offsetParent !== null && !b.disabled;
      return isVisible && textKeywords.some(kw => text.includes(kw) || aria.includes(kw));
    }) || null;
  },

  // Handles post-submit modal confirmation and dismisses dialog
  async handlePostSubmit() {
    this.updateHUDStatus(`✨ Application Submitted Successfully!`, `Submitted`);
    await this.sleep(1500);

    // Look for post-submission "Done" or "Dismiss" button
    const doneBtn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = (b.textContent || '').trim().toLowerCase();
      return t === 'done' || t.includes('dismiss');
    });

    if (doneBtn) {
      doneBtn.click();
    } else {
      this.closeDismissModal();
    }

    // Log application to SaaS tracker
    window.JobFlowOverlay?.sendMessage({
      type: 'LOG_APPLICATION',
      payload: {
        company: document.title.split('|')[0].trim() || 'LinkedIn Company',
        jobTitle: document.title.split('Jobs')[0].trim() || 'Software Engineer',
        platform: 'LinkedIn',
        url: window.location.href,
        status: 'Submitted'
      }
    });
  },

  // Comprehensive field autofill for the active modal step
  fillCurrentModalStep(modal, profile) {
    if (!profile) return 0;
    const core = window.JobFlowCore;
    let count = 0;

    // 1. Text, Email & Phone Inputs
    const textInputs = modal.querySelectorAll('input[type="text"], input[type="tel"], input[type="email"]');
    textInputs.forEach(input => {
      const label = core.getAssociatedLabelText(input);

      if (label.includes('first name') && profile.firstName) {
        if (!input.value && core.setInputValue(input, profile.firstName)) count++;
      } else if (label.includes('last name') && profile.lastName) {
        if (!input.value && core.setInputValue(input, profile.lastName)) count++;
      } else if (label.includes('email') && profile.email) {
        if (!input.value && core.setInputValue(input, profile.email)) count++;
      } else if (label.includes('phone') || label.includes('mobile')) {
        if (!input.value && profile.phone) {
          // If country code is handled by select, provide national number
          const nationalPhone = profile.phone.replace(/^\+971\s*/, '').replace(/^\+1\s*/, '').trim();
          if (core.setInputValue(input, nationalPhone || profile.phone)) count++;
        }
      } else if (label.includes('city') || label.includes('location')) {
        if (!input.value && profile.city) {
          if (core.setInputValue(input, profile.city)) {
            count++;
            // Handle LinkedIn city typeahead dropdown if present
            setTimeout(() => {
              const suggestion = modal.querySelector('.basic-typeahead__selectable-list li, div[role="listbox"] div');
              if (suggestion) suggestion.click();
            }, 300);
          }
        }
      }
    });

    // 2. Select Dropdowns (Country code, authorization, language, experience)
    const selects = modal.querySelectorAll('select');
    selects.forEach(sel => {
      const label = core.getAssociatedLabelText(sel);

      if (label.includes('country code') || label.includes('phone') || sel.id.includes('countryCode')) {
        // Match UAE (+971) or US (+1)
        const isUAE = (profile.phone && profile.phone.includes('+971')) || (profile.country && profile.country.includes('Emirates'));
        const target = isUAE ? '971' : '1';
        for (let i = 0; i < sel.options.length; i++) {
          const optText = sel.options[i].text.toLowerCase();
          if (optText.includes(target) || (isUAE && optText.includes('emirates'))) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            core.markFieldFilled(sel);
            count++;
            break;
          }
        }
      } else if (label.includes('email') && profile.email) {
        for (let i = 0; i < sel.options.length; i++) {
          if (sel.options[i].text.toLowerCase().includes(profile.email.toLowerCase())) {
            sel.selectedIndex = i;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            core.markFieldFilled(sel);
            count++;
            break;
          }
        }
      } else if (label.includes('authorized')) {
        if (core.setSelectValue(sel, profile.workAuthorized ? 'yes' : 'no')) count++;
      } else if (label.includes('sponsorship')) {
        if (core.setSelectValue(sel, profile.requireSponsorship ? 'yes' : 'no')) count++;
      } else if (label.includes('proficiency') || label.includes('language')) {
        if (core.setSelectValue(sel, 'professional') || core.setSelectValue(sel, 'fluent')) count++;
      }
    });

    // 3. Resume / Document Selection
    const resumeRadios = modal.querySelectorAll('input[type="radio"][name*="resume"], div[data-test-jobs-resume-item] input[type="radio"]');
    if (resumeRadios.length > 0) {
      const isChecked = Array.from(resumeRadios).some(r => r.checked);
      if (!isChecked) {
        resumeRadios[0].checked = true;
        resumeRadios[0].dispatchEvent(new Event('change', { bubbles: true }));
        resumeRadios[0].dispatchEvent(new Event('click', { bubbles: true }));
        core.markFieldFilled(resumeRadios[0]);
        count++;
      }
    }

    // 4. Numerical Screening Questions (e.g. "How many years of experience do you have with React?")
    const numInputs = modal.querySelectorAll('input[type="number"], input[id*="numeric"], input.ember-text-field');
    numInputs.forEach(input => {
      if (input.value) return;
      const label = core.getAssociatedLabelText(input);

      if (label.includes('years') || label.includes('experience') || label.includes('how many')) {
        const candidateSkills = (profile.skills || []).map(s => s.toLowerCase());
        const hasSkill = candidateSkills.some(s => label.includes(s));
        const val = hasSkill ? (profile.yearsExperience || 4) : 3;
        if (core.setInputValue(input, String(val))) count++;
      } else if (label.includes('notice') || label.includes('days')) {
        if (core.setInputValue(input, '30')) count++;
      } else if (label.includes('gpa')) {
        if (core.setInputValue(input, '3.8')) count++;
      }
    });

    // 5. Radio Buttons (Yes/No questions)
    const fieldsets = modal.querySelectorAll('fieldset');
    fieldsets.forEach(fieldset => {
      const legend = fieldset.querySelector('legend');
      const qText = (legend ? legend.textContent : '').toLowerCase();
      const radios = fieldset.querySelectorAll('input[type="radio"]');
      if (!radios.length) return;

      const isChecked = Array.from(radios).some(r => r.checked);
      if (isChecked) return;

      if (qText.includes('authorized to work') || qText.includes('legally authorized')) {
        const isAuth = profile.workAuthorized !== false;
        if (core.setRadioValue(radios, isAuth ? 'yes' : 'no')) count++;
      } else if (qText.includes('sponsorship') || qText.includes('visa')) {
        const needsSponsorship = profile.requireSponsorship === true;
        if (core.setRadioValue(radios, needsSponsorship ? 'yes' : 'no')) count++;
      } else if (qText.includes('comfortable') || qText.includes('willing') || qText.includes('commute') || qText.includes('hybrid') || qText.includes('on-site')) {
        if (core.setRadioValue(radios, 'yes')) count++;
      } else if (qText.includes('education') || qText.includes('degree') || qText.includes('background check') || qText.includes('license') || qText.includes('18 years')) {
        if (core.setRadioValue(radios, 'yes')) count++;
      } else {
        // Affirmative default for standard requirement inquiries
        if (core.setRadioValue(radios, 'yes')) count++;
      }
    });

    // 6. Checkboxes (Consent & Acknowledgements)
    const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
      if (cb.type === 'checkbox' && !cb.checked && cb.id !== 'jf-hud-auto-advance') {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        cb.dispatchEvent(new Event('click', { bubbles: true }));
        core.markFieldFilled(cb);
        count++;
      }
    });

    // 7. Open-ended Textareas
    const textareas = modal.querySelectorAll('textarea');
    textareas.forEach(ta => {
      if (!ta.value) {
        const skillsSnippet = (profile.skills || []).slice(0, 4).join(', ');
        ta.value = `With over ${profile.yearsExperience || 4}+ years of hands-on software engineering experience specializing in ${skillsSnippet}, I build resilient, high-performance systems and am excited to contribute to this role.`;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        core.markFieldFilled(ta);
        count++;
      }
    });

    return count;
  },

  closeDismissModal() {
    const dismissBtn = document.querySelector('button[aria-label="Dismiss"]') ||
                       document.querySelector('.artdeco-modal__dismiss');
    if (dismissBtn) dismissBtn.click();
    
    setTimeout(() => {
      const discardBtn = document.querySelector('button[data-control-name="discard_application_confirm_btn"]') ||
                         Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').toLowerCase().includes('discard'));
      if (discardBtn) discardBtn.click();
    }, 400);
  },

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // Main entry point called by overlay or user action
  async autoApply(profile, options = { autoSubmit: false }, onProgress) {
    if (!profile) return { success: false, message: 'Profile not loaded' };

    // Check if modal is already open
    let modal = this.findEasyApplyModal();
    if (modal) {
      if (onProgress) onProgress('Easy Apply modal detected! Processing steps...');
      return await this.processModalFlow(modal, profile, options);
    }

    // Otherwise find and click Easy Apply button
    const applyBtn = this.findEasyApplyButton();
    if (!applyBtn) {
      return { 
        success: false, 
        message: 'No "Easy Apply" button found on this job. It may require applying on an external company site.' 
      };
    }

    if (onProgress) onProgress('Clicking Easy Apply button...');
    applyBtn.click();
    await this.sleep(1200);

    modal = this.findEasyApplyModal();
    if (modal) {
      return await this.processModalFlow(modal, profile, options);
    }

    return { success: false, message: 'Could not open Easy Apply modal.' };
  },

  // --- AUTONOMOUS BATCH SEARCH RESULTS RUNNER ---
  mountBatchRunnerBar() {
    if (document.getElementById('jobflow-linkedin-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'jobflow-linkedin-bar';
    bar.style.cssText = `
      position: fixed;
      top: 60px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999999;
      background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
      color: #ffffff;
      padding: 10px 20px;
      border-radius: 9999px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      gap: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      border: 1px solid #4338ca;
    `;

    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; font-weight:700;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        <span>JobFlow LinkedIn Auto-Pilot</span>
      </div>
      <span id="jf-li-status" style="background:rgba(255,255,255,0.15); padding:3px 10px; border-radius:9999px; font-size:11px; font-weight:600;">Ready</span>
      <button id="jf-li-start-btn" style="background:#10b981; color:white; border:none; padding:6px 14px; border-radius:9999px; font-weight:700; font-size:12px; cursor:pointer;">
        ▶ Start Auto-Applying to Page
      </button>
      <button id="jf-li-stop-btn" style="display:none; background:#ef4444; color:white; border:none; padding:6px 14px; border-radius:9999px; font-weight:700; font-size:12px; cursor:pointer;">
        ⏹ Stop
      </button>
      <span id="jf-li-counter" style="font-size:12px; opacity:0.85;">Applied: 0</span>
    `;

    document.body.appendChild(bar);

    const startBtn = document.getElementById('jf-li-start-btn');
    const stopBtn = document.getElementById('jf-li-stop-btn');

    if (startBtn) startBtn.addEventListener('click', () => this.startBatchApplying());
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopBatchApplying());
  },

  async startBatchApplying() {
    this.isBatchRunning = true;
    const startBtn = document.getElementById('jf-li-start-btn');
    const stopBtn = document.getElementById('jf-li-stop-btn');
    const status = document.getElementById('jf-li-status');

    if (startBtn) startBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'inline-block';
    if (status) {
      status.textContent = 'Running...';
      status.style.background = '#065f46';
    }

    let profile = window.JobFlowOverlay?.profile;
    if (!profile) {
      const res = await window.JobFlowOverlay?.sendMessage({ type: 'GET_PROFILE' });
      profile = res?.profile;
    }

    const cards = Array.from(document.querySelectorAll('.jobs-search-results-list__list-item, .job-card-container, div[data-job-id]'));
    console.log(`[JobFlow LinkedIn] Found ${cards.length} job cards on current page.`);

    for (let i = 0; i < cards.length; i++) {
      if (!this.isBatchRunning) break;

      const card = cards[i];
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (status) status.textContent = `Job [${i + 1}/${cards.length}]: Loading...`;

      const clickTarget = card.querySelector('a, button, .job-card-list__title, .job-card-container__link') || card;
      clickTarget.click();
      await this.sleep(2000);

      const easyBtn = this.findEasyApplyButton();
      if (!easyBtn) {
        if (status) status.textContent = `Job [${i + 1}/${cards.length}]: External apply, skipping...`;
        await this.sleep(1000);
        continue;
      }

      if (status) status.textContent = `Job [${i + 1}/${cards.length}]: Auto-Filling & Submitting...`;

      try {
        const result = await this.autoApply(profile, { autoSubmit: true }, (stepMsg) => {
          if (status) status.textContent = stepMsg;
        });

        if (result.success && result.status === 'Submitted') {
          this.appliedCount++;
          const counter = document.getElementById('jf-li-counter');
          if (counter) counter.textContent = `Applied: ${this.appliedCount}`;
        }
      } catch (err) {
        console.warn('[JobFlow LinkedIn] Error applying to job:', err);
      }

      if (status) status.textContent = `Waiting 4s safety delay before next job...`;
      await this.sleep(4000);
    }

    this.stopBatchApplying();
    if (status) status.textContent = `Done! Applied to ${this.appliedCount} jobs.`;
  },

  stopBatchApplying() {
    this.isBatchRunning = false;
    const startBtn = document.getElementById('jf-li-start-btn');
    const stopBtn = document.getElementById('jf-li-stop-btn');
    const status = document.getElementById('jf-li-status');

    if (startBtn) startBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
    if (status) {
      status.textContent = 'Stopped';
      status.style.background = 'rgba(255,255,255,0.15)';
    }
  }
};

// Auto-boot when loaded on LinkedIn
if (window.location.hostname.includes('linkedin.com')) {
  setTimeout(() => {
    // 1. Start continuous modal watcher
    window.JobFlowLinkedIn.initModalWatcher();

    // 2. Mount top batch bar on LinkedIn Jobs search pages
    if (window.location.href.includes('/jobs')) {
      window.JobFlowLinkedIn.mountBatchRunnerBar();
    }

    // 3. Auto-start batch runner if launched via Dashboard Auto-Pilot
    const href = window.location.href || '';
    const search = window.location.search || '';
    if (href.includes('jobflow_auto=true') || search.includes('jobflow_auto')) {
      const status = document.getElementById('jf-li-status');
      if (status) {
        status.textContent = '🚀 Auto-Pilot Starting in 2s...';
        status.style.background = '#4f46e5';
      }
      setTimeout(() => {
        window.JobFlowLinkedIn.startBatchApplying();
      }, 2000);
    }
  }, 1000);
}
