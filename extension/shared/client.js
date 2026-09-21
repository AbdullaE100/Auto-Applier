/* JobFlow AI - Supabase client + data API for extension pages and the service worker.
 * Requires: config.js, lib/supabase.js, shared/countries.js loaded first. */
(function (root) {
  const cfg = root.JOBFLOW_CONFIG || {};

  const chromeStorage = {
    async getItem(key) {
      const r = await chrome.storage.local.get(key);
      return r[key] ?? null;
    },
    async setItem(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },
    async removeItem(key) {
      await chrome.storage.local.remove(key);
    }
  };

  let client = null;
  function getClient() {
    if (!client) {
      if (!cfg.supabaseUrl || /YOUR-PROJECT/.test(cfg.supabaseUrl) || /YOUR-SUPABASE-ANON-KEY/.test(cfg.supabaseAnonKey)) {
        throw new Error('JobFlow is not configured yet (add your Supabase URL and anon key to config.js).');
      }
      client = root.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          storage: chromeStorage,
          storageKey: 'jobflow.auth',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce'
        }
      });
    }
    return client;
  }

  class ApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }

  // ------------------------------------------------------------ mapping
  function rowToProfile(row) {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email || '',
      firstName: row.first_name || '',
      lastName: row.last_name || '',
      phone: row.phone || '',
      phoneCountryCode: row.phone_country_code || '',
      city: row.city || '',
      country: row.country || '',
      nationality: row.nationality || '',
      headline: row.headline || '',
      currentTitle: row.current_title || '',
      currentCompany: row.current_company || '',
      yearsExperience: row.years_experience,
      skills: row.skills || [],
      summary: row.summary || '',
      linkedinUrl: row.linkedin_url || '',
      githubUrl: row.github_url || '',
      portfolioUrl: row.portfolio_url || '',
      experience: row.experience || [],
      education: row.education || [],
      cvPath: row.cv_path || '',
      cvFileName: row.cv_file_name || '',
      answers: row.answers || {},
      preferences: row.preferences || {},
      settings: root.JobFlowSettings ? root.JobFlowSettings.normalize(row.settings) : { mode: 'review', dailyLimit: 25, ...(row.settings || {}) },
      onboardingCompleted: Boolean(row.onboarding_completed),
      updatedAt: row.updated_at
    };
  }

  function profileToRow(p) {
    const out = {};
    const map = {
      email: 'email', firstName: 'first_name', lastName: 'last_name', phone: 'phone', phoneCountryCode: 'phone_country_code',
      city: 'city', country: 'country', nationality: 'nationality', headline: 'headline', currentTitle: 'current_title',
      currentCompany: 'current_company', yearsExperience: 'years_experience', skills: 'skills', summary: 'summary',
      linkedinUrl: 'linkedin_url', githubUrl: 'github_url', portfolioUrl: 'portfolio_url', experience: 'experience',
      education: 'education', cvPath: 'cv_path', cvFileName: 'cv_file_name', answers: 'answers', preferences: 'preferences',
      settings: 'settings', onboardingCompleted: 'onboarding_completed'
    };
    for (const [k, col] of Object.entries(map)) {
      if (p[k] !== undefined) out[col] = p[k] === '' ? null : p[k];
    }
    if (out.years_experience !== undefined && out.years_experience !== null) {
      const n = Math.round(Number(out.years_experience));
      out.years_experience = Number.isFinite(n) ? Math.min(Math.max(n, 0), 60) : null;
    }
    if (out.skills === null) out.skills = [];
    return out;
  }

  // --------------------------------------------------------------- API
  const Api = {
    getClient,
    ApiError,
    rowToProfile,
    profileToRow,

    async getSession() {
      const { data } = await getClient().auth.getSession();
      return data.session || null;
    },

    async signInWithEmail(email) {
      const { error } = await getClient().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw new ApiError(error.message, 'auth');
    },

    async verifyEmailCode(email, token) {
      const { data, error } = await getClient().auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw new ApiError('That code is not valid or has expired. Check the latest email or request a new code.', 'auth');
      return data.session;
    },

    /** Google sign-in through chrome.identity (extension pages only). */
    async signInWithGoogle() {
      const sb = getClient();
      const redirectTo = chrome.identity.getRedirectURL('auth');
      const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } }
      });
      if (error) throw new ApiError(error.message, 'auth');
      const resultUrl = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
      const url = new URL(resultUrl);
      const code = url.searchParams.get('code');
      if (!code) throw new ApiError(url.searchParams.get('error_description') || 'Google sign-in was cancelled.', 'auth');
      const { data: session, error: exErr } = await sb.auth.exchangeCodeForSession(code);
      if (exErr) throw new ApiError(exErr.message, 'auth');
      return session.session;
    },

    async signOut() {
      await getClient().auth.signOut();
    },

    async getProfile() {
      const session = await this.getSession();
      if (!session) return null;
      const { data, error } = await getClient().from('profiles').select('*').eq('id', session.user.id).maybeSingle();
      if (error) throw new ApiError(error.message, 'db');
      return rowToProfile(data) || { id: session.user.id, email: session.user.email, answers: {}, preferences: {}, settings: {} };
    },

    async saveProfile(partial) {
      const session = await this.getSession();
      if (!session) throw new ApiError('Please sign in again.', 'auth');
      const row = { id: session.user.id, ...profileToRow(partial) };
      const { data, error } = await getClient().from('profiles').upsert(row).select('*').single();
      if (error) throw new ApiError(error.message, 'db');
      return rowToProfile(data);
    },

    async uploadCv(file) {
      const session = await this.getSession();
      const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
      const path = `${session.user.id}/${Date.now()}_${safe}`;
      const { error } = await getClient().storage.from('cvs').upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (error) throw new ApiError(error.message, 'storage');
      return path;
    },

    async invoke(name, body) {
      const { data, error } = await getClient().functions.invoke(name, { body });
      if (error) {
        let message = error.message;
        let code = 'function';
        if (error.name === 'FunctionsFetchError') {
          message = `couldn't reach the JobFlow server (${error.context?.message || 'network error'}). Check your internet or VPN and try again`;
          code = 'network';
        }
        try {
          const ctx = await error.context?.json?.();
          if (ctx?.error) message = ctx.error;
          if (ctx?.code) code = ctx.code;
        } catch (_) { /* not JSON */ }
        throw new ApiError(message, code, error.context?.status);
      }
      return data;
    },

    parseCv(text) {
      return this.invoke('parse-cv', { text });
    },

    answerQuestion(payload) {
      return this.invoke('answer-question', payload);
    },

    async saveAnswer({ question, answer, options }) {
      const session = await this.getSession();
      if (!session) throw new ApiError('Please sign in again.', 'auth');
      const key = root.JobFlowAnswers ? root.JobFlowAnswers.normalizeQuestion(question) : String(question).toLowerCase().trim();
      const { error } = await getClient().from('saved_answers').upsert({
        user_id: session.user.id,
        question: String(question).slice(0, 1000),
        question_key: key,
        answer: answer == null ? null : String(answer).slice(0, 4000),
        options: options && options.length ? options : null,
        source: answer == null ? 'pending' : 'user'
      }, { onConflict: 'user_id,question_key', ignoreDuplicates: answer == null }); // never wipe an existing answer
      if (error) throw new ApiError(error.message, 'db');
    },

    /** Answers the user confirmed, keyed by normalized question. */
    async getUserAnswers() {
      const { data, error } = await getClient().from('saved_answers')
        .select('question_key, answer').eq('source', 'user').not('answer', 'is', null).limit(1000);
      if (error) throw new ApiError(error.message, 'db');
      return Object.fromEntries((data || []).map((r) => [r.question_key, r.answer]));
    },

    async downloadCv(path) {
      const { data, error } = await getClient().storage.from('cvs').download(path);
      if (error) throw new ApiError(error.message, 'storage');
      return data;
    },

    async getUsage() {
      const { data, error } = await getClient().rpc('get_usage');
      if (error) throw new ApiError(error.message, 'db');
      return data;
    },

    async countApplicationsToday() {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const { count, error } = await getClient()
        .from('applications').select('id', { count: 'exact', head: true }).gte('applied_at', start.toISOString());
      if (error) throw new ApiError(error.message, 'db');
      return count || 0;
    },

    async recordApplication(app) {
      const { data, error } = await getClient().rpc('record_application', {
        p_platform: app.platform,
        p_company: app.company || null,
        p_job_title: app.jobTitle || null,
        p_job_url: app.url || null,
        p_external_job_id: app.externalId || null,
        p_location: app.location || null,
        p_fields_filled: app.fieldsFilled || 0,
        p_ai_answers_used: app.aiAnswers || 0
      });
      if (error) {
        const limit = /credit_limit_reached/.test(error.message);
        throw new ApiError(limit ? 'You have used all applications in your plan this month.' : error.message, limit ? 'credit_limit_reached' : 'db');
      }
      return data;
    }
  };

  root.JobFlowApi = Api;
})(typeof self !== 'undefined' ? self : globalThis);
