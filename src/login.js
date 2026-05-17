const SUPABASE_URL = 'https://asjrsshmuqepkultayry.supabase.co';
const SUPABASE_KEY = 'sb_publishable_DaL6vOcejc_byWWxRYDaww_p2W6c3eb';

async function supabaseRequest(endpoint, body) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Auto-login wenn Session gespeichert
window.addEventListener('DOMContentLoaded', async () => {
  const session = localStorage.getItem('ctrl-session');
  if (session) {
    try {
      const s = JSON.parse(session);
      // Session noch gültig?
      if (s.expires_at && Date.now() / 1000 < s.expires_at) {
        goToDashboard();
        return;
      }
      // Token refresh versuchen
      if (s.refresh_token) {
        const data = await supabaseRequest('token?grant_type=refresh_token', {
          refresh_token: s.refresh_token,
        });
        if (data.access_token) {
          localStorage.setItem('ctrl-session', JSON.stringify({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_at: Math.floor(Date.now()/1000) + (data.expires_in || 3600),
            user: data.user,
          }));
          goToDashboard();
          return;
        }
      }
    } catch {}
    localStorage.removeItem('ctrl-session');
  }

  // Enter-Taste Support
  document.getElementById('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('email').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('password').focus();
  });
});

async function doLogin() {
  const email    = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const remember = document.getElementById('remember').checked;
  const errEl    = document.getElementById('error-msg');
  const btn      = document.getElementById('btn-login');
  const spinner  = document.getElementById('spinner');
  const btnText  = document.getElementById('btn-text');

  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }

  btn.disabled = true;
  spinner.style.display = 'block';
  btnText.textContent = 'Anmelden...';

  try {
    const data = await supabaseRequest('token?grant_type=password', { email, password });

    if (data.error || data.error_description) {
      errEl.textContent = data.error_description === 'Invalid login credentials'
        ? 'E-Mail oder Passwort falsch.'
        : (data.error_description || data.error || 'Login fehlgeschlagen.');
      btn.disabled = false; spinner.style.display = 'none'; btnText.textContent = 'ANMELDEN';
      return;
    }

    if (data.access_token) {
      if (remember) {
        localStorage.setItem('ctrl-session', JSON.stringify({
          access_token:  data.access_token,
          refresh_token: data.refresh_token,
          expires_at:    Math.floor(Date.now()/1000) + (data.expires_in || 3600),
          user:          data.user,
        }));
      }
      goToDashboard();
    }
  } catch(e) {
    errEl.textContent = 'Verbindungsfehler — bitte Internetverbindung prüfen.';
    btn.disabled = false; spinner.style.display = 'none'; btnText.textContent = 'ANMELDEN';
  }
}

function goToDashboard() {
  window.ctrl.loadLoading();
}
