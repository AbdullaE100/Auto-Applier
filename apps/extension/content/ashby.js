/**
 * JobFlow AI - Ashby Form Handler
 * Matches and populates Ashby application pages (jobs.ashbyhq.com)
 */

window.JobFlowAshby = {
  detect() {
    return !!(
      window.location.hostname.includes('ashbyhq.com') ||
      document.querySelector('div[class*="AshbyApplicationForm"]') ||
      document.querySelector('form[class*="applicationForm"]')
    );
  },

  async autofill(profile, onProgress) {
    const core = window.JobFlowCore;
    let filledCount = 0;
    const form = document.querySelector('form') || document.body;

    const fields = [
      { keys: ['name', 'full name'], val: `${profile.firstName} ${profile.lastName}`.trim() },
      { keys: ['email'], val: profile.email },
      { keys: ['phone'], val: profile.phone },
      { keys: ['linkedin'], val: profile.linkedin },
      { keys: ['github'], val: profile.github },
      { keys: ['website', 'portfolio'], val: profile.portfolio }
    ];

    for (const f of fields) {
      if (!f.val) continue;
      const input = Array.from(form.querySelectorAll('input:not([type="hidden"])')).find(el => core.fieldMatches(el, f.keys));
      if (input && !input.value) {
        if (core.setInputValue(input, f.val)) {
          filledCount++;
          if (onProgress) onProgress(`Filled ${f.keys[0]}`);
        }
      }
    }

    return {
      success: true,
      count: filledCount,
      platform: 'Ashby'
    };
  }
};
