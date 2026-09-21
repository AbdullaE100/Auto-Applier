/* JobFlow AI web - Supabase client shared by login and dashboard */
(function () {
  const cfg = window.JOBFLOW_CONFIG;
  if (!cfg || /YOUR-SUPABASE-ANON-KEY/.test(cfg.supabaseAnonKey)) {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.insertAdjacentHTML('afterbegin', '<div class="alert alert-error" style="margin:12px">Set supabaseAnonKey in web/config.js to enable sign-in.</div>');
    });
  }
  window.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'jobflow.web.auth' }
  });

  window.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.toast = (message) => {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.hidden = false;
    clearTimeout(window.toast.t);
    window.toast.t = setTimeout(() => { el.hidden = true; }, 3000);
  };
})();
