/* JobFlow AI - content-script bridge to the service worker */
(function () {
  if (window.JobFlowBridge) return;

  const Questions = window.JobFlowQuestions;
  let cache = null;

  async function send(type, payload) {
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type, payload });
    } catch (err) {
      // Happens after the extension is reloaded while the page stays open
      const e = new Error('JobFlow was updated. Refresh this page to continue.');
      e.code = 'extension_reloaded';
      throw e;
    }
    if (!res?.ok) {
      const e = new Error(res?.error || 'JobFlow error');
      e.code = res?.code || 'error';
      throw e;
    }
    return res.data;
  }

  /** Profile with convenience aliases used by the form handlers. */
  function augment(profile) {
    if (!profile) return null;
    const ctx = { country: profile.country, city: profile.city, answers: profile.answers || {} };
    const home = Questions ? Questions.eligibilityFor(null, ctx) : { authorized: true, sponsorship: false };
    return {
      ...profile,
      linkedin: profile.linkedinUrl,
      github: profile.githubUrl,
      portfolio: profile.portfolioUrl,
      fullPhone: profile.phone ? `+${profile.phoneCountryCode || ''} ${profile.phone}`.trim() : '',
      workAuthorized: home.authorized,
      requireSponsorship: home.sponsorship
    };
  }

  window.JobFlowBridge = {
    send,

    async getContext(force = false) {
      if (!force && cache && Date.now() - cache.at < 60_000) return cache.value;
      const value = await send('GET_CONTEXT', { force });
      if (value?.profile) value.profile = augment(value.profile);
      cache = { at: Date.now(), value };
      return value;
    },

    invalidate() {
      cache = null;
    },

    async answerWithAI({ question, fieldType, options, maxLength, job }) {
      try {
        return await send('ANSWER_QUESTION', { question, fieldType, options, maxLength, job });
      } catch (err) {
        return { answer: null, error: err.message, code: err.code };
      }
    },

    saveAnswer(question, answer, options) {
      return send('SAVE_ANSWER', { question, answer, options }).catch(() => null);
    },

    canApply() {
      return send('CAN_APPLY');
    },

    recordApplication(app) {
      return send('RECORD_APPLICATION', app);
    },

    openOnboarding(step) {
      return send('OPEN_ONBOARDING', { step }).catch(() => null);
    },

    async getCvFile() {
      const data = await send('GET_CV_FILE').catch(() => null);
      if (!data?.base64) return null;
      const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
      return new File([bytes], data.name, { type: data.type || 'application/pdf' });
    }
  };
})();
