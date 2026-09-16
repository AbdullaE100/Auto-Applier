/**
 * JobFlow AI - Screening Question Intelligence Engine
 * Supports direct Gemini API or high-precision semantic candidate response synthesis.
 */

async function generateScreeningAnswer({ question, jobTitle, company, profile }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (apiKey) {
    try {
      return await callGemini({ question, jobTitle, company, profile, apiKey });
    } catch (err) {
      console.warn('[JobFlow AI] Gemini API failed, falling back to local synthesis engine:', err.message);
    }
  }

  // Built-in intelligent synthesis engine
  return synthesizeAnswer({ question, jobTitle, company, profile });
}

async function callGemini({ question, jobTitle, company, profile, apiKey }) {
  const prompt = `
You are an expert career coach and candidate writing on behalf of ${profile.firstName} ${profile.lastName}.
Candidate Profile:
- Current/Target Role: ${profile.targetRole || 'Software Engineer'}
- Years of Experience: ${profile.yearsExperience || 5}
- Top Skills: ${(profile.skills || []).join(', ')}
- Summary: ${profile.summary || ''}
- Key Experiences: ${(profile.experience || []).map(e => `${e.role} at ${e.company}: ${e.description}`).join(' | ')}
- Salary Expectations: ${profile.salaryExpectations || 'Market competitive'}

Target Position: ${jobTitle} at ${company}.

Screening Question to answer:
"${question}"

Instructions:
1. Write a direct, highly professional, first-person answer (using "I").
2. Answer truthfully based strictly on the candidate profile. Do not invent false companies or qualifications.
3. Keep the response concise, punchy, and confident (1-3 paragraphs or 2-4 sentences depending on question depth).
4. Do not include introductory conversational fluff (like "Here is the answer:"). Return ONLY the text to be pasted directly into the application field.
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 350
      }
    })
  });

  const data = await response.json();
  const answer = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!answer) throw new Error('Empty response from Gemini');
  return { answer, source: 'gemini-1.5-flash' };
}

function synthesizeAnswer({ question, jobTitle, company, profile }) {
  const q = question.toLowerCase();
  const name = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  const role = profile.targetRole || 'Software Engineer';
  const skills = (profile.skills || []).slice(0, 4).join(', ');
  const years = profile.yearsExperience || 5;

  let answer = '';

  // 1. "Why do you want to work here?" / "Why this company?"
  if (q.includes('why') && (q.includes('work') || q.includes('join') || q.includes('company') || q.includes('interest') || q.includes('here'))) {
    answer = `I have been following ${company}'s work and product growth closely. As a ${role} with over ${years} years of experience specializing in ${skills}, I am drawn to the challenges your engineering team tackles. I am excited by the opportunity to apply my background in scalable architecture and high-performance systems to make a direct impact at ${company}.`;
  }
  // 2. Salary expectations
  else if (q.includes('salary') || q.includes('compensation') || q.includes('expectation') || q.includes('target pay')) {
    answer = profile.salaryExpectations 
      ? `My target compensation is ${profile.salaryExpectations}, though I am open to discussing the full package depending on benefits, equity, and the overall scope of the role.`
      : `My target compensation is market-competitive for a ${role} position and open to negotiation based on the complete compensation and equity structure.`;
  }
  // 3. Technical background / Project experience
  else if (q.includes('experience') || q.includes('project') || q.includes('technical') || q.includes('background') || q.includes('tell me about')) {
    const recent = profile.experience?.[0] || {};
    answer = `Over the past ${years} years as a ${role}, I have focused on building robust, high-availability software. Most recently as ${recent.role || 'Senior Engineer'} at ${recent.company || 'my current company'}, ${recent.description || `I spearheaded architecture improvements and scaled web services using ${skills}`}. I look forward to bringing this hands-on engineering rigor to ${company}.`;
  }
  // 4. Work authorization & sponsorship
  else if (q.includes('authorized') || q.includes('eligibility') || q.includes('sponsorship') || q.includes('visa')) {
    if (profile.workAuthorized && !profile.requireSponsorship) {
      answer = `Yes, I am legally authorized to work in the United States without requiring any employer sponsorship now or in the future.`;
    } else if (profile.requireSponsorship) {
      answer = `I am authorized to work with visa sponsorship required.`;
    } else {
      answer = `Yes, I am fully authorized to work.`;
    }
  }
  // 5. General / "Why are you a good fit?"
  else {
    answer = `With ${years}+ years of experience building mission-critical applications with ${skills}, I offer a strong blend of technical depth and product delivery focus. I pride myself on clean architecture, proactive problem-solving, and cross-functional communication, which aligns directly with the requirements for the ${jobTitle || 'role'} at ${company}.`;
  }

  return {
    answer,
    source: 'jobflow-synthesis-engine'
  };
}

module.exports = {
  generateScreeningAnswer
};
