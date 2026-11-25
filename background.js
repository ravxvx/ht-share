'use strict';

const SITE = 'https://www.holistictherapists.ie';
const SCAN_ALARM = 'ht-share-content-scan';

chrome.runtime.onInstalled.addListener(async () => {
  const state = await chrome.storage.local.get(['monitorEnabled', 'feedUrl']);
  if (state.monitorEnabled) startMonitoring();
  await restoreScheduledPosts();
});

chrome.runtime.onStartup.addListener(restoreScheduledPosts);

function startMonitoring() {
  chrome.alarms.create(SCAN_ALARM, { periodInMinutes: 360 });
  scanForNewContent();
}

function stopMonitoring() {
  chrome.alarms.clear(SCAN_ALARM);
}

async function scanForNewContent() {
  const state = await chrome.storage.local.get(['monitorEnabled', 'feedUrl', 'lastSeenContent']);
  if (!state.monitorEnabled) return;
  const feed = state.feedUrl || SITE + '/wp-json/wp/v2/posts?per_page=10&_fields=id,date,link,title,excerpt';
  try {
    const response = await fetch(feed, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) throw new Error('Feed returned HTTP ' + response.status);
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error('The content feed did not return a JSON array.');
    const latest = items[0];
    if (!latest) return;
    const lastSeen = Number(state.lastSeenContent || 0);
    const dated = items.filter(item => Date.parse(item.date || item.date_gmt || '') > lastSeen);
    if (lastSeen && dated.length) {
      const newest = dated.sort((a,b) => Date.parse(b.date || b.date_gmt) - Date.parse(a.date || a.date_gmt))[0];
      const title = stripHtml(newest.title?.rendered || newest.title || 'New content');
      chrome.notifications.create('ht-share-new-' + newest.id, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: 'New content on Holistic Therapists',
        message: title + '\nOpen HT Share to prepare your social post.',
        priority: 1
      });
      await chrome.storage.local.set({ pendingContent: { id: newest.id, title, url: newest.link || SITE, date: newest.date } });
    }
    const maxDate = Math.max(...items.map(item => Date.parse(item.date || item.date_gmt || '') || 0));
    if (maxDate) await chrome.storage.local.set({ lastSeenContent: maxDate });
    await chrome.storage.local.set({ lastScanAt: Date.now(), lastScanError: '' });
  } catch (error) {
    await chrome.storage.local.set({ lastScanAt: Date.now(), lastScanError: String(error.message || error) });
  }
}

function stripHtml(value) {
  return String(value).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#8211;/g, '–').replace(/\s+/g, ' ').trim();
}

async function restoreScheduledPosts() {
  const { scheduledPosts = [] } = await chrome.storage.local.get('scheduledPosts');
  for (const item of scheduledPosts) {
    if (!item.notified && Number(item.when) > Date.now()) {
      chrome.alarms.create('ht-share-schedule-' + item.id, { when: Number(item.when) });
    }
  }
}

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === SCAN_ALARM) {
    scanForNewContent();
    return;
  }
  if (!alarm.name.startsWith('ht-share-schedule-')) return;
  const id = alarm.name.replace('ht-share-schedule-', '');
  const { scheduledPosts = [] } = await chrome.storage.local.get('scheduledPosts');
  const item = scheduledPosts.find(post => post.id === id);
  if (!item || item.notified) return;
  item.notified = true;
  await chrome.storage.local.set({ scheduledPosts });
  chrome.notifications.create('ht-share-due-' + id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: 'Your social post is ready',
    message: item.title + '\nOpen the page and publish your prepared post.',
    priority: 2
  });
});

chrome.notifications.onClicked.addListener(async notificationId => {
  if (notificationId.startsWith('ht-share-new-')) {
    const { pendingContent } = await chrome.storage.local.get('pendingContent');
    if (pendingContent?.url) chrome.tabs.create({ url: pendingContent.url });
  } else if (notificationId.startsWith('ht-share-due-')) {
    const id = notificationId.replace('ht-share-due-', '');
    const { scheduledPosts = [] } = await chrome.storage.local.get('scheduledPosts');
    const item = scheduledPosts.find(post => post.id === id);
    chrome.tabs.create({ url: item?.url || SITE });
  }
  chrome.notifications.clear(notificationId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'HT_START_MONITOR') {
      await chrome.storage.local.set({ monitorEnabled: true, feedUrl: message.feedUrl || SITE + '/wp-json/wp/v2/posts?per_page=10&_fields=id,date,link,title,excerpt' });
      startMonitoring();
      sendResponse({ ok: true });
    } else if (message?.type === 'HT_STOP_MONITOR') {
      stopMonitoring();
      await chrome.storage.local.set({ monitorEnabled: false });
      sendResponse({ ok: true });
    } else if (message?.type === 'HT_SCAN_NOW') {
      await scanForNewContent();
      const result = await chrome.storage.local.get(['lastScanAt', 'lastScanError', 'pendingContent']);
      sendResponse({ ok: true, ...result });
    } else if (message?.type === 'HT_SCHEDULE_POST') {
      const { scheduledPosts = [] } = await chrome.storage.local.get('scheduledPosts');
      const item = message.item;
      if (!item?.id || !Number(item.when) || Number(item.when) <= Date.now()) throw new Error('Choose a future date and time.');
      scheduledPosts.push(item);
      await chrome.storage.local.set({ scheduledPosts });
      chrome.alarms.create('ht-share-schedule-' + item.id, { when: Number(item.when) });
      sendResponse({ ok: true });
    } else if (message?.type === 'HT_FB_AUTOPASTE') {
      // Answer first: opening the tab closes the popup.
      sendResponse({ ok: true });
      const tab = await chrome.tabs.create({ url: message.url });
      pasteIntoFacebook(tab.id, String(message.text || ''));
    } else if (message?.type === 'HT_DELETE_SCHEDULE') {
      const { scheduledPosts = [] } = await chrome.storage.local.get('scheduledPosts');
      await chrome.storage.local.set({ scheduledPosts: scheduledPosts.filter(p => p.id !== message.id) });
      await chrome.alarms.clear('ht-share-schedule-' + message.id);
      sendResponse({ ok: true });
    }
  })().catch(error => sendResponse({ ok: false, error: String(error.message || error) }));
  return true;
});

/* ---------- Facebook: paste the caption into the share window ---------- */

// Facebook's share link cannot carry post text, so after the share window loads we put the caption
// into its post box, exactly as if the user had clicked it and pressed Ctrl+V.
function pasteIntoFacebook(tabId, text) {
  if (!text) return;
  const deadline = Date.now() + 60000;
  let busy = false;
  let done = false;
  const tryPaste = async () => {
    if (done || busy) return;
    busy = true;
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: fbPasteInPage, args: [text] });
      if (res?.result === 'pasted' || res?.result === 'already') finish();
    } catch (e) { /* page not ready, login page or no permission yet */ }
    busy = false;
  };
  const onUpdated = (id, info) => { if (id === tabId && info.status === 'complete') tryPaste(); };
  const timer = setInterval(() => { if (Date.now() > deadline) finish(); else tryPaste(); }, 1500);
  function finish() {
    done = true;
    clearInterval(timer);
    chrome.tabs.onUpdated.removeListener(onUpdated);
  }
  chrome.tabs.onUpdated.addListener(onUpdated);
}

// Runs inside the Facebook tab. Waits for the post box, then inserts the caption.
async function fbPasteInPage(text) {
  if (!/(^|\.)facebook\.com$/.test(location.hostname)) return 'wrong-host';
  if (window.__htSharePasted) return 'already';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const findBox = () => [...document.querySelectorAll('[contenteditable="true"][role="textbox"], div[contenteditable="true"], textarea')]
    .find(el => visible(el) && !el.closest('[aria-label*="omment" i]'));
  let box = null;
  for (let i = 0; i < 20 && !(box = findBox()); i++) await sleep(500);
  if (!box) return 'no-box';
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const current = () => box.value !== undefined ? box.value : box.innerText;
  if (norm(current()).includes(norm(text).slice(0, 40))) { window.__htSharePasted = true; return 'already'; }
  box.focus();
  // 1) A real paste event – Facebook's editor handles this like Ctrl+V.
  try {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  } catch (e) { /* older browsers */ }
  await sleep(800);
  // 2) Fallback: insert as typed text.
  if (!norm(current()).includes(norm(text).slice(0, 40))) {
    box.focus();
    document.execCommand('insertText', false, text);
    await sleep(300);
  }
  if (norm(current()).includes(norm(text).slice(0, 40))) { window.__htSharePasted = true; return 'pasted'; }
  return 'failed';
}
