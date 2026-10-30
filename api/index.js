// Point d'entrée unique de l'API AssibaService.
// vercel.json redirige /api/* ici ; un seul fonction serverless pour tout le site.
const { open } = require('../lib/db');
const { HttpError, readBody, send } = require('../lib/http');
const { ensureAdmin } = require('../lib/routes/admin');

const modules = [
  require('../lib/routes/auth'),
  require('../lib/routes/requests'),
  require('../lib/routes/payments'),
  require('../lib/routes/catalog'),
  require('../lib/routes/admin'),
  require('../lib/routes/training'),
];

// Compile les chemins "/a/:id/b" en expressions régulières
const ROUTES = [];
for (const m of modules) {
  for (const [method, path, handler] of m.routes) {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:([a-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    ROUTES.push({ method, re, keys, handler });
  }
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '');
  return (xf.split(',')[0] || req.socket?.remoteAddress || 'inconnu').trim();
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  // Chemin d'origine : soit passé par la réécriture (?__path=), soit l'URL directe
  let path = url.searchParams.get('__path');
  path = path !== null ? '/' + path : url.pathname.replace(/^\/api/, '');
  path = path.replace(/\/+$/, '') || '/';

  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  if (path === '/health') {
    return send(res, 200, { success: true, status: 'ok', time: new Date().toISOString() });
  }

  let match = null;
  let methodMismatch = false;
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (r.method !== req.method) { methodMismatch = true; continue; }
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    match = { route: r, params };
    break;
  }
  if (!match) return send(res, methodMismatch ? 405 : 404, { success: false, error: 'Route introuvable' });

  let db = null;
  try {
    db = await open();
    await ensureAdmin(db);
    let bodyCache;
    const ctx = {
      req, res, db, params: match.params,
      query: Object.fromEntries(url.searchParams.entries()),
      ip: clientIp(req),
      body: async () => (bodyCache !== undefined ? bodyCache : (bodyCache = await readBody(req))),
    };
    const out = await match.route.handler(ctx);
    if (out !== undefined && !res.writableEnded) send(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError || (e && e.status && e.status < 600)) {
      send(res, e.status, { success: false, error: e.message });
    } else if (e && e.code === '23505') {
      send(res, 409, { success: false, error: 'Cet élément existe déjà' });
    } else {
      console.error('Erreur API', req.method, path, e);
      send(res, 500, { success: false, error: 'Erreur interne. Réessayez dans un instant.' });
    }
  } finally {
    if (db) await db.close();
  }
};
