/**
 * JobFlow AI - Greenhouse Form Handler
 * Matches and populates Greenhouse application forms (boards.greenhouse.io & embeds)
 */

window.JobFlowGreenhouse = {
  detect() {
    return !!(
      document.querySelector('#application_form') ||
      document.querySelector('#main.greenhouse-app') ||
      window.location.hostname.includes('greenhouse.io') ||
      document.querySelector('form[action*="greenhouse.io"]')
    );
  },

  async autofill(profile, onProgress) {
    const core = window.JobFlowCore;
    let filledCount = 0;
    const form = document.querySelector('#application_form') || document.querySelector('form');
    if (!form) return { success: false, count: 0, message: 'Application form not found' };

    // 1. Standard Personal Info
    const standardFields = [
      { keys: ['first_name', 'firstname', 'first name'], val: profile.firstName },
      { keys: ['last_name', 'lastname', 'last name'], val: profile.lastName },
      { keys: ['email', 'e-mail'], val: profile.email },
      { keys: ['phone', 'telephone', 'mobile'], val: profile.phone }
    ];

    for (const sf of standardFields) {
      if (!sf.val) continue;
      const input = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="file"])')).find(el => core.fieldMatches(el, sf.keys));
      if (input && !input.value) {
        if (core.setInputValue(input, sf.val)) {
          filledCount++;
          if (onProgress) onProgress(`Filled ${sf.keys[0]}`);
        }
      }
    }

    // 2. URLs / Social Links (LinkedIn, GitHub, Portfolio)
    const urlFields = [
      { keys: ['linkedin', 'linked in'], val: profile.linkedin },
      { keys: ['github', 'git hub'], val: profile.github },
      { keys: ['portfolio', 'website', 'personal site'], val: profile.portfolio }
    ];

    for (const uf of urlFields) {
      if (!uf.val) continue;
      const input = Array.from(form.querySelectorAll('input[type="text"], input[type="url"]')).find(el => core.fieldMatches(el, uf.keys));
      if (input && !input.value) {
        if (core.setInputValue(input, uf.val)) {
          filledCount++;
          if (onProgress) onProgress(`Filled ${uf.keys[0]}`);
        }
      }
    }

    // 3. Work Authorization & Sponsorship (Select dropdowns & Radios)
    const selectElements = form.querySelectorAll('select');
    for (const sel of selectElements) {
      const labelText = core.getAssociatedLabelText(sel);

      // Work authorization
      if (labelText.includes('authorized to work') || labelText.includes('legally authorized') || labelText.includes('work authorization')) {
        const val = profile.workAuthorized ? 'yes' : 'no';
        if (core.setSelectValue(sel, val)) {
          filledCount++;
          if (onProgress) onProgress('Filled work authorization');
        }
      }
      // Sponsorship requirement
      else if (labelText.includes('sponsorship') || labelText.includes('visa')) {
        const val = profile.requireSponsorship ? 'yes' : 'no';
        if (core.setSelectValue(sel, val)) {
          filledCount++;
          if (onProgress) onProgress('Filled visa sponsorship');
        }
      }
      // Years of experience
      else if (labelText.includes('years of experience') || labelText.includes('experience level')) {
        if (core.setSelectValue(sel, String(profile.yearsExperience))) {
          filledCount++;
          if (onProgress) onProgress('Filled years of experience');
        }
      }
    }

    // 4. Number inputs (e.g. Years of Experience)
    const numberInputs = form.querySelectorAll('input[type="number"]');
    for (const numInput of numberInputs) {
      const label = core.getAssociatedLabelText(numInput);
      if (label.includes('years') || label.includes('experience')) {
        if (core.setInputValue(numInput, profile.yearsExperience)) {
          filledCount++;
        }
      }
    }

    // 5. Open-ended Textareas (Screening Questions handled via AI)
    const textareas = form.querySelectorAll('textarea');
    for (const ta of textareas) {
      if (ta.value.trim().length > 0) continue; // don't overwrite if already filled

      const questionText = core.getAssociatedLabelText(ta);
      if (questionText.length > 5) {
        if (onProgress) onProgress(`Synthesizing answer for: "${questionText.slice(0, 30)}..."`);
        
        try {
          const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
          const aiResponse = await window.JobFlowOverlay.requestAiAnswer({
            question: questionText,
            jobTitle: (typeof document !== 'undefined' && document.title) ? document.title : 'Target Role',
            company: host ? host.split('.')[0] : 'Company'
          });

          if (aiResponse && aiResponse.answer) {
            core.setInputValue(ta, aiResponse.answer);
            filledCount++;
            if (onProgress) onProgress(`Answered screening question`);
          }
        } catch (err) {
          console.warn('[JobFlow] AI generation skipped for field:', err);
        }
      }
    }

    return {
      success: true,
      count: filledCount,
      platform: 'Greenhouse'
    };
  }
};
