/* HT Share – builds ready-to-post captions from the open page (Open Graph + JSON-LD) and opens each network's official share window. */
'use strict';

const NETWORKS = {
  facebook: { label: 'Facebook', limit: 0 },
  instagram: { label: 'Instagram', limit: 2200 },
  linkedin: { label: 'LinkedIn', limit: 3000 },
  x: { label: 'X', limit: 280 },
  groups: { label: 'Groups', limit: 0 }
};

const TOPICS = [
  [/sound ?bath|gong|singing bowl/i, '#SoundBath'],
  [/reiki/i, '#Reiki'],
  [/yoga/i, '#Yoga'],
  [/meditat/i, '#Meditation'],
  [/mindful/i, '#Mindfulness'],
  [/breath/i, '#Breathwork'],
  [/massage/i, '#Massage'],
  [/reflexolog/i, '#Reflexology'],
  [/hypno/i, '#Hypnotherapy'],
  [/coach/i, '#LifeCoaching'],
  [/retreat/i, '#Retreat'],
  [/workshop/i, '#Workshop'],
  [/circle/i, '#WomensCircle'],
  [/energy|bio.?energy|healing/i, '#EnergyHealing'],
  [/shaman/i, '#Shamanism'],
  [/access bars/i, '#AccessBars'],
  [/acupunct/i, '#Acupuncture'],
  [/aromather/i, '#Aromatherapy']
];
const PLACES = ['Dublin', 'Cork', 'Galway', 'Limerick', 'Waterford', 'Kilkenny', 'Wexford', 'Sligo', 'Kerry', 'Clare', 'Wicklow', 'Meath', 'Kildare', 'Donegal', 'Mayo', 'Louth', 'Tipperary', 'Westmeath', 'Belfast', 'Athlone', 'Drogheda', 'Bray', 'Killarney'];

const DEMO = {
  url: 'https://www.holistictherapists.ie/events/rest-release-friday-evening-sound-bath/',
  title: 'Rest & Release – Friday Evening Sound Bath',
  desc: 'A calming sound bath meditation to unwind at the end of the week. Mats and blankets provided.',
  image: 'icons/icon-128.png',
  type: 'event',
  event: { start: '2026-11-27T19:00:00+00:00', end: '2026-11-27T20:30:00+00:00', place: 'Angels Love', address: 'Angels Love, Dublin, Ireland' }
};

const $ = (s) => document.querySelector(s);
let page = null;
let settings = { tags: '#HolisticIreland #Wellbeing', emoji: true };
let current = 'facebook';
const texts = {};

/* ---------- read the page ---------- */

function extractFromPage() {
  const meta = (n) => (document.querySelector('meta[property="' + n + '"],meta[name="' + n + '"]') || {}).content || '';
  let event = null;
  let article = null;
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const json = JSON.parse(s.textContent);
      [].concat(json['@graph'] || json).forEach((o) => {
        const types = [].concat(o['@type'] || []);
        if (types.includes('Event') && !event) event = o;
        if (!article && types.some((t) => /BlogPosting|Article/.test(t))) article = o;
      });
    } catch (e) { /* ignore broken JSON-LD */ }
  });
  const h1 = document.querySelector('h1');
  const canon = document.querySelector('link[rel="canonical"]');
  const path = location.pathname;
  let type = 'page';
  if (event || /^\/events\/.+/.test(path)) type = 'event';
  else if (/^\/listing\//.test(path)) type = 'listing';
  else if (article) type = 'post';
  const loc = event && event.location ? event.location : {};
  return {
    url: canon ? canon.href : location.href.split('#')[0],
    title: (h1 && h1.innerText.trim()) || meta('og:title') || document.title,
    desc: meta('og:description') || meta('description'),
    image: meta('og:image'),
    type,
    host: location.hostname,
    event: event ? {
      start: event.startDate || '',
      end: event.endDate || '',
      place: loc.name || '',
      address: typeof loc.address === 'string' ? loc.address : (loc.address && (loc.address.addressLocality || loc.address.streetAddress)) || ''
    } : null
  };
}

async function readPage() {
  if (location.hash === '#demo') return DEMO;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || '')) return null;
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractFromPage });
  return res ? res.result : null;
}

/* ---------- captions ---------- */

function fmtDate(iso) {
  if (!iso) return '';
  const hasTime = iso.includes('T');
  const d = new Date(hasTime ? iso : iso + 'T12:00:00');
  if (isNaN(d)) return '';
  const opts = { timeZone: 'Europe/Dublin' };
  const day = d.toLocaleDateString('en-IE', { ...opts, weekday: 'long', day: 'numeric', month: 'long' });
  const time = hasTime ? d.toLocaleTimeString('en-GB', { ...opts, hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s*([ap])\.?m\.?/i, ' $1m').toLowerCase() : '';
  return time ? day + ' · ' + time : day;
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso + 'T12:00:00');
  return isNaN(d) ? '' : d.toLocaleDateString('en-IE', { timeZone: 'Europe/Dublin', day: 'numeric', month: 'short' });
}

function placeText(p) {
  if (!p.event) return '';
  const a = p.event.address || '';
  const n = p.event.place || '';
  return a && a.toLowerCase().startsWith(n.toLowerCase()) ? a : [n, a].filter(Boolean).join(', ');
}

function city(p) {
  const hay = [placeText(p), p.title].join(' ');
  return PLACES.find((c) => new RegExp('\\b' + c + '\\b', 'i').test(hay)) || '';
}

function hashtags(p, max) {
  const hay = p.title + ' ' + p.desc;
  const tags = [];
  TOPICS.forEach(([re, tag]) => { if (re.test(hay) && !tags.includes(tag)) tags.push(tag); });
  const c = city(p);
  if (c) tags.push('#' + c);
  (settings.tags || '').split(/\s+/).filter((t) => /^#\w/.test(t)).forEach((t) => { if (!tags.includes(t)) tags.push(t); });
  return tags.slice(0, max).join(' ');
}

function clip(s, n) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

function build(net, p) {
  if (net === 'groups') return build('facebook', p);
  const e = settings.emoji;
  const ic = (emoji) => (e ? emoji + ' ' : '');
  const when = p.event ? fmtDate(p.event.start) : '';
  const where = placeText(p);
  const desc = clip(p.desc, net === 'linkedin' ? 400 : 260);
  const lines = [];

  if (net === 'x') {
    const tags = hashtags(p, 3);
    const head = p.type === 'event'
      ? [p.title, [shortDate(p.event && p.event.start), city(p)].filter(Boolean).join(' · ')].filter(Boolean).join(' – ')
      : p.title;
    const fixed = 24 + (tags ? tags.length + 1 : 0) + 2; // URL counts as 23 characters on X
    let body = head;
    const room = 280 - fixed - body.length - 2;
    if (room > 40 && p.desc) body += '\n\n' + clip(p.desc, room);
    return body + '\n\n' + p.url + (tags ? '\n' + tags : '');
  }

  if (p.type === 'event') {
    lines.push(ic('🌿') + p.title);
    if (when) lines.push(ic('📅') + when);
    if (where) lines.push(ic('📍') + where);
    if (desc) lines.push('', desc);
    lines.push('', net === 'instagram' ? 'Details & tickets – link in bio ' + (e ? '🌿' : '') : 'Details & tickets: ' + p.url);
  } else if (p.type === 'listing') {
    lines.push(ic('🌿') + 'Meet ' + p.title + ' on Holistic Therapists Ireland');
    if (desc) lines.push('', desc);
    lines.push('', net === 'instagram' ? 'Find them in our directory – link in bio' : 'View the profile: ' + p.url);
  } else {
    lines.push((p.type === 'post' ? ic('✨') + 'New on the blog: ' : '') + p.title);
    if (desc) lines.push('', desc);
    lines.push('', net === 'instagram' ? 'Read the full article – link in bio' : (p.type === 'post' ? 'Read more: ' : '') + p.url);
  }
  const tags = hashtags(p, net === 'instagram' ? 10 : net === 'linkedin' ? 4 : 5);
  if (tags) lines.push('', tags);
  return lines.join('\n').trim();
}

/* ---------- UI ---------- */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function open(url) {
  if (chrome.tabs) chrome.tabs.create({ url });
  else window.open(url, '_blank');
}

const ICON_OPEN = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>';
const ICON_IMG = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

function render() {
  const app = $('#app');
  const p = page;
  const badge = { event: 'Event', post: 'Blog post', listing: 'Practitioner listing', page: 'Page' }[p.type];
  const meta = p.event ? [shortDate(p.event.start), city(p) || p.event.place].filter(Boolean).join(' · ') : p.url.replace(/^https?:\/\/(www\.)?/, '');
  app.innerHTML = `
    <div class="preview">
      ${p.image ? `<img src="${p.image}" alt="">` : ''}
      <div class="preview__txt">
        <span class="badge">${badge}</span>
        <div class="preview__title"></div>
        <div class="preview__meta"></div>
      </div>
    </div>
    ${!/holistictherapists\.ie$/.test(p.host || 'holistictherapists.ie') ? '<p class="hint">This is not a holistictherapists.ie page. The caption may need editing.</p>' : ''}
    <div class="tabs" role="tablist">
      ${Object.entries(NETWORKS).map(([k, n]) => `<button class="tab" role="tab" data-net="${k}" aria-selected="${k === current}">${n.label}</button>`).join('')}
    </div>
    <textarea id="text" spellcheck="true" aria-label="Post text"></textarea>
    <div class="counter"><span id="count"></span><span id="limit"></span></div>
    <div id="netHint"></div>
    <div class="actions" id="actions"></div>
    <button class="regen" id="regen" type="button">Restore generated text</button>`;
  app.querySelector('.preview__title').textContent = p.title;
  app.querySelector('.preview__meta').textContent = meta;
  app.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => select(b.dataset.net)));
  $('#text').addEventListener('input', (ev) => { texts[current] = ev.target.value; if (current === 'groups') texts.groupsEdited = true; count(); });
  $('#regen').addEventListener('click', () => { texts[current] = build(current, page); if (current === 'groups') texts.groupsEdited = false; select(current); });
  select(current);
}

function count() {
  const t = texts[current] || '';
  const lim = NETWORKS[current].limit;
  const len = current === 'x' ? t.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length : t.length;
  $('#count').textContent = len + ' characters';
  $('#limit').innerHTML = lim ? (len > lim ? `<span class="over">limit ${lim} exceeded</span>` : 'Limit: ' + lim) : '';
}

function select(net) {
  current = net;
  if (texts[net] === undefined) texts[net] = build(net, page);
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.net === net)));
  $('#text').value = texts[net];
  count();
  const hint = $('#netHint');
  const actions = $('#actions');
  document.body.classList.toggle('is-groups', net === 'groups');
  const enc = encodeURIComponent;
  if (net === 'facebook') {
    hint.innerHTML = '<p class="hint">Facebook does not allow this extension to fill in the post text through the share link. Click the button, then paste the copied caption (Ctrl+V) into Facebook.</p>';
    actions.innerHTML = `<button class="btn" id="go">${ICON_OPEN} Copy and open Facebook</button>`;
    $('#go').onclick = async () => { await copy(texts.facebook); toast('Caption copied. Paste it into Facebook.'); open('https://www.facebook.com/sharer/sharer.php?u=' + enc(page.url)); };
  } else if (net === 'linkedin') {
    hint.innerHTML = '';
    actions.innerHTML = `<button class="btn" id="go">${ICON_OPEN} Open LinkedIn</button><button class="btn btn--ghost" id="cp">${ICON_COPY} Copy</button>`;
    $('#go').onclick = async () => { await copy(texts.linkedin); open('https://www.linkedin.com/feed/?shareActive=true&text=' + enc(texts.linkedin)); };
    $('#cp').onclick = async () => { await copy(texts.linkedin); toast('Copied'); };
  } else if (net === 'x') {
    hint.innerHTML = '';
    actions.innerHTML = `<button class="btn" id="go">${ICON_OPEN} Open X</button><button class="btn btn--ghost" id="cp">${ICON_COPY} Copy</button>`;
    $('#go').onclick = () => open('https://x.com/intent/post?text=' + enc(texts.x));
    $('#cp').onclick = async () => { await copy(texts.x); toast('Copied'); };
  } else if (net === 'groups') {
    renderGroups(hint, actions);
  } else {
    hint.innerHTML = '<p class="hint">Instagram does not support creating a post from this browser share link. Copy the caption and download the image, then create your post in Instagram or Meta Business Suite.</p>';
    actions.innerHTML = `<button class="btn" id="cp">${ICON_COPY} Copy tekst</button>${page.image ? `<button class="btn btn--ghost" id="img">${ICON_IMG} Download image</button>` : ''}`;
    $('#cp').onclick = async () => { await copy(texts.instagram); toast('Copied'); };
    const img = $('#img');
    if (img) {
      img.onclick = () => {
        const slug = (page.url.split('/').filter(Boolean).pop() || 'post').slice(0, 60);
        const ext = (page.image.match(/\.(jpe?g|png|webp)(\?|$)/i) || [, 'jpg'])[1];
        if (chrome.downloads) chrome.downloads.download({ url: page.image, filename: 'holistic-' + slug + '.' + ext, saveAs: false }, () => toast('Image saved to Downloads'));
        else open(page.image);
      };
    }
  }
}


/* ---------- groups ---------- */

let groups = [];
let posted = {};
let postLog = [];

async function loadGroups() {
  try {
    const s = await chrome.storage.sync.get(['groups']);
    const l = await chrome.storage.local.get(['posted', 'postLog']);
    groups = Array.isArray(s.groups) ? s.groups : [];
    posted = l.posted && typeof l.posted === 'object' ? l.posted : {};
    postLog = Array.isArray(l.postLog) ? l.postLog : [];
  } catch (e) {
    groups = [
      { id: 'g1', name: 'Holistic Ireland Community', url: 'https://www.facebook.com/groups/holisticireland' },
      { id: 'g2', name: 'Wellbeing Events Dublin', url: 'https://www.facebook.com/groups/wellbeingdublin' },
      { id: 'g3', name: 'Complementary Therapists Ireland', url: 'https://www.linkedin.com/groups/1234567/' }
    ];
    posted = { [DEMO.url]: { g2: Date.now() - 3600e3 * 26 } };
  }
}

async function saveGroups() {
  try { await chrome.storage.sync.set({ groups }); } catch (e) { /* demo */ }
}

async function savePosted() {
  try { await chrome.storage.local.set({ posted, postLog }); } catch (e) { /* demo */ }
}

function networkOf(url) {
  if (/facebook\.com/i.test(url)) return 'Facebook';
  if (/linkedin\.com/i.test(url)) return 'LinkedIn';
  if (/(^|\/\/|\.)(x|twitter)\.com/i.test(url)) return 'X';
  return 'Other';
}

/* Slightly different opening line per group, so the same post does not look copy-pasted everywhere. */
function variant(text, i) {
  if (!page || texts.groupsEdited || i % 3 === 0) return text;
  const lines = text.split('\n');
  if (!lines[0].includes(page.title)) return text;
  const e = settings.emoji;
  const intros = {
    event: [[e ? '📣 ' : '', 'Coming up: '], [e ? '✨ ' : '', 'Join us – ']],
    post: [[e ? '📖 ' : '', 'Worth a read: '], [e ? '🌱 ' : '', 'New article: ']],
    listing: [[e ? '🤝 ' : '', 'Discover '], [e ? '🌿 ' : '', 'Recommended: ']],
    page: [[e ? '🌿 ' : '', ''], [e ? '✨ ' : '', '']]
  }[page.type] || [['', ''], ['', '']];
  const [emo, word] = intros[(i % 3) - 1];
  lines[0] = emo + word + page.title;
  return lines.join('\n');
}

function fmtAgo(ts) {
  const h = Math.round((Date.now() - ts) / 3600e3);
  if (h < 1) return 'just now';
  if (h < 24) return h + ' hours ago';
  return new Date(ts).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
}

function renderGroups(hint, actions) {
  const done = posted[page.url] || {};
  const recent = postLog.filter((t) => Date.now() - t < 3600e3).length;
  let html = '';
  if (recent >= 4) {
    html += `<p class="hint hint--warn">You have started sharing this link to ${recent} groups in the last hour. Take a break to avoid repetitive or spam-like posting.</p>`;
  }
  if (!groups.length) {
    html += '<p class="hint">You have not added any groups yet. Add a Facebook or LinkedIn group using its name and URL.</p>';
  } else {
    html += '<ul class="groups">' + groups.map((g, i) => {
      const when = done[g.id];
      return `<li class="group${when ? ' group--done' : ''}">
        <span class="group__net group__net--${networkOf(g.url).toLowerCase()}">${networkOf(g.url) === 'X' ? 'X' : networkOf(g.url).slice(0, 2)}</span>
        <span class="group__txt"><b></b><small>${when ? '✓ Share started ' + fmtAgo(when) : 'Not shared yet'}</small></span>
        <button class="btn btn--small${when ? ' btn--ghost' : ''}" data-go="${i}" type="button">${when ? 'Jeszcze raz' : 'Copy i otwórz'}</button>
        <button class="group__del" data-del="${i}" type="button" title="Remove group" aria-label="Remove group">×</button>
      </li>`;
    }).join('') + '</ul>';
  }
  html += `<details class="addgroup"${groups.length ? '' : ' open'}>
      <summary>+ Add group</summary>
      <input id="gName" type="text" placeholder="Name, e.g. Holistic Ireland Community">
      <input id="gUrl" type="url" placeholder="Facebook or LinkedIn group URL, or X community URL">
      <button class="btn btn--small" id="gAdd" type="button">Save group</button>
    </details>
    <p class="hint hint--soft">The caption above is copied to your clipboard and the group opens in a new tab. Open the post composer and paste (Ctrl+V). Each group can use a slightly different opening line. X communities use the shorter caption from the X tab.</p>`;
  hint.innerHTML = html;
  actions.innerHTML = '';
  hint.querySelectorAll('.group__txt b').forEach((b, i) => { b.textContent = groups[i].name; });

  hint.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', async () => {
    const i = +b.dataset.go;
    const g = groups[i];
    if (networkOf(g.url) === 'X') {
      if (texts.x === undefined) texts.x = build('x', page);
      await copy(texts.x);
    } else {
      await copy(variant(texts.groups, i));
    }
    posted[page.url] = Object.assign({}, posted[page.url], { [g.id]: Date.now() });
    postLog = postLog.filter((t) => Date.now() - t < 86400e3).concat(Date.now());
    await savePosted();
    toast('Caption copied. Paste it into the group post composer (Ctrl+V).');
    open(g.url);
    renderGroups(hint, actions);
  }));
  hint.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const g = groups[+b.dataset.del];
    if (!confirm('Remove the group “' + g.name + '”?')) return;
    groups.splice(+b.dataset.del, 1);
    await saveGroups();
    renderGroups(hint, actions);
  }));
  $('#gAdd').addEventListener('click', async () => {
    const name = $('#gName').value.trim();
    let url = $('#gUrl').value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (!name || !/^https?:\/\/\S+\.\S+/.test(url)) { toast('Enter a group name and a valid URL.'); return; }
    groups.push({ id: 'g' + Date.now().toString(36), name, url });
    await saveGroups();
    toast('Group saved.');
    renderGroups(hint, actions);
  });
}

/* ---------- settings ---------- */

async function loadSettings() {
  try {
    const s = await chrome.storage.sync.get(['tags', 'emoji']);
    if (typeof s.tags === 'string') settings.tags = s.tags;
    if (typeof s.emoji === 'boolean') settings.emoji = s.emoji;
  } catch (e) { /* demo mode */ }
  $('#setTags').value = settings.tags;
  $('#setEmoji').checked = settings.emoji;
}

$('#settingsBtn').addEventListener('click', () => {
  const box = $('#settings');
  box.hidden = !box.hidden;
  $('#settingsBtn').setAttribute('aria-expanded', String(!box.hidden));
});
$('#saveSettings').addEventListener('click', async () => {
  settings.tags = $('#setTags').value.trim();
  settings.emoji = $('#setEmoji').checked;
  try { await chrome.storage.sync.set(settings); } catch (e) { /* demo mode */ }
  Object.keys(texts).forEach((k) => delete texts[k]);
  $('#settings').hidden = true;
  if (page) render();
  toast('Settings saved.');
});

(async () => {
  await loadSettings();
  await loadGroups();
  try {
    page = await readPage();
  } catch (e) {
    page = null;
  }
  if (!page || !page.title) {
    $('#state').innerHTML = '<b>Open an article, event or practitioner listing</b>HT Share works on holistictherapists.ie and other standard websites.';
    return;
  }
  render();
})();
