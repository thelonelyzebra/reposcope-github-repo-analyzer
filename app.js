const apiBase = 'https://api.github.com';
const languageColors = ['#32a675', '#4178b8', '#d75a43', '#8b6caf', '#d69c38'];
const form = document.querySelector('#analyze-form');
const repoInput = document.querySelector('#repo-input');
const tokenInput = document.querySelector('#token-input');
const analyzeButton = document.querySelector('#analyze-button');
const buttonLabel = analyzeButton.querySelector('.button-label');
const tokenToggle = document.querySelector('#token-toggle');
const tokenPanel = document.querySelector('#token-panel');
const notice = document.querySelector('#notice');
const results = document.querySelector('#results');
const emptyState = document.querySelector('#empty-state');
const apiIndicator = document.querySelector('#api-indicator');
const apiStatus = document.querySelector('#api-status');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function parseRepository(value) {
  const input = value.trim().replace(/\.git\/?$/i, '').replace(/\/$/, '');
  const match = input.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)(?:[/?#].*)?$|^([^/?#\s]+)\/([^/?#\s]+)$/i);
  if (!match) return null;
  const owner = match[1] || match[3];
  const repo = match[2] || match[4];
  if (!owner || !repo || owner.includes(':') || repo.includes(':')) return null;
  return { owner, repo };
}

async function fetchJson(url, token, optional = false) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    if (optional) return null;
    const error = new Error(response.status === 404
      ? 'Repository not found, or it is private. Check the URL or add a token with repository read access.'
      : response.status === 403 || response.status === 429
        ? 'GitHub API rate limit reached. Add a personal access token and try again shortly.'
        : `GitHub returned ${response.status} ${response.statusText}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function setStatus(state, label) {
  apiIndicator.className = `api-indicator${state === 'busy' ? ' busy' : state === 'error' ? ' error' : ''}`;
  apiStatus.innerHTML = `GITHUB API <span class="meta-divider">/</span> ${escapeHtml(label)}`;
}

function showNotice(message, isError = true) {
  notice.hidden = !message;
  notice.textContent = message;
  notice.classList.toggle('success', Boolean(message) && !isError);
}

function formatNumber(value) {
  return new Intl.NumberFormat('en', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0);
}

function formatDate(value) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value));
}

function timeAgo(value) {
  if (!value) return 'Date unavailable';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const unit = units.find(([, amount]) => seconds >= amount);
  if (!unit) return 'just now';
  const count = Math.floor(seconds / unit[1]);
  return `${count} ${unit[0]}${count === 1 ? '' : 's'} ago`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function stat(label, value, detail) {
  return `<div class="stat"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value" title="${escapeHtml(value)}">${escapeHtml(value)}</span><span class="stat-detail">${escapeHtml(detail)}</span></div>`;
}

function renderLanguages(languages) {
  const content = document.querySelector('#language-content');
  const entries = Object.entries(languages || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  document.querySelector('#language-total').textContent = total ? `${formatBytes(total)} TOTAL` : 'NO DATA';
  if (!entries.length) {
    content.innerHTML = '<p class="language-empty">No language data is available for this repository.</p>';
    return;
  }
  content.innerHTML = `<div class="language-list">${entries.slice(0, 7).map(([name, bytes], index) => {
    const percent = bytes / total * 100;
    return `<div class="language-row"><span class="language-name">${escapeHtml(name)}</span><span class="language-track"><span class="language-fill" style="width:${Math.max(percent, 1)}%;background:${languageColors[index % languageColors.length]}"></span></span><span class="language-percent">${percent < 1 ? '<1' : percent.toFixed(1)}%</span></div>`;
  }).join('')}</div>`;
}

function renderSignals(tree, repo) {
  if (!tree?.tree) {
    document.querySelector('#signals-content').innerHTML = '<p class="language-empty">Project signals are unavailable because GitHub did not return the file tree.</p>';
    return;
  }
  const paths = new Set((tree?.tree || []).filter((item) => item.type === 'blob').map((item) => item.path.toLowerCase()));
  const hasPath = (pattern) => [...paths].some((path) => pattern.test(path));
  const checks = [
    ['README', hasPath(/^readme(?:\.|$)/)],
    ['License', Boolean(repo.license) || hasPath(/^license(?:\.|$)/)],
    ['CI workflow', hasPath(/^\.github\/workflows\//) || hasPath(/^\.circleci\/config\.yml$/) || hasPath(/^\.travis\.yml$/)],
    ['Tests', hasPath(/(^|\/)(tests?|__tests__|spec)(\/|\.|$)/)],
    ['Contributing guide', hasPath(/^contributing(?:\.|$)/) || hasPath(/^\.github\/contributing\.md$/)],
    ['Issue templates', hasPath(/^\.github\/issue_template/) || hasPath(/^\.github\/issue_templates\//)],
  ];
  const checksFound = checks.filter(([, found]) => found).length;
  document.querySelector('#signals-content').innerHTML = `<div class="signal-list">${checks.map(([label, found]) => `<div class="signal${found ? '' : ' missing'}"><span class="signal-mark" aria-hidden="true">${found ? '+' : '-'}</span><span>${label}</span></div>`).join('')}</div><p class="signal-note">${checksFound} of ${checks.length} common project files detected. Signals reflect visible files on the default branch, not overall code quality.</p>`;
}

function renderTree(tree) {
  const items = (tree?.tree || []).filter((item) => item.path && (item.type === 'tree' || item.type === 'blob'));
  const directories = items.filter((item) => item.type === 'tree' && !item.path.includes('/'));
  const fileCount = items.filter((item) => item.type === 'blob').length;
  document.querySelector('#tree-total').textContent = `${formatNumber(fileCount)} FILES${tree?.truncated ? ' / PARTIAL' : ''}`;
  if (!items.length) {
    document.querySelector('#tree-content').innerHTML = '<p class="tree-empty">File map is not available for this repository.</p>';
    return;
  }
  const counts = new Map(directories.map(({ path }) => [path, 0]));
  let rootFiles = 0;
  for (const item of items) {
    if (item.type !== 'blob') continue;
    const first = item.path.split('/')[0];
    if (item.path.includes('/') && counts.has(first)) counts.set(first, counts.get(first) + 1);
    else if (!item.path.includes('/')) rootFiles += 1;
  }
  const visible = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  if (rootFiles) visible.push(['(root files)', rootFiles]);
  document.querySelector('#tree-content').innerHTML = `<div class="tree-list">${visible.map(([name, count]) => `<div class="tree-item"><span class="tree-path">${escapeHtml(name)}/</span><span class="tree-count">${formatNumber(count)} ${count === 1 ? 'file' : 'files'}</span></div>`).join('') || '<p class="tree-empty">No top-level directories found.</p>'}</div>`;
}

function renderActivity(commit, repository) {
  const content = document.querySelector('#activity-content');
  const commitData = commit?.commit;
  if (!commitData) {
    content.innerHTML = '<p class="tree-empty">Recent commit details are not available.</p>';
    return;
  }
  const message = commitData.message.split('\n')[0];
  const author = commitData.author?.name || commit.author?.login || 'Unknown author';
  const date = commitData.author?.date;
  content.innerHTML = `<div class="activity-card"><span class="activity-mark" aria-hidden="true">&gt;</span><div><p class="activity-message">${escapeHtml(message)}</p><div class="activity-meta"><span>${escapeHtml(author)}</span><span>${escapeHtml(timeAgo(date))}</span><a href="${escapeHtml(commit.html_url)}" target="_blank" rel="noreferrer">${escapeHtml(commit.sha.slice(0, 7))}</a></div></div></div>`;
}

function renderRepository(repo, languages, tree, commit) {
  const owner = repo.owner.login;
  const topics = (repo.topics || []).slice(0, 6);
  document.querySelector('#repo-heading').innerHTML = `<div class="repo-title-wrap"><p class="repo-owner">${escapeHtml(owner)} /</p><div class="repo-name-line"><h2>${escapeHtml(repo.name)}</h2><span class="visibility-tag">${repo.private ? 'private' : repo.archived ? 'archived' : 'public'}</span></div>${repo.description ? `<p class="repo-description">${escapeHtml(repo.description)}</p>` : ''}${topics.length ? `<div class="topic-list">${topics.map((topic) => `<span class="topic-tag">${escapeHtml(topic)}</span>`).join('')}</div>` : ''}</div><div class="repo-actions"><a class="repo-action" href="${escapeHtml(repo.html_url)}" target="_blank" rel="noreferrer" aria-label="Open repository on GitHub" title="Open on GitHub">&gt;</a><a class="repo-action" href="${escapeHtml(repo.html_url)}/issues" target="_blank" rel="noreferrer" aria-label="View repository issues" title="View issues">#</a></div>`;
  const languageNames = Object.entries(languages || {}).sort((a, b) => b[1] - a[1]);
  const primaryLanguage = repo.language || languageNames[0]?.[0] || 'Not detected';
  document.querySelector('#stat-grid').innerHTML = [
    stat('Stars', formatNumber(repo.stargazers_count), `+ ${formatNumber(repo.watchers_count)} watching`),
    stat('Forks', formatNumber(repo.forks_count), `${formatNumber(repo.open_issues_count)} open issues*`),
    stat('Primary language', primaryLanguage, `${languageNames.length} detected`),
    stat('Default branch', repo.default_branch, `Updated ${timeAgo(repo.pushed_at)}`),
    stat('Repository size', formatBytes(repo.size * 1024), `Created ${formatDate(repo.created_at)}`),
  ].join('');
  renderLanguages(languages);
  renderSignals(tree, repo);
  renderTree(tree);
  renderActivity(commit, repo);
  const truncated = tree?.truncated ? ' GitHub truncated the file tree, so directory counts are partial.' : '';
  document.querySelector('#data-note').textContent = `* GitHub's open issues count can include pull requests. Repository map and project signals use the ${repo.default_branch} branch.${truncated}`;
  results.hidden = false;
  emptyState.hidden = true;
}

async function analyze(value) {
  const parsed = parseRepository(value);
  if (!parsed) {
    results.hidden = true;
    emptyState.hidden = false;
    showNotice('Enter a GitHub URL or owner/repository, for example: vercel/next.js');
    repoInput.focus();
    return;
  }
  notice.hidden = true;
  results.hidden = true;
  emptyState.hidden = true;
  analyzeButton.disabled = true;
  buttonLabel.textContent = 'Analyzing';
  buttonLabel.classList.add('loading-dots');
  setStatus('busy', 'FETCHING');

  try {
    const path = `${apiBase}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
    const token = tokenInput.value.trim();
    const repo = await fetchJson(path, token);
    const [languages, tree, commits] = await Promise.all([
      fetchJson(`${apiBase}/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/languages`, token, true),
      fetchJson(`${apiBase}/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`, token, true),
      fetchJson(`${apiBase}/repos/${encodeURIComponent(repo.owner.login)}/${encodeURIComponent(repo.name)}/commits?per_page=1`, token, true),
    ]);
    renderRepository(repo, languages, tree, commits?.[0]);
    setStatus('ready', 'CONNECTED');
    showNotice(`Analysis complete / ${repo.full_name}`, false);
    try {
      window.localStorage.setItem('reposcope:last-repo', repo.full_name);
    } catch {}
  } catch (error) {
    emptyState.hidden = false;
    setStatus('error', 'CHECK INPUT');
    showNotice(error.message || 'Could not reach GitHub. Check your connection and try again.');
  } finally {
    analyzeButton.disabled = false;
    buttonLabel.textContent = 'Analyze repository';
    buttonLabel.classList.remove('loading-dots');
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  analyze(repoInput.value);
});

document.querySelectorAll('[data-repo]').forEach((button) => {
  button.addEventListener('click', () => {
    repoInput.value = button.dataset.repo;
    analyze(button.dataset.repo);
  });
});

tokenToggle.addEventListener('click', () => {
  const opening = tokenPanel.hidden;
  tokenPanel.hidden = !opening;
  tokenToggle.setAttribute('aria-expanded', String(opening));
  tokenToggle.textContent = opening ? '- HIDE TOKEN' : '+ ADD TOKEN';
  if (opening) tokenInput.focus();
});

try {
  const previousRepo = window.localStorage.getItem('reposcope:last-repo');
  if (previousRepo) repoInput.value = previousRepo;
} catch {
}