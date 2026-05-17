// CTRL Admin Panel
const SUPABASE_URL = 'https://asjrsshmuqepkultayry.supabase.co';
const SUPABASE_KEY = 'sb_publishable_DaL6vOcejc_byWWxRYDaww_p2W6c3eb';

// ADMIN EMAILS — nur diese dürfen das Panel nutzen
const ADMIN_EMAILS = ['Joelknippel12@gmx.de'
  // DEINE EMAIL HIER EINTRAGEN
];

let session = null;
let allUsers = [];

window.addEventListener('DOMContentLoaded', async () => {
  // Get session from localStorage
  try {
    const s = JSON.parse(localStorage.getItem('ctrl-session') || 'null');
    if (!s?.user?.email) { unauthorized(); return; }
    session = s;
    const email = s.user.email.toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) { unauthorized(); return; }
    document.getElementById('admin-email-display').textContent = email;
    await loadData();
  } catch { unauthorized(); }
});

function unauthorized() {
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Rajdhani,sans-serif;color:rgba(255,80,80,0.7);font-size:14px;letter-spacing:2px;text-transform:uppercase;">⛔ Kein Zugriff</div>';
}

async function supaFetch(endpoint, method='GET', body=null) {
  const res = await fetch(SUPABASE_URL + endpoint, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : null,
  });
  return res.json();
}

async function loadData() {
  // Load users from profiles table (you need to create this in Supabase)
  try {
    const users = await supaFetch('/rest/v1/profiles?select=*&order=created_at.desc');
    if (!Array.isArray(users)) { allUsers = []; }
    else { allUsers = users; }
    renderOverview();
    renderUsers(allUsers);
    renderPlusMembers();
  } catch(e) {
    console.error('Load error:', e);
    showToast('Fehler beim Laden — Profiles-Tabelle prüfen');
  }
}

function renderOverview() {
  const total = allUsers.length;
  const plus  = allUsers.filter(u => u.plan === 'plus').length;
  const free  = total - plus;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-plus').textContent  = plus;
  document.getElementById('stat-free').textContent  = free;

  const recent = document.getElementById('recent-users');
  const last5  = allUsers.slice(0,5);
  if (!last5.length) { recent.innerHTML = '<div class="loading">Keine Nutzer gefunden — Profiles-Tabelle leer.</div>'; return; }
  recent.innerHTML = last5.map(u => userRow(u)).join('');
}

function renderUsers(users) {
  const list = document.getElementById('users-list');
  if (!list) return;
  if (!users.length) { list.innerHTML = '<div class="loading">Keine Nutzer gefunden.</div>'; return; }
  list.innerHTML = users.map(u => userRow(u, true)).join('');
}

function userRow(u, showActions=false) {
  const plan = u.plan || 'free';
  const planClass = plan === 'plus' ? 'plan-plus' : plan === 'admin' ? 'plan-admin' : 'plan-free';
  const planLabel = plan === 'plus' ? 'CTRL+' : plan === 'admin' ? 'ADMIN' : 'FREE';
  const actions = showActions ? `
    <button class="act-btn" onclick="quickGrant('${u.email}','plus')">+ CTRL+</button>
    <button class="act-btn danger" onclick="quickGrant('${u.email}','free')">Free</button>
  ` : '';
  return `<div class="user-row">
    <i class="ti ti-user" style="font-size:16px;color:rgba(255,100,0,0.4);flex-shrink:0;"></i>
    <span class="user-email">${u.email || u.id || '—'}</span>
    ${u.created_at ? `<span style="font-size:9px;color:rgba(200,220,255,0.25);font-family:'Share Tech Mono',monospace;">${new Date(u.created_at).toLocaleDateString('de-DE')}</span>` : ''}
    <span class="user-plan ${planClass}">${planLabel}</span>
    ${actions}
  </div>`;
}

function renderPlusMembers() {
  const list = document.getElementById('plus-list');
  if (!list) return;
  const plus = allUsers.filter(u => u.plan === 'plus');
  if (!plus.length) { list.innerHTML = '<div class="loading">Noch keine CTRL+ Mitglieder.</div>'; return; }
  list.innerHTML = plus.map(u => userRow(u, true)).join('');
}

window.searchUsers = function(query) {
  const filtered = allUsers.filter(u => (u.email||'').toLowerCase().includes(query.toLowerCase()));
  renderUsers(filtered);
};

window.grantMembership = async function() {
  const email   = document.getElementById('mem-email').value.trim();
  const plan    = document.getElementById('mem-plan').value;
  const expiry  = document.getElementById('mem-expiry').value || null;
  if (!email) { showToast('Bitte E-Mail eingeben'); return; }
  await quickGrant(email, plan, expiry);
  document.getElementById('mem-email').value = '';
};

async function quickGrant(email, plan, expiry=null) {
  try {
    showToast('Membership wird gesetzt...');
    await supaFetch('/rest/v1/profiles?email=eq.' + encodeURIComponent(email), 'PATCH', {
      plan, plan_expires_at: expiry
    });
    showToast('✓ ' + email + ' → ' + (plan === 'plus' ? 'CTRL+' : 'Free'));
    await loadData();
  } catch(e) { showToast('Fehler: ' + e.message); }
}

window.sendAnnouncement = async function() {
  const title  = document.getElementById('ann-title').value.trim();
  const body   = document.getElementById('ann-body').value.trim();
  const target = document.getElementById('ann-target').value;
  if (!title || !body) { showToast('Titel und Nachricht eingeben'); return; }

  try {
    await supaFetch('/rest/v1/announcements', 'POST', {
      title, body, target, created_at: new Date().toISOString()
    });
    showToast('✓ Ankündigung gesendet!');
    document.getElementById('ann-title').value = '';
    document.getElementById('ann-body').value  = '';
  } catch(e) { showToast('Fehler: ' + e.message); }
};

window.showPage = function(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  el.classList.add('active');
};

function showToast(msg) {
  let t = document.getElementById('admin-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'admin-toast';
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(10,12,16,0.95);border:1px solid rgba(255,100,0,0.3);color:#ff6400;padding:9px 18px;border-radius:7px;font-size:11px;letter-spacing:1px;z-index:9999;font-family:Rajdhani,sans-serif;font-weight:600;transition:opacity 0.3s;white-space:nowrap;';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.opacity = '1';
  clearTimeout(t._t); t._t = setTimeout(() => t.style.opacity = '0', 3000);
}
