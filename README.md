# ResumeIt v1.1.0 📝

> **AI-Driven Resume Generator for Software Engineers**  
> Open Source · Privacy-First · Zero Backend

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
| 📥 **Resume Import** | Upload PDF/DOCX → AI extracts entries into your Vault |
| 🔒 **Zero-Tracking** | API keys and data stored only in browser localStorage/IndexedDB |

### Resume customisation and templates

Before generation, use **Resume preferences** to control the output without editing the job description:

- Select a **1-page** concise target or permit up to **2 pages** for more detail.
- Include only the sections you want: summary, skills and languages, experience, projects, education, and certifications.
- Add skills or languages that should be emphasised in the generated content.
- Prioritise specific Memory Vault entries, or let ResumeIt rank the full Vault automatically.
- Add any other instructions, such as focusing on a particular project or leadership impact.

These choices are used in the AI prompt, applied to the live preview and PDF export, and saved with each resume in your library.

Version 1.1 adds a **Templates** workspace where you can select a global default design, change its accent color and font pairing, and preview all six layouts with sample resume data. At the generator preview step, templates switch instantly without another Gemini request. Your selected template, color, font pairing, and section visibility are preserved with saved resumes.

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
git tag v1.1.0
git push origin v1.1.0
# GitHub Actions will automatically create a GitHub Release with changelog
```

---

## 📄 License

MIT © [deeyeti](https://github.com/deeyeti)
