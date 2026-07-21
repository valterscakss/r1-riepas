const $ = (sel) => document.querySelector(sel);
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

let ME = null;
// Token-based auth (cookie-independent — works even if the browser blocks cookies).
let TOKEN = localStorage.getItem('r1_token') || null;
const authHeaders = (extra) => (TOKEN ? { ...(extra || {}), Authorization: 'Bearer ' + TOKEN } : (extra || {}));

// --- Auth bootstrapping ---
async function init() {
  if (!TOKEN) return showLogin();
  try {
    const res = await fetch('/api/me', { headers: authHeaders() });
    if (res.ok) { ME = (await res.json()).user; showApp(); }
    else showLogin();
  } catch { showLogin(); }
}

function showLogin() {
  $('#login').classList.remove('hidden');
  $('#app').classList.add('hidden');
}

function showApp() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-area').innerHTML = `${esc(ME.name)} <span class="role">${esc(ME.role)}</span> <button id="logout" class="ghost small">Log out</button>`;
  $('#logout').addEventListener('click', logout);
  document.querySelectorAll('.admin-only').forEach((el) => el.classList.toggle('hidden', ME.role !== 'admin'));
  loadHealth();
  search();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const msg = $('#login-msg');
  msg.textContent = 'Signing in…';
  const res = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: fd.get('username'), password: fd.get('password') }),
  });
  const data = await res.json();
  if (res.ok) {
    ME = data.user;
    TOKEN = data.token || null;
    if (TOKEN) localStorage.setItem('r1_token', TOKEN);
    msg.textContent = '';
    showApp();
  } else msg.textContent = data.error?.message ?? 'Login failed';
});

async function logout() {
  try { await fetch('/api/logout', { method: 'POST', headers: authHeaders() }); } catch {}
  ME = null; TOKEN = null; localStorage.removeItem('r1_token');
  showLogin();
}

// Any 401 sends us back to login. Injects the Bearer token on every request.
async function api(url, opts) {
  const o = opts || {};
  const res = await fetch(url, { ...o, headers: authHeaders(o.headers) });
  if (res.status === 401) { ME = null; TOKEN = null; localStorage.removeItem('r1_token'); showLogin(); throw new Error('unauthorized'); }
  return res;
}

// --- Tabs ---
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    for (const t of ['search', 'intake', 'admin']) $(`#tab-${t}`).classList.toggle('hidden', btn.dataset.tab !== t);
  });
});

async function loadHealth() {
  try {
    const h = await (await fetch('/api/health')).json();
    const badge = $('#store-badge');
    badge.textContent = h.store;
    badge.className = 'badge ' + (h.store.startsWith('postgres') ? 'sheets' : h.store.startsWith('google') ? 'sheets' : 'local');
  } catch { $('#store-badge').textContent = 'offline'; }
}

// --- Search ---
async function search() {
  const q = $('#q').value.trim();
  const status = $('#status').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  let data;
  try { data = await (await api('/api/storage?' + params)).json(); } catch { return; }
  $('#search-meta').textContent = `${data.count} record(s)`;
  const tbody = $('#results tbody');
  tbody.innerHTML = data.records.slice(0, 300).map((r) => `
    <tr>
      <td>${esc(r.location)}</td><td>${esc(r.plate)}</td><td>${esc(r.makeModel)}</td>
      <td>${esc(r.customerName)}${r.isCompany ? ' 🏢' : ''}</td><td>${esc(r.phone)}</td>
      <td>${esc(r.size1)}${r.size2 ? ' + ' + esc(r.size2) : ''}</td><td>${esc(r.brand)}</td>
      <td>${esc(r.quantity)}</td><td>${esc(r.intakeDate)}</td>
      <td class="status-${r.status}">${r.status}</td>
      <td>${r.status === 'active' ? `<button class="ghost" data-release="${esc(r.id)}">Release</button>` : ''}</td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-release]').forEach((b) => b.addEventListener('click', () => release(b.dataset.release)));
  if (data.count > 300) $('#search-meta').textContent += ' (showing first 300)';
}

async function release(id) {
  if (!confirm('Mark this set as released / retrieved?')) return;
  const res = await api(`/api/storage/${encodeURIComponent(id)}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (res.ok) search(); else alert('Release failed');
}

$('#search-btn').addEventListener('click', search);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
$('#status').addEventListener('change', search);

// --- Intake auto-fill by plate ---
async function lookupPlate() {
  const plate = $('#plate-input').value.trim();
  const banner = $('#lookup-banner');
  if (!plate) return;
  banner.className = 'banner'; banner.textContent = 'Looking up…';
  let data;
  try { data = await (await api('/api/lookup?plate=' + encodeURIComponent(plate))).json(); }
  catch { banner.className = 'banner hidden'; return; }
  if (!data.found) {
    banner.className = 'banner new';
    banner.textContent = `No previous record for ${data.plate} — new vehicle.`;
    return;
  }
  const s = data.suggestion, form = $('#intake-form');
  const set = (n, v) => { const el = form.elements[n]; if (el && !el.value && v) el.value = v; };
  set('makeModel', s.makeModel); set('customerName', s.customerName); set('phone', s.phone);
  set('size1', s.size1); set('brand', s.brand); set('quantity', s.quantity); set('size2', s.size2); set('rimNote', s.rimNote);
  banner.className = 'banner found';
  banner.innerHTML = `✅ Found ${data.history} previous record(s) for <b>${esc(data.plate)}</b> — prefilled from ${esc(data.lastSeason) || 'last visit'}. <b>Confirm or edit</b>.`;
}
$('#lookup-btn').addEventListener('click', lookupPlate);
$('#plate-input').addEventListener('blur', () => { if ($('#plate-input').value.trim()) lookupPlate(); });
$('#plate-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookupPlate(); } });

// --- Intake submit ---
$('#intake-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === '' ? null : v]));
  const msg = $('#intake-msg');
  const res = await api('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) { msg.textContent = `✅ Saved (${data.location ?? ''} ${data.plate ?? ''}).`; e.target.reset(); }
  else msg.textContent = `⚠️ ${data.error?.message ?? 'Failed'}`;
});

// --- Admin: Excel import ---
$('#import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileEl = $('#import-file');
  const msg = $('#import-msg'), out = $('#import-result');
  if (!fileEl.files[0]) { msg.textContent = 'Choose an .xlsx file first.'; return; }
  if (!confirm('This will REPLACE all storage records with the contents of this file. Continue?')) return;
  msg.textContent = 'Uploading & importing…'; out.classList.add('hidden');
  const fd = new FormData(); fd.append('file', fileEl.files[0]);
  const res = await api('/api/import', { method: 'POST', body: fd });
  const data = await res.json();
  if (res.ok) {
    msg.textContent = `✅ Imported ${data.imported} records.`;
    out.textContent = `Sheets read: ${data.sheets}\nRows scanned: ${data.rows}\nParsed: ${data.parsed}\nSkipped (empty): ${data.skipped}\nImported to DB: ${data.imported}`;
    out.classList.remove('hidden');
    search();
  } else msg.textContent = `⚠️ ${data.error?.message ?? 'Import failed'}`;
});

init();
