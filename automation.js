'use strict';

const studio = id => document.getElementById(id);
const defaultFeed = 'https://www.holistictherapists.ie/wp-json/wp/v2/posts?per_page=10&_fields=id,date,link,title,excerpt';

async function studioInit() {
  const local = await chrome.storage.local.get(['openAiKey','monitorEnabled','feedUrl','scheduledPosts','lastScanAt','lastScanError']);
  studio('aiKey').value = local.openAiKey || '';
  studio('monitorEnabled').checked = !!local.monitorEnabled;
  studio('feedUrl').value = local.feedUrl || defaultFeed;
  studio('monitorStatus').textContent = local.lastScanError ? 'Last scan error: ' + local.lastScanError : (local.monitorEnabled ? 'Monitoring is enabled. Checks every 6 hours.' : 'Monitoring is off.');
  renderSchedule(local.scheduledPosts || []);
}
function studioToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(studioToast.timer);
  studioToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
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
async function callOpenAI(prompt) {
  const { openAiKey } = await chrome.storage.local.get('openAiKey');
  if (!openAiKey) throw new Error('Add your OpenAI API key first.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + openAiKey },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      instructions: 'You are a social media editor for Holistic Therapists Ireland. Write natural, engaging Irish English. Be accurate, inclusive and professional. Do not invent event details, prices, qualifications, claims or links. Return only the revised post, preserving factual information and the supplied URL.',
      input: prompt,
      max_output_tokens: 700
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'OpenAI request failed (' + response.status + ').');
  const output = (data.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (!output) throw new Error('The AI response was empty.');
  return output;
}
studio('saveAiKey').addEventListener('click', async () => {
  const key = studio('aiKey').value.trim();
  if (key && !key.startsWith('sk-')) { studioToast('That does not look like an OpenAI API key.'); return; }
  await chrome.storage.local.set({ openAiKey: key });
  studioToast(key ? 'AI key saved in this browser.' : 'AI key removed.');
});

studio('aiGenerate').addEventListener('click', async () => {
  const source = window.htShareGetCurrentPage?.();
  if (!source?.title) { studioToast('Open an article, event or practitioner listing first.'); return; }
  const button = studio('aiGenerate');
  button.disabled = true; button.textContent = 'Generating caption…';
  try {
    const platform = document.querySelector('.tab[aria-selected="true"]')?.dataset.net || 'facebook';
    const prompt = [
      'Create a complete, engaging social media post for ' + platform + ' using only the source details below.',
      'Write in natural Irish English. Adapt length and style to the platform. Include a clear invitation to read, attend or discover.',
      'Do not invent prices, dates, claims, credentials or details. Include the source URL unless platform is Instagram; for Instagram say link in bio.',
      'Suggest up to 5 relevant hashtags. Return only the post text.',
      'CONTENT TYPE: ' + (source.type || 'page'),
      'TITLE: ' + source.title,
      'DESCRIPTION: ' + (source.desc || ''),
      'URL: ' + source.url,
      'EVENT DETAILS: ' + JSON.stringify(source.event || {})
    ].join('\n');
    const generated = await callOpenAI(prompt);
    setCaption(generated);
    studioToast('AI post generated. Review all details before sharing.');
  } catch (error) { studioToast(error.message); }
  finally { button.disabled = false; button.textContent = '✨ Generate a fresh caption with AI'; }
});
\nstudio('aiRewrite').addEventListener('click', async () => {
  const caption = currentCaption();
  if (!caption) { studioToast('Generate or enter a caption first.'); return; }
  const button = studio('aiRewrite');
  button.disabled = true; button.textContent = 'Improving caption…';
  try {
    const revised = await callOpenAI('Improve this social media caption. Keep it suitable for the selected platform and retain all factual details and URLs.\n\n' + caption);
    setCaption(revised);
    studioToast('AI caption ready. Review it before sharing.');
  } catch (error) { studioToast(error.message); }
  finally { button.disabled = false; button.textContent = '✨ Improve current caption with AI'; }
});
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
    return '<div class="schedule-item"><span>' + escapeHtml(item.title) + '<br><small>' + date + (item.notified ? ' · Reminder sent' : '') + '</small></span><button type="button" data-remove="' + item.id + '" aria-label="Remove reminder">Remove</button></div>';
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
  const item = { id: crypto.randomUUID(), when, title, caption, url: window.htShareGetCurrentPage?.()?.url || 'https://www.holistictherapists.ie' };
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
