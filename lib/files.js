// Fichiers (photos, pièces d'identité) stockés en base, jamais publics.
const { fail } = require('./http');

const ALLOWED = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'application/pdf': true,
};
const MAX_BYTES = 1.5 * 1024 * 1024;

// dataUrl : "data:image/jpeg;base64,...."
function parseDataUrl(dataUrl, { allowPdf = false } = {}) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) fail(400, 'Fichier invalide');
  const mime = m[1].toLowerCase();
  if (!ALLOWED[mime] || (mime === 'application/pdf' && !allowPdf)) fail(400, 'Format de fichier non accepté');
  const b64 = m[2].replace(/\s/g, '');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) fail(400, 'Fichier vide');
  if (buf.length > MAX_BYTES) fail(413, 'Fichier trop lourd (1,5 Mo maximum)');
  // Vérifie la signature réelle du fichier, pas seulement le type annoncé
  const sig = buf.subarray(0, 12);
  const ok =
    (mime === 'image/jpeg' && sig[0] === 0xff && sig[1] === 0xd8) ||
    (mime === 'image/png' && sig.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
    (mime === 'image/webp' && sig.subarray(0, 4).toString() === 'RIFF' && sig.subarray(8, 12).toString() === 'WEBP') ||
    (mime === 'application/pdf' && sig.subarray(0, 4).toString() === '%PDF');
  if (!ok) fail(400, 'Le contenu du fichier ne correspond pas à son format');
  return { mime, b64: buf.toString('base64'), size: buf.length };
}

async function saveFile(db, { ownerId, kind, dataUrl, allowPdf = false }) {
  const f = parseDataUrl(dataUrl, { allowPdf });
  const row = await db.one(
    'INSERT INTO files (owner_id, kind, mime, size, data_b64) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [ownerId, kind, f.mime, f.size, f.b64]
  );
  return row.id;
}

module.exports = { saveFile, parseDataUrl };
