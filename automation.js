'use strict';

const studio = id => document.getElementById(id);
const defaultFeed = 'https://www.holistictherapists.ie/wp-json/wp/v2/posts?per_page=10&_fields=id,date,link,title,excerpt';
const MWAPI_DEFAULT_BASE = 'https://api.mwapi.dev';

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

async function loadMwapiModels() {
  const button = studio('loadMwapiModels');
  const status = studio('mwapiStatus');
  const select = studio('mwapiModelList');
  button.disabled = true;
  button.textContent = 'Loading models…';
  status.textContent = 'Loading models from MWAPI…';
  try {
    const local = await chrome.storage.local.get(['mwapiApiKey', 'mwapiBaseUrl', 'mwapiModel']);
    const key = local.mwapiApiKey || '';
    if (!key) throw new Error('Save your MWAPI API key first.');
    const baseUrl = normalizeBaseUrl(local.mwapiBaseUrl || MWAPI_DEFAULT_BASE);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(baseUrl + '/v1/models', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      // Some Anthropic-compatible gateways use x-api-key for authenticated catalogue requests.
      if (response.status === 401 || response.status === 403) {
        response = await fetch(baseUrl + '/v1/models', {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Accept': 'application/json' },
          cache: 'no-store',
          signal: controller.signal
        });
      }
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error('MWAPI model list returned HTTP ' + response.status + '.');
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload : (payload.data || payload.models || payload.items || []);
    const models = entries.map(item => typeof item === 'string' ? item : (item.id || item.name || item.model))
      .filter(value => typeof value === 'string' && value.trim())
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b));
    if (!models.length) throw new Error('MWAPI returned no model IDs in the expected models list.');
    const savedModel = (studio('mwapiModel').value || local.mwapiModel || '').trim();
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a model…';
    select.appendChild(placeholder);
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      select.appendChild(option);
    });
    if (savedModel && models.includes(savedModel)) select.value = savedModel;
    else if (models.length === 1) select.value = models[0];
    if (!studio('mwapiModel').value && select.value) studio('mwapiModel').value = select.value;
    status.textContent = 'Loaded ' + models.length + ' model(s). Choose one or enter a model ID manually.';
    studioToast('MWAPI models loaded.');
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Loading models timed out.' : error.message;
    status.textContent = 'Could not load models: ' + message + ' You can still enter the model ID manually.';
    studioToast(message);
  } finally {
    button.disabled = false;
    button.textContent = 'Load models';
  }
}
async function mwapiRequest(path, payload) {
  const { key, baseUrl } = await getMwapiSettings(false);
  if (!key) throw new Error('Enter and save your MWAPI API key first.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(baseUrl + path, {
      method: 'POST', signal: controller.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload), cache: 'no-store'
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error('MWAPI returned non-JSON (HTTP ' + response.status + ').'); }
    if (!response.ok) throw new Error(data.error?.message || data.message || data.detail || ('HTTP ' + response.status));
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('MWAPI request timed out after 45 seconds.');
    if (error instanceof TypeError) throw new Error('Network/CORS error. Check connection and MWAPI browser access.');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function testMwapi() {
  const status = studio('mwapiStatus');
  const button = studio('testMwapi');
  button.disabled = true; status.textContent = 'Testing MWAPI Messages API…';
  try {
    const { model } = await getMwapiSettings(true);
    const data = await mwapiRequest('/v1/messages', { model, max_tokens: 12, messages: [{ role: 'user', content: 'Reply with exactly: MWAPI connection successful' }] });
    const reply = Array.isArray(data.content) ? data.content.filter(part => part.type === 'text').map(part => part.text).join(' ').trim() : '';
    if (!reply) throw new Error('MWAPI responded, but no text block was returned.');
    status.textContent = 'Connection successful · model: ' + (data.model || model); studioToast('MWAPI connection successful.');
    return true;
  } catch (error) { status.textContent = 'Connection test failed: ' + error.message; studioToast(error.message); return false; }
  finally { button.disabled = false; }
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
    const { model } = await getMwapiSettings(true);
    const prompt = buildApiPrompt(mode, caption, source, currentPlatform());
    const data = await mwapiRequest('/v1/messages', {
      model, max_tokens: 1200,
      system: 'You are a careful social media copywriter for Holistic Therapists Ireland. Follow instructions exactly. Never fabricate facts or medical claims.',
      messages: [{ role: 'user', content: prompt }]
    });
    const result = Array.isArray(data.content) ? data.content.filter(part => part.type === 'text').map(part => part.text || '').join('\n').trim() : '';
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
    const selectedModel = studio('mwapiModelList').value;
    const modelToSave = model || selectedModel;
    if (modelToSave) await chrome.storage.local.set({ mwapiModel: modelToSave });
    await chrome.storage.local.set({ mwapiBaseUrl: baseUrl });
    studio('mwapiKey').value = '';
    studio('mwapiStatus').textContent = 'MWAPI settings saved locally. Key is hidden; use Test connection.';
    studioToast('MWAPI settings saved.');
  } catch (error) { studioToast(error.message); }
});

studio('loadMwapiModels').addEventListener('click', loadMwapiModels);
studio('mwapiModelList').addEventListener('change', () => {
  if (studio('mwapiModelList').value) studio('mwapiModel').value = studio('mwapiModelList').value;
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
function compareVersions(a, b) {
  const parse = value => {
    const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
    if (!match) throw new Error('Invalid version number received from GitHub: ' + value);
    return match.slice(1, 4).map(Number);
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

async function checkForExtensionUpdates(showToast = true) {
  const button = studio('checkUpdate');
  const status = studio('updateStatus');
  const installed = chrome.runtime.getManifest().version;
  button.disabled = true;
  button.textContent = 'Checking GitHub…';
  status.textContent = 'Checking GitHub for the latest HT Share version…';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://raw.githubusercontent.com/ravxvx/ht-share/main/manifest.json?cache=' + Date.now(), {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error('GitHub returned HTTP ' + response.status + '.');
    const latest = await response.json();
    if (!latest || !latest.version) throw new Error('GitHub manifest does not contain a version number.');
    const comparison = compareVersions(latest.version, installed);
    status.replaceChildren();
    const versionLine = document.createElement('span');
    versionLine.textContent = 'Installed: ' + installed + ' · Latest on GitHub: ' + latest.version + '. ';
    status.appendChild(versionLine);
    if (comparison > 0) {
      const message = document.createElement('span');
      message.textContent = 'Update available. Download the ZIP, extract it, then open chrome://extensions and click Reload on HT Share (or remove the old unpacked copy and load the new folder).';
      status.appendChild(message);
      status.appendChild(document.createElement('br'));
      const link = document.createElement('a');
      link.href = 'https://github.com/ravxvx/ht-share/archive/refs/heads/main.zip';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Download HT Share update';
      status.appendChild(link);
      if (showToast) studioToast('A new HT Share version is available.');
    } else if (comparison === 0) {
      const message = document.createElement('span');
      message.textContent = 'HT Share is up to date.';
      status.appendChild(message);
      if (showToast) studioToast('HT Share is up to date.');
    } else {
      const message = document.createElement('span');
      message.textContent = 'The installed version is newer than the version currently published on GitHub.';
      status.appendChild(message);
    }
    return { installed, latest: latest.version, updateAvailable: comparison > 0 };
  } catch (error) {
    const message = error.name === 'AbortError'
      ? 'GitHub check timed out after 15 seconds. Try again.'
      : 'Update check failed: ' + error.message;
    status.textContent = 'Installed: ' + installed + ' · ' + message;
    if (showToast) studioToast(message);
    return { installed, error: message };
  } finally {
    button.disabled = false;
    button.textContent = 'Check for extension updates';
  }
}

studio('checkUpdate').addEventListener('click', () => checkForExtensionUpdates(true));
studio('updateStatus').textContent = 'Installed version: ' + chrome.runtime.getManifest().version + '. Click the button to check GitHub.';
studioInit();
