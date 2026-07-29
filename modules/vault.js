/**
 * vault.js - Memory Vault CRUD operations using IndexedDB
 * Stores experiences, projects, and metrics locally on the client.
 */

const DB_NAME = 'resumeit_db';
const DB_VERSION = 3;
const STORE_VAULT = 'vault';
const STORE_RESUMES = 'resumes';
const STORE_APPLICATIONS = 'applications';

let db = null;

export async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const database = e.target.result;

      if (!database.objectStoreNames.contains(STORE_VAULT)) {
        const vaultStore = database.createObjectStore(STORE_VAULT, { keyPath: 'id', autoIncrement: true });
        vaultStore.createIndex('title', 'title', { unique: false });
        vaultStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!database.objectStoreNames.contains(STORE_RESUMES)) {
        const resumeStore = database.createObjectStore(STORE_RESUMES, { keyPath: 'id', autoIncrement: true });
        resumeStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!database.objectStoreNames.contains(STORE_APPLICATIONS)) {
        const appStore = database.createObjectStore(STORE_APPLICATIONS, { keyPath: 'id', autoIncrement: true });
        appStore.createIndex('status', 'status', { unique: false });
        appStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = (e) => reject(e.target.error);
  });
}

function getStore(storeName, mode = 'readonly') {
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

// ===== VAULT ENTRIES =====

export async function getAllVaultEntries() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_VAULT);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function getVaultEntry(id) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_VAULT);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function addVaultEntry(entry) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_VAULT, 'readwrite');
    const now = new Date().toISOString();
    const request = store.add({ ...entry, createdAt: now, updatedAt: now });
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function updateVaultEntry(id, entry) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_VAULT, 'readwrite');
    const updatedEntry = { ...entry, id, updatedAt: new Date().toISOString() };
    const request = store.put(updatedEntry);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteVaultEntry(id) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_VAULT, 'readwrite');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function clearVault() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_VAULT, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

// ===== SAVED RESUMES =====

export async function getAllResumes() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_RESUMES);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function saveResume(resumeData) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_RESUMES, 'readwrite');
    const now = new Date().toISOString();
    const request = store.add({ ...resumeData, createdAt: now });
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteResume(id) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_RESUMES, 'readwrite');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function clearResumes() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_RESUMES, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

// ===== JOB APPLICATIONS =====

export async function getAllApplications() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_APPLICATIONS);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function addApplication(app) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_APPLICATIONS, 'readwrite');
    const now = new Date().toISOString();
    const request = store.add({ ...app, createdAt: now, updatedAt: now });
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function updateApplication(id, app) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_APPLICATIONS, 'readwrite');
    const updated = { ...app, id, updatedAt: new Date().toISOString() };
    const request = store.put(updated);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function deleteApplication(id) {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_APPLICATIONS, 'readwrite');
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

export async function clearApplications() {
  return new Promise((resolve, reject) => {
    const store = getStore(STORE_APPLICATIONS, 'readwrite');
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}
