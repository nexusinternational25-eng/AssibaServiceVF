// AssibaService : comportements communs aux pages publiques.
(function () {
  var html = document.documentElement;
  // Dans l'application Android, on masque ce qui ne sert qu'au navigateur (bouton « Installer »)
  if (/AssibaServiceApp/.test(navigator.userAgent)) html.classList.add('in-app');

  function ready(fn) {
    if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    // Menu mobile des en-têtes communs
    var toggle = document.querySelector('[data-site-nav]');
    var menu = document.getElementById('nav-menu');
    if (toggle && menu) {
      toggle.setAttribute('role', 'button');
      toggle.setAttribute('tabindex', '0');
      toggle.setAttribute('aria-label', 'Menu');
      var flip = function () {
        menu.classList.toggle('active');
        toggle.setAttribute('aria-expanded', menu.classList.contains('active'));
      };
      toggle.addEventListener('click', flip);
      toggle.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    }

    // Lien actif
    var page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-menu .nav-link').forEach(function (a) {
      if (a.getAttribute('href') === page) a.classList.add('active');
    });

    // Visiteur connecté : « Mon espace » à la place de Connexion / Inscription
    var actions = document.getElementById('nav-actions');
    try {
      var u = JSON.parse(localStorage.getItem('user_data') || 'null');
      if (actions && u && localStorage.getItem('auth_token')) {
        var home = u.role === 'admin' ? 'admin.html' : u.role === 'prestataire' ? 'prestataire_dashboard.html' : 'client_dashboard.html';
        actions.innerHTML = '<a class="btn-register" href="' + home + '">Mon espace</a>';
      }
    } catch (e) {}

    // Année du pied de page
    document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });
  });
})();
