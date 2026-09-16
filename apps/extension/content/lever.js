/**
 * JobFlow AI - Lever Form Handler
 * Matches and populates Lever application pages (jobs.lever.co)
 */

window.JobFlowLever = {
  detect() {
    return !!(
      window.location.hostname.includes('jobs.lever.co') ||
      document.querySelector('.application-form') ||
      document.querySelector('form#application-form') ||
      document.querySelector('.application-page')
    );
  },

  async autofill(profile, onProgress) {
    const core = window.JobFlowCore;
    let filledCount = 0;
    const form = document.querySelector('.application-form') || document.querySelector('form');
    if (!form) return { success: false, count: 0, message: 'Lever application form not found' };

    // 1. Full Name vs First/Last Name
    const fullNameInput = form.querySelector('input[name="name"]') || 
                          Array.from(form.querySelectorAll('input[type="text"]')).find(el => core.fieldMatches(el, ['full name', 'candidate name']));
    if (fullNameInput && !fullNameInput.value) {
      const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
      if (core.setInputValue(fullNameInput, fullName)) {
        filledCount++;
        if (onProgress) onProgress('Filled Full Name');
      }
    }

    // 2. Email & Phone
    const emailInput = form.querySelector('input[name="email"]') ||
                       Array.from(form.querySelectorAll('input[type="email"], input[type="text"]')).find(el => core.fieldMatches(el, ['email']));
    if (emailInput && !emailInput.value && profile.email) {
      if (core.setInputValue(emailInput, profile.email)) {
        filledCount++;
        if (onProgress) onProgress('Filled Email');
      }
    }

    const phoneInput = form.querySelector('input[name="phone"]') ||
                       Array.from(form.querySelectorAll('input[type="tel"], input[type="text"]')).find(el => core.fieldMatches(el, ['phone']));
    if (phoneInput && !phoneInput.value && profile.phone) {
      if (core.setInputValue(phoneInput, profile.phone)) {
        filledCount++;
        if (onProgress) onProgress('Filled Phone');
      }
    }

    // 3. Current Company / Organization
    const currentCompanyInput = form.querySelector('input[name="org"]') ||
                                Array.from(form.querySelectorAll('input[type="text"]')).find(el => core.fieldMatches(el, ['current company', 'current employer', 'org']));
    if (currentCompanyInput && !currentCompanyInput.value && profile.currentCompany) {
      if (core.setInputValue(currentCompanyInput, profile.currentCompany)) {
        filledCount++;
        if (onProgress) onProgress('Filled Current Company');
      }
    }

    // 4. Social / Portfolio URLs
    const urlInputs = form.querySelectorAll('input[name*="urls"], input[name*="link"]');
    for (const input of urlInputs) {
      const nameAttr = (input.getAttribute('name') || '').toLowerCase();
      const label = core.getAssociatedLabelText(input);

      if ((nameAttr.includes('linkedin') || label.includes('linkedin')) && profile.linkedin) {
        if (core.setInputValue(input, profile.linkedin)) filledCount++;
      } else if ((nameAttr.includes('github') || label.includes('github')) && profile.github) {
        if (core.setInputValue(input, profile.github)) filledCount++;
      } else if ((nameAttr.includes('portfolio') || nameAttr.includes('other') || label.includes('portfolio') || label.includes('website')) && profile.portfolio) {
        if (core.setInputValue(input, profile.portfolio)) filledCount++;
      }
    }

    // 5. Custom Questions / Textareas (Handled by AI)
    const textareas = form.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.value.trim().length > 0) continue;

      const questionText = core.getAssociatedLabelText(ta);
      if (questionText.length > 5) {
        if (onProgress) onProgress(`Generating AI response for: "${questionText.slice(0, 30)}..."`);
        try {
          const path = (typeof window !== 'undefined' && window.location && window.location.pathname) ? window.location.pathname : '';
          const aiResponse = await window.JobFlowOverlay.requestAiAnswer({
            question: questionText,
            jobTitle: (typeof document !== 'undefined' && document.title) ? document.title : 'Target Role',
            company: path ? path.split('/')[1] || 'Company' : 'Company'
          });

          if (aiResponse && aiResponse.answer) {
            core.setInputValue(ta, aiResponse.answer);
            filledCount++;
            if (onProgress) onProgress('Filled screening answer');
          }
        } catch (err) {
          console.warn('[JobFlow] AI generation skipped:', err);
        }
      }
    }

    // 6. Radio / Dropdown Custom Questions
    const questions = form.querySelectorAll('.application-question, .custom-question');
    for (const q of questions) {
      const qText = q.textContent.toLowerCase();
      if (qText.includes('authorized to work') || qText.includes('legally authorized')) {
        const radios = q.querySelectorAll('input[type="radio"]');
        if (radios.length) core.setRadioValue(radios, profile.workAuthorized ? 'yes' : 'no');
      } else if (qText.includes('sponsorship')) {
        const radios = q.querySelectorAll('input[type="radio"]');
        if (radios.length) core.setRadioValue(radios, profile.requireSponsorship ? 'yes' : 'no');
      }
    }

    return {
      success: true,
      count: filledCount,
      platform: 'Lever'
    };
  }
};
