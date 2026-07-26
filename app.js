/**
 * app.js - ResumeIt Main Application
 * Handles routing, state, UI rendering, and orchestration of all modules.
 */

import { initDB, getAllVaultEntries, addVaultEntry, updateVaultEntry, deleteVaultEntry, clearVault, saveResume, getAllResumes, deleteResume, clearResumes } from './modules/vault.js';
import { fetchGitHubProfile, validateGitHubUser } from './modules/github.js';
import { rankVaultEntries, generateResume, validateApiKey, improveResumeBullet } from './modules/llm.js';
import { parseResume, extractVaultEntriesFromText } from './modules/parser.js';
import { renderResumePreview, renderTemplateThumbnail, exportToPDF, getResumeFilename } from './modules/exporter.js';
import { TEMPLATES, COLOR_THEMES, FONT_PAIRINGS, SAMPLE_RESUME } from './modules/templates/index.js';

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
  templateSelection: null,
  profile: null,
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

const DEFAULT_TEMPLATE_PREFS = {
  defaultTemplateId: 'modern',
  perTemplate: {},
};

function getTemplatePrefs() {
  const prefs = ls.get('template_prefs', DEFAULT_TEMPLATE_PREFS);
  return {
    defaultTemplateId: TEMPLATES.some(template => template.id === prefs?.defaultTemplateId)
      ? prefs.defaultTemplateId
      : DEFAULT_TEMPLATE_PREFS.defaultTemplateId,
    perTemplate: prefs?.perTemplate || {},
  };
}

function saveTemplatePrefs(prefs) {
  ls.set('template_prefs', prefs);
}

function getTemplateSelection(templateId = getTemplatePrefs().defaultTemplateId) {
  const prefs = getTemplatePrefs();
  const selectedTemplateId = TEMPLATES.some(template => template.id === templateId)
    ? templateId
    : prefs.defaultTemplateId;
  const custom = prefs.perTemplate[selectedTemplateId] || {};
  return {
    templateId: selectedTemplateId,
    color: COLOR_THEMES[custom.color] ? custom.color : 'slate',
    fontPairing: FONT_PAIRINGS[custom.fontPairing] ? custom.fontPairing : 'sans',
  };
}

function getCurrentRenderOptions() {
  return {
    ...generatorState.preferences,
    ...generatorState.templateSelection,
  };
}

function persistTemplateSelection(selection, setAsDefault = true) {
  const prefs = getTemplatePrefs();
  prefs.perTemplate[selection.templateId] = {
    color: selection.color,
    fontPairing: selection.fontPairing,
  };
  if (setAsDefault) prefs.defaultTemplateId = selection.templateId;
  saveTemplatePrefs(prefs);
}

// ===== TOAST SYSTEM =====
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const messageEl = document.createElement('span');
  messageEl.className = 'toast-msg';
  messageEl.textContent = message;

  const closeButton = document.createElement('button');
  closeButton.className = 'toast-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Dismiss notification');
  closeButton.textContent = '✕';
  closeButton.addEventListener('click', () => toast.remove());

  toast.append(messageEl, closeButton);

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

  const titles = {
    dashboard: 'Dashboard',
    vault: 'Memory Vault',
    generate: 'Generator',
    resumes: 'Saved Resumes',
    templates: 'Templates',
    settings: 'Settings',
  };

  const nameEl = document.getElementById('topbar-page-name');
  if (nameEl) nameEl.textContent = titles[page] || 'ResumeIt';

  if (page === 'dashboard') renderDashboard();
  if (page === 'vault') renderVault();
  if (page === 'resumes') renderResumes();
  if (page === 'templates') renderTemplateBrowser();
  if (page === 'settings') renderSettings();
  if (page === 'generate') initGenerator();

  const generatorSubnav = document.getElementById('generator-subnav');
  if (generatorSubnav) generatorSubnav.classList.toggle('d-none', page !== 'generate');
  if (page !== 'generate') document.getElementById('sidebar')?.classList.remove('mobile-open');
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
  // Show correct step
  document.querySelectorAll('.ob-step').forEach((el, i) => {
    el.classList.toggle('active', i === step);
  });
  // Update progress track
  document.querySelectorAll('.ob-progress-step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i === step) el.classList.add('active');
    else if (i < step) el.classList.add('done');
  });
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
    const pendingUpload = state._pendingUploadFile;

    // Final step - finish onboarding
    ls.set('onboarded', true);
    hideOnboarding();
    await refreshData();
    navigate('dashboard');

    if (pendingUpload) {
      await handleResumeUpload(pendingUpload);
      delete state._pendingUploadFile;
    }

    showToast('Welcome to ResumeIt! 🎉', 'success');
    return;
  }
}

// ===== DATA REFRESH =====
async function refreshData() {
  state.settings = getSettings();
  state.vaultEntries = await getAllVaultEntries();
  state.savedResumes = await getAllResumes();
  state.templateSelection = getTemplateSelection();
  updateNavBadges();
}

function updateNavBadges() {
  const vaultBadge = document.getElementById('vault-badge');
  if (vaultBadge) vaultBadge.textContent = state.vaultEntries.length;
}

// ===== DASHBOARD =====
function addActivity(type, label) {
  const activities = ls.get('activity_log', []);
  activities.unshift({ type, label, timestamp: new Date().toISOString() });
  ls.set('activity_log', activities.slice(0, 20));
}

function formatRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function renderActivityTimeline() {
  const container = document.getElementById('activity-timeline');
  if (!container) return;
  const activities = ls.get('activity_log', []).slice(0, 5);
  if (activities.length === 0) {
    container.innerHTML = '<div class="activity-empty">Your recent Vault and resume actions will appear here.</div>';
    return;
  }
  container.innerHTML = activities.map(activity => `
    <div class="activity-item"><span class="activity-dot"></span><div class="activity-text">${escHtml(activity.label)}</div><time class="activity-time">${formatRelativeTime(activity.timestamp)}</time></div>
  `).join('');
}

function animateStat(id, value) {
  const element = document.getElementById(id);
  if (!element) return;
  const duration = 600;
  const startedAt = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    element.textContent = Math.round(value * (1 - Math.pow(1 - progress, 3)));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function renderProfileIdentity(settings) {
  const displayName = settings.name || 'Your profile';
  let profile = state.profile;
  if (settings.github && (!profile || profile.login?.toLowerCase() !== settings.github.toLowerCase())) {
    try {
      profile = await validateGitHubUser(settings.github);
      state.profile = profile;
    } catch (_) {
      profile = null;
    }
  }

  const githubText = settings.github ? `@${settings.github}` : 'Add GitHub in Settings';
  ['dash-profile-name', 'sidebar-profile-name'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.textContent = profile?.name || displayName;
  });
  ['dash-profile-github', 'sidebar-profile-github'].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.textContent = githubText;
  });
  ['dash-avatar', 'sidebar-profile-avatar'].forEach(id => {
    const image = document.getElementById(id);
    if (!image) return;
    if (profile?.avatar) {
      image.src = profile.avatar;
      image.alt = `${profile.login} avatar`;
      image.classList.remove('d-none');
    } else {
      image.removeAttribute('src');
      image.alt = '';
      image.classList.add('d-none');
    }
  });
}

async function renderDashboard() {
  const settings = getSettings();
  const vaultCount = state.vaultEntries.length;
  const resumeCount = state.savedResumes.length;

  animateStat('stat-vault', vaultCount);
  animateStat('stat-resumes', resumeCount);
  document.getElementById('stat-github').textContent = settings.github || '—';
  renderProfileIdentity(settings);
  renderActivityTimeline();

  const recentEl = document.getElementById('recent-resumes');
  if (state.savedResumes.length === 0) {
    recentEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No resumes generated yet</div>
        <p class="empty-state-desc">Paste a job description in the Generator to create your first tailored resume.</p>
        <button class="btn btn-primary" onclick="navigate('generate')" style="margin-top:12px;">Open generator</button>
      </div>`;
  } else {
    const recents = [...state.savedResumes].reverse().slice(0, 3);
    recentEl.innerHTML = recents.map(r => `
      <div class="resume-row" onclick="viewSavedResume(${r.id})">
        <div class="resume-row-icon">◻</div>
        <div class="resume-row-info">
          <div class="resume-row-title">${escHtml(r.jobTitle || 'Resume')} ${r.templateId ? `<span class="resume-template-badge">${escHtml(TEMPLATES.find(template => template.id === r.templateId)?.name || r.templateId)}</span>` : ''}</div>
          <div class="resume-row-meta">${formatDate(r.createdAt)}</div>
        </div>
        <div class="resume-row-actions">
          <button class="btn-text btn-sm" onclick="event.stopPropagation(); downloadResume(${r.id})">Download PDF</button>
        </div>
      </div>`).join('');
  }

  const tipEl = document.getElementById('vault-tip');
  if (tipEl) {
    if (vaultCount === 0) tipEl.classList.remove('d-none');
    else tipEl.classList.add('d-none');
  }
}

// ===== MEMORY VAULT =====
function renderVault() {
  const container = document.getElementById('vault-entries');

  if (state.vaultEntries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Memory Vault is empty</div>
        <p class="empty-state-desc">Add your work experiences, projects, and achievements. The AI selects the most relevant entries for each job description.</p>
        <button class="btn btn-primary" onclick="openVaultModal()" style="margin-top:12px;">Add first entry</button>
      </div>`;
    return;
  }

  container.innerHTML = state.vaultEntries.map(entry => `
    <div class="vault-entry" id="vault-entry-${entry.id}">
      <div class="vault-entry-body">
        <div class="vault-entry-title">${escHtml(entry.title)}</div>
        <div class="vault-entry-context">
          ${entry.context ? `<span>${escHtml(entry.context)}</span>` : ''}
          ${entry.dateRange ? `<span style="color:var(--text-muted)">${escHtml(entry.dateRange)}</span>` : ''}
          ${entry.type ? `<span class="tag" style="font-size:10px;">${escHtml(entry.type)}</span>` : ''}
        </div>
        ${entry.bulletPoints?.length ? `
          <div class="vault-entry-bullets">
            ${entry.bulletPoints.slice(0, 3).map(b => `<div class="vault-entry-bullet">${escHtml(b)}</div>`).join('')}
            ${entry.bulletPoints.length > 3 ? `<span style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px;">+${entry.bulletPoints.length - 3} more</span>` : ''}
          </div>` : ''}
        ${entry.techStack?.length ? `
          <div class="vault-entry-stack">
            ${entry.techStack.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}
          </div>` : ''}
      </div>
      <div class="vault-entry-actions">
        <button class="btn-text" style="font-size:var(--text-xs);" onclick="openVaultModal(${entry.id})">Edit</button>
        <button class="btn-danger-text" style="font-size:var(--text-xs);" onclick="confirmDeleteVault(${entry.id})">Delete</button>
      </div>
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
      addActivity('vault_entry_updated', `Updated '${title}' in the Vault`);
      showToast('Entry updated!', 'success');
    } else {
      await addVaultEntry(entryData);
      addActivity('vault_entry_added', `Added '${title}' to the Vault`);
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
const RESUME_SECTION_LABELS = {
  summary: 'Summary',
  skills: 'Skills & languages',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
};

function createDefaultResumePreferences() {
  return {
    pageCount: 1,
    sections: Object.fromEntries(Object.keys(RESUME_SECTION_LABELS).map(key => [key, true])),
    highlightedSkills: [],
    selectedVaultIds: [],
    additionalInstructions: '',
  };
}

function normalizeResumePreferences(preferences = {}) {
  const defaults = createDefaultResumePreferences();
  const sections = Object.fromEntries(Object.keys(RESUME_SECTION_LABELS).map(key => [
    key,
    preferences.sections?.[key] !== false,
  ]));

  return {
    ...defaults,
    pageCount: Number(preferences.pageCount) === 2 ? 2 : 1,
    sections,
    highlightedSkills: Array.isArray(preferences.highlightedSkills)
      ? preferences.highlightedSkills.filter(skill => typeof skill === 'string' && skill.trim()).map(skill => skill.trim())
      : [],
    selectedVaultIds: Array.isArray(preferences.selectedVaultIds)
      ? preferences.selectedVaultIds.map(Number).filter(Number.isFinite)
      : [],
    additionalInstructions: typeof preferences.additionalInstructions === 'string'
      ? preferences.additionalInstructions.trim()
      : '',
  };
}

let generatorState = {
  jd: '',
  githubData: null,
  rankedEntries: [],
  generatedResume: null,
  currentStep: 0,
  preferences: createDefaultResumePreferences(),
  templateSelection: getTemplateSelection(),
  previewZoom: 100,
};

function initGenerator() {
  generatorState.currentStep = 0;
  generatorState.jd = '';
  generatorState.githubData = null;
  generatorState.rankedEntries = [];
  generatorState.generatedResume = null;
  generatorState.preferences = createDefaultResumePreferences();
  generatorState.templateSelection = getTemplateSelection();
  generatorState.previewZoom = 100;

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
  document.querySelectorAll('.step-nav-item').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i === 0) el.classList.add('active');
  });

  renderGeneratorVaultSummary();
  renderResumePreferencesForm();
  updateTokenEstimate();
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
  document.querySelectorAll('.step-nav-item').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i === step) el.classList.add('active');
    else if (i < step) el.classList.add('done');
  });

  const progress = Math.round((step / 4) * 100);
  document.getElementById('gen-progress-bar').style.width = `${progress}%`;

  document.querySelectorAll('[data-generator-step]').forEach(item => {
    item.classList.toggle('active', Number(item.dataset.generatorStep) === step);
  });
}

function updateTokenEstimate() {
  const input = document.getElementById('jd-input');
  const output = document.getElementById('jd-token-estimate');
  if (!input || !output) return;
  output.textContent = `~${Math.ceil(input.value.trim().length / 4)} tokens`;
}

function updateJDReference(jobDescription) {
  const reference = document.getElementById('jd-reference-text');
  if (reference) reference.textContent = jobDescription || 'Your job description will remain available here while ResumeIt works.';
}

function resetGenerationLog() {
  const log = document.getElementById('gen-log');
  if (log) log.innerHTML = '';
}

function addGenerationLog(message, type = 'info') {
  const log = document.getElementById('gen-log');
  if (!log) return;
  const row = document.createElement('div');
  row.className = 'gen-log-line';
  const time = document.createElement('span');
  time.className = 'gen-log-time';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text = document.createElement('span');
  text.className = `gen-log-${type}`;
  text.textContent = message;
  row.append(time, text);
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}

function setGenerationStatus(icon, message, type = 'info') {
  const statusIcon = document.getElementById('gen-status-icon');
  const statusText = document.getElementById('gen-status-text');
  if (statusIcon) statusIcon.textContent = icon;
  if (statusText) statusText.textContent = message;
  addGenerationLog(message, type);
}

function renderGeneratorVaultSummary() {
  const badge = document.getElementById('vault-count-badge');
  const container = document.getElementById('vault-summary-list');
  if (!badge || !container) return;

  const count = state.vaultEntries.length;
  badge.textContent = `${count} ${count === 1 ? 'entry' : 'entries'}`;

  if (count === 0) {
    container.innerHTML = '<p style="font-size:var(--text-xs);color:var(--text-muted);">Add entries to give the AI material to tailor.</p>';
    return;
  }

  const entries = state.vaultEntries.slice(0, 5);
  const extraCount = count - entries.length;
  container.innerHTML = entries.map(entry => `
    <div style="font-size:var(--text-xs);color:var(--text-secondary);padding:5px 0;border-bottom:1px solid var(--divider);">
      <strong>${escHtml(entry.title)}</strong>${entry.context ? ` <span style="color:var(--text-muted);">· ${escHtml(entry.context)}</span>` : ''}
    </div>
  `).join('') + (extraCount > 0
    ? `<div style="font-size:var(--text-xs);color:var(--text-muted);padding-top:6px;">+${extraCount} more</div>`
    : '');
}

function renderResumePreferencesForm() {
  const preferences = normalizeResumePreferences(generatorState.preferences);
  generatorState.preferences = preferences;

  const pageCountInput = document.querySelector(`input[name="page-count"][value="${preferences.pageCount}"]`);
  if (pageCountInput) pageCountInput.checked = true;

  document.querySelectorAll('[data-resume-section]').forEach(input => {
    input.checked = preferences.sections[input.dataset.resumeSection] !== false;
  });

  const instructions = document.getElementById('resume-instructions');
  if (instructions) instructions.value = preferences.additionalInstructions;

  renderHighlightedSkills();
  renderVaultPreferences();
}

function readResumePreferences() {
  const pageCount = Number(document.querySelector('input[name="page-count"]:checked')?.value);
  const sections = Object.fromEntries(Object.keys(RESUME_SECTION_LABELS).map(key => {
    const input = document.querySelector(`[data-resume-section="${key}"]`);
    return [key, input?.checked !== false];
  }));

  return normalizeResumePreferences({
    ...generatorState.preferences,
    pageCount,
    sections,
    additionalInstructions: document.getElementById('resume-instructions')?.value || '',
  });
}

function renderHighlightedSkills() {
  const container = document.getElementById('highlighted-skills-tags');
  if (!container) return;

  container.innerHTML = generatorState.preferences.highlightedSkills.map((skill, index) => `
    <span class="selected-tag">
      ${escHtml(skill)}
      <button type="button" onclick="removeHighlightedSkill(${index})" aria-label="Remove ${escHtml(skill)}">✕</button>
    </span>
  `).join('');
}

function addHighlightedSkill() {
  const input = document.getElementById('highlighted-skill-input');
  const skill = input?.value.trim();
  if (!skill) return;

  const exists = generatorState.preferences.highlightedSkills.some(item => item.toLowerCase() === skill.toLowerCase());
  if (!exists) {
    generatorState.preferences.highlightedSkills.push(skill);
    renderHighlightedSkills();
  }
  input.value = '';
  input.focus();
}

function removeHighlightedSkill(index) {
  generatorState.preferences.highlightedSkills.splice(index, 1);
  renderHighlightedSkills();
}

function renderVaultPreferences() {
  const container = document.getElementById('vault-preferences-list');
  if (!container) return;

  if (state.vaultEntries.length === 0) {
    container.innerHTML = '<p style="font-size:var(--text-xs);color:var(--text-muted);">Your Vault is empty. Add an entry to prioritise it here.</p>';
    return;
  }

  const selectedIds = new Set(generatorState.preferences.selectedVaultIds);
  container.innerHTML = state.vaultEntries.map(entry => `
    <label class="vault-preference-option">
      <input type="checkbox" ${selectedIds.has(entry.id) ? 'checked' : ''} onchange="togglePreferredVaultEntry(${entry.id}, this.checked)" />
      <span>
        <strong>${escHtml(entry.title)}</strong>
        <small>${escHtml(entry.context || entry.type || 'Vault entry')}</small>
      </span>
    </label>
  `).join('');
}

function togglePreferredVaultEntry(id, selected) {
  const entryId = Number(id);
  const selectedIds = new Set(generatorState.preferences.selectedVaultIds);
  if (selected) selectedIds.add(entryId);
  else selectedIds.delete(entryId);
  generatorState.preferences.selectedVaultIds = [...selectedIds];
}

function renderResumePreferencesSummary() {
  const container = document.getElementById('resume-preferences-summary');
  if (!container) return;

  const preferences = normalizeResumePreferences(generatorState.preferences);
  const includedSections = Object.entries(RESUME_SECTION_LABELS)
    .filter(([key]) => preferences.sections[key])
    .map(([, label]) => label);
  const highlights = preferences.highlightedSkills.length
    ? ` Highlighting: ${preferences.highlightedSkills.map(escHtml).join(', ')}.`
    : '';

  const templateName = TEMPLATES.find(template => template.id === generatorState.templateSelection.templateId)?.name || 'Modern';
  container.innerHTML = `<strong>${escHtml(templateName)} · ${preferences.pageCount}-page target</strong>${includedSections.map(escHtml).join(', ')} included.${highlights}`;
}

function ensureTemplateFonts(fontPairing) {
  const fontUrls = {
    sans: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
    'serif-heading': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:wght@500;600;700&display=swap',
    'mono-body': 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap',
  };
  const linkId = `resumeit-template-font-${fontPairing}`;
  if (!fontUrls[fontPairing] || document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = fontUrls[fontPairing];
  document.head.appendChild(link);
}

function selectTemplate(templateId) {
  generatorState.templateSelection = getTemplateSelection(templateId);
  state.templateSelection = generatorState.templateSelection;
  persistTemplateSelection(generatorState.templateSelection, true);
  ensureTemplateFonts(generatorState.templateSelection.fontPairing);
  renderTemplateBrowser();
  renderTemplateControls();
  if (generatorState.generatedResume) renderResumeResult(generatorState.generatedResume);
}

function setTemplateColor(color) {
  if (!COLOR_THEMES[color]) return;
  generatorState.templateSelection = { ...generatorState.templateSelection, color };
  state.templateSelection = generatorState.templateSelection;
  persistTemplateSelection(generatorState.templateSelection, true);
  renderTemplateBrowser();
  renderTemplateControls();
  if (generatorState.generatedResume) renderResumeResult(generatorState.generatedResume);
}

function setTemplateFont(fontPairing) {
  if (!FONT_PAIRINGS[fontPairing]) return;
  generatorState.templateSelection = { ...generatorState.templateSelection, fontPairing };
  state.templateSelection = generatorState.templateSelection;
  persistTemplateSelection(generatorState.templateSelection, true);
  ensureTemplateFonts(fontPairing);
  renderTemplateBrowser();
  renderTemplateControls();
  if (generatorState.generatedResume) renderResumeResult(generatorState.generatedResume);
}

function setDefaultTemplate() {
  persistTemplateSelection(generatorState.templateSelection, true);
  showToast(`${TEMPLATES.find(template => template.id === generatorState.templateSelection.templateId).name} is now your default template.`, 'success');
  renderTemplateBrowser();
}

function templateColorOptions(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const selected = generatorState.templateSelection.color;
  container.innerHTML = Object.entries(COLOR_THEMES).map(([id, color]) => `
    <button class="color-option ${id === selected ? 'active' : ''}" type="button" onclick="setTemplateColor('${id}')" aria-label="Use ${color.name}" aria-pressed="${id === selected}" title="${color.name}"><span style="background:${color.value}"></span></button>
  `).join('');
}

function templateFontOptions(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const selected = generatorState.templateSelection.fontPairing;
  container.innerHTML = Object.entries(FONT_PAIRINGS).map(([id, font]) => `
    <button class="font-option ${id === selected ? 'active' : ''}" type="button" onclick="setTemplateFont('${id}')" aria-pressed="${id === selected}">${escHtml(font.name)}</button>
  `).join('');
}

function renderTemplateControls() {
  const selection = generatorState.templateSelection;
  const activeTemplate = TEMPLATES.find(template => template.id === selection.templateId);
  const label = document.getElementById('active-template-label');
  if (label) label.textContent = activeTemplate?.name || 'Modern';

  const switcher = document.getElementById('template-switcher');
  if (switcher) {
    switcher.innerHTML = TEMPLATES.map(template => `
      <button class="template-switch-tile ${template.id === selection.templateId ? 'active' : ''}" type="button" role="listitem" onclick="selectTemplate('${template.id}')" aria-pressed="${template.id === selection.templateId}">
        <span class="template-switch-thumb">${template.thumbnail}</span><span>${escHtml(template.name)}</span>
      </button>
    `).join('');
  }
  templateColorOptions('template-color-options');
  templateFontOptions('template-font-options');
}

function renderTemplateBrowser() {
  const container = document.getElementById('template-grid');
  if (!container) return;
  const selection = generatorState.templateSelection || getTemplateSelection();
  generatorState.templateSelection = selection;
  state.templateSelection = selection;
  const defaultTemplateId = getTemplatePrefs().defaultTemplateId;

  container.innerHTML = TEMPLATES.map(template => `
    <article class="template-card ${template.id === selection.templateId ? 'active' : ''}">
      <div class="template-card-preview" id="template-thumb-${template.id}"></div>
      <div class="template-card-body">
        <div class="template-card-title-row"><h3>${escHtml(template.name)}</h3>${template.id === defaultTemplateId ? '<span class="template-default-badge">Default</span>' : ''}</div>
        <p>${escHtml(template.description)}</p>
        <small>${escHtml(template.bestFor)}</small>
        ${template.atsCaution ? '<span class="template-caution">Two-column layout — ATS caution</span>' : ''}
        <div class="template-card-actions"><button class="btn-text btn-sm" type="button" onclick="previewTemplate('${template.id}')">Preview</button><button class="btn ${template.id === selection.templateId ? 'btn-outline' : 'btn-primary'} btn-sm" type="button" onclick="selectTemplate('${template.id}')">${template.id === selection.templateId ? 'Selected' : 'Use this'}</button></div>
      </div>
    </article>
  `).join('');

  TEMPLATES.forEach(template => {
    const preview = document.getElementById(`template-thumb-${template.id}`);
    if (preview) renderTemplateThumbnail(preview, template.id, selection);
  });

  const selectedTemplate = TEMPLATES.find(template => template.id === selection.templateId);
  const title = document.getElementById('template-customization-title');
  if (title) title.textContent = selectedTemplate?.name || 'Modern';
  templateColorOptions('template-page-color-options');
  templateFontOptions('template-page-font-options');
}

let templatePreviewId = null;

function previewTemplate(templateId) {
  const template = TEMPLATES.find(item => item.id === templateId);
  if (!template) return;
  templatePreviewId = templateId;
  const title = document.getElementById('template-preview-title');
  const description = document.getElementById('template-preview-description');
  const caution = document.getElementById('template-preview-caution');
  if (title) title.textContent = template.name;
  if (description) description.textContent = `${template.description} Best for ${template.bestFor.toLowerCase()}.`;
  if (caution) caution.classList.toggle('d-none', !template.atsCaution);
  const container = document.getElementById('template-preview-modal-container');
  if (container) renderResumePreview(container, SAMPLE_RESUME, { ...generatorState.templateSelection, templateId });
  document.getElementById('template-preview-modal')?.classList.add('open');
}

function openTemplateBrowserModal() {
  previewTemplate(generatorState.templateSelection.templateId);
}

function closeTemplatePreviewModal() {
  document.getElementById('template-preview-modal')?.classList.remove('open');
  templatePreviewId = null;
}

function usePreviewTemplate() {
  if (templatePreviewId) selectTemplate(templatePreviewId);
  closeTemplatePreviewModal();
}

function renderPreviewSectionToggles() {
  const container = document.getElementById('preview-section-toggles');
  if (!container) return;
  container.innerHTML = Object.entries(RESUME_SECTION_LABELS).map(([id, label]) => `
    <label><input type="checkbox" ${generatorState.preferences.sections[id] !== false ? 'checked' : ''} onchange="togglePreviewSection('${id}', this.checked)" /> <span>${escHtml(label)}</span></label>
  `).join('');
}

function togglePreviewSection(section, visible) {
  generatorState.preferences.sections[section] = visible;
  if (generatorState.generatedResume) renderResumeResult(generatorState.generatedResume);
}

function applyPreviewZoom() {
  const iframe = document.querySelector('#resume-preview-container iframe');
  if (!iframe) return;
  const zoom = generatorState.previewZoom;
  iframe.style.width = `${zoom}%`;
  iframe.style.height = `${Math.max(600, 600 * zoom / 100)}px`;
}

function changePreviewZoom(delta) {
  generatorState.previewZoom = Math.max(70, Math.min(140, generatorState.previewZoom + delta));
  applyPreviewZoom();
}

function resetPreviewZoom() {
  generatorState.previewZoom = 100;
  applyPreviewZoom();
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

  const preferences = readResumePreferences();
  if (!Object.values(preferences.sections).some(Boolean)) {
    showToast('Select at least one resume section to continue', 'error');
    return;
  }

  generatorState.jd = jd;
  generatorState.githubData = null;
  generatorState.rankedEntries = [];
  generatorState.generatedResume = null;
  generatorState.preferences = preferences;

  showGeneratorStep(1);
  updateJDReference(jd);
  resetGenerationLog();
  setGenerationStatus('⏳', 'Starting tailored resume generation...', 'wait');

  // Step 1: Fetch GitHub data
  if (settings.github) {
    setGenerationStatus('⚙️', 'Fetching GitHub activity...', 'wait');

    try {
      generatorState.githubData = await fetchGitHubProfile(settings.github);
      renderGitHubStats(generatorState.githubData);
      setGenerationStatus('✅', `GitHub data loaded — ${generatorState.githubData.repos.length} repos found`, 'ok');
    } catch (e) {
      setGenerationStatus('⚠️', `GitHub: ${e.message}`, 'info');
    }
  } else {
    setGenerationStatus('ℹ️', 'No GitHub handle configured — skipping', 'info');
  }

  showGeneratorStep(2);

  // Step 2: Rank vault entries
  const vaultEntriesToRank = preferences.selectedVaultIds.length > 0
    ? state.vaultEntries.filter(entry => preferences.selectedVaultIds.includes(entry.id))
    : state.vaultEntries;

  if (vaultEntriesToRank.length > 0) {
    setGenerationStatus('🧠', `Ranking ${vaultEntriesToRank.length} Memory Vault entries against JD...`, 'wait');

    try {
      generatorState.rankedEntries = await rankVaultEntries(settings.apiKey, jd, vaultEntriesToRank);
      renderRankedEntries(generatorState.rankedEntries);
      setGenerationStatus('✅', `Ranked ${generatorState.rankedEntries.length} entries by relevance`, 'ok');
    } catch (e) {
      showToast('Ranking failed: ' + e.message, 'error');
      generatorState.rankedEntries = vaultEntriesToRank;
      setGenerationStatus('⚠️', 'Ranking could not complete — using your selected entries.', 'info');
    }
  } else {
    setGenerationStatus('ℹ️', 'Memory Vault is empty — generating from GitHub data only', 'info');
  }

  showGeneratorStep(3);

  // Step 3: Generate resume
  setGenerationStatus('✨', 'Generating tailored resume with Gemini...', 'wait');

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
      userProfile,
      preferences
    );

    setGenerationStatus('🎉', 'Resume generated successfully!', 'ok');
    addActivity('resume_generated', `Generated a ${preferences.pageCount}-page resume`);

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

  const topLangs = data.languages.slice(0, 5);

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div>
        <div style="font-weight:600;font-size:var(--text-sm);">@${escHtml(data.user.login)}</div>
        <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:1px;">${data.user.publicRepos} public repos</div>
      </div>
      <img src="${data.user.avatar}" style="width:32px;height:32px;border-radius:50%;border:1px solid var(--border);" alt="GitHub avatar">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;margin-bottom:14px;">
      <div style="background:var(--bg-page);padding:10px 12px;">
        <div style="font-family:var(--font-serif);font-size:var(--text-xl);font-weight:700;">${data.activity.recentCommits}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-top:1px;">Recent commits</div>
      </div>
      <div style="background:var(--bg-page);padding:10px 12px;">
        <div style="font-family:var(--font-serif);font-size:var(--text-xl);font-weight:700;">${data.user.followers}</div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-top:1px;">Followers</div>
      </div>
    </div>
    <div style="font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Top languages</div>
    ${topLangs.map(l => `
      <div style="margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;font-size:var(--text-xs);margin-bottom:3px;">
          <span style="color:var(--text-secondary);">${escHtml(l.lang)}</span>
          <span style="color:var(--text-muted);">${l.percent}%</span>
        </div>
        <div class="progress"><div class="progress-fill" style="width:${l.percent}%;"></div></div>
      </div>`).join('')}
  `;
}

function renderRankedEntries(entries) {
  const container = document.getElementById('ranked-entries-list');
  if (!container) return;

  container.innerHTML = entries.map(e => `
    <div class="flex gap-12 items-center" style="padding:8px 0; border-bottom:1px solid var(--divider);">
      <div style="flex:1;">
        <div style="font-size:0.82rem;font-weight:600;">${escHtml(e.title)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${escHtml(e.context || '')}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:0.9rem;font-weight:700;color:${e.relevanceScore >= 70 ? 'var(--status-success)' : e.relevanceScore >= 40 ? 'var(--status-warning)' : 'var(--text-muted)'};">${e.relevanceScore}%</div>
        <div style="font-size:0.68rem;color:var(--text-muted);">relevance</div>
      </div>
    </div>
  `).join('');
}

function renderResumeResult(data) {
  const container = document.getElementById('resume-preview-container');
  ensureTemplateFonts(generatorState.templateSelection.fontPairing);
  renderResumePreview(container, data, getCurrentRenderOptions());
  applyPreviewZoom();
  renderTemplateControls();
  renderPreviewSectionToggles();
  renderResumePreferencesSummary();
}

async function saveCurrentResume() {
  if (!generatorState.generatedResume) return;
  const resumeData = {
    jobTitle: generatorState.generatedResume.tagline || 'Resume',
    company: '',
    jd: generatorState.jd,
    resumeData: generatorState.generatedResume,
    resumeOptions: normalizeResumePreferences(generatorState.preferences),
    templateId: generatorState.templateSelection.templateId,
    templateColor: generatorState.templateSelection.color,
    templateFont: generatorState.templateSelection.fontPairing,
    hiddenSections: Object.keys(generatorState.preferences.sections).filter(section => generatorState.preferences.sections[section] === false),
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
    await exportToPDF(generatorState.generatedResume, filename, getCurrentRenderOptions());
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
        <div class="empty-state-title">No saved resumes</div>
        <p class="empty-state-desc">Generated resumes will appear here after you save them.</p>
        <button class="btn btn-primary" onclick="navigate('generate')" style="margin-top:12px;">Open generator</button>
      </div>`;
    return;
  }

  const sorted = [...state.savedResumes].reverse();
  container.innerHTML = sorted.map(r => `
    <div class="resume-row" onclick="viewSavedResume(${r.id})">
      <div class="resume-row-icon">◻</div>
      <div class="resume-row-info">
        <div class="resume-row-title">${escHtml(r.jobTitle || 'Resume')} ${r.templateId ? `<span class="resume-template-badge">${escHtml(TEMPLATES.find(template => template.id === r.templateId)?.name || r.templateId)}</span>` : ''}</div>
        <div class="resume-row-meta">${formatDate(r.createdAt)}</div>
      </div>
      <div class="resume-row-actions">
        <button class="btn-text btn-sm" onclick="event.stopPropagation(); downloadResume(${r.id})">Download PDF</button>
        <button class="btn-danger-text" style="font-size:var(--text-xs);" onclick="event.stopPropagation(); confirmDeleteResume(${r.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

async function viewSavedResume(id) {
  const resume = state.savedResumes.find(r => r.id === id);
  if (!resume) return;

  navigate('generate');
  generatorState.generatedResume = resume.resumeData;
  generatorState.jd = resume.jd || '';
  generatorState.preferences = normalizeResumePreferences(resume.resumeOptions);
  generatorState.templateSelection = {
    ...getTemplateSelection(resume.templateId),
    color: COLOR_THEMES[resume.templateColor] ? resume.templateColor : getTemplateSelection(resume.templateId).color,
    fontPairing: FONT_PAIRINGS[resume.templateFont] ? resume.templateFont : getTemplateSelection(resume.templateId).fontPairing,
  };
  renderResumePreferencesForm();
  showGeneratorStep(4);
  setTimeout(() => renderResumeResult(resume.resumeData), 100);
}

async function downloadResume(id) {
  const resume = state.savedResumes.find(r => r.id === id);
  if (!resume?.resumeData) return;

  try {
    const selection = {
      ...getTemplateSelection(resume.templateId),
      color: COLOR_THEMES[resume.templateColor] ? resume.templateColor : getTemplateSelection(resume.templateId).color,
      fontPairing: FONT_PAIRINGS[resume.templateFont] ? resume.templateFont : getTemplateSelection(resume.templateId).fontPairing,
    };
    await exportToPDF(resume.resumeData, getResumeFilename(resume.resumeData), { ...resume.resumeOptions, ...selection });
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
    addActivity('vault_imported', `Imported ${added} Vault ${added === 1 ? 'entry' : 'entries'} from a resume`);

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

function setSidebarCollapsed(collapsed) {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed', collapsed);
  if (toggle) {
    toggle.textContent = collapsed ? '›' : '‹';
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }
}

function toggleSidebarCollapse() {
  const collapsed = !document.getElementById('sidebar')?.classList.contains('collapsed');
  ls.set('sidebar_collapsed', collapsed);
  setSidebarCollapsed(collapsed);
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('sidebar');
  const button = document.getElementById('mobile-menu-btn');
  if (!sidebar) return;
  const opened = sidebar.classList.toggle('mobile-open');
  if (button) button.setAttribute('aria-expanded', String(opened));
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
  addHighlightedSkill,
  removeHighlightedSkill,
  togglePreferredVaultEntry,
  selectTemplate,
  setTemplateColor,
  setTemplateFont,
  setDefaultTemplate,
  previewTemplate,
  openTemplateBrowserModal,
  closeTemplatePreviewModal,
  usePreviewTemplate,
  togglePreviewSection,
  changePreviewZoom,
  resetPreviewZoom,
  toggleSidebarCollapse,
  toggleMobileSidebar,
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
  setSidebarCollapsed(ls.get('sidebar_collapsed', false));
  ensureTemplateFonts(state.templateSelection.fontPairing);

  const settings = getSettings();

  if (!settings.onboarded) {
    showOnboarding();
  } else {
    navigate('dashboard');
  }

  // Wire up onboarding nav buttons
  document.getElementById('ob-next')?.addEventListener('click', onboardingNext);
  document.getElementById('ob-next-2')?.addEventListener('click', onboardingNext);
  document.getElementById('ob-finish')?.addEventListener('click', onboardingNext);
  document.getElementById('ob-back')?.addEventListener('click', () => {
    if (onboardingStep > 0) gotoOnboardingStep(onboardingStep - 1);
  });
  document.getElementById('ob-back-2')?.addEventListener('click', () => {
    if (onboardingStep > 0) gotoOnboardingStep(onboardingStep - 1);
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

  document.getElementById('highlighted-skill-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addHighlightedSkill(); }
  });

  document.getElementById('jd-input')?.addEventListener('input', updateTokenEstimate);

  document.getElementById('ob-api-key')?.addEventListener('input', (e) => {
    const feedback = document.getElementById('ob-api-feedback');
    if (!feedback) return;
    const value = e.target.value.trim();
    feedback.textContent = !value ? '' : value.startsWith('AIza') && value.length >= 20
      ? 'Looks like a Gemini API key.'
      : 'Gemini keys usually begin with AIza.';
    feedback.classList.toggle('valid', value.startsWith('AIza') && value.length >= 20);
    feedback.classList.toggle('invalid', Boolean(value) && !(value.startsWith('AIza') && value.length >= 20));
  });

  let githubValidationTimer;
  document.getElementById('ob-github')?.addEventListener('input', (e) => {
    const feedback = document.getElementById('ob-github-feedback');
    const handle = e.target.value.trim();
    clearTimeout(githubValidationTimer);
    if (!feedback) return;
    if (!handle) { feedback.textContent = ''; feedback.className = 'inline-feedback'; return; }
    feedback.textContent = 'Checking GitHub profile…';
    feedback.className = 'inline-feedback';
    githubValidationTimer = setTimeout(async () => {
      try {
        const profile = await validateGitHubUser(handle);
        feedback.textContent = `Found ${profile.login}${profile.name ? ` · ${profile.name}` : ''}`;
        feedback.className = 'inline-feedback valid';
      } catch (_) {
        feedback.textContent = 'Profile not found — you can still continue without GitHub.';
        feedback.className = 'inline-feedback invalid';
      }
    }, 450);
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

})().catch((error) => {
  // Never leave both application roots hidden when browser storage or a module fails.
  console.error('ResumeIt could not finish initialization.', error);
  document.getElementById('onboarding')?.classList.add('d-none');
  document.getElementById('app')?.classList.remove('d-none');
  showToast('ResumeIt started without saved workspace data. Reload to try again.', 'warning', 10000);
});
