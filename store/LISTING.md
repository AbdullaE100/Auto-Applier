# Chrome Web Store listing – JobFlow AI

Copy these into the Chrome Web Store Developer Dashboard.

## Store listing

**Name:** JobFlow AI – Job Application Autofill

**Summary (max 132 chars):**
Upload your CV once. JobFlow fills LinkedIn Easy Apply and career-site applications with truthful, tailored answers.

**Category:** Productivity (Workflow & Planning)

**Language:** English

**Description:**

Stop retyping the same answers into every job application.

JobFlow AI turns your CV and a few quick answers into a reusable profile, then fills in job applications for you: contact details, work eligibility, visa and sponsorship questions, notice period, salary, education and screening questions.

HOW IT WORKS
1. Upload your CV (PDF or Word). AI extracts your details and you review everything.
2. Answer a few multiple-choice questions tailored to where you live and where you want to work: UAE & GCC, UK, EU, US, Canada, Australia, India and Singapore.
3. Open LinkedIn Jobs and press Start. JobFlow fills each Easy Apply form and stops on the review screen so you can submit.

WHY PEOPLE USE IT
• Truthful by design: answers come only from your CV and your choices. If JobFlow isn't sure, it asks you.
• Learns as you go: answer a new question once and it's reused on every future application.
• Location-aware: "Do you need sponsorship?" is answered correctly for each country.
• You stay in control: review before submit by default, daily limits and human-paced applying.
• Tracker included: every application is logged in your dashboard, where you can mark interviews and offers.
• Career sites too: one-click autofill on Greenhouse, Lever, Ashby and Workable, including attaching your CV.

FREE PLAN
30 applications a month and 40 AI answers a day, free. No credit card.

PRIVACY
Your data is encrypted, visible only to you, never sold and never used for ads. Export or delete it any time.

Note: some websites, including LinkedIn, restrict automated tools in their terms. JobFlow runs in your browser at a human pace with review mode on by default. You're responsible for how you use it.

## Graphics

- Icon: `extension/icons/icon128.png`
- Screenshots (1280×800): `store/screenshots/*.png`
- Small promo tile (440×280): `store/promo-small-440x280.png`

## Privacy practices tab

**Single purpose:**
Helps job seekers fill in job application forms using a profile built from their own CV and answers.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Stores the user's sign-in session and onboarding progress locally. |
| `identity` | Enables "Continue with Google" sign-in through `chrome.identity.launchWebAuthFlow`. |
| Host: `https://<project>.supabase.co/*` | Reads and saves the user's own profile, answers and application log from the JobFlow backend. |
| Content script: `https://www.linkedin.com/*` | Detects LinkedIn Jobs pages and fills the Easy Apply form the user opens. Only acts on `/jobs` pages. |
| Content scripts: Greenhouse, Lever, Ashby, Workable | Adds an "Autofill with JobFlow" button to application forms on these career sites. |

**Remote code:** No. All JavaScript is packaged in the extension (Supabase client, PDF.js and Mammoth are bundled).

**Data usage – check these boxes:**
- Personally identifiable information (name, email, phone)
- Location (city and country the user enters)
- Personal communications: **No**
- Authentication information (session token)
- Website content (the application form fields on supported job sites)
- Other: CV / employment history the user uploads

**Certify:**
- Data is not sold to third parties.
- Data is not used or transferred for purposes unrelated to the single purpose.
- Data is not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL:** `https://<your-domain>/privacy.html`

## Review tips

- Provide a test account in "Test instructions": an email address plus instructions to use the 6-digit code flow, or a Google test account.
- Mention that the extension never submits applications unless the user turns on auto-submit, and that it defaults to review mode.
