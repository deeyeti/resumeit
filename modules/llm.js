/**
 * llm.js - Gemini API Orchestration Layer
 * Compiles JD + Memory Vault + GitHub metrics into a structured prompt,
 * calls Gemini to generate ATS-optimized resume content as JSON.
 * Only communicates with generativelanguage.googleapis.com.
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL = 'gemini-2.0-flash';

function buildRankingPrompt(jobDescription, vaultEntries) {
  return `You are an expert resume strategist. Analyze the following job description and rank each experience entry from the Memory Vault by relevance.

JOB DESCRIPTION:
${jobDescription}

MEMORY VAULT ENTRIES (JSON):
${JSON.stringify(vaultEntries.map(e => ({ id: e.id, title: e.title, context: e.context, techStack: e.techStack, bulletPoints: e.bulletPoints })), null, 2)}

Return ONLY a valid JSON array of objects with this exact structure:
[
  { "id": <entry_id>, "relevanceScore": <0-100>, "reason": "<brief reason>" }
]

Score 100 = perfect match, 0 = completely irrelevant. Be strict and precise.`;
}

function buildResumePrompt(jobDescription, rankedEntries, githubData, userProfile, preferences = {}, existingResumeText = '') {
  const topEntries = rankedEntries.slice(0, 5);
  const pageCount = Number(preferences.pageCount) === 2 ? 2 : 1;
  const sections = preferences.sections || {};
  const sectionNames = {
    summary: 'Summary / Objective',
    skills: 'Technical Skills',
    experience: 'Experience',
    projects: 'Projects',
    education: 'Education',
    certifications: 'Certifications',
  };
  const includedSections = Object.entries(sectionNames)
    .filter(([key]) => sections[key] !== false)
    .map(([, name]) => name);
  const excludedSections = Object.entries(sectionNames)
    .filter(([key]) => sections[key] === false)
    .map(([, name]) => name);
  const highlightedSkills = (preferences.highlightedSkills || []).filter(Boolean);
  const additionalInstructions = String(preferences.additionalInstructions || '').trim();

  return `You are an elite ATS resume optimization specialist and technical resume writer. Generate a complete, maximally ATS-optimized resume for a software engineer.

═══════════════════════════════════════════
ATS MAXIMIZATION — MANDATORY REQUIREMENTS
═══════════════════════════════════════════

KEYWORD MIRRORING (Critical for ATS parse score):
- Extract EVERY technical skill, tool, framework, methodology, and qualification from the JD
- Mirror these keywords EXACTLY (same capitalization, same abbreviations) throughout the resume
- Especially include them in: Summary, Skills section, and bullet points
- Do NOT paraphrase keywords — if the JD says "Kubernetes", write "Kubernetes" not "k8s" (unless both appear)

METRICS & QUANTIFICATION (Highest ATS weight):
- EVERY bullet point MUST contain at least one quantified metric or measurable outcome
- Use these formats where applicable:
  • Percentage change: "reduced latency by 42%", "improved test coverage from 61% → 94%"
  • Scale/volume: "processed 2M+ events/day", "served 500K concurrent users"
  • Time savings: "cut deployment time from 45 min → 8 min"
  • Cost impact: "reduced AWS spend by $18K/month"
  • Team/scope: "led a team of 6 engineers across 3 time zones"
  • Growth: "grew API adoption from 0 to 12K active integrations"
- If a vault bullet lacks a metric, INFER a plausible metric based on the context (e.g. scale of company, type of system). Mark inferred metrics with "~" (e.g., "~30% faster").
- NEVER invent completely fabricated metrics for things that clearly never happened.

BULLET POINT STRUCTURE — Use STAR-lite format:
  [Strong verb] + [what you did] + [how/technology] + [measurable result]
  Example: "Architected event-driven microservices on AWS Lambda, cutting p99 latency by 67% and eliminating 3 on-call incidents/week"

STRONG ACTION VERBS — Rotate through high-impact verbs:
  Architected, Engineered, Spearheaded, Automated, Optimized, Orchestrated, Migrated,
  Reduced, Scaled, Deployed, Mentored, Delivered, Revamped, Designed, Integrated, Led

SUMMARY OPTIMIZATION:
- Open with the EXACT target job title from the JD
- Include 3–5 top keywords from the JD in the first sentence
- Quantify years of experience and 1–2 headline achievements
- End with a forward-looking value statement tied to the employer's goals

SKILLS SECTION:
- List ONLY skills that appear in JD or are directly supported by vault/GitHub data
- Group by: languages, frameworks, tools, methodologies
- Prioritize skills in the SAME ORDER they appear in the JD requirements
- Include both long-form and abbreviated forms when both appear in JD (e.g., "Amazon Web Services (AWS)")

═══════════════════════════════════════════
OUTPUT RULES
═══════════════════════════════════════════
- Output ONLY valid JSON (no markdown, no code blocks, no extra text)
- Avoid complex formatting (no tables, no columns)
- Keep bullet points concise (under 140 characters each)
- Target a ${pageCount}-page resume. ${pageCount === 1
    ? 'Be ruthlessly concise: 3–4 bullets per role, only top 3 most relevant roles, one A4 page.'
    : 'Use the full two pages deliberately — 4–6 bullets per role, surface all relevant projects and achievements.'}
- Do not invent employers, projects, degrees, certifications, or skills not supported by the input data.
- For sections the user excluded, return an empty string, empty array, or empty skills object as appropriate.

TARGET JOB DESCRIPTION:
${jobDescription}

CANDIDATE PROFILE:
Name: ${userProfile.name || 'Your Name'}
GitHub: ${userProfile.github ? `github.com/${userProfile.github}` : ''}
Email: ${userProfile.email || ''}
Location: ${userProfile.location || ''}

GITHUB SIGNALS:
- Public Repos: ${githubData?.user?.publicRepos || 0}
- Top Languages: ${githubData?.languages?.slice(0, 5).map(l => `${l.lang} (${l.percent}%)`).join(', ') || 'N/A'}
- Recent Activity: ${githubData?.activity?.recentCommits || 0} commits in recent events
- Notable Repos: ${githubData?.topRepos?.slice(0, 3).map(r => `${r.name} (⭐${r.stars})`).join(', ') || 'N/A'}

SELECTED EXPERIENCES (ordered by relevance to JD):
${JSON.stringify(topEntries, null, 2)}

USER CONTENT PREFERENCES:
- Include these sections: ${includedSections.join(', ') || 'None'}
- Exclude these sections: ${excludedSections.join(', ') || 'None'}
- Skills and languages to highlight: ${highlightedSkills.join(', ') || 'No additional preferences'}
- Additional instructions: ${additionalInstructions || 'None'}
${existingResumeText ? `
CANDIDATE'S EXISTING RESUME (for additional context — extract any implied metrics, responsibilities, or technical depth not yet in the vault entries above):
${existingResumeText.substring(0, 6000)}` : ''}

Return this EXACT JSON structure:
{
  "name": "Full Name",
  "tagline": "Job Title Matching the JD",
  "contact": {
    "email": "email@example.com",
    "github": "github.com/handle",
    "linkedin": "linkedin.com/in/handle",
    "location": "City, Country"
  },
  "summary": "2-3 sentence professional summary tailored to JD",
  "experience": [
    {
      "title": "Job Title",
      "company": "Company Name",
      "dateRange": "Jan 2023 – Present",
      "location": "Remote / City",
      "bullets": [
        "Strong action verb + what you did + impact/metric",
        "..."
      ]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "description": "One-line description",
      "techStack": ["Tech1", "Tech2"],
      "url": "github.com/user/repo",
      "bullets": ["Key achievement 1", "Key achievement 2"]
    }
  ],
  "skills": {
    "languages": ["Python", "JavaScript"],
    "frameworks": ["React", "FastAPI"],
    "tools": ["Docker", "Git", "AWS"],
    "other": ["REST APIs", "CI/CD"]
  },
  "education": [
    {
      "degree": "Bachelor of Science in Computer Science",
      "institution": "University Name",
      "year": "2023",
      "gpa": ""
    }
  ],
  "certifications": []
}`;
}

async function callGemini(apiKey, prompt) {
  const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const msg = errBody?.error?.message || `Gemini API error: ${response.status}`;
    if (response.status === 400 && msg.includes('API key')) throw new Error('Invalid Gemini API key. Please check your key in Settings.');
    if (response.status === 429) throw new Error('Gemini API rate limit reached. Please wait a moment and try again.');
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini API.');

  try {
    return JSON.parse(text);
  } catch (_) {
    // Try to extract JSON from response if it wrapped it
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Gemini returned invalid JSON. Please try again.');
  }
}

export async function rankVaultEntries(apiKey, jobDescription, vaultEntries) {
  if (!vaultEntries || vaultEntries.length === 0) return [];

  const prompt = buildRankingPrompt(jobDescription, vaultEntries);
  const ranked = await callGemini(apiKey, prompt);

  // Merge scores back into entries
  return ranked
    .map(r => {
      const entry = vaultEntries.find(e => e.id === r.id);
      return entry ? { ...entry, relevanceScore: r.relevanceScore, reason: r.reason } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

export async function generateResume(apiKey, jobDescription, rankedEntries, githubData, userProfile, preferences = {}, existingResumeText = '') {
  const prompt = buildResumePrompt(jobDescription, rankedEntries, githubData, userProfile, preferences, existingResumeText);
  return callGemini(apiKey, prompt);
}

export async function validateApiKey(apiKey) {
  const testPrompt = 'Reply with exactly: {"valid":true}';
  try {
    await callGemini(apiKey, testPrompt);
    return true;
  } catch (e) {
    throw e;
  }
}

export async function improveResumeBullet(apiKey, bullet, context) {
  const prompt = `Improve this resume bullet point to be more impactful, quantified, and ATS-friendly. Return ONLY a JSON object: {"improved": "<bullet>"}

Original bullet: "${bullet}"
Context: ${context || 'Software engineering role'}`;

  const result = await callGemini(apiKey, prompt);
  return result.improved || bullet;
}

export async function generateCoverLetter(apiKey, jobDescription, resumeData, userProfile, options = {}) {
  const hiringManager = options.hiringManager ? String(options.hiringManager).trim() : '';
  const companyName = options.companyName ? String(options.companyName).trim() : '';
  const tone = options.tone || 'professional'; // professional | enthusiastic | concise

  const prompt = `You are an expert professional cover letter writer. Write a compelling, ATS-friendly cover letter for the candidate below.

TONE: ${tone}
LENGTH: 3–4 paragraphs (250–350 words). Never write more than 400 words.

COVER LETTER RULES:
- Open with a strong hook that references the specific role and a headline achievement
- Middle paragraphs: mirror 2–3 key requirements from the JD with specific examples and metrics from the candidate's experience
- Closing paragraph: express genuine enthusiasm for the company and a clear CTA (interview request)
- NEVER use generic filler phrases like "I am writing to apply for..." or "I believe I am a great fit"
- Use the same keywords that appear in the job description
- Sound like a real human, not a template
- Do NOT use bullet points in the body — prose only
- Keep the tone ${tone}

JOB DESCRIPTION:
${jobDescription.substring(0, 4000)}

CANDIDATE PROFILE:
Name: ${userProfile.name || 'Candidate'}
Email: ${userProfile.email || ''}
LinkedIn: ${userProfile.linkedin || ''}
GitHub: ${userProfile.github ? `github.com/${userProfile.github}` : ''}

CANDIDATE'S RESUME SUMMARY:
Tagline: ${resumeData?.tagline || ''}
Summary: ${resumeData?.summary || ''}
Top experience: ${(resumeData?.experience || []).slice(0, 2).map(e => `${e.title} at ${e.company} — ${(e.bullets || []).slice(0, 2).join('; ')}`).join('\n')}

${companyName ? `COMPANY: ${companyName}` : ''}
${hiringManager ? `HIRING MANAGER: ${hiringManager}` : ''}

Return ONLY this exact JSON structure (no markdown, no code blocks):
{
  "subject": "Application for [Job Title] — [Candidate Name]",
  "greeting": "Dear ${hiringManager ? hiringManager : 'Hiring Manager'},",
  "paragraphs": [
    "Opening paragraph...",
    "Body paragraph 1...",
    "Body paragraph 2...",
    "Closing paragraph with CTA..."
  ],
  "closing": "Sincerely,",
  "signature": "${userProfile.name || 'Your Name'}"
}`;

  const result = await callGemini(apiKey, prompt);
  // Validate structure
  if (!result.paragraphs || !Array.isArray(result.paragraphs)) {
    throw new Error('Cover letter generation returned unexpected structure. Please try again.');
  }
  return result;
}
