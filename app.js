/**
 * app.js - ResumeIt Main Application
 * Handles routing, state, UI rendering, and orchestration of all modules.
 */

import { initDB, getAllVaultEntries, addVaultEntry, updateVaultEntry, deleteVaultEntry, clearVault, saveResume, getAllResumes, deleteResume, clearResumes } from './modules/vault.js';
import { fetchGitHubProfile, validateGitHubUser } from './modules/github.js';
import { rankVaultEntries, generateResume, validateApiKey, improveResumeBullet } from './modules/llm.js';
import { parseResume, extractVaultEntriesFromText } from './modules/parser.js';
import { renderResumePreview, exportToPDF, getResumeFilename, resumeToHTML } from './modules/exporter.js';

// ===== STATE =====
const state = {
  currentPage: 'dashboard',
  vaultEntries: [],
  savedResumes: [],
  githubData: null,
  currentResume: null,
  generatorStep: 0,
  isGenerating: false,
  settings: {},
};

// ===== LOCAL STORAGE HELPERS =====
const ls = {
  get: (k, fallback = null) => {
    try { return JSON.parse(localStorage.getItem(`resumeit_${k}`)) ?? fallback; }
    catch { return fallback; }
  },
  set: (k, v) => localStorage.setItem(`resumeit_${k}`, JSON.stringify(v)),
  remove: (k) => localStorage.removeItem(`resumeit_${k}`),
};

function getSettings() {
  return {
    apiKey: ls.get('api_key', ''),
    github: ls.get('github', ''),
    name: ls.get('name', ''),
    email: ls.get('email', ''),
    linkedin: ls.get('linkedin', ''),
    location: ls.get('location', ''),
    onboarded: ls.get('onboarded', false),
  };
}

function saveSettings(settings) {
  Object.entries(settings).forEach(([k, v]) => ls.set(k, v));
}

// ===== TOAST SYSTEM =====
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
    <span class="toast-close" onclick="this.parentElement.remove()">✕</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ===== ROUTER =====
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  state.currentPage = page;

  // Update topbar
  const titles = {
    dashboard: ['Dashboard', 'Overview of your resume activity'],
    vault: ['Memory Vault', 'Your experiences, projects & achievements'],
    generate: ['Resume Generator', 'Generate a tailored, ATS-optimized resume'],
    resumes: ['Saved Resumes', 'Your previously generated resumes'],
    settings: ['Settings', 'Configure your API keys and preferences'],
  };

  const [title, subtitle] = titles[page] || ['ResumeIt', ''];
  document.getElementById('topbar-title').textContent = title;
  document.getElementById('topbar-subtitle').textContent = subtitle;

  if (page === 'dashboard') renderDashboard();
  if (page === 'vault') renderVault();
  if (page === 'resumes') renderResumes();
  if (page === 'settings') renderSettings();
  if (page === 'generate') initGenerator();
}

// ===== ONBOARDING =====
let onboardingStep = 0;
const ONBOARDING_STEPS = 3;

function showOnboarding() {
  document.getElementById('app').classList.add('d-none');
  document.getElementById('onboarding').classList.remove('d-none');
  gotoOnboardingStep(0);
}

function hideOnboarding() {
  document.getElementById('onboarding').classList.add('d-none');
  document.getElementById('app').classList.remove('d-none');
}

function gotoOnboardingStep(step) {
  onboardingStep = step;
  document.querySelectorAll('.onboarding-step').forEach((el, i) => {
    el.classList.toggle('active', i === step);
  });

  document.querySelectorAll('.onboarding-step-dot').forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i === step) dot.classList.add('active');
    else if (i < step) dot.classList.add('done');
  });

  // Update nav button states
  const backBtn = document.getElementById('ob-back');
  const nextBtn = document.getElementById('ob-next');
  if (backBtn) backBtn.style.display = step === 0 ? 'none' : 'block';
  if (nextBtn) nextBtn.textContent = step === ONBOARDING_STEPS - 1 ? '🚀 Launch App' : 'Continue →';
}

async function onboardingNext() {
  const settings = getSettings();

  if (onboardingStep === 0) {
    const apiKey = document.getElementById('ob-api-key')?.value?.trim();
    const name = document.getElementById('ob-name')?.value?.trim();

    if (!apiKey) { showToast('Please enter your Gemini API key', 'error'); return; }
    if (!name) { showToast('Please enter your name', 'error'); return; }

    const btn = document.getElementById('ob-next');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Validating...';

    try {
      await validateApiKey(apiKey);
      ls.set('api_key', apiKey);
      ls.set('name', name);
      ls.set('email', document.getElementById('ob-email')?.value?.trim() || '');
      showToast('API key validated successfully!', 'success');
      gotoOnboardingStep(1);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Continue →';
    }
    return;
  }

  if (onboardingStep === 1) {
    const github = document.getElementById('ob-github')?.value?.trim();

    if (github) {
      const btn = document.getElementById('ob-next');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Connecting...';

      try {
        await validateGitHubUser(github);
        ls.set('github', github);
        showToast(`Connected to github.com/${github}`, 'success');
      } catch (e) {
        showToast(e.message, 'warning');
        // Don't block progress if GitHub fails
      } finally {
        btn.disabled = false;
        btn.innerHTML = 'Continue →';
      }
    }

    ls.set('linkedin', document.getElementById('ob-linkedin')?.value?.trim() || '');
    ls.set('location', document.getElementById('ob-location')?.value?.trim() || '');
    gotoOnboardingStep(2);
    return;
  }

  if (onboardingStep === 2) {
    // Final step - finish onboarding
    ls.set('onboarded', true);
    hideOnboarding();
    await refreshData();
    navigate('dashboard');
    showToast('Welcome to ResumeIt! 🎉', 'success');
    return;
  }
}

// ===== DATA REFRESH =====
async function refreshData() {
  state.settings = getSettings();
  state.vaultEntries = await getAllVaultEntries();
  state.savedResumes = await getAllResumes();
  updateNavBadges();
}

function updateNavBadges() {
  const vaultBadge = document.querySelector('[data-page="vault"] .nav-badge');
  if (vaultBadge) vaultBadge.textContent = state.vaultEntries.length;
}

// ===== DASHBOARD =====
async function renderDashboard() {
  const settings = getSettings();
  const vaultCount = state.vaultEntries.length;
  const resumeCount = state.savedResumes.length;

  document.getElementById('stat-vault').textContent = vaultCount;
  document.getElementById('stat-resumes').textContent = resumeCount;
  document.getElementById('stat-github').textContent = settings.github || '—';

  // Recent resumes
  const recentEl = document.getElementById('recent-resumes');
  if (state.savedResumes.length === 0) {
    recentEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📄</div>
        <div class="empty-state-title">No resumes yet</div>
        <div class="empty-state-desc">Generate your first tailored resume by pasting a job description</div>
        <button class="btn btn-primary mt-16" onclick="navigate('generate')">✨ Generate Resume</button>
      </div>`;
  } else {
    const recents = [...state.savedResumes].reverse().slice(0, 3);
    recentEl.innerHTML = recents.map(r => `
      <div class="resume-list-item" onclick="viewSavedResume(${r.id})">
        <div class="rli-icon">📄</div>
        <div class="rli-info">
          <div class="rli-title">${escHtml(r.jobTitle || 'Resume')}</div>
          <div class="rli-meta">${formatDate(r.createdAt)} · ${r.company || 'General'}</div>
        </div>
        <div class="rli-actions">
          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); downloadResume(${r.id})">⬇️ PDF</button>
        </div>
      </div>`).join('');
  }

  // Vault tips
  if (vaultCount === 0) {
    document.getElementById('vault-tip').classList.remove('d-none');
  }
}

// ===== MEMORY VAULT =====
function renderVault() {
  const container = document.getElementById('vault-entries');

  if (state.vaultEntries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🗄️</div>
        <div class="empty-state-title">Memory Vault is empty</div>
        <div class="empty-state-desc">Add your work experiences, projects, and achievements. The AI uses these to build your resume.</div>
        <button class="btn btn-primary mt-16" onclick="openVaultModal()">+ Add First Entry</button>
      </div>`;
    return;
  }

  container.innerHTML = state.vaultEntries.map(entry => `
    <div class="vault-entry animate-fade-in-up" id="vault-entry-${entry.id}">
      <div class="vault-entry-header">
        <div>
          <div class="vault-entry-title">${escHtml(entry.title)}</div>
          <div class="vault-entry-context">${escHtml(entry.context || '')}</div>
        </div>
        <div class="vault-entry-actions">
          <button class="btn btn-sm btn-secondary btn-icon" onclick="openVaultModal(${entry.id})" title="Edit">✏️</button>
          <button class="btn btn-sm btn-danger btn-icon" onclick="confirmDeleteVault(${entry.id})" title="Delete">🗑️</button>
        </div>
      </div>
      <div class="vault-entry-meta">
        ${entry.dateRange ? `<span>📅 ${escHtml(entry.dateRange)}</span>` : ''}
        ${entry.type ? `<span><span class="tag tag-${entry.type === 'experience' ? 'purple' : entry.type === 'project' ? 'emerald' : 'amber'}">${entry.type}</span></span>` : ''}
      </div>
      ${entry.bulletPoints?.length ? `
        <div class="vault-entry-bullets">
          ${entry.bulletPoints.slice(0, 3).map(b => `<div class="vault-entry-bullet">${escHtml(b)}</div>`).join('')}
          ${entry.bulletPoints.length > 3 ? `<div class="text-muted" style="font-size:0.78rem;margin-top:4px;">+${entry.bulletPoints.length - 3} more bullets</div>` : ''}
        </div>` : ''}
      ${entry.techStack?.length ? `
        <div class="vault-entry-stack">
          ${entry.techStack.map(t => `<span class="tag tag-sky">${escHtml(t)}</span>`).join('')}
        </div>` : ''}
    </div>
  `).join('');
}

// ===== VAULT MODAL =====
let vaultModalEntryId = null;
let currentTechStack = [];
let currentBullets = [];

function openVaultModal(entryId = null) {
  vaultModalEntryId = entryId;
  currentTechStack = [];
  currentBullets = [];

  const modal = document.getElementById('vault-modal');
  const title = document.getElementById('vault-modal-title');

  // Reset form
  document.getElementById('vm-title').value = '';
  document.getElementById('vm-context').value = '';
  document.getElementById('vm-date-range').value = '';
  document.getElementById('vm-type').value = 'experience';
  document.getElementById('vm-tech-tags').innerHTML = '';
  document.getElementById('vm-bullets-list').innerHTML = '';
  document.getElementById('vm-tech-input').value = '';
  document.getElementById('vm-bullet-input').value = '';

  if (entryId) {
    title.textContent = 'Edit Entry';
    const entry = state.vaultEntries.find(e => e.id === entryId);
    if (entry) {
      document.getElementById('vm-title').value = entry.title || '';
      document.getElementById('vm-context').value = entry.context || '';
      document.getElementById('vm-date-range').value = entry.dateRange || '';
      document.getElementById('vm-type').value = entry.type || 'experience';
      currentTechStack = [...(entry.techStack || [])];
      currentBullets = [...(entry.bulletPoints || [])];
      renderTechTags();
      renderBullets();
    }
  } else {
    title.textContent = 'Add Experience';
  }

  modal.classList.add('open');
  setTimeout(() => document.getElementById('vm-title').focus(), 100);
}

function closeVaultModal() {
  document.getElementById('vault-modal').classList.remove('open');
  vaultModalEntryId = null;
}

function renderTechTags() {
  const container = document.getElementById('vm-tech-tags');
  container.innerHTML = currentTechStack.map((t, i) => `
    <span class="tag tag-sky">${escHtml(t)} <span class="tag-remove" onclick="removeTech(${i})">✕</span></span>
  `).join('');
}

function removeTech(index) {
  currentTechStack.splice(index, 1);
  renderTechTags();
}

function addTech() {
  const input = document.getElementById('vm-tech-input');
  const val = input.value.trim();
  if (val && !currentTechStack.includes(val)) {
    currentTechStack.push(val);
    renderTechTags();
  }
  input.value = '';
  input.focus();
}

function renderBullets() {
  const container = document.getElementById('vm-bullets-list');
  container.innerHTML = currentBullets.map((b, i) => `
    <div class="vault-entry-bullet" style="align-items:flex-start; gap:8px;">
      <span style="color:var(--accent-primary);flex-shrink:0;margin-top:2px;">▸</span>
      <span style="flex:1;font-size:0.82rem;">${escHtml(b)}</span>
      <button class="btn btn-sm btn-ghost btn-icon" style="padding:2px 6px;" onclick="removeBullet(${i})">✕</button>
    </div>
  `).join('');
}

function removeBullet(index) {
  currentBullets.splice(index, 1);
  renderBullets();
}

function addBullet() {
  const input = document.getElementById('vm-bullet-input');
  const val = input.value.trim();
  if (val) {
    currentBullets.push(val);
    renderBullets();
  }
  input.value = '';
  input.focus();
}

async function saveVaultEntry() {
  const title = document.getElementById('vm-title').value.trim();
  const context = document.getElementById('vm-context').value.trim();
  const dateRange = document.getElementById('vm-date-range').value.trim();
  const type = document.getElementById('vm-type').value;

  if (!title) { showToast('Please enter a title', 'error'); return; }

  const entryData = {
    title, context, dateRange, type,
    techStack: currentTechStack,
    bulletPoints: currentBullets,
  };

  try {
    if (vaultModalEntryId) {
      await updateVaultEntry(vaultModalEntryId, entryData);
      showToast('Entry updated!', 'success');
    } else {
      await addVaultEntry(entryData);
      showToast('Entry added to Memory Vault!', 'success');
    }

    closeVaultModal();
    state.vaultEntries = await getAllVaultEntries();
    updateNavBadges();
    renderVault();
    if (state.currentPage === 'dashboard') renderDashboard();
  } catch (e) {
    showToast('Failed to save entry: ' + e.message, 'error');
  }
}

async function confirmDeleteVault(id) {
  const entry = state.vaultEntries.find(e => e.id === id);
  showConfirm(
    '🗑️ Delete Entry',
    `Are you sure you want to delete "${entry?.title}"? This cannot be undone.`,
    async () => {
      await deleteVaultEntry(id);
      state.vaultEntries = await getAllVaultEntries();
      updateNavBadges();
      renderVault();
      showToast('Entry deleted', 'info');
    }
  );
}

// ===== GENERATOR =====
let generatorState = {
  jd: '',
  githubData: null,
  rankedEntries: [],
  generatedResume: null,
  currentStep: 0,
};

function initGenerator() {
  generatorState.currentStep = 0;
  generatorState.jd = '';
  generatorState.githubData = null;
  generatorState.rankedEntries = [];
  generatorState.generatedResume = null;

  // Reset visibility
  const step0 = document.getElementById('gen-step-0');
  const processingPanel = document.getElementById('gen-processing-panel');
  const step4 = document.getElementById('gen-step-4');
  if (step0) step0.style.display = 'block';
  if (processingPanel) processingPanel.classList.add('d-none');
  if (step4) step4.style.display = 'none';

  const jdInput = document.getElementById('jd-input');
  if (jdInput) jdInput.value = '';

  const previewContainer = document.getElementById('resume-preview-container');
  if (previewContainer) previewContainer.innerHTML = '';

  const githubPanel = document.getElementById('github-stats-panel');
  if (githubPanel) githubPanel.innerHTML = '';

  const rankedWrapper = document.getElementById('ranked-entries-wrapper');
  if (rankedWrapper) rankedWrapper.style.display = 'none';

  const progressBar = document.getElementById('gen-progress-bar');
  if (progressBar) progressBar.style.width = '0%';

  // Reset step wizard
  document.querySelectorAll('.step-item').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i === 0) el.classList.add('active');
  });
}

function showGeneratorStep(step) {
  generatorState.currentStep = step;

  // Handle step panels visibility
  const step0 = document.getElementById('gen-step-0');
  const processingPanel = document.getElementById('gen-processing-panel');
  const step4 = document.getElementById('gen-step-4');

  if (step === 0) {
    step0.style.display = 'block';
    processingPanel.classList.add('d-none');
    step4.style.display = 'none';
  } else if (step >= 1 && step <= 3) {
    step0.style.display = 'none';
    processingPanel.classList.remove('d-none');
    step4.style.display = 'none';
    // Show ranked entries list once we reach step 2+
    if (step >= 2) {
      const rankedWrapper = document.getElementById('ranked-entries-wrapper');
      if (rankedWrapper) rankedWrapper.style.display = 'block';
    }
  } else if (step === 4) {
    step0.style.display = 'none';
    processingPanel.classList.add('d-none');
    step4.style.display = 'block';
  }

  // Update wizard step indicators
  document.querySelectorAll('.step-item').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i === step) el.classList.add('active');
    else if (i < step) el.classList.add('done');
  });

  const progress = Math.round((step / 4) * 100);
  document.getElementById('gen-progress-bar').style.width = `${progress}%`;
}

async function startGeneration() {
  const jd = document.getElementById('jd-input').value.trim();
  if (!jd || jd.length < 50) {
    showToast('Please paste a complete job description (at least 50 characters)', 'error');
    return;
  }

  const settings = getSettings();
  if (!settings.apiKey) {
    showToast('Please configure your Gemini API key in Settings', 'error');
    navigate('settings');
    return;
  }

  generatorState.jd = jd;
  generatorState.githubData = null;
  generatorState.rankedEntries = [];
  generatorState.generatedResume = null;

  showGeneratorStep(1);

  const statusEl = document.getElementById('gen-status');
  const statusIcon = document.getElementById('gen-status-icon');
  const statusText = document.getElementById('gen-status-text');

  // Step 1: Fetch GitHub data
  if (settings.github) {
    statusIcon.textContent = '⚙️';
    statusText.textContent = 'Fetching GitHub activity...';

    try {
      generatorState.githubData = await fetchGitHubProfile(settings.github);
      renderGitHubStats(generatorState.githubData);
      statusIcon.textContent = '✅';
      statusText.textContent = `GitHub data loaded — ${generatorState.githubData.repos.length} repos found`;
    } catch (e) {
      statusIcon.textContent = '⚠️';
      statusText.textContent = `GitHub: ${e.message}`;
    }
  } else {
    statusIcon.textContent = 'ℹ️';
    statusText.textContent = 'No GitHub handle configured — skipping';
  }

  showGeneratorStep(2);

  // Step 2: Rank vault entries
  if (state.vaultEntries.length > 0) {
    statusIcon.textContent = '🧠';
    statusText.textContent = `Ranking ${state.vaultEntries.length} Memory Vault entries against JD...`;

    try {
      generatorState.rankedEntries = await rankVaultEntries(settings.apiKey, jd, state.vaultEntries);
      renderRankedEntries(generatorState.rankedEntries);
      statusIcon.textContent = '✅';
      statusText.textContent = `Ranked ${generatorState.rankedEntries.length} entries by relevance`;
    } catch (e) {
      showToast('Ranking failed: ' + e.message, 'error');
      generatorState.rankedEntries = state.vaultEntries;
    }
  } else {
    statusIcon.textContent = 'ℹ️';
    statusText.textContent = 'Memory Vault is empty — generating from GitHub data only';
  }

  showGeneratorStep(3);

  // Step 3: Generate resume
  statusIcon.textContent = '✨';
  statusText.textContent = 'Generating tailored resume with Gemini...';

  try {
    const userProfile = {
      name: settings.name,
      email: settings.email,
      github: settings.github,
      linkedin: settings.linkedin,
      location: settings.location,
    };

    generatorState.generatedResume = await generateResume(
      settings.apiKey,
      jd,
      generatorState.rankedEntries,
      generatorState.githubData,
      userProfile
    );

    statusIcon.textContent = '🎉';
    statusText.textContent = 'Resume generated successfully!';

    showGeneratorStep(4);
    renderResumeResult(generatorState.generatedResume);

  } catch (e) {
    showToast('Generation failed: ' + e.message, 'error');
    showGeneratorStep(0);
  }
}

function renderGitHubStats(data) {
  const container = document.getElementById('github-stats-panel');
  if (!data) { container.innerHTML = ''; return; }

  const topLangs = data.languages.slice(0, 4);

  container.innerHTML = `
    <div class="section-header" style="margin-bottom:14px;">
      <div>
        <div class="section-title">GitHub Profile</div>
        <div class="section-subtitle">@${data.user.login}</div>
      </div>
      <img src="${data.user.avatar}" style="width:36px;height:36px;border-radius:50%;border:2px solid var(--border-active);" alt="avatar">
    </div>
    <div class="github-stats-grid">
      <div class="github-stat-item">
        <div class="gsv text-accent">${data.user.publicRepos}</div>
        <div class="gsl">Public Repos</div>
      </div>
      <div class="github-stat-item">
        <div class="gsv text-accent">${data.activity.recentCommits}</div>
        <div class="gsl">Recent Commits</div>
      </div>
      <div class="github-stat-item">
        <div class="gsv text-accent">${data.user.followers}</div>
        <div class="gsl">Followers</div>
      </div>
      <div class="github-stat-item">
        <div class="gsv text-accent">${data.topRepos.reduce((s, r) => s + r.stars, 0)}</div>
        <div class="gsl">Total Stars</div>
      </div>
    </div>
    <div style="margin-top:14px;">
      <div class="section-title" style="font-size:0.8rem;margin-bottom:8px;">Top Languages</div>
      ${topLangs.map(l => `
        <div class="lang-bar">
          <div class="lang-bar-label"><span>${l.lang}</span><span>${l.percent}%</span></div>
          <div class="progress"><div class="progress-bar" style="width:${l.percent}%; background: var(--gradient-primary);"></div></div>
        </div>`).join('')}
    </div>`;
}

function renderRankedEntries(entries) {
  const container = document.getElementById('ranked-entries-list');
  if (!container) return;

  container.innerHTML = entries.map(e => `
    <div class="d-flex gap-12 items-center" style="padding:8px 0; border-bottom:1px solid var(--border-subtle);">
      <div style="flex:1;">
        <div style="font-size:0.82rem;font-weight:600;">${escHtml(e.title)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${escHtml(e.context || '')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:0.9rem;font-weight:700;color:${e.relevanceScore >= 70 ? 'var(--accent-emerald)' : e.relevanceScore >= 40 ? 'var(--accent-amber)' : 'var(--text-muted)'};">${e.relevanceScore}%</div>
        <div style="font-size:0.68rem;color:var(--text-muted);">relevance</div>
      </div>
    </div>
  `).join('');
}

function renderResumeResult(data) {
  const container = document.getElementById('resume-preview-container');
  renderResumePreview(container, data);
}

async function saveCurrentResume() {
  if (!generatorState.generatedResume) return;
  const settings = getSettings();

  const resumeData = {
    jobTitle: generatorState.generatedResume.tagline || 'Resume',
    company: '',
    jd: generatorState.jd,
    resumeData: generatorState.generatedResume,
  };

  try {
    await saveResume(resumeData);
    state.savedResumes = await getAllResumes();
    showToast('Resume saved!', 'success');
    updateNavBadges();
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  }
}

async function exportCurrentResume() {
  if (!generatorState.generatedResume) return;

  const btn = document.getElementById('export-pdf-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating PDF...';

  try {
    const filename = getResumeFilename(generatorState.generatedResume);
    await exportToPDF(generatorState.generatedResume, filename);
    showToast('PDF exported!', 'success');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⬇️ Export PDF';
  }
}

// ===== SAVED RESUMES =====
function renderResumes() {
  const container = document.getElementById('saved-resumes-list');

  if (state.savedResumes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📂</div>
        <div class="empty-state-title">No saved resumes</div>
        <div class="empty-state-desc">Generated resumes will appear here after you save them</div>
        <button class="btn btn-primary mt-16" onclick="navigate('generate')">✨ Generate Resume</button>
      </div>`;
    return;
  }

  const sorted = [...state.savedResumes].reverse();
  container.innerHTML = sorted.map(r => `
    <div class="resume-list-item" onclick="viewSavedResume(${r.id})">
      <div class="rli-icon">📄</div>
      <div class="rli-info">
        <div class="rli-title">${escHtml(r.jobTitle || 'Resume')}</div>
        <div class="rli-meta">${formatDate(r.createdAt)} · ${r.company || 'General'}</div>
      </div>
      <div class="rli-actions">
        <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); downloadResume(${r.id})">⬇️ PDF</button>
        <button class="btn btn-sm btn-danger btn-icon" onclick="event.stopPropagation(); confirmDeleteResume(${r.id})">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function viewSavedResume(id) {
  const resume = state.savedResumes.find(r => r.id === id);
  if (!resume) return;

  generatorState.generatedResume = resume.resumeData;
  navigate('generate');
  showGeneratorStep(4);
  setTimeout(() => renderResumeResult(resume.resumeData), 100);
}

async function downloadResume(id) {
  const resume = state.savedResumes.find(r => r.id === id);
  if (!resume?.resumeData) return;

  try {
    await exportToPDF(resume.resumeData, getResumeFilename(resume.resumeData));
    showToast('PDF exported!', 'success');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error');
  }
}

async function confirmDeleteResume(id) {
  showConfirm('🗑️ Delete Resume', 'Delete this saved resume? This cannot be undone.', async () => {
    await deleteResume(id);
    state.savedResumes = await getAllResumes();
    renderResumes();
    showToast('Resume deleted', 'info');
  });
}

// ===== SETTINGS =====
function renderSettings() {
  const s = getSettings();
  document.getElementById('set-name').value = s.name || '';
  document.getElementById('set-email').value = s.email || '';
  document.getElementById('set-github').value = s.github || '';
  document.getElementById('set-linkedin').value = s.linkedin || '';
  document.getElementById('set-location').value = s.location || '';
  document.getElementById('set-api-key').value = s.apiKey || '';
}

async function saveSettingsForm() {
  const settings = {
    name: document.getElementById('set-name').value.trim(),
    email: document.getElementById('set-email').value.trim(),
    github: document.getElementById('set-github').value.trim(),
    linkedin: document.getElementById('set-linkedin').value.trim(),
    location: document.getElementById('set-location').value.trim(),
    api_key: document.getElementById('set-api-key').value.trim(),
  };

  saveSettings(settings);
  state.settings = getSettings();
  showToast('Settings saved!', 'success');
}

async function validateApiKeyFromSettings() {
  const key = document.getElementById('set-api-key').value.trim();
  if (!key) { showToast('Please enter an API key', 'error'); return; }

  const btn = document.getElementById('validate-key-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Validating...';

  try {
    await validateApiKey(key);
    showToast('API key is valid! ✅', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '✓ Validate Key';
  }
}

function clearAllData() {
  showConfirm(
    '⚠️ Clear All Data',
    'This will permanently delete ALL your Memory Vault entries, saved resumes, and settings. This cannot be undone.',
    async () => {
      await clearVault();
      await clearResumes();
      localStorage.clear();
      showToast('All data cleared. Reloading...', 'info');
      setTimeout(() => location.reload(), 1500);
    },
    true // danger mode
  );
}

// ===== CONFIRM DIALOG =====
let confirmCallback = null;

function showConfirm(title, desc, onConfirm, isDanger = false) {
  confirmCallback = onConfirm;
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-desc').textContent = desc;
  const btn = document.getElementById('confirm-ok-btn');
  btn.className = `btn ${isDanger ? 'btn-danger' : 'btn-primary'}`;
  btn.textContent = isDanger ? '⚠️ Yes, Delete All' : '✓ Confirm';
  document.getElementById('confirm-modal').classList.add('open');
}

function closeConfirm() {
  document.getElementById('confirm-modal').classList.remove('open');
  confirmCallback = null;
}

function executeConfirm() {
  if (confirmCallback) confirmCallback();
  closeConfirm();
}

// ===== FILE UPLOAD HANDLING =====
async function handleResumeUpload(file) {
  if (!file) return;

  const settings = getSettings();
  if (!settings.apiKey) {
    showToast('Gemini API key required to parse resume', 'error');
    return;
  }

  showToast('Parsing resume...', 'info', 8000);

  try {
    const text = await parseResume(file);
    const entries = await extractVaultEntriesFromText(settings.apiKey, text);

    if (entries.length === 0) {
      showToast('Could not extract entries from resume', 'warning');
      return;
    }

    let added = 0;
    for (const entry of entries) {
      await addVaultEntry(entry);
      added++;
    }

    state.vaultEntries = await getAllVaultEntries();
    updateNavBadges();

    showToast(`✅ Added ${added} entries from your resume!`, 'success');

    if (state.currentPage === 'vault') renderVault();
    if (state.currentPage === 'dashboard') renderDashboard();

  } catch (e) {
    showToast('Failed to parse resume: ' + e.message, 'error');
  }
}

// ===== UTILITY =====
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return isoStr; }
}

function toggleApiKeyVisibility(inputId) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ===== GLOBAL EXPOSURE (for onclick handlers) =====
Object.assign(window, {
  navigate,
  openVaultModal,
  closeVaultModal,
  saveVaultEntry,
  confirmDeleteVault,
  addTech,
  removeTech,
  addBullet,
  removeBullet,
  startGeneration,
  saveCurrentResume,
  exportCurrentResume,
  viewSavedResume,
  downloadResume,
  confirmDeleteResume,
  saveSettingsForm,
  validateApiKeyFromSettings,
  clearAllData,
  closeConfirm,
  executeConfirm,
  toggleApiKeyVisibility,
});

// ===== INIT =====
(async function init() {
  await initDB();
  await refreshData();

  const settings = getSettings();

  if (!settings.onboarded) {
    showOnboarding();
  } else {
    navigate('dashboard');
  }

  // Wire up onboarding nav buttons
  document.getElementById('ob-next')?.addEventListener('click', onboardingNext);
  document.getElementById('ob-back')?.addEventListener('click', () => {
    if (onboardingStep > 0) gotoOnboardingStep(onboardingStep - 1);
  });
  document.getElementById('ob-skip')?.addEventListener('click', () => {
    ls.set('onboarded', true);
    hideOnboarding();
    navigate('dashboard');
  });

  // Nav clicks
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.page));
  });

  // Keyboard shortcuts for vault modal inputs
  document.getElementById('vm-tech-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTech(); }
  });

  document.getElementById('vm-bullet-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addBullet(); }
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('open');
      }
    });
  });

  // Resume upload in vault page
  const uploadInput = document.getElementById('vault-upload-input');
  if (uploadInput) {
    uploadInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleResumeUpload(e.target.files[0]);
    });
  }

  // Onboarding upload
  const obUpload = document.getElementById('ob-resume-upload');
  if (obUpload) {
    obUpload.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        const fileName = e.target.files[0].name;
        document.getElementById('ob-upload-filename').textContent = `📎 ${fileName}`;
        state._pendingUploadFile = e.target.files[0];
      }
    });
  }

  // Drag and drop
  const uploadAreas = document.querySelectorAll('.upload-area');
  uploadAreas.forEach(area => {
    area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragover'));
    area.addEventListener('drop', (e) => {
      e.preventDefault();
      area.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleResumeUpload(file);
    });
  });

})();
