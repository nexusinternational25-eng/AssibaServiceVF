// Outils HTTP : erreurs, lecture du corps, validation simple.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new HttpError(status, message); };

const MAX_BODY = 4 * 1024 * 1024; // limite des fonctions Vercel : 4,5 Mo

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else {
    raw = await new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', c => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Envoi trop volumineux')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { fail(400, 'Requête invalide'); }
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

// Validation de champs texte
function str(v, { max = 500, required = false, name = 'champ' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') v = String(v);
  v = v.trim();
  if (required && !v) fail(400, `Le champ « ${name} » est obligatoire`);
  if (v.length > max) fail(400, `Le champ « ${name} » est trop long`);
  return v;
}

function int(v, { min = 0, max = 1e9, name = 'nombre', required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) fail(400, `Le champ « ${name} » est obligatoire`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `Valeur invalide pour « ${name} »`);
  return n;
}

// Numéro togolais : on garde les chiffres et on ajoute l'indicatif 228 si absent
function phone(v, { required = true } = {}) {
  const digits = String(v || '').replace(/\D/g, '');
  if (!digits) { if (required) fail(400, 'Le numéro de téléphone est obligatoire'); return null; }
  let d = digits;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '228' + d;
  if (d.length < 8 || d.length > 15) fail(400, 'Numéro de téléphone invalide');
  return '+' + d;
}

function email(v, { required = false } = {}) {
  const e = str(v, { max: 200, name: 'e-mail' }).toLowerCase();
  if (!e) { if (required) fail(400, "L'adresse e-mail est obligatoire"); return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) fail(400, 'Adresse e-mail invalide');
  return e;
}

function oneOf(v, allowed, name) {
  if (!allowed.includes(v)) fail(400, `Valeur invalide pour « ${name} »`);
  return v;
}

module.exports = { HttpError, fail, readBody, send, str, int, phone, email, oneOf };
