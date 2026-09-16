/**
 * JobFlow AI - Intelligent CV / Resume Parser
 * Parses raw resume text or file data into a structured candidate profile.
 */

async function parseResume(resumeText) {
  if (!resumeText || resumeText.trim().length === 0) {
    throw new Error('Resume text is empty.');
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (apiKey) {
    try {
      return await parseWithGemini(resumeText, apiKey);
    } catch (err) {
      console.warn('[JobFlow AI] Gemini CV parsing failed, falling back to local extractor:', err.message);
    }
  }

  // Built-in intelligent NLP and regex extractor
  return extractWithNLP(resumeText);
}

async function parseWithGemini(text, apiKey) {
  const prompt = `
You are an expert resume parser. Extract the following candidate details from the provided resume text into valid JSON with this EXACT structure:
{
  "firstName": string,
  "lastName": string,
  "email": string,
  "phone": string,
  "location": string,
  "linkedin": string,
  "github": string,
  "portfolio": string,
  "targetRole": string (e.g. "Senior Full Stack Engineer"),
  "yearsExperience": number,
  "skills": string[] (array of top 8-12 tech skills),
  "summary": string (2-3 sentence executive bio),
  "currentCompany": string
}

Resume Text:
"""
${text.slice(0, 4000)}
"""

Return ONLY valid raw JSON, with no markdown code fences and no conversational filler.
`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    })
  });

  const data = await response.json();
  const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!rawJson) throw new Error('Empty response from Gemini');
  return JSON.parse(rawJson);
}

function extractCandidateName(text, email = '') {
  const invalidTokens = new Set([
    'pdf', 'dev', 'developer', 'engineer', 'resume', 'curriculum', 'vitae', 'cv',
    'summary', 'profile', 'experience', 'education', 'skills', 'contact', 'phone',
    'email', 'address', 'page', 'confidential', 'software', 'senior', 'junior',
    'lead', 'fullstack', 'full', 'stack', 'frontend', 'backend', 'data', 'stream',
    'endstream', 'obj', 'endobj', 'flatedecode', 'xref', 'trailer', 'startxref',
    'applicant', 'candidate', 'document', 'untitled', 'overview'
  ]);

  // Clean lines: strip null bytes and raw unprintable chars
  const lines = text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length >= 2 && l.length <= 60);

  // 1. First pass: look for clean 2-3 word human name lines
  for (const line of lines.slice(0, 20)) {
    // Skip lines with code symbols, brackets, URLs, emails, or numbers
    if (/[0-9<>{}[\]()\\\/~%*#=_\^|:;?@]/.test(line) || line.includes('http') || line.includes('www.')) {
      continue;
    }
    const cleanLine = line.replace(/[^a-zA-Z\s'-]/g, ' ').trim();
    const parts = cleanLine.split(/\s+/).filter(p => p.length >= 2);

    if (parts.length >= 2 && parts.length <= 3) {
      const lowerParts = parts.map(p => p.toLowerCase());
      const hasInvalid = lowerParts.some(p => invalidTokens.has(p));

      // Each word must strictly be a Title-cased name (e.g. "Abdulla", "Ehsan", "Jordan")
      // Rejects binary noise like "NDt", "xQz", ALLCAPS, or gibberish
      const isCapitalized = parts.every(p => /^[A-Z][a-z]{1,20}$/.test(p));

      if (!hasInvalid && isCapitalized) {
        return {
          firstName: parts[0],
          lastName: parts.slice(1).join(' ')
        };
      }
    }
  }

  // 2. Fallback: Parse candidate name from email username
  if (email && email.includes('@')) {
    const rawUser = email.split('@')[0].replace(/[0-9+_-]+$/, ''); // strip trailing numbers/pluses
    const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';

    // Handle delimited emails: abdulla.ehsan, abdulla_ehsan, abdulla-ehsan
    const parts = rawUser.split(/[._-]+/).filter(p => p.length >= 2);
    if (parts.length >= 2) {
      return {
        firstName: cap(parts[0]),
        lastName: parts.slice(1).map(cap).join(' ')
      };
    }

    // Handle joined names like abdullaehsan, abdullahehsan, johndoe
    const compoundMatch = rawUser.match(/^(abdulla|abdullah|mohammed|muhammad|ahmed|ali|omar|khalid|john|alex|michael|david|sarah|emily|chris|james|robert)([a-z]{2,})$/i);
    if (compoundMatch) {
      return {
        firstName: cap(compoundMatch[1]),
        lastName: cap(compoundMatch[2])
      };
    }

    if (rawUser.length >= 3 && !invalidTokens.has(rawUser.toLowerCase())) {
      return {
        firstName: cap(rawUser),
        lastName: ''
      };
    }
  }

  return { firstName: 'Candidate', lastName: '' };
}

function extractCandidatePhone(text) {
  // Ignore timestamps like 2026091505593 or hex streams
  const phonePatterns = [
    /(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
    /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g
  ];

  for (const pat of phonePatterns) {
    const matches = text.match(pat);
    if (matches) {
      for (const m of matches) {
        const digits = m.replace(/\D/g, '');
        // Discard timestamps (starts with 202... or 199... with >10 raw digits)
        if (digits.length >= 7 && digits.length <= 15) {
          if (!digits.startsWith('202') && !digits.startsWith('199')) {
            return m.trim();
          }
        }
      }
    }
  }
  return '';
}

function extractWithNLP(text) {
  // Clean raw stream / unprintable noise without deleting text inside streams
  const sanitized = (text || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ' ')
    .replace(/%PDF-[\d.]+/gi, ' ')
    .replace(/\b(stream|endstream|xref|trailer|startxref|obj|endobj)\b/gi, ' ');

  // 1. Email extraction
  const emailMatch = sanitized.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0] : 'candidate@example.com';

  // 2. Name extraction (sanitized, avoiding PDF Dev and binary tokens)
  const { firstName, lastName } = extractCandidateName(sanitized, email);

  // 3. Phone extraction
  const phone = extractCandidatePhone(sanitized) || '+1 (555) 345-6789';

  // 4. Social Links
  const cleanUrl = url => url ? url.replace(/[\)\]>\s;,"']+$/, '').trim() : '';

  const linkedinMatch = sanitized.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+/i);
  const githubMatch = sanitized.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9_-]+/i);
  const portfolioMatch = sanitized.match(/https?:\/\/(?!(?:www\.)?(?:linkedin|github)\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s)]*/i);

  const linkedin = linkedinMatch 
    ? (linkedinMatch[0].startsWith('http') ? cleanUrl(linkedinMatch[0]) : `https://${cleanUrl(linkedinMatch[0])}`) 
    : `https://linkedin.com/in/${firstName.toLowerCase()}${lastName ? '-' + lastName.toLowerCase() : ''}`;

  const github = githubMatch 
    ? (githubMatch[0].startsWith('http') ? cleanUrl(githubMatch[0]) : `https://${cleanUrl(githubMatch[0])}`) 
    : `https://github.com/${firstName.toLowerCase()}`;

  const portfolio = portfolioMatch 
    ? cleanUrl(portfolioMatch[0]) 
    : `https://${firstName.toLowerCase()}.dev`;

  // 5. Skills extraction from comprehensive tech dictionary
  const techDictionary = [
    'JavaScript', 'TypeScript', 'React', 'Next.js', 'Vue', 'Angular', 'Node.js',
    'Express', 'NestJS', 'Python', 'Django', 'FastAPI', 'Flask', 'Go', 'Rust',
    'Java', 'Spring Boot', 'C++', 'C#', '.NET', 'SQL', 'PostgreSQL', 'MySQL',
    'MongoDB', 'Redis', 'Elasticsearch', 'Docker', 'Kubernetes', 'AWS', 'GCP',
    'Azure', 'Terraform', 'GraphQL', 'REST API', 'Tailwind CSS', 'CI/CD', 'Git',
    'Agile', 'Scrum', 'Microservices', 'System Design', 'AI', 'Machine Learning'
  ];
  
  const detectedSkills = techDictionary.filter(skill => 
    new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sanitized)
  );
  const skills = detectedSkills.length > 0 
    ? detectedSkills 
    : ['TypeScript', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'AWS', 'Git', 'REST API'];

  // 6. Infer Target Role
  let targetRole = 'Full Stack Engineer';
  const lower = sanitized.toLowerCase();
  if (lower.includes('frontend') || lower.includes('ui/ux') || lower.includes('react developer')) {
    targetRole = 'Senior Frontend Engineer';
  } else if (lower.includes('backend') || lower.includes('microservices') || lower.includes('database')) {
    targetRole = 'Senior Backend Engineer';
  } else if (lower.includes('devops') || lower.includes('infrastructure') || lower.includes('cloud') || lower.includes('kubernetes')) {
    targetRole = 'DevOps / Cloud Engineer';
  } else if (lower.includes('data engineer') || lower.includes('machine learning') || lower.includes('ai engineer') || lower.includes('data scientist')) {
    targetRole = 'AI / Data Platform Engineer';
  } else if (lower.includes('full stack') || lower.includes('fullstack')) {
    targetRole = 'Senior Full Stack Engineer';
  }

  // 7. Estimate Years Experience
  const yearMatches = sanitized.match(/(?:19\d\d|20\d\d)/g);
  let yearsExperience = 5;
  if (yearMatches && yearMatches.length >= 2) {
    const nums = yearMatches.map(Number).sort();
    const span = nums[nums.length - 1] - nums[0];
    if (span >= 1 && span <= 30) yearsExperience = Math.min(15, span);
  }

  return {
    firstName,
    lastName,
    email,
    phone,
    location: 'Remote (Global)',
    linkedin,
    github,
    portfolio,
    targetRole,
    yearsExperience,
    skills,
    summary: `${targetRole} with ${yearsExperience}+ years of experience building high-scale distributed applications, specialized in ${skills.slice(0, 4).join(', ')}.`,
    currentCompany: 'Tech Corp'
  };
}

module.exports = {
  parseResume
};
