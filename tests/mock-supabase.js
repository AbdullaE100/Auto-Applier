/* Minimal in-memory Supabase mock for UI tests (auth, PostgREST, storage, functions). */
const http = require('node:http');
const crypto = require('node:crypto');

function createMock({ port = 54321 } = {}) {
  const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@jobflow.dev', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  const db = {
    profiles: [],
    applications: [],
    saved_answers: [],
    plans: [
      { id: 'free', name: 'Free', monthly_applications: 30, daily_ai_answers: 40, price_cents: 0, is_public: true, sort_order: 0 },
      { id: 'pro', name: 'Pro', monthly_applications: 300, daily_ai_answers: 400, price_cents: 2900, is_public: true, sort_order: 1 }
    ],
    waitlist: [],
    files: {}
  };
  const log = [];

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = () => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const session = () => ({ access_token: jwt(), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-token', user });

  function usage() {
    const used = db.applications.length;
    return { plan: 'free', planName: 'Free', status: 'active', monthlyLimit: 30, used, remaining: 30 - used, periodStart: new Date().toISOString(), periodEnd: new Date(Date.now() + 20 * 864e5).toISOString(), aiDailyLimit: 40, aiUsedToday: 3 };
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,HEAD,OPTIONS,PUT',
      'Access-Control-Expose-Headers': 'Content-Range, content-range',
      ...headers
    });
    res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
  }

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    let body = {};
    try { body = raw.length ? JSON.parse(raw.toString()) : {}; } catch (_) { body = raw; }
    log.push(`${req.method} ${url.pathname}`);
    const p = url.pathname;

    // ---- auth
    if (p === '/auth/v1/otp') return send(res, 200, {});
    if (p === '/auth/v1/verify') return body.token === '123456' ? send(res, 200, session()) : send(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    if (p === '/auth/v1/token') return send(res, 200, session());
    if (p === '/auth/v1/user') return send(res, 200, user);
    if (p === '/auth/v1/logout') return send(res, 204);

    // ---- functions
    if (p === '/functions/v1/parse-cv') {
      return send(res, 200, { profile: { firstName: 'Abdulla', lastName: 'Ehsan', email: 'abdulla@example.com', phone: '+971 55 118 0792', city: 'Dubai', country: 'AE', headline: 'AI Engineer', currentTitle: 'AI Engineer', currentCompany: 'BNESIM', yearsExperience: 2, skills: ['Python', 'LangChain', 'Node.js', 'SQL'], summary: 'AI engineer building agents and data pipelines.', linkedinUrl: 'https://linkedin.com/in/abdulla', githubUrl: null, portfolioUrl: null, experience: [], education: [] } });
    }
    if (p === '/functions/v1/answer-question') {
      const q = String(body.question || '');
      if (/kubernetes/i.test(q)) return send(res, 200, { answer: null, source: 'ai', needsUser: true });
      if (body.options?.length) return send(res, 200, { answer: body.options[0], source: 'ai' });
      return send(res, 200, { answer: body.fieldType === 'number' ? '1' : `AI answer for: ${q.slice(0, 30)}`, source: 'ai' });
    }

    // ---- storage
    if (p.startsWith('/storage/v1/object/')) {
      const key = p.replace(/^\/storage\/v1\/object\/(authenticated\/)?/, '');
      if (req.method === 'POST' || req.method === 'PUT') { db.files[key] = raw; return send(res, 200, { Key: key, Id: crypto.randomUUID() }); }
      if (db.files[key]) { res.writeHead(200, { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' }); return res.end(db.files[key]); }
      return send(res, 404, { error: 'not found' });
    }

    // ---- rpc
    if (p === '/rest/v1/rpc/get_usage') return send(res, 200, usage());
    if (p === '/rest/v1/rpc/record_application') {
      if (db.applications.some((a) => a.external_job_id === body.p_external_job_id)) return send(res, 200, { duplicate: true, usage: usage() });
      db.applications.unshift({ id: crypto.randomUUID(), user_id: user.id, platform: body.p_platform, company: body.p_company, job_title: body.p_job_title, job_url: body.p_job_url, external_job_id: body.p_external_job_id, location: body.p_location, status: 'submitted', fields_filled: body.p_fields_filled, ai_answers_used: body.p_ai_answers_used, applied_at: new Date().toISOString() });
      return send(res, 200, { id: db.applications[0].id, duplicate: false, usage: usage() });
    }

    // ---- tables
    const m = p.match(/^\/rest\/v1\/(\w+)$/);
    if (m && db[m[1]]) {
      const table = db[m[1]];
      const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
      if (req.method === 'GET' || req.method === 'HEAD') {
        let rows = [...table];
        for (const [k, v] of url.searchParams) {
          if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
          const [op, val] = v.split(/\.(.*)/s);
          if (op === 'eq') rows = rows.filter((r) => String(r[k]) === val);
          if (op === 'gte') rows = rows.filter((r) => String(r[k]) >= val);
        }
        const headers = { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` };
        if (req.method === 'HEAD') return send(res, 200, undefined, headers);
        if (single) return rows[0] ? send(res, 200, rows[0], headers) : send(res, 406, { code: 'PGRST116', message: 'no rows' });
        return send(res, 200, rows, headers);
      }
      if (req.method === 'POST') {
        const items = Array.isArray(body) ? body : [body];
        const out = items.map((item) => {
          const conflictCols = (url.searchParams.get('on_conflict') || 'id').split(',');
          const existing = table.find((r) => conflictCols.every((c) => r[c] !== undefined && r[c] === item[c]));
          if (existing) { Object.assign(existing, item, { updated_at: new Date().toISOString() }); return existing; }
          const row = { id: item.id || crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), answers: {}, preferences: {}, settings: {}, skills: [], ...item };
          table.push(row);
          return row;
        });
        return single ? send(res, 201, out[0]) : send(res, 201, out);
      }
      if (req.method === 'PATCH') {
        let rows = table;
        for (const [k, v] of url.searchParams) {
          const [op, val] = v.split(/\.(.*)/s);
          if (op === 'eq') rows = rows.filter((r) => String(r[k]) === val);
        }
        rows.forEach((r) => Object.assign(r, body));
        return send(res, 200, single ? rows[0] : rows);
      }
      if (req.method === 'DELETE') {
        for (const [k, v] of url.searchParams) {
          const [op, val] = v.split(/\.(.*)/s);
          if (op === 'eq') db[m[1]] = table.filter((r) => String(r[k]) !== val);
        }
        return send(res, 204);
      }
    }
    return send(res, 404, { message: `mock: no route ${req.method} ${p}` });
  });

  return {
    db, log, user,
    listen: () => new Promise((r) => server.listen(port, '127.0.0.1', r)),
    close: () => new Promise((r) => server.close(r))
  };
}

module.exports = { createMock };
if (require.main === module) createMock().listen().then(() => console.log('mock supabase on :54321'));
