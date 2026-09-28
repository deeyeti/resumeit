/**
 * app.js - ResumeIt Main Application
 * Handles routing, state, UI rendering, and orchestration of all modules.
 */

import { initDB, getAllVaultEntries, addVaultEntry, updateVaultEntry, deleteVaultEntry, clearVault, saveResume, getAllResumes, deleteResume, clearResumes, getAllApplications, addApplication, updateApplication, deleteApplication, clearApplications } from './modules/vault.js';
import { fetchGitHubProfile, validateGitHubUser } from './modules/github.js';
import { rankVaultEntries, generateResume, validateApiKey, improveResumeBullet, generateCoverLetter, scoreFitForJD, AVAILABLE_MODELS, getModel, setModel } from './modules/llm.js';
import { parseResume, extractVaultEntriesFromText } from './modules/parser.js';
import { renderResumePreview, renderTemplateThumbnail, exportToPDF, getResumeFilename } from './modules/exporter.js';
import { TEMPLATES, COLOR_THEMES, FONT_PAIRINGS, SAMPLE_RESUME } from './modules/templates/index.js';

// ===== STATE =====
const state = {
  currentPage: 'dashboard',
  vaultEntries: [],
  savedResumes: [],
  applications: [],
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
  const model = ls.get('model', 'gemini-2.5-flash');
  setModel(model); // sync the llm module with the persisted choice
  return {
    apiKey: ls.get('api_key', ''),
    github: ls.get('github', ''),
    name: ls.get('name', ''),
    email: ls.get('email', ''),
    linkedin: ls.get('linkedin', ''),
    location: ls.get('location', ''),
    model,
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
    tracker: 'Applications',
  };

  const nameEl = document.getElementById('topbar-page-name');
  if (nameEl) nameEl.textContent = titles[page] || 'ResumeIt';

  if (page === 'dashboard') renderDashboard();
  if (page === 'vault') renderVault();
  if (page === 'resumes') renderResumes();
  if (page === 'templates') renderTemplateBrowser();
  if (page === 'settings') renderSettings();
  if (page === 'generate') initGenerator();
  if (page === 'tracker') renderTracker();

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
  state.applications = await getAllApplications();
  state.templateSelection = getTemplateSelection();
  updateNavBadges();
}

function updateNavBadges() {
  const vaultBadge = document.getElementById('vault-badge');
  if (vaultBadge) vaultBadge.textContent = state.vaultEntries.length;
  const trackerBadge = document.getElementById('tracker-badge');
  if (trackerBadge) {
    const activeCount = state.applications.filter(a => a.status !== 'rejected' && a.status !== 'withdrawn').length;
    trackerBadge.textContent = state.applications.length;
    trackerBadge.style.display = state.applications.length ? '' : 'none';
  }
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
  const appCount = state.applications.length;

  animateStat('stat-vault', vaultCount);
  animateStat('stat-resumes', resumeCount);
  animateStat('stat-applications', appCount);
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

  // Recent applications
  const recentAppsEl = document.getElementById('dash-recent-applications');
  if (recentAppsEl) {
    if (state.applications.length === 0) {
      recentAppsEl.innerHTML = `<div class="empty-state" style="padding:20px 0;">
        <div class="empty-state-title">No applications tracked yet</div>
        <p class="empty-state-desc">Generate a resume or add one manually to start tracking.</p>
        <button class="btn btn-outline btn-sm" onclick="openTrackerModal()" style="margin-top:10px;">+ Add application</button>
      </div>`;
    } else {
      const recent = [...state.applications].reverse().slice(0, 3);
      recentAppsEl.innerHTML = recent.map(a => `
        <div class="resume-row" onclick="navigate('tracker')" style="cursor:pointer;">
          <div class="resume-row-icon" style="font-size:1.1rem;">${getStatusEmoji(a.status)}</div>
          <div class="resume-row-info">
            <div class="resume-row-title">${escHtml(a.roleTitle)} <span style="color:var(--text-muted);font-weight:400;">at</span> ${escHtml(a.companyName)}</div>
            <div class="resume-row-meta">${formatDate(a.createdAt)}</div>
          </div>
          <div class="resume-row-actions">
            <span class="status-pill status-${a.status}">${getStatusLabel(a.status)}</span>
          </div>
        </div>`).join('');
    }
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
  existingResumeText: '',
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

  // Clear upload state
  generatorState.existingResumeText = '';
  const jdStatus = document.getElementById('jd-upload-status');
  if (jdStatus) jdStatus.textContent = 'PDF or DOCX';
  const erStatus = document.getElementById('existing-resume-status');
  if (erStatus) erStatus.textContent = '';
  const jdFileInput = document.getElementById('jd-file-input');
  if (jdFileInput) jdFileInput.value = '';
  const erInput = document.getElementById('existing-resume-input');
  if (erInput) erInput.value = '';
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

// ===== GENERATOR FILE UPLOADS =====
async function handleJDFileUpload(file) {
  if (!file) return;
  const statusEl = document.getElementById('jd-upload-status');
  const labelEl = document.getElementById('jd-upload-label');
  if (statusEl) statusEl.textContent = `Parsing ${file.name}\u2026`;
  if (labelEl) labelEl.style.borderColor = 'var(--accent-primary)';

  try {
    const text = await parseResume(file);
    if (!text || text.trim().length < 20) {
      showToast('Could not extract text from the file. Try a different format.', 'warning');
      if (statusEl) statusEl.textContent = 'PDF or DOCX';
      if (labelEl) labelEl.style.borderColor = '';
      return;
    }
    document.getElementById('jd-input').value = text.trim();
    updateTokenEstimate();
    showToast(`Job description loaded from ${file.name}`, 'success');
    if (statusEl) statusEl.textContent = `\u2713 ${file.name}`;
    if (labelEl) labelEl.style.borderColor = 'var(--status-success)';
  } catch (e) {
    showToast('Failed to parse file: ' + e.message, 'error');
    if (statusEl) statusEl.textContent = 'PDF or DOCX';
    if (labelEl) labelEl.style.borderColor = '';
  }
}

async function handleExistingResumeUpload(file) {
  if (!file) return;
  const statusEl = document.getElementById('existing-resume-status');
  const labelEl = document.getElementById('existing-resume-upload-label');
  if (statusEl) statusEl.textContent = `Parsing ${file.name}\u2026`;

  try {
    const text = await parseResume(file);
    if (!text || text.trim().length < 20) {
      showToast('Could not extract text from your resume. Try a different format.', 'warning');
      if (statusEl) statusEl.textContent = '';
      return;
    }
    generatorState.existingResumeText = text.trim();
    showToast(`Resume context loaded from ${file.name}`, 'success');
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--status-success);">\u2713 ${escHtml(file.name)}</span> \u2014 will be used as extra context`;
    if (labelEl) labelEl.style.borderColor = 'var(--status-success)';
  } catch (e) {
    showToast('Failed to parse resume: ' + e.message, 'error');
    if (statusEl) statusEl.textContent = '';
  }
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
      preferences,
      generatorState.existingResumeText || ''
    );

    setGenerationStatus('🎉', 'Resume generated successfully!', 'ok');
    addActivity('resume_generated', `Generated a ${preferences.pageCount}-page resume`);

    // Auto-track the application
    try {
      const resume = generatorState.generatedResume;
      const roleTitle = resume?.tagline || resume?.name || 'Software Engineer';
      // Try to extract company name from JD (first line often contains it)
      const jdFirstLine = jd.split('\n').find(l => l.trim().length > 2)?.trim() || '';
      const companyName = jdFirstLine.length < 60 ? jdFirstLine : '';
      const newApp = {
        roleTitle,
        companyName: companyName || 'Unknown Company',
        status: 'applied',
        jdLink: '',
        notes: '',
        appliedDate: new Date().toISOString().split('T')[0],
        jdSnippet: jd.slice(0, 200),
        resumeId: null,
        autoAdded: true,
      };
      const newId = await addApplication(newApp);
      state.applications = await getAllApplications();
      updateNavBadges();
      showToast('📋 Application tracked automatically', 'success', 4000);
    } catch (_) { /* non-critical */ }

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

// ===== COVER LETTER =====
let generatedCoverLetterData = null;

async function generateCoverLetterUI() {
  if (!generatorState.generatedResume) {
    showToast('Generate a resume first before creating a cover letter.', 'error');
    return;
  }

  const settings = getSettings();
  if (!settings.apiKey) {
    showToast('Gemini API key required. Configure it in Settings.', 'error');
    navigate('settings');
    return;
  }

  const btn = document.getElementById('gen-cover-letter-btn');
  const outputEl = document.getElementById('cover-letter-output');
  const previewEl = document.getElementById('cover-letter-preview');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';
  if (outputEl) outputEl.style.display = 'none';

  try {
    const options = {
      companyName: document.getElementById('cl-company')?.value?.trim() || '',
      hiringManager: document.getElementById('cl-hiring-manager')?.value?.trim() || '',
      tone: document.querySelector('input[name="cl-tone"]:checked')?.value || 'professional',
    };

    const userProfile = {
      name: settings.name,
      email: settings.email,
      github: settings.github,
      linkedin: settings.linkedin,
      location: settings.location,
    };

    generatedCoverLetterData = await generateCoverLetter(
      settings.apiKey,
      generatorState.jd,
      generatorState.generatedResume,
      userProfile,
      options
    );

    // Render plain-text preview
    const letter = generatedCoverLetterData;
    const formatted = [
      letter.subject ? `Subject: ${letter.subject}\n` : '',
      letter.greeting,
      '',
      ...(letter.paragraphs || []).map(p => p + '\n'),
      letter.closing,
      letter.signature,
    ].filter(l => l !== undefined).join('\n');

    if (previewEl) previewEl.textContent = formatted;
    if (outputEl) outputEl.style.display = 'block';
    showToast('Cover letter generated!', 'success');
    addActivity('cover_letter_generated', `Generated a cover letter`);
  } catch (e) {
    showToast('Cover letter failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#9993; Generate Cover Letter';
  }
}

function getCoverLetterText() {
  if (!generatedCoverLetterData) return '';
  const letter = generatedCoverLetterData;
  return [
    letter.subject ? `Subject: ${letter.subject}\n` : '',
    letter.greeting,
    '',
    ...(letter.paragraphs || []).map(p => p + '\n'),
    letter.closing,
    letter.signature,
  ].filter(l => l !== undefined).join('\n');
}

async function copyCoverLetter() {
  const text = getCoverLetterText();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Cover letter copied to clipboard!', 'success');
  } catch (_) {
    showToast('Copy failed — please select and copy the text manually.', 'error');
  }
}

function downloadCoverLetter() {
  const text = getCoverLetterText();
  if (!text) return;
  const name = (generatorState.generatedResume?.name || 'cover-letter').replace(/\s+/g, '_').toLowerCase();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_cover_letter.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Cover letter downloaded!', 'success');
}

// ===== FIT SCORE =====

/**
 * Returns a CSS colour string (and label) for a given 1.1–9.9 score.
 */
function fitScoreColour(score) {
  if (score >= 8.5) return { colour: '#22c55e', label: 'Excellent' };
  if (score >= 7.0) return { colour: '#84cc16', label: 'Strong' };
  if (score >= 5.5) return { colour: '#f59e0b', label: 'Moderate' };
  if (score >= 4.0) return { colour: '#f97316', label: 'Weak' };
  return { colour: '#ef4444', label: 'Poor' };
}

/**
 * Renders the animated score dial + breakdown inside #fit-score-output.
 */
function renderFitScoreResult(result) {
  const container = document.getElementById('fit-score-output');
  if (!container) return;

  const { colour, label } = fitScoreColour(result.score);

  const dimLabels = {
    skillsMatch:      'Skills match',
    experienceDepth:  'Experience depth',
    keywordAlignment: 'Keyword alignment',
    roleFit:          'Role fit',
  };

  const dimsHTML = Object.entries(result.dimensions || {}).map(([key, dim]) => {
    const pct = ((dim.score - 1.1) / (9.9 - 1.1)) * 100;
    const { colour: dc } = fitScoreColour(dim.score);
    return `
      <div class="fit-dim-row">
        <div class="fit-dim-label">
          <span>${escHtml(dimLabels[key] || key)}</span>
          <span class="fit-dim-score" style="color:${dc};">${dim.score.toFixed(1)}</span>
        </div>
        <div class="fit-dim-bar-track">
          <div class="fit-dim-bar-fill" style="width:0%;background:${dc};" data-target="${pct.toFixed(1)}"></div>
        </div>
        <div class="fit-dim-note">${escHtml(dim.note || '')}</div>
      </div>`;
  }).join('');

  const strengthsHTML = (result.topStrengths || []).map(s =>
    `<li class="fit-list-item fit-strength">✓ ${escHtml(s)}</li>`).join('');

  const gapsHTML = (result.topGaps || []).map(g =>
    `<li class="fit-list-item fit-gap">✗ ${escHtml(g)}</li>`).join('');

  const pct = ((result.score - 1.1) / (9.9 - 1.1)) * 100;

  container.innerHTML = `
    <div class="fit-score-card">
      <!-- Main dial -->
      <div class="fit-dial-wrap">
        <svg class="fit-dial-svg" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="fit-dial-track" cx="60" cy="60" r="50" />
          <circle class="fit-dial-fill" cx="60" cy="60" r="50"
            style="stroke:${colour};"
            stroke-dasharray="${(pct / 100) * 314.16} 314.16"
            transform="rotate(-90 60 60)" />
        </svg>
        <div class="fit-dial-label">
          <span class="fit-dial-score" style="color:${colour};" id="fit-dial-animated">1.1</span>
          <span class="fit-dial-tag" style="background:${colour}22;color:${colour};">${label}</span>
        </div>
      </div>

      <!-- Verdict -->
      <p class="fit-verdict">"${escHtml(result.verdict || '')}"</p>

      <!-- Dimension bars -->
      <div class="fit-dims">${dimsHTML}</div>

      <!-- Strengths & Gaps -->
      <div class="fit-sg-grid">
        <div>
          <div class="fit-sg-header fit-sg-header--green">Top strengths</div>
          <ul class="fit-list">${strengthsHTML}</ul>
        </div>
        <div>
          <div class="fit-sg-header fit-sg-header--red">Key gaps</div>
          <ul class="fit-list">${gapsHTML}</ul>
        </div>
      </div>
    </div>`;

  container.style.display = 'block';

  // Animate the big score number
  const dialEl = document.getElementById('fit-dial-animated');
  if (dialEl) {
    const start = 1.1;
    const end = result.score;
    const duration = 900;
    const startTime = performance.now();
    function tick(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = start + (end - start) * eased;
      dialEl.textContent = current.toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Animate dimension bars
  requestAnimationFrame(() => {
    container.querySelectorAll('.fit-dim-bar-fill').forEach(bar => {
      const target = bar.dataset.target;
      bar.style.transition = 'width 0.8s cubic-bezier(0.34,1.56,0.64,1)';
      bar.style.width = `${target}%`;
    });
  });
}

async function scoreFitUI() {
  if (!generatorState.jd) {
    showToast('Run the generator first to get a fit score.', 'error');
    return;
  }

  const settings = getSettings();
  if (!settings.apiKey) {
    showToast('Gemini API key required. Configure it in Settings.', 'error');
    navigate('settings');
    return;
  }

  const btn = document.getElementById('fit-score-btn');
  const outputEl = document.getElementById('fit-score-output');

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Scoring…';
  if (outputEl) { outputEl.style.display = 'none'; outputEl.innerHTML = ''; }

  try {
    const userProfile = {
      name: settings.name,
      email: settings.email,
      github: settings.github,
      linkedin: settings.linkedin,
      location: settings.location,
    };

    const result = await scoreFitForJD(
      settings.apiKey,
      generatorState.jd,
      generatorState.rankedEntries || [],
      generatorState.githubData,
      userProfile,
      generatorState.existingResumeText || ''
    );

    renderFitScoreResult(result);
    addActivity('fit_scored', `Fit score: ${result.score}/9.9`);
    showToast(`Fit score: ${result.score} — ${result.verdict}`, 'success', 6000);
  } catch (e) {
    showToast('Fit score failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⚡ Check My Fit';
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

  // Populate model selector
  const modelSelect = document.getElementById('set-model');
  if (modelSelect) {
    modelSelect.innerHTML = AVAILABLE_MODELS.map(m =>
      `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${m.label} — ${m.desc}</option>`
    ).join('');
  }
}

async function saveSettingsForm() {
  const selectedModel = document.getElementById('set-model')?.value || 'gemini-2.5-flash';
  const settings = {
    name: document.getElementById('set-name').value.trim(),
    email: document.getElementById('set-email').value.trim(),
    github: document.getElementById('set-github').value.trim(),
    linkedin: document.getElementById('set-linkedin').value.trim(),
    location: document.getElementById('set-location').value.trim(),
    api_key: document.getElementById('set-api-key').value.trim(),
    model: selectedModel,
  };

  saveSettings(settings);
  setModel(selectedModel);
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
    'This will permanently delete ALL your Memory Vault entries, saved resumes, applications, and settings. This cannot be undone.',
    async () => {
      await clearVault();
      await clearResumes();
      await clearApplications();
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

// ===== APPLICATION TRACKER =====

const APP_STATUSES = ['to_apply', 'applied', 'waiting', 'interview', 'offer', 'rejected', 'withdrawn'];

const STATUS_META = {
  to_apply:  { label: 'To Apply',   emoji: '📌', cls: 'status-to_apply' },
  applied:   { label: 'Applied',    emoji: '✉️',  cls: 'status-applied' },
  waiting:   { label: 'Waiting',    emoji: '⏳',  cls: 'status-waiting' },
  interview: { label: 'Interview',  emoji: '🎙️', cls: 'status-interview' },
  offer:     { label: 'Offer',      emoji: '🎉',  cls: 'status-offer' },
  rejected:  { label: 'Rejected',   emoji: '✕',  cls: 'status-rejected' },
  withdrawn: { label: 'Withdrawn',  emoji: '—',  cls: 'status-withdrawn' },
};

function getStatusLabel(status) { return STATUS_META[status]?.label || status; }
function getStatusEmoji(status) { return STATUS_META[status]?.emoji || '•'; }

let trackerFilter = 'all';
let trackerModalEntryId = null;

function setTrackerFilter(filter) {
  trackerFilter = filter;
  document.querySelectorAll('.tracker-filter').forEach(btn => {
    const active = btn.dataset.filter === filter;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  renderTrackerList();
}

function renderTrackerStatsStrip() {
  const el = document.getElementById('tracker-stats-strip');
  if (!el) return;
  const counts = {};
  APP_STATUSES.forEach(s => counts[s] = 0);
  state.applications.forEach(a => { if (counts[a.status] !== undefined) counts[a.status]++; });
  el.innerHTML = APP_STATUSES.filter(s => counts[s] > 0).map(s => `
    <div class="tracker-stat-chip tracker-stat-chip--${s}" onclick="setTrackerFilter('${s}')">
      <span>${STATUS_META[s].emoji}</span>
      <span>${counts[s]}</span>
      <span class="tracker-stat-label">${STATUS_META[s].label}</span>
    </div>
  `).join('');
}

function renderTrackerList() {
  const container = document.getElementById('tracker-list');
  if (!container) return;

  const filtered = trackerFilter === 'all'
    ? state.applications
    : state.applications.filter(a => a.status === trackerFilter);

  const sorted = [...filtered].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (state.applications.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:48px 0;">
        <div style="font-size:2.5rem;margin-bottom:12px;">📋</div>
        <div class="empty-state-title">No applications tracked yet</div>
        <p class="empty-state-desc">Applications are automatically added when you generate a resume.<br>You can also add them manually.</p>
        <button class="btn btn-primary" onclick="openTrackerModal()" style="margin-top:16px;">+ Add application</button>
      </div>`;
    return;
  }

  if (sorted.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding:32px 0;"><p class="empty-state-desc">No applications with this status.</p></div>`;
    return;
  }

  container.innerHTML = sorted.map(a => `
    <div class="app-card" id="app-card-${a.id}">
      <div class="app-card-left">
        <div class="app-card-company">${escHtml(a.companyName)}</div>
        <div class="app-card-role">${escHtml(a.roleTitle)}</div>
        <div class="app-card-meta">
          ${a.appliedDate ? `<span>Applied ${formatDate(a.appliedDate)}</span>` : `<span>Added ${formatDate(a.createdAt)}</span>`}
          ${a.autoAdded ? '<span class="app-card-auto-badge">auto-tracked</span>' : ''}
          ${a.jdLink ? `<a href="${escHtml(a.jdLink)}" target="_blank" rel="noopener" class="app-card-link" onclick="event.stopPropagation()">View JD ↗</a>` : ''}
        </div>
        ${a.notes ? `<div class="app-card-notes">${escHtml(a.notes)}</div>` : ''}
      </div>
      <div class="app-card-right">
        <select class="status-selector" onchange="updateApplicationStatus(${a.id}, this.value)" aria-label="Update status">
          ${APP_STATUSES.map(s => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${STATUS_META[s].emoji} ${STATUS_META[s].label}</option>`).join('')}
        </select>
        <div class="app-card-actions">
          <button class="btn-text" style="font-size:var(--text-xs);" onclick="openTrackerModal(${a.id})">Edit</button>
          <button class="btn-danger-text" style="font-size:var(--text-xs);" onclick="confirmDeleteApplication(${a.id})">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

function renderTracker() {
  renderTrackerStatsStrip();
  renderTrackerList();
}

function openTrackerModal(entryId = null) {
  trackerModalEntryId = entryId;
  const modal = document.getElementById('tracker-modal');
  const titleEl = document.getElementById('tracker-modal-title');

  // Reset
  document.getElementById('tm-role').value = '';
  document.getElementById('tm-company').value = '';
  document.getElementById('tm-status').value = 'applied';
  document.getElementById('tm-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('tm-link').value = '';
  document.getElementById('tm-notes').value = '';

  if (entryId) {
    titleEl.textContent = 'Edit application';
    const entry = state.applications.find(a => a.id === entryId);
    if (entry) {
      document.getElementById('tm-role').value = entry.roleTitle || '';
      document.getElementById('tm-company').value = entry.companyName || '';
      document.getElementById('tm-status').value = entry.status || 'applied';
      document.getElementById('tm-date').value = entry.appliedDate || '';
      document.getElementById('tm-link').value = entry.jdLink || '';
      document.getElementById('tm-notes').value = entry.notes || '';
    }
  } else {
    titleEl.textContent = 'Add application';
  }

  modal.classList.add('open');
  setTimeout(() => document.getElementById('tm-role').focus(), 100);
}

function closeTrackerModal() {
  document.getElementById('tracker-modal').classList.remove('open');
  trackerModalEntryId = null;
}

async function saveTrackerEntry() {
  const roleTitle = document.getElementById('tm-role').value.trim();
  const companyName = document.getElementById('tm-company').value.trim();

  if (!roleTitle) { showToast('Please enter a role title', 'error'); return; }
  if (!companyName) { showToast('Please enter a company name', 'error'); return; }

  const appData = {
    roleTitle,
    companyName,
    status: document.getElementById('tm-status').value,
    appliedDate: document.getElementById('tm-date').value,
    jdLink: document.getElementById('tm-link').value.trim(),
    notes: document.getElementById('tm-notes').value.trim(),
    jdSnippet: '',
    resumeId: null,
    autoAdded: false,
  };

  try {
    if (trackerModalEntryId) {
      await updateApplication(trackerModalEntryId, appData);
      showToast('Application updated!', 'success');
    } else {
      await addApplication(appData);
      showToast('Application added!', 'success');
    }
    state.applications = await getAllApplications();
    updateNavBadges();
    closeTrackerModal();
    renderTracker();
    if (state.currentPage === 'dashboard') renderDashboard();
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  }
}

async function updateApplicationStatus(id, newStatus) {
  const app = state.applications.find(a => a.id === id);
  if (!app) return;
  try {
    await updateApplication(id, { ...app, status: newStatus });
    state.applications = await getAllApplications();
    updateNavBadges();
    renderTrackerStatsStrip();
    // Update just the card's select to reflect saved state
    const select = document.querySelector(`#app-card-${id} .status-selector`);
    if (select) select.value = newStatus;
    showToast(`Status updated to ${getStatusLabel(newStatus)}`, 'success', 2000);
    if (state.currentPage === 'dashboard') renderDashboard();
  } catch (e) {
    showToast('Failed to update status', 'error');
  }
}

async function confirmDeleteApplication(id) {
  const app = state.applications.find(a => a.id === id);
  showConfirm(
    '🗑️ Delete Application',
    `Remove "${app?.roleTitle || 'this application'}" at ${app?.companyName || ''}? This cannot be undone.`,
    async () => {
      await deleteApplication(id);
      state.applications = await getAllApplications();
      updateNavBadges();
      renderTracker();
      showToast('Application removed', 'info');
      if (state.currentPage === 'dashboard') renderDashboard();
    }
  );
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
  handleJDFileUpload,
  handleExistingResumeUpload,
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
  generateCoverLetterUI,
  copyCoverLetter,
  downloadCoverLetter,
  openTrackerModal,
  closeTrackerModal,
  saveTrackerEntry,
  updateApplicationStatus,
  confirmDeleteApplication,
  setTrackerFilter,
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

  // Wire up JD file upload
  const jdFileInput = document.getElementById('jd-file-input');
  if (jdFileInput) {
    jdFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleJDFileUpload(e.target.files[0]);
    });
  }

  // Wire up existing resume upload in generator
  const existingResumeInput = document.getElementById('existing-resume-input');
  if (existingResumeInput) {
    existingResumeInput.addEventListener('change', (e) => {
      if (e.target.files[0]) handleExistingResumeUpload(e.target.files[0]);
    });
  }

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
