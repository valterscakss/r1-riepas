const $ = (sel) => document.querySelector(sel);
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

// --- Tabs ---
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-search').classList.toggle('hidden', btn.dataset.tab !== 'search');
    $('#tab-intake').classList.toggle('hidden', btn.dataset.tab !== 'intake');
  });
});

// --- Store badge ---
async function loadHealth() {
  try {
    const h = await fetch('/api/health').then((r) => r.json());
    const badge = $('#store-badge');
    badge.textContent = h.store;
    badge.classList.add(h.store.startsWith('google') ? 'sheets' : 'local');
  } catch { $('#store-badge').textContent = 'offline'; }
}

// --- Search ---
async function search() {
  const q = $('#q').value.trim();
  const status = $('#status').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const data = await fetch('/api/storage?' + params).then((r) => r.json());
  $('#search-meta').textContent = `${data.count} record(s)`;
  const tbody = $('#results tbody');
  tbody.innerHTML = data.records.slice(0, 300).map((r) => `
    <tr>
      <td>${esc(r.location)}</td>
      <td>${esc(r.plate)}</td>
      <td>${esc(r.makeModel)}</td>
      <td>${esc(r.customerName)}${r.isCompany ? ' 🏢' : ''}</td>
      <td>${esc(r.phone)}</td>
      <td>${esc(r.size1)}${r.size2 ? ' + ' + esc(r.size2) : ''}</td>
      <td>${esc(r.brand)}</td>
      <td>${esc(r.quantity)}</td>
      <td>${esc(r.intakeDate)}</td>
      <td class="status-${r.status}">${r.status}</td>
      <td>${r.status === 'active' ? `<button class="ghost" data-release="${esc(r.id)}">Release</button>` : ''}</td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-release]').forEach((b) =>
    b.addEventListener('click', () => release(b.dataset.release)));
  if (data.count > 300) $('#search-meta').textContent += ' (showing first 300)';
}

async function release(id) {
  if (!confirm('Mark this set as released / retrieved?')) return;
  const res = await fetch(`/api/storage/${encodeURIComponent(id)}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (res.ok) search();
  else alert('Release failed');
}

$('#search-btn').addEventListener('click', search);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
$('#status').addEventListener('change', search);

// --- Intake ---
$('#intake-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, v === '' ? null : v]));
  const msg = $('#intake-msg');
  const res = await fetch('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) {
    msg.textContent = `✅ Saved (${data.location ?? ''} ${data.plate ?? ''}).`;
    e.target.reset();
  } else {
    msg.textContent = `⚠️ ${data.error?.message ?? 'Failed'}`;
  }
});

loadHealth();
search();
