'use strict';

const studio = id => document.getElementById(id);
const defaultFeed = 'https://www.holistictherapists.ie/wp-json/wp/v2/posts?per_page=10&_fields=id,date,link,title,excerpt';
const MWAPI_DEFAULT_BASE = 'https://api.mwapi.dev/v1';

async function studioInit() {
  const local = await chrome.storage.local.get(['monitorEnabled','feedUrl','scheduledPosts','lastScanAt','lastScanError','mwapiBaseUrl','mwapiModel']);
  studio('monitorEnabled').checked = !!local.monitorEnabled;
  studio('feedUrl').value = local.feedUrl || defaultFeed;
  studio('mwapiModel').value = local.mwapiModel || '';
  studio('monitorStatus').textContent = local.lastScanError ? 'Last scan error: ' + local.lastScanError : (local.monitorEnabled ? 'Monitoring is enabled. Checks every 6 hours.' : 'Monitoring is off.');
  studio('mwapiStatus').textContent = local.mwapiBaseUrl ? 'Saved MWAPI settings. API key is stored locally.' : 'MWAPI is not configured.';
  renderSchedule(local.scheduledPosts || []);
}
function studioToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(studioToast.timer);
  studioToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}
function currentCaption() {
  const field = document.getElementById('text');
  return field ? field.value.trim() : '';
}
function setCaption(value) {
  const field = document.getElementById('text');
  if (!field) return;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
function currentSource() {
  return window.htShareGetCurrentPage?.() || {};
}
function currentPlatform() {
  return document.querySelector('.tab[aria-selected="true"]')?.dataset.net || 'facebook';
}
function makeChatGPTPrompt(mode, caption, source, platform) {
  if (mode === 'improve') return 'Improve this social media caption for ' + platform + '. Use natural Irish English. Preserve all facts and URLs. Return only the improved post.\n\n' + caption;
  return [
    'Create a complete social media post for ' + platform + ' for Holistic Therapists Ireland.',
    'Use natural Irish English. Be engaging and professional. Do not invent facts, dates, prices, qualifications or claims.',
    'Include a call to action and up to 5 relevant hashtags. Include the source URL except for Instagram, where say link in bio.',
    'Return only the post text.',
    'CONTENT TYPE: ' + (source.type || 'page'),
    'TITLE: ' + (source.title || ''),
    'DESCRIPTION: ' + (source.desc || ''),
    'URL: ' + (source.url || ''),
    'EVENT DETAILS: ' + JSON.stringify(source.event || {})
  ].join('\n');
}
async function handOffToChatGPT(mode) {
  const source = currentSource();
  const caption = currentCaption();
  if (mode === 'improve' && !caption) { studioToast('Generate or enter a caption first.'); return; }
  if (mode === 'generate' && !source.title) { studioToast('Open an article, event or practitioner listing first.'); return; }
  const prompt = makeChatGPTPrompt(mode, caption, source, currentPlatform());
  try {
    await navigator.clipboard.writeText(prompt);
    await chrome.tabs.create({ url: 'https://chatgpt.com/' });
    studioToast('Prompt copied. Paste it into ChatGPT, then copy the result back here.');
  } catch (error) { studioToast('Could not open ChatGPT: ' + error.message); }
}
function normalizeBaseUrl(value) {
  const url = new URL(value || MWAPI_DEFAULT_BASE);
  if (url.protocol !== 'https:') throw new Error('MWAPI must use HTTPS.');
  if (url.hostname !== 'api.mwapi.dev') throw new Error('For security, this integration only accepts api.mwapi.dev.');
  return url.origin + url.pathname.replace(/\/+$/, '');
}
async function getMwapiSettings(requireKey = true) {
  const local = await chrome.storage.local.get(['mwapiApiKey','mwapiBaseUrl','mwapiModel']);
  const key = local.mwapiApiKey || '';
  const baseUrl = normalizeBaseUrl(local.mwapiBaseUrl || MWAPI_DEFAULT_BASE);
  const model = (local.mwapiModel || studio('mwapiModel')?.value || '').trim();
  if (requireKey && !key) throw new Error('Enter and save your MWAPI API key first.');
  if (!model) throw new Error('Enter the exact model ID shown in your MWAPI account.');
  return { key, baseUrl, model };
}
async function mwapiRequest(path, options = {}) {
  const { key, baseUrl } = await getMwapiSettings(false);
  if (!key) throw new Error('Enter and save your MWAPI API key first.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(baseUrl + path, {
      ...options,
      signal: controller.signal,
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Accept': 'application/json', ...(options.headers || {}) },
      cache: 'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('MWAPI returned a non-JSON response (HTTP ' + response.status + '). Check the API base URL.'); }
    if (!response.ok) {
      const detail = data.error?.message || data.message || data.detail || ('HTTP ' + response.status);
      throw new Error(String(detail).slice(0, 500));
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('MWAPI request timed out after 45 seconds.');
    if (error instanceof TypeError) throw new Error('Network/CORS error. Check the connection and whether MWAPI permits Chrome extension requests.');
    throw error;
  } finally { clearTimeout(timeout); }
}
function extractModelIds(data) {
  const rows = Array.isArray(data) ? data : (data.data || data.models || data.items || []);
  return rows.map(item => typeof item === 'string' ? item : item.id || item.name).filter(Boolean);
}
async function testMwapi() {
  const status = studio('mwapiStatus');
  const button = studio('testMwapi');
  button.disabled = true;
  status.textContent = 'Testing MWAPI connection…';
  try {
    const { baseUrl, key } = await getMwapiSettings(false);
    if (!key) throw new Error('Save your MWAPI API key first.');
    const response = await fetch(baseUrl + '/models', {
      headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' },
      cache: 'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('The /models endpoint did not return JSON (HTTP ' + response.status + ').'); }
    if (!response.ok) throw new Error(data.error?.message || data.message || 'MWAPI returned HTTP ' + response.status + '.');
    const ids = extractModelIds(data);
    if (ids.length) {
      const modelInput = studio('mwapiModel');
      if (!modelInput.value.trim()) modelInput.value = ids[0];
      status.textContent = 'Connection successful. ' + ids.length + ' model(s) returned. Choose the exact model ID below.';
    } else {
      status.textContent = 'Authentication and /models endpoint responded, but no model IDs were found. Enter the model ID from your MWAPI dashboard.';
    }
    await chrome.storage.local.set({ mwapiBaseUrl: baseUrl });
    return true;
  } catch (error) {
    status.textContent = 'Connection test failed: ' + error.message;
    studioToast(error.message);
    return false;
  } finally { button.disabled = false; }
}
function buildApiPrompt(mode, caption, source, platform) {
  if (mode === 'improve') {
    return 'Improve this social media caption for ' + platform + ' for Holistic Therapists Ireland. Use natural Irish English. Preserve every factual detail, date, price, qualification and URL. Do not invent claims. Keep it suitable for the platform. Return only the revised post.\n\n' + caption;
  }
  return [
    'Write a polished social media post for Holistic Therapists Ireland.',
    'Platform: ' + platform + '. Use natural Irish English.',
    'Be warm, credible, professional and engaging. Do not invent facts, dates, prices, qualifications, health outcomes or claims.',
    'Use the supplied page details only. Include a clear call to action and up to 5 relevant hashtags.',
    platform === 'instagram' ? 'Do not print the source URL; say “Link in bio”.' : 'Include the source URL.',
    'Return only the final post text, with no explanation.',
    'Page type: ' + (source.type || 'page'),
    'Title: ' + (source.title || ''),
    'Description: ' + (source.desc || ''),
    'URL: ' + (source.url || ''),
    'Event details: ' + JSON.stringify(source.event || {})
  ].join('\n');
}
async function generateWithMwapi(mode) {
  const button = studio(mode === 'generate' ? 'apiGenerate' : 'apiRewrite');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Generating…';
  try {
    const caption = currentCaption();
    const source = currentSource();
    if (mode === 'improve' && !caption) throw new Error('Generate or enter a caption first.');
    if (mode === 'generate' && !source.title) throw new Error('Open an article, event or practitioner listing first.');
    const { key, baseUrl, model } = await getMwapiSettings(true);
    const prompt = buildApiPrompt(mode, caption, source, currentPlatform());
    const response = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a careful social media copywriter for Holistic Therapists Ireland. Follow the user instructions exactly. Never fabricate facts or medical claims.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        stream: false
      }),
      cache: 'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('MWAPI returned a non-JSON response (HTTP ' + response.status + ').'); }
    if (!response.ok) throw new Error(data.error?.message || data.message || data.detail || ('MWAPI HTTP ' + response.status));
    const content = data.choices?.[0]?.message?.content;
    const result = Array.isArray(content) ? content.map(part => part.text || '').join('\n').trim() : String(content || '').trim();
    if (!result) throw new Error('The API responded, but no text was found in choices[0].message.content.');
    setCaption(result);
    studio('mwapiStatus').textContent = 'MWAPI request successful · model: ' + (data.model || model);
    studioToast('AI text added to the caption. Review it before publishing.');
  } catch (error) {
    studio('mwapiStatus').textContent = 'MWAPI error: ' + error.message;
    studioToast(error.message);
  } finally { button.disabled = false; button.textContent = original; }
}
studio('aiGenerate').addEventListener('click', () => handOffToChatGPT('generate'));
studio('aiRewrite').addEventListener('click', () => handOffToChatGPT('improve'));
studio('saveMwapi').addEventListener('click', async () => {
  try {
    const key = studio('mwapiKey').value.trim();
    const model = studio('mwapiModel').value.trim();
    const baseUrl = normalizeBaseUrl(MWAPI_DEFAULT_BASE);
    const current = await chrome.storage.local.get('mwapiApiKey');
    if (key) await chrome.storage.local.set({ mwapiApiKey: key });
    else if (!current.mwapiApiKey) throw new Error('Paste your MWAPI API key first.');
    if (model) await chrome.storage.local.set({ mwapiModel: model });
    await chrome.storage.local.set({ mwapiBaseUrl: baseUrl });
    studio('mwapiKey').value = '';
    studio('mwapiStatus').textContent = 'MWAPI settings saved locally. Key is hidden; use Test connection.';
    studioToast('MWAPI settings saved.');
  } catch (error) { studioToast(error.message); }
});
studio('testMwapi').addEventListener('click', testMwapi);
studio('apiGenerate').addEventListener('click', () => generateWithMwapi('generate'));
studio('apiRewrite').addEventListener('click', () => generateWithMwapi('improve'));

studio('saveMonitor').addEventListener('click', async () => {
  const enabled = studio('monitorEnabled').checked;
  const feedUrl = studio('feedUrl').value.trim() || defaultFeed;
  if (!/^https:\/\//i.test(feedUrl)) { studioToast('Use a secure HTTPS feed URL.'); return; }
  try {
    const result = await chrome.runtime.sendMessage({ type: enabled ? 'HT_START_MONITOR' : 'HT_STOP_MONITOR', feedUrl });
    if (!result?.ok) throw new Error(result?.error || 'Could not save monitoring settings.');
    await chrome.storage.local.set({ feedUrl });
    studio('monitorStatus').textContent = enabled ? 'Monitoring is enabled. Checks every 6 hours.' : 'Monitoring is off.';
    studioToast('Monitoring settings saved.');
  } catch (error) { studioToast(error.message); }
});
studio('scanNow').addEventListener('click', async () => {
  const button = studio('scanNow');
  button.disabled = true; button.textContent = 'Scanning…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'HT_SCAN_NOW' });
    studio('monitorStatus').textContent = result.lastScanError ? 'Scan failed: ' + result.lastScanError : 'Scan complete. ' + (result.pendingContent ? 'New content found: ' + result.pendingContent.title : 'No new content detected.');
    studioToast(result.lastScanError || 'Website scan completed.');
  } catch (error) { studioToast(error.message); }
  finally { button.disabled = false; button.textContent = 'Scan now'; }
});
function renderSchedule(items) {
  const list = studio('scheduleList');
  if (!items.length) { list.innerHTML = '<p class="studio-note">No scheduled reminders yet.</p>'; return; }
  list.innerHTML = items.sort((a,b) => a.when - b.when).map(item => {
    const date = new Date(item.when).toLocaleString('en-IE', { dateStyle:'medium', timeStyle:'short' });
    return '<div class="schedule-item"><span>' + escapeHtml(item.title) + '<br><small>' + date + (item.notified ? ' · Reminder sent' : '') + '</small></span><button type="button" data-remove="' + escapeHtml(item.id) + '" aria-label="Remove reminder">Remove</button></div>';
  }).join('');
  list.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type:'HT_DELETE_SCHEDULE', id:button.dataset.remove });
    const { scheduledPosts = [] } = await chrome.storage.local.get('scheduledPosts');
    renderSchedule(scheduledPosts);
  }));
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
studio('schedulePost').addEventListener('click', async () => {
  const when = new Date(studio('scheduleWhen').value).getTime();
  const caption = currentCaption();
  if (!caption) { studioToast('Prepare a caption before scheduling.'); return; }
  if (!Number.isFinite(when) || when <= Date.now()) { studioToast('Choose a future date and time.'); return; }
  const title = caption.split('\n')[0].slice(0, 90) || 'Social media post';
  const item = { id: crypto.randomUUID(), when, title, caption, url: currentSource().url || 'https://www.holistictherapists.ie' };
  try {
    const result = await chrome.runtime.sendMessage({ type:'HT_SCHEDULE_POST', item });
    if (!result?.ok) throw new Error(result?.error || 'Could not schedule reminder.');
    const { scheduledPosts = [] } = await chrome.storage.local.get('scheduledPosts');
    renderSchedule(scheduledPosts);
    studioToast('Publishing reminder scheduled.');
  } catch (error) { studioToast(error.message); }
});
studioInit();

studio('checkUpdate').addEventListener('click', async () => {
  const button = studio('checkUpdate');
  const status = studio('updateStatus');
  button.disabled = true; button.textContent = 'Checking GitHub…';
  try {
    const response = await fetch('https://raw.githubusercontent.com/ravxvx/ht-share/main/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('GitHub returned HTTP ' + response.status);
    const latest = await response.json();
    const installed = chrome.runtime.getManifest().version;
    status.textContent = 'Installed: ' + installed + ' · Latest: ' + latest.version;
    if (compareVersions(latest.version, installed) > 0) {
      status.innerHTML = 'New version ' + escapeHtml(latest.version) + ' is available. <a href="https://github.com/ravxvx/ht-share/archive/refs/heads/main.zip" target="_blank" rel="noreferrer">Download update ZIP</a>.';
      studioToast('A new HT Share version is available.');
    } else {
      studioToast('HT Share is up to date.');
    }
  } catch (error) { status.textContent = 'Update check failed: ' + error.message; }
  finally { button.disabled = false; button.textContent = 'Check for extension updates'; }
});
function compareVersions(a, b) {
  const left = String(a).split('.').map(Number), right = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}
