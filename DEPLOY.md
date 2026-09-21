# Deploying JobFlow AI

Your Supabase project: **`ztthkncbktcndgypyazn`** (`https://ztthkncbktcndgypyazn.supabase.co`)

The whole setup takes about 30 minutes. Do the steps in order.

---

## 1. Database (5 min)

**Option A – SQL editor (easiest):**
1. Open Supabase Dashboard → **SQL Editor** → **New query**.
2. Paste all of `supabase/migrations/20260916000000_init.sql` and click **Run**.

**Option B – CLI:**
```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref ztthkncbktcndgypyazn   # asks for your database password
supabase db push
```

To check it worked, open **Table Editor**. You should see `profiles`, `applications`, `saved_answers`, `plans` (with 3 rows) and more. Under **Storage** you should see a private `cvs` bucket.

## 2. AI functions + OpenRouter key (5 min)

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-your-key
supabase secrets set OPENROUTER_MODEL=qwen/qwen3-30b-a3b-instruct-2507   # optional: any OpenRouter model ID
supabase secrets set APP_URL=https://your-domain.com
supabase functions deploy parse-cv
supabase functions deploy answer-question
```

The key is stored only on Supabase. It is never included in the extension or website.

## 3. Authentication (10 min)

Go to Supabase Dashboard → **Authentication**.

**Email sign-in codes.** Open **Emails → Templates → Magic Link** and replace the body with:
```html
<h2>Your JobFlow sign-in code</h2>
<p>Enter this code to sign in:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">{{ .Token }}</p>
<p>It expires in 1 hour. If you didn't request it, ignore this email.</p>
```
Also update the **Confirm signup** template the same way.

For real users, set up custom SMTP under **Emails → SMTP Settings** (for example Resend or Postmark). The built-in sender is rate-limited to a few emails an hour.

**URL configuration** (**Authentication → URL Configuration**):
- Site URL: `https://your-domain.com`
- Redirect URLs:
  - `https://your-domain.com/app.html`
  - `https://<EXTENSION-ID>.chromiumapp.org/auth` (see step 5 for the ID)

**Google sign-in (optional but recommended):**
1. In Google Cloud Console, create an OAuth client of type **Web application**.
2. Add this authorized redirect URI: `https://ztthkncbktcndgypyazn.supabase.co/auth/v1/callback`.
3. In Supabase, open **Authentication → Providers → Google**, turn it on, and paste the client ID and secret.

## 4. Configure and build (2 min)

```bash
cp .env.example .env
# Fill in SUPABASE_ANON_KEY (Settings → API → "anon public"), WEB_APP_URL, CHROME_STORE_URL, SUPPORT_EMAIL
npm install
npm run build
```

This writes `extension/config.js` and `web/config.js`, locks the extension's host permission to your project, and creates `dist/jobflow-extension-1.0.0.zip`.

> Until you publish, set `CHROME_STORE_URL` to any placeholder. Update it and rebuild once you have the listing URL.

## 5. Website (5 min)

Deploy the **`web/`** folder. It's static, with no build step.

- **Vercel:** `npx vercel web --prod` (or import the repo and set the Root Directory to `web`).
- **Netlify:** drag the `web/` folder onto app.netlify.com/drop, or `npx netlify deploy --dir web --prod`.

Security headers are already configured in `web/vercel.json` and `web/netlify.toml`.

## 6. Chrome Web Store

1. Pay the one-time developer fee at https://chrome.google.com/webstore/devconsole.
2. Click **New item** and upload `dist/jobflow-extension-1.0.0.zip`.
3. Copy the listing text, permission justifications and data disclosures from `store/LISTING.md`. Upload the images from `store/`.
4. Privacy policy URL: `https://your-domain.com/privacy.html`.
5. Once the item is created, copy its **extension ID**:
   - Add `https://<EXTENSION-ID>.chromiumapp.org/auth` to the Supabase redirect URLs (step 3).
   - Put the listing URL in `.env` as `CHROME_STORE_URL`, run `npm run build` again and redeploy `web/`.
6. Submit for review. It usually takes a few days.

**Tip:** to keep the extension ID the same while testing unpacked builds, copy the `key` from the Developer Dashboard (Package → Public key) into `extension/manifest.json` as `"key": "..."`.

## 7. Smoke test

1. Install the extension from the zip (Developer mode → Load unpacked on `extension/`). The onboarding tab should open.
2. Sign in with the email code, upload your CV, and finish the questions.
3. Open LinkedIn Jobs with the Easy Apply filter on and click **Start** on the JobFlow bar.
4. Open `https://your-domain.com/app.html` and confirm the application appears.

## Before launch

- [ ] Rotate the database password that was shared in chat (Settings → Database).
- [ ] Custom SMTP for auth emails.
- [ ] Have a lawyer review `web/privacy.html` and `web/terms.html` for the markets you sell in.
- [ ] In the OpenRouter dashboard, set a monthly spend limit on the key.
- [ ] Turn on Supabase **Point-in-time recovery** or daily backups.
