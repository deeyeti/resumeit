# ResumeIt v1.2.0 📝

> **AI-Driven Resume Generator for Software Engineers**  
> Open Source · Privacy-First · No Backend

[![Deploy to GitHub Pages](https://github.com/deeyeti/resumeit/actions/workflows/deploy.yml/badge.svg)](https://github.com/deeyeti/resumeit/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-6c63ff.svg)](LICENSE)
[![Version](https://img.shields.io/github/v/release/deeyeti/resumeit?color=10d9a0)](https://github.com/deeyeti/resumeit/releases)

---

## ✨ What is ResumeIt?

ResumeIt is a **client-side, AI-powered resume generator** built specifically for software engineers. Paste a job description, and it automatically generates a tailored, ATS-optimized resume by combining:

- 🧠 Your **Memory Vault** — a structured database of your experiences and achievements
- 🐙 Your **GitHub profile** — repos, language stats, and recent activity
- ✨ **Google Gemini AI** — to rank, rewrite, and format everything for the target role

**100% private. No backend. No data collection. Everything stays in your browser.**

---

## 🚀 Live Demo

👉 **[resumeit.app](https://deeyeti.github.io/resumeit)** — just open and use, no install needed

---

## ⚡ Features

| Feature | Description |
|---|---|
| 🎯 **JD-Tailored Generation** | Paste any job description → get a resume optimized for it |
| 📐 **Six Resume Templates** | Live-switch between Classic, Modern, Minimal, Compact, Executive, and Technical layouts |
| 🎨 **Design Controls** | Set a default template, then choose one of five accent colors and three font pairings |
| 👁️ **Live Template Browser** | Browse live miniature previews, inspect a full preview, and apply a template without re-generating content |
| 📄 **1- or 2-Page Target** | Choose a concise one-page resume or allow up to two pages of detail |
| 🎛️ **Content Controls** | Choose included sections, highlight skills/languages, prioritise Vault entries, and add custom instructions |
| 🗄️ **Memory Vault** | Persistent local DB of your experiences (IndexedDB) |
| 🐙 **GitHub Integration** | Auto-fetches repos, languages, and activity signals |
| 🧠 **AI Relevance Ranking** | Gemini scores each vault entry against the JD before writing |
| 📄 **PDF Export** | ATS-compliant, single-column PDF output |
| 📂 **Resume Library** | Save and re-download past resumes |
| 📥 **Resume & JD Upload** | Upload PDF/DOCX for your existing resume or job description — AI extracts context automatically |
| ✉️ **AI Cover Letter** | Generate a tailored cover letter with tone options, hiring manager field, inline preview, copy & download |
| 🔒 **Zero-Tracking** | API keys and data stored only in browser localStorage/IndexedDB |

### Resume customisation and templates

Before generation, use **Resume preferences** to control the output without editing the job description:

- Select a **1-page** concise target or permit up to **2 pages** for more detail.
- Include only the sections you want: summary, skills and languages, experience, projects, education, and certifications.
- Add skills or languages that should be emphasised in the generated content.
- Prioritise specific Memory Vault entries, or let ResumeIt rank the full Vault automatically.
- Add any other instructions, such as focusing on a particular project or leadership impact.

These choices are used in the AI prompt, applied to the live preview and PDF export, and saved with each resume in your library.

Version 1.1 added a **Templates** workspace where you can select a global default design, change its accent color and font pairing, and preview all six layouts with sample resume data. At the generator preview step, templates switch instantly without another Gemini request.

Version 1.2 adds **AI Cover Letter generation** and **file upload** support for both job descriptions and existing resumes, along with a significantly enhanced ATS-maximization prompt engine.

The Compact template uses a two-column presentation to fit dense technical profiles. It includes an in-app ATS caution because older applicant tracking systems may read columns less reliably.

---

## 🛠️ Getting Started

### Option 1: Use the hosted version (recommended)
Just visit **[deeyeti.github.io/resumeit](https://deeyeti.github.io/resumeit)** — always up to date, no setup needed.

### Option 2: Run locally
```bash
git clone https://github.com/deeyeti/resumeit.git
cd resumeit
# Open index.html in your browser — no server required
```

Or with a simple local server:
```bash
npx serve .
# Then open http://localhost:3000
```

### Prerequisites
- A free **Google Gemini API key** → [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- A **GitHub username** (optional, for repo/language signals)

---

## 🔑 Getting Your Gemini API Key (Free)

ResumeIt uses the **Google Gemini API** to generate and rank resume content. You supply your own key — it's free for personal use, stays in your browser, and is never sent to any third-party server.

### Step-by-step guide

**1. Go to Google AI Studio**  
Open [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) in your browser.  
You will need a Google account (any Gmail or Google Workspace account works).

**2. Sign in**  
Click **Sign in with Google** and complete the authentication flow.

**3. Agree to Terms of Service** *(first time only)*  
If prompted, accept the Google AI API Terms of Service to activate your account.

**4. Create an API key**  
- Click the **"Create API key"** button (top-left or centre of the page).
- Choose **"Create API key in new project"** — a new project is created automatically.
- Your new key appears immediately (starts with `AIza...`).

**5. Copy your key**  
Click the copy icon next to your key. Keep this key private — treat it like a password.

**6. Paste it into ResumeIt**  
- Open ResumeIt and complete the onboarding wizard, **or** go to **Settings → API Configuration**.
- Paste the key into the **Gemini API key** field.
- Click **Validate** to confirm it works.
- Click **Save settings**.

### Is it really free?

Yes. Google's Gemini free tier (`gemini-2.0-flash`) provides:
- **1,500 requests/day**
- **1 million tokens/minute**

Generating one resume typically uses ~1,500–3,000 tokens. You can generate **hundreds of resumes per day** at no cost.

> ⚠️ **Never share your API key publicly** (e.g., in a public GitHub repo, Discord, or screenshot). Anyone with your key can consume your quota. If you accidentally expose it, rotate it immediately at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

### Troubleshooting

| Error | Solution |
|---|---|
| `Invalid API key` | Make sure you copied the full key (starts with `AIza`) with no extra spaces |
| `API key not valid. Please pass a valid API key.` | Regenerate the key in AI Studio — sometimes new keys take 60s to activate |
| `Rate limit exceeded` | You've hit the free-tier limit. Wait 60 seconds or check [quota usage](https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas) |
| Key not saved after refresh | Your browser may be blocking `localStorage`. Try disabling private/incognito mode |

---

## 🏗️ Architecture

```
resumeit/
├── index.html              # App shell & all views (SPA)
├── style.css               # Dark glassmorphism design system
├── app.js                  # Router, state, UI rendering
└── modules/
    ├── vault.js            # IndexedDB CRUD (Memory Vault)
    ├── github.js           # GitHub REST API integration
    ├── llm.js              # Gemini API orchestration
    ├── parser.js           # Client-side PDF/DOCX parser
    ├── exporter.js         # PDF/preview rendering and page controls
    └── templates/          # Template registry, shared renderer, and six layouts
        ├── index.js        # Template registry and selection helpers
        ├── shared.js       # ATS HTML/CSS primitives and preview fixture
        ├── classic.js      # Traditional single-column layout
        ├── modern.js       # Accent-led technology layout
        ├── minimal.js      # Whitespace-forward layout
        ├── compact.js      # Dense two-column layout
        ├── executive.js    # Leadership header-band layout
        └── technical.js    # Monospace, grid-inspired layout
```

**Tech stack:** Vanilla HTML + CSS + JavaScript ES Modules. No framework, no build step, no bundler.

**External APIs (only these two):**
- `generativelanguage.googleapis.com` — Google Gemini AI
- `api.github.com` — GitHub REST API

---

## 🔒 Privacy & Security

- Your Gemini API key is stored **only in `localStorage`** — never sent to any server other than Google's
- All resume data lives in **IndexedDB** in your browser
- No analytics, no telemetry, no server
- You can clear everything anytime via Settings → Clear All Data

---

## 🤝 Contributing

Contributions are welcome! Please follow the [GitFlow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow) branching strategy:

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/): `git commit -m "feat: add cover letter generation"`
4. Push and open a Pull Request against `main`

### Commit Convention
```
feat:     New feature
fix:      Bug fix
docs:     Documentation changes
style:    Formatting, no logic change
refactor: Code refactor
chore:    Maintenance tasks
```

---

## 📦 Versioning & Releases

This project uses **semantic versioning** (`MAJOR.MINOR.PATCH`).

To create a new release:
```bash
git tag v1.2.0
git push origin v1.2.0
# GitHub Actions will automatically create a GitHub Release with changelog
```

---

## 📄 License

MIT © [deeyeti](https://github.com/deeyeti)
