// AssibaService : outils communs aux espaces client, prestataire et admin.
(function () {
  const API = window.API_BASE || '';

  const Auth = {
    token() { try { return localStorage.getItem('auth_token'); } catch (_) { return null; } },
    user() { try { return JSON.parse(localStorage.getItem('user_data') || 'null'); } catch (_) { return null; } },
    save(token, user) {
      try {
        localStorage.setItem('auth_token', token);
        localStorage.setItem('user_data', JSON.stringify(user));
      } catch (_) {}
    },
    logout(redirect = true) {
      try { localStorage.removeItem('auth_token'); localStorage.removeItem('user_data'); } catch (_) {}
      if (redirect) location.href = 'login.html';
    },
    // Redirige vers la connexion si besoin ; renvoie false si la page ne doit pas continuer
    require(roles) {
      const u = Auth.user();
      if (!Auth.token() || !u) {
        location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search));
        return false;
      }
      if (roles && !roles.includes(u.role)) { location.replace(homeFor(u.role)); return false; }
      return true;
    },
  };

  function homeFor(role) {
    return role === 'admin' ? 'admin.html' : role === 'prestataire' ? 'prestataire_dashboard.html' : 'client_dashboard.html';
  }

  async function api(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const t = Auth.token();
    if (t) headers.Authorization = 'Bearer ' + t;
    let r;
    try {
      r = await fetch(API + '/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (_) {
      throw new Error('Connexion impossible. Vérifiez votre accès Internet.');
    }
    let data = {};
    try { data = await r.json(); } catch (_) {}
    if (r.status === 401 && t) { Auth.logout(false); location.replace('login.html?expired=1'); }
    if (!r.ok || data.success === false) throw new Error(data.error || 'Une erreur est survenue');
    return data;
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fcfa = n => (Number(n) || 0).toLocaleString('fr-FR').replace(/ /g, ' ') + ' FCFA';
  // +22890123456 -> +228 90 12 34 56
  const tel = p => {
    const m = /^\+228(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(p || ''));
    return m ? `+228 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : String(p || '');
  };
  const date = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const dateTime = d => d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  const STATUS = {
    awaiting_payment: ['Frais à régler', 'warn'],
    open: ['En attente d’offres', 'info'],
    accepted: ['Paiement de la prestation à faire', 'warn'],
    in_progress: ['En cours (paiement sécurisé)', 'info'],
    done: ['Terminée, à valider', 'warn'],
    completed: ['Terminée', 'ok'],
    dispute: ['Litige en cours', 'bad'],
    refunded: ['Remboursée', 'muted'],
    cancelled: ['Annulée', 'muted'],
    pending: ['En attente', 'warn'],
    processing: ['En cours de validation', 'info'],
    submitted: ['Référence envoyée, vérification en cours', 'info'],
    confirmed: ['Confirmé', 'ok'],
    rejected: ['Refusé', 'bad'],
    paid: ['Payé', 'ok'],
    active: ['Actif', 'ok'],
    suspended: ['Suspendu', 'bad'],
    pending_payment: ['Paiement en attente', 'warn'],
    open_dispute: ['Ouvert', 'bad'],
    resolved: ['Résolu', 'ok'],
  };
  const badge = s => {
    const [label, tone] = STATUS[s] || [s, 'muted'];
    return `<span class="badge badge-${tone}">${esc(label)}</span>`;
  };

  function toast(message, type = 'ok') {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.setAttribute('role', type === 'bad' ? 'alert' : 'status');
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // Réduit une photo (max 1280 px, JPEG) pour rester sous les limites d'envoi
  function compressImage(file, maxSide = 1280, quality = 0.72) {
    return new Promise((resolve, reject) => {
      if (file.type === 'application/pdf') {
        if (file.size > 1.4 * 1024 * 1024) return reject(new Error('PDF trop lourd (1,4 Mo maximum)'));
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(new Error('Lecture du fichier impossible'));
        return fr.readAsDataURL(file);
      }
      if (!/^image\//.test(file.type)) return reject(new Error('Choisissez une image (JPEG ou PNG)'));
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  }

  // Charge une image protégée (avec le jeton) et renvoie une URL locale
  async function protectedImage(path) {
    const r = await fetch(API + path, { headers: { Authorization: 'Bearer ' + Auth.token() } });
    if (!r.ok) throw new Error('Image indisponible');
    return URL.createObjectURL(await r.blob());
  }

  // Remplace les <img data-src="/api/files/..."> par l'image chargée avec le jeton
  function hydrateImages(root = document) {
    root.querySelectorAll('img[data-src]').forEach(img => {
      const src = img.getAttribute('data-src');
      img.removeAttribute('data-src');
      protectedImage(src).then(u => { img.src = u; }).catch(() => { img.alt = 'Image indisponible'; });
    });
  }

  // Petite boîte de dialogue accessible ; renvoie les valeurs du formulaire ou null
  function dialog({ title, html, submitLabel = 'Valider', danger = false }) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">${esc(title)}</h2>
        <div class="modal-body">${html || ''}</div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-cancel>Annuler</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(submitLabel)}</button>
        </div></form>`;
      document.body.appendChild(wrap);
      const form = wrap.querySelector('form');
      const close = v => { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-cancel]').onclick = () => close(null);
      wrap.addEventListener('click', e => { if (e.target === wrap) close(null); });
      wrap.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
      form.onsubmit = e => {
        e.preventDefault();
        if (!form.reportValidity()) return;
        close(Object.fromEntries(new FormData(form).entries()));
      };
      const first = form.querySelector('input, textarea, select, button[type=submit]');
      if (first) first.focus();
    });
  }

  // Exécute une action en désactivant le bouton et en affichant l'erreur éventuelle
  async function run(btn, fn, okMessage) {
    if (btn) btn.disabled = true;
    try {
      const out = await fn();
      if (okMessage) toast(okMessage);
      return out;
    } catch (e) {
      toast(e.message, 'bad');
      return undefined;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  window.ASB = { API, Auth, api, esc, fcfa, tel, date, dateTime, badge, toast, compressImage, protectedImage, hydrateImages, dialog, run, homeFor };
})();
