// AssibaService : enregistrement du service worker et bouton « Installer »
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('Service worker non enregistré :', err);
      });
    });
  }

  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    var bar = document.getElementById('pwaInstallBar');
    if (bar) bar.style.display = 'flex';
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    var bar = document.getElementById('pwaInstallBar');
    if (bar) bar.style.display = 'none';
  });

  window.installPWA = function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
      return;
    }
    // iPhone et navigateurs sans invite d'installation
    var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    alert(ios
      ? 'Pour installer AssibaService : touchez le bouton Partager puis « Sur l’écran d’accueil ».'
      : 'Pour installer AssibaService : ouvrez le menu du navigateur puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».');
  };
})();
