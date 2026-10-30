// AssibaService PWA Service Worker - Mode Offline Avancé
const CACHE_NAME = 'assibaservice-v1.5.0';
const OFFLINE_URL = '/offline.html';

// Ressources essentielles à mettre en cache
const ESSENTIAL_RESOURCES = [
  '/',
  '/index.html',
  '/login.html',
  '/register_client.html',
  '/register_prestataire.html',
  '/form_client.html',
  '/apropos.html',
  '/reset-password.html',
  '/assets/common.css',
  '/assets/pwa-install.js',
  '/assets/logo/logo-assiba.png',
  '/assets/icons/icon-192x192.png',
  '/assets/icons/icon-512x512.png',
  '/manifest.webmanifest',
  OFFLINE_URL
];

// Images des services à mettre en cache
const SERVICE_IMAGES = [1, 2, 13].map(i => `/assets/services/service_${i}.jpg`);

// Images des publicités
const AD_IMAGES = [
  '/assets/ads/ad1.jpg',
  '/assets/ads/ad2.jpg',
  '/assets/ads/ad3.jpg',
  '/assets/ads/ad4.jpg'
];

// APIs critiques à mettre en cache
// Ne jamais mettre en cache les données personnelles (profil, jeton) :
// sur un téléphone partagé, elles resteraient lisibles après déconnexion.
const CACHEABLE_APIS = [
  '/api/categories'
];

// Installation du service worker
self.addEventListener('install', event => {
  console.log('🔧 AssibaService SW: Installation en cours...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 AssibaService SW: Mise en cache des ressources essentielles');
        // Une ressource absente ne doit pas bloquer toute l'installation
        return Promise.allSettled(ESSENTIAL_RESOURCES.map(url => cache.add(url)));
      })
      .then(() => {
        console.log('✅ AssibaService SW: Installation terminée');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ AssibaService SW: Erreur lors de l\'installation:', error);
      })
  );
});

// Activation du service worker
self.addEventListener('activate', event => {
  console.log('🚀 AssibaService SW: Activation en cours...');
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('🗑️ AssibaService SW: Suppression de l\'ancien cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('✅ AssibaService SW: Activation terminée');
        return self.clients.claim();
      })
  );
});

// Stratégies de cache avancées
const cacheStrategies = {
  // Cache First - Pour les ressources statiques
  cacheFirst: async (request) => {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch (error) {
      console.log('📡 AssibaService SW: Ressource non disponible offline:', request.url);
      throw error;
    }
  },

  // Network First - Pour les données dynamiques
  networkFirst: async (request) => {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch (error) {
      console.log('📡 AssibaService SW: Tentative cache pour:', request.url);
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
      throw error;
    }
  },

  // Stale While Revalidate - Pour un équilibre performance/fraîcheur
  staleWhileRevalidate: async (request) => {
    const cachedResponse = await caches.match(request);
    
    const fetchPromise = fetch(request).then(networkResponse => {
      if (networkResponse.ok) {
        const cache = caches.open(CACHE_NAME);
        cache.then(c => c.put(request, networkResponse.clone()));
      }
      return networkResponse;
    }).catch(() => {
      console.log('📡 AssibaService SW: Réseau indisponible pour:', request.url);
    });

    return cachedResponse || fetchPromise;
  }
};

// Interception des requêtes réseau avec stratégies avancées
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-HTTP
  if (!request.url.startsWith('http')) {
    return;
  }

  // Stratégie selon le type de ressource
  if (request.method === 'GET') {
    // Pages HTML - Network First avec fallback offline
    if (request.headers.get('accept')?.includes('text/html')) {
      event.respondWith(handlePageRequest(request));
      return;
    }

    // API - Network First avec cache de secours pour APIs critiques
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(handleApiRequest(request));
      return;
    }

    // Ressources statiques - Cache First
    if (isStaticResource(request)) {
      event.respondWith(cacheStrategies.cacheFirst(request));
      return;
    }

    // Images - Stale While Revalidate
    if (request.headers.get('accept')?.includes('image/')) {
      event.respondWith(cacheStrategies.staleWhileRevalidate(request));
      return;
    }
  }

  // Stratégie par défaut - Network First
  event.respondWith(cacheStrategies.networkFirst(request));
});

// Gestion spécifique des pages HTML
async function handlePageRequest(request) {
  try {
    // Essayer le réseau d'abord
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    }
  } catch (error) {
    console.log('📡 AssibaService SW: Page non disponible en ligne:', request.url);
  }

  // Fallback vers le cache
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  // Fallback final vers la page offline
  return caches.match(OFFLINE_URL);
}

// Gestion spécifique des API
async function handleApiRequest(request) {
  const url = new URL(request.url);
  
  // APIs critiques à mettre en cache
  const shouldCache = CACHEABLE_APIS.some(pattern => 
    url.pathname.includes(pattern)
  );

  if (shouldCache) {
    return cacheStrategies.networkFirst(request);
  }

  // Pour les autres APIs, essayer le réseau uniquement
  try {
    return await fetch(request);
  } catch (error) {
    // Retourner une réponse d'erreur structurée pour les APIs
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Service non disponible hors ligne',
        offline: true
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }
}

// Fonctions utilitaires
function isStaticResource(request) {
  const url = new URL(request.url);
  const staticExtensions = ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2'];
  
  return staticExtensions.some(ext => url.pathname.endsWith(ext)) ||
         url.pathname.includes('/assets/') ||
         url.pathname === '/manifest.webmanifest';
}

// Gestion des messages du client
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'GET_VERSION':
      event.ports[0].postMessage({ version: CACHE_NAME });
      break;
      
    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0].postMessage({ success: true });
      });
      break;

    case 'CACHE_IMAGES':
      // Mettre en cache les images des services et publicités
      event.waitUntil(
        caches.open(CACHE_NAME)
          .then(cache => {
            return cache.addAll([...SERVICE_IMAGES, ...AD_IMAGES]);
          })
          .then(() => {
            console.log('✅ AssibaService SW: Images mises en cache avec succès');
            if (event.ports && event.ports[0]) {
              event.ports[0].postMessage({ success: true });
            }
          })
          .catch(error => {
            console.error('❌ AssibaService SW: Erreur lors de la mise en cache des images:', error);
            if (event.ports && event.ports[0]) {
              event.ports[0].postMessage({ success: false, error: error.message });
            }
          })
      );
      break;

    case 'CACHE_URLS':
      if (payload && payload.urls) {
        caches.open(CACHE_NAME).then(cache => {
          return cache.addAll(payload.urls);
        }).then(() => {
          event.ports[0].postMessage({ success: true });
        }).catch(error => {
          event.ports[0].postMessage({ success: false, error: error.message });
        });
      }
      break;
  }
});

// Notification de mise à jour disponible
self.addEventListener('controllerchange', () => {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({
        type: 'SW_UPDATED',
        message: 'Une nouvelle version d\'AssibaService est disponible'
      });
    });
  });
});

// Gestion des erreurs globales
self.addEventListener('error', event => {
  console.error('❌ AssibaService SW: Erreur globale:', event.error);
});

self.addEventListener('unhandledrejection', event => {
  console.error('❌ AssibaService SW: Promesse rejetée:', event.reason);
});

console.log('🚀 AssibaService Service Worker chargé - Version:', CACHE_NAME);

