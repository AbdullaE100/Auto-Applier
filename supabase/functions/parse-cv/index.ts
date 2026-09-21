// POST { text: string }  ->  { profile: {...} }
// The extension extracts text from the PDF/DOCX locally; only the text is sent here.
import { authenticate, HttpError, json, meter, serve } from "../_shared/common.ts";
import { chat, parseJsonObject } from "../_shared/openrouter.ts";

const SYSTEM = `You extract structured data from a CV/resume. Return ONLY a JSON object with these keys:
{
  "firstName": string|null, "lastName": string|null, "email": string|null,
  "phone": string|null,
  "city": string|null,
  "country": string|null,
  "headline": string|null,
  "currentTitle": string|null, "currentCompany": string|null,
  "yearsExperience": number|null,
  "skills": string[],
  "summary": string|null,
  "linkedinUrl": string|null, "githubUrl": string|null, "portfolioUrl": string|null,
  "experience": [{"title": string, "company": string, "start": string|null, "end": string|null, "description": string|null}],
  "education": [{"degree": string|null, "field": string|null, "school": string|null, "end": string|null}]
}
Field notes:
- phone: as written, including the country code if present.
- country: ISO 3166-1 alpha-2 code of where the candidate currently lives (e.g. "AE", "US", "GB").
- headline: short professional headline, max 80 characters.
- yearsExperience: total full-time professional years computed from the dates. Internships count at half. Never round up generously.
- skills: at most 25, most relevant first, canonical names.
- summary: 2-3 factual sentences in first person.
- experience: every role, most recent first. start/end as "YYYY-MM" (or "YYYY"); end null if current. description: at most 300 characters listing the concrete tools, projects and results in that role.
- education: every degree or diploma. field is the subject (e.g. "Computer Science").
Rules: use null when information is missing. Never invent employers, dates, degrees or contact details.`;

const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

serve(async (req) => {
  const ctx = await authenticate(req);
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim();
  if (text.length < 80) {
    throw new HttpError(400, "Couldn't read enough text from this CV. Try a text-based PDF or a DOCX file.", "cv_too_short");
  }

  await meter(ctx, "cv");

  const content = await chat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: `CV text:\n"""\n${text.slice(0, 30_000)}\n"""` },
    ],
    { json: true, maxTokens: 4500, temperature: 0 },
  );
  const raw = parseJsonObject(content);

  const years = Number(raw.yearsExperience);
  const profile = {
    firstName: str(raw.firstName, 80),
    lastName: str(raw.lastName, 80),
    email: str(raw.email, 200),
    phone: str(raw.phone, 40),
    city: str(raw.city, 100),
    country: str(raw.country, 2)?.toUpperCase() ?? null,
    headline: str(raw.headline, 120),
    currentTitle: str(raw.currentTitle, 150),
    currentCompany: str(raw.currentCompany, 150),
    yearsExperience: raw.yearsExperience !== null && Number.isFinite(years) && years >= 0 && years <= 60 ? Math.round(years) : null,
    skills: Array.isArray(raw.skills) ? raw.skills.map((s) => str(s, 60)).filter(Boolean).slice(0, 25) : [],
    summary: str(raw.summary, 1200),
    linkedinUrl: str(raw.linkedinUrl, 300),
    githubUrl: str(raw.githubUrl, 300),
    portfolioUrl: str(raw.portfolioUrl, 300),
    experience: Array.isArray(raw.experience)
      ? raw.experience
        .map((e: Record<string, unknown>) => ({
          title: str(e?.title, 150), company: str(e?.company, 150), start: str(e?.start, 20), end: str(e?.end, 20),
          description: str(e?.description, 600),
        }))
        .filter((e) => e.title || e.company)
        .slice(0, 15)
      : [],
    education: Array.isArray(raw.education)
      ? raw.education
        .map((e: Record<string, unknown>) => ({ degree: str(e?.degree, 150), field: str(e?.field, 150), school: str(e?.school, 200), end: str(e?.end, 20) }))
        .filter((e) => e.degree || e.school)
        .slice(0, 8)
      : [],
  };

  return json({ profile });
});
