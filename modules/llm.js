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

function buildResumePrompt(jobDescription, rankedEntries, githubData, userProfile) {
  const topEntries = rankedEntries.slice(0, 5);

  return `You are an elite technical resume writer. Generate a complete, ATS-optimized resume for a software engineer.

STRICT RULES:
- Output ONLY valid JSON (no markdown, no code blocks, no extra text)
- Use strong action verbs for bullet points
- Quantify achievements where possible
- Tailor ALL content to the job description below
- Avoid complex formatting (no tables, no columns)
- Keep bullet points concise (under 120 characters each)
- Max 2 pages worth of content

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
      maxOutputTokens: 4096,
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

export async function generateResume(apiKey, jobDescription, rankedEntries, githubData, userProfile) {
  const prompt = buildResumePrompt(jobDescription, rankedEntries, githubData, userProfile);
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
