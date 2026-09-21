# JobFlow AI

Job-application autofill SaaS: a Chrome extension plus a web dashboard, backed by Supabase and OpenRouter.

- **Extension** (`extension/`): onboarding (sign-in, CV upload, location-aware multiple-choice questionnaire, preferences, auto-apply settings), toolbar popup, LinkedIn Easy Apply autopilot, and one-click autofill on Greenhouse, Lever, Ashby and Workable.
- **Web app** (`web/`): landing page, sign-in, dashboard (overview, application tracker, saved answers, profile, plan & usage, settings), privacy policy and terms. Plain static files, so any static host works.
- **Backend** (`supabase/`): Postgres schema with row-level security, plans and credit metering, private CV storage, and two edge functions (`parse-cv`, `answer-question`) that call OpenRouter with a server-side key.

Deployment steps are in **[DEPLOY.md](DEPLOY.md)**.

## How it works

```
Chrome extension ──(user session, RLS)──► Supabase Postgres / Storage
      │                                          ▲
      └──► Edge functions (parse-cv, answer-question) ──► OpenRouter
Web dashboard ─────(same account)───────────────┘
```

1. **Onboarding.** The CV is read locally (PDF.js / Mammoth). Its text goes to `parse-cv`, and the user reviews every field. The questionnaire (`extension/shared/questions.js`) adapts to the user's country and target markets, and every option has a machine-readable meaning (for example `auth: true, sponsor: false`).
2. **Answering questions.** `extension/shared/answer-engine.js` answers common screening questions deterministically: country-aware work authorization and sponsorship, experience, notice period, salary with monthly/yearly conversion, education, language, EEO, and consent. Anything else goes to `answer-question`. That function checks saved answers first, then asks the LLM to answer strictly from the user's profile, or return `null`.
3. **Unknown questions.** Depending on the user's setting, JobFlow either skips the job or pauses so the user can answer. The question is saved, the user's answer is remembered, and it appears on the dashboard's **Saved answers** page.
4. **Credits.** `record_application()` enforces the monthly plan limit atomically. Users can't insert, delete or back-date applications directly. The daily AI limit is metered server-side.

## Project layout

```
extension/            Chrome MV3 extension
  background/         service worker (only place that talks to the backend)
  content/            linkedin.js, ats.js, bridge.js, autofill-core.js, content.css
  onboarding/         setup & settings flow
  popup/              toolbar popup
  shared/             countries, questionnaire, answer engine, API client, design tokens
  lib/                bundled supabase-js, pdf.js, mammoth (no remote code)
web/                  static website + dashboard (deploy this folder)
supabase/
  migrations/         schema, RLS, plans, credit functions, storage bucket
  functions/          parse-cv, answer-question (Deno)
scripts/              build.js (production config + zip), sync-shared.js
store/                Chrome Web Store listing copy, screenshots, promo tile
tests/                unit tests, jsdom LinkedIn flows, Chromium E2E with a mock Supabase
```

## Development

```bash
npm install
npm test              # answer engine + simulated LinkedIn Easy Apply flows
npm run test:e2e      # loads the real extension + web app in Chromium against a mock backend
```

To load the extension locally, go to `chrome://extensions`, turn on Developer mode, click **Load unpacked** and select `extension/`.

When you change files in `extension/shared/`, run `npm run sync` to copy them into `web/`.

## Plans

Plans are defined in the `plans` table. Paid plans show a waitlist until billing is added. To add Stripe later, create a webhook edge function that updates `subscriptions.plan_id` using the service role. The rest of the app already reads limits from the database.
