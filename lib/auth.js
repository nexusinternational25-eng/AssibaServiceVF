// Mots de passe (scrypt) et jetons de session signés (JWT HS256).
const crypto = require('crypto');
const { fail } = require('./http');

const TOKEN_TTL = 7 * 24 * 3600; // 7 jours

function secret() {
  const s = process.env.JWT_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview') {
    fail(503, 'Configuration de sécurité manquante (JWT_SECRET)');
  }
  return 'dev-secret-local-uniquement-ne-pas-utiliser-en-ligne';
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères');
  if (pw.length > 128) fail(400, 'Mot de passe trop long');
}

const b64url = buf => Buffer.from(buf).toString('base64url');

function signToken(user) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: user.id, role: user.role, v: user.token_version, iat: now, exp: now + TOKEN_TTL }));
  const sig = crypto.createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(`${header}.${payload}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (_) { return null; }
}

// Renvoie l'utilisateur connecté, ou null. Le jeton est invalidé si le mot de passe a changé.
async function currentUser(req, db) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const data = verifyToken(m[1]);
  if (!data) return null;
  const user = await db.one('SELECT * FROM users WHERE id = $1', [data.sub]);
  if (!user || user.token_version !== data.v || user.status === 'suspended') return null;
  return user;
}

async function requireUser(req, db, roles) {
  const user = await currentUser(req, db);
  if (!user) fail(401, 'Veuillez vous connecter');
  if (roles && !roles.includes(user.role)) fail(403, 'Accès non autorisé');
  return user;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

// Limite sur 15 minutes : 8 échecs par identifiant, 50 par adresse IP
// (une même IP est souvent partagée par de nombreux abonnés mobiles)
async function checkRateLimit(db, keys) {
  for (const key of keys) {
    const r = await db.one(
      "SELECT count(*)::int AS n FROM login_attempts WHERE key = $1 AND success = false AND created_at > now() - interval '15 minutes'",
      [key]
    );
    const limit = key.startsWith('ip:') ? 50 : 8;
    if (r.n >= limit) fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
  }
}

async function recordAttempt(db, keys, success) {
  for (const key of keys) {
    await db.query('INSERT INTO login_attempts (key, success) VALUES ($1, $2)', [key, success]);
  }
  // Nettoyage léger des anciennes lignes
  if (Math.random() < 0.02) await db.query("DELETE FROM login_attempts WHERE created_at < now() - interval '2 days'");
}

module.exports = {
  hashPassword, verifyPassword, checkPasswordStrength, signToken, verifyToken,
  currentUser, requireUser, randomToken, sha256, checkRateLimit, recordAttempt,
};
