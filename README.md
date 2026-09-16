# JobFlow AI - Commercial Auto Job Applier SaaS 🚀

**JobFlow AI** is a commercial-ready, high-conversion job application copilot engineered to automate applications safely across **Greenhouse, Lever, Ashby, and LinkedIn** without triggering anti-bot protections or risking account bans.

---

## Architecture Overview

JobFlow AI uses the proven **Client-Side Extension + Cloud SaaS Backend** model (the architecture powering multi-million user apps like Simplify.jobs):

```
┌────────────────────────────────────────────────────────┐
│               Client Layer (User Machine)              │
│                                                        │
│   • Runs on User's Authentic Residential IP            │
│   • Natural Keystrokes & DOM Event Dispatching         │
│   • Manifest V3 Extension + Floating In-Page Copilot   │
└──────────────────────────┬─────────────────────────────┘
                           │ Auth, Profile & AI Stream
┌──────────────────────────▼─────────────────────────────┐
│                 JobFlow SaaS Backend                   │
│                                                        │
│   • Next-Gen AI Screening Q&A Engine (Gemini 1.5)      │
│   • Profile & Resume Store                             │
│   • Credit & Subscription Billing Tiers                │
│   • Real-Time Application Tracker                      │
└────────────────────────────────────────────────────────┘
```

---

## ⚡ Quick Start

### 1. Launch the Server & Dashboard
```bash
cd /Users/abu/.gemini/antigravity/scratch/jobflow-saas
npm start
```

* **Landing Page:** [http://localhost:3000](http://localhost:3000)
* **SaaS Dashboard:** [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
* **Mock Greenhouse Test Bed:** [http://localhost:3000/mock/greenhouse](http://localhost:3000/mock/greenhouse)
* **Mock Lever Test Bed:** [http://localhost:3000/mock/lever](http://localhost:3000/mock/lever)

---

### 2. Load the Chrome Extension (30 Seconds)
1. Open Google Chrome, Brave, or Microsoft Edge.
2. Go to `chrome://extensions` in the address bar.
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** (top-left).
5. Select the folder:
   ```
   /Users/abu/.gemini/antigravity/scratch/jobflow-saas/apps/extension
   ```
6. The JobFlow AI icon will appear in your browser toolbar!

---

### 3. Test 1-Click Autofill & AI Questions
1. Open the **[Mock Greenhouse Portal](http://localhost:3000/mock/greenhouse)** in your browser.
2. Look at the bottom-right corner: the purple **JobFlow AI** badge is active.
3. Click **"1-Click Auto Fill"**:
   - First/Last name, email, phone, and social links are filled.
   - Work authorization and sponsorship dropdowns are selected.
   - The open-ended question (*"Why are you interested in joining Acme Cloud Technologies?"*) is answered by the AI copilot.
   - All populated inputs glow with an **emerald green ring** for easy review.
4. Visit your **[Dashboard Application Tracker](http://localhost:3000/dashboard#tracker)** to see the application logged!

---

## 💰 Monetization & Packaging (How to Sell It)

### Pricing Tiers
| Tier | Price | Features |
| :--- | :--- | :--- |
| **Free Starter** | $0 | 10 Applications / month, standard autofill |
| **JobFlow Pro** | **$29 / mo** | 150 Applications / month, Gemini 1.5 AI screening essays, cover letters |
| **Career Turbo** | **$49 / mo** | Unlimited Applications, all ATS platforms, resume keyword optimizer |

### Packaging for Chrome Web Store
To publish JobFlow AI on the Chrome Web Store:
```bash
cd apps/extension
zip -r ../../jobflow-extension-v1.0.0.zip . -x ".*"
```
Upload `jobflow-extension-v1.0.0.zip` directly to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## 🔑 Environment Configuration (Optional)
To enable real Google Gemini API generation for custom recruiter essays:
```bash
export GEMINI_API_KEY="your-gemini-api-key"
npm start
```
*(If no API key is provided, JobFlow uses its built-in semantic candidate synthesis engine to construct tailored answers).*

---

## 🧪 Verification
Run the automated test suite anytime:
```bash
npm test
```
All 17 integration and manifest tests will execute and verify system health.
