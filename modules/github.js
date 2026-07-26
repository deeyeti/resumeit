/**
 * github.js - GitHub REST API integration
 * Fetches public repo data, commit frequency, and language stats.
 * Only communicates with api.github.com - no third-party servers.
 */

const GITHUB_API = 'https://api.github.com';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const cache = new Map();

function getCached(key) {
  if (cache.has(key)) {
    const { data, ts } = cache.get(key);
    if (Date.now() - ts < CACHE_TTL) return data;
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

async function ghFetch(path) {
  const cached = getCached(path);
  if (cached) return cached;

  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: { 'Accept': 'application/vnd.github.v3+json' }
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error('GitHub user not found.');
    if (response.status === 403) throw new Error('GitHub rate limit exceeded. Try again in a moment.');
    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = await response.json();
  setCache(path, data);
  return data;
}

export async function validateGitHubUser(handle) {
  const data = await ghFetch(`/users/${handle}`);
  return {
    login: data.login,
    name: data.name,
    bio: data.bio,
    avatar: data.avatar_url,
    company: data.company,
    location: data.location,
    publicRepos: data.public_repos,
    followers: data.followers,
    url: data.html_url,
  };
}

export async function fetchPublicRepos(handle) {
  const repos = await ghFetch(`/users/${handle}/repos?sort=updated&per_page=100&type=public`);
  return repos.map(r => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    url: r.html_url,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    topics: r.topics || [],
    updatedAt: r.updated_at,
    isForked: r.fork,
    size: r.size,
  }));
}

export async function fetchLanguageStats(handle, repos) {
  const langMap = {};
  const originalRepos = repos.filter(r => !r.isForked).slice(0, 20);

  await Promise.allSettled(
    originalRepos.map(async (repo) => {
      try {
        const langs = await ghFetch(`/repos/${handle}/${repo.name}/languages`);
        Object.entries(langs).forEach(([lang, bytes]) => {
          langMap[lang] = (langMap[lang] || 0) + bytes;
        });
      } catch (_) { /* skip */ }
    })
  );

  const total = Object.values(langMap).reduce((a, b) => a + b, 0);
  return Object.entries(langMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lang, bytes]) => ({
      lang,
      bytes,
      percent: total > 0 ? Math.round((bytes / total) * 100) : 0,
    }));
}

export async function fetchRecentActivity(handle) {
  try {
    const events = await ghFetch(`/users/${handle}/events/public?per_page=30`);
    const pushEvents = events.filter(e => e.type === 'PushEvent');
    const commitCount = pushEvents.reduce((sum, e) => sum + (e.payload?.commits?.length || 0), 0);

    const recentRepos = [...new Set(pushEvents.map(e => e.repo?.name).filter(Boolean))].slice(0, 5);

    return {
      totalPushEvents: pushEvents.length,
      recentCommits: commitCount,
      recentRepos,
      lastActive: events[0]?.created_at || null,
    };
  } catch (_) {
    return { totalPushEvents: 0, recentCommits: 0, recentRepos: [], lastActive: null };
  }
}

export async function fetchGitHubProfile(handle) {
  const [user, repos] = await Promise.all([
    validateGitHubUser(handle),
    fetchPublicRepos(handle),
  ]);

  const [languages, activity] = await Promise.all([
    fetchLanguageStats(handle, repos),
    fetchRecentActivity(handle),
  ]);

  const topRepos = repos
    .filter(r => !r.isForked)
    .sort((a, b) => b.stars - a.stars)
    .slice(0, 6);

  return { user, repos, topRepos, languages, activity };
}
