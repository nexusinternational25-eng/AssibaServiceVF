// Page de paiement : consultation, déclaration manuelle, paiement via PayGate.
// La référence (ASB-XXXXXXXXXX) sert de clé d'accès : elle est aléatoire et
// n'est communiquée qu'à la personne qui doit payer.
const { fail, str, phone, oneOf } = require('../http');
const { currentUser } = require('../auth');
const P = require('../payments');
const { PURPOSE_LABELS, paymentNumbers } = require('../config');

async function loadByRef(db, ref) {
  if (!/^ASB-[A-Z0-9]{10}$/.test(String(ref))) fail(404, 'Paiement introuvable');
  const p = await db.one('SELECT * FROM payments WHERE ref = $1', [ref]);
  if (!p) fail(404, 'Paiement introuvable');
  return p;
}

// Un paiement rattaché à un compte n'est visible que par ce compte (ou un admin)
async function checkOwner(ctx, p) {
  if (!p.user_id) return;
  const u = await currentUser(ctx.req, ctx.db);
  if (!u) fail(401, 'Veuillez vous connecter pour accéder à ce paiement');
  if (u.id !== p.user_id && u.role !== 'admin') fail(403, 'Accès non autorisé');
}

function view(p) {
  const numbers = paymentNumbers();
  return {
    ref: p.ref, purpose: p.purpose, purpose_label: PURPOSE_LABELS[p.purpose], amount: p.amount,
    status: p.status, method: p.method, created_at: p.created_at, note: p.note,
    gateway: P.gatewayEnabled() ? 'paygate' : 'manual',
    instructions: P.gatewayEnabled() ? null : {
      tmoney: numbers.tmoney || null, flooz: numbers.flooz || null, beneficiary: numbers.beneficiary,
    },
  };
}

async function getPayment(ctx) {
  const p = await loadByRef(ctx.db, ctx.params.ref);
  await checkOwner(ctx, p);
  return { success: true, payment: view(p) };
}

// Mode manuel : le payeur déclare la référence de transaction reçue par SMS
async function submitManual(ctx) {
  const p = await loadByRef(ctx.db, ctx.params.ref);
  await checkOwner(ctx, p);
  const b = await ctx.body();
  const method = oneOf(b.method, ['tmoney', 'flooz'], 'moyen de paiement');
  const tel = phone(b.phone);
  const txn = str(b.transaction_id, { max: 60, required: true, name: 'référence de transaction' }).toUpperCase();
  if (txn.length < 4) fail(400, 'Référence de transaction trop courte');
  if (!['pending', 'submitted'].includes(p.status)) fail(400, 'Ce paiement ne peut plus être modifié');
  const dup = await ctx.db.one('SELECT ref FROM payments WHERE method = $1 AND external_ref = $2 AND id <> $3', [method, txn, p.id]);
  if (dup) fail(409, 'Cette référence de transaction a déjà été utilisée');
  const row = await ctx.db.one(
    `UPDATE payments SET method = $2, payer_phone = $3, external_ref = $4, status = 'submitted', submitted_at = now()
     WHERE id = $1 AND status IN ('pending','submitted') RETURNING *`,
    [p.id, method, tel, txn]);
  return { success: true, payment: view(row) };
}

// Mode PayGate : déclenche la demande de paiement sur le téléphone du client
async function initiate(ctx) {
  if (!P.gatewayEnabled()) fail(400, 'Le paiement automatique n\'est pas activé');
  const p = await loadByRef(ctx.db, ctx.params.ref);
  await checkOwner(ctx, p);
  if (!['pending', 'processing'].includes(p.status)) fail(400, 'Ce paiement est déjà traité');
  const b = await ctx.body();
  const method = oneOf(b.method, ['tmoney', 'flooz'], 'moyen de paiement');
  const tel = phone(b.phone);
  const tx = await P.paygateInitiate(p, { method, phone: tel });
  const row = await ctx.db.one(
    "UPDATE payments SET method = $2, payer_phone = $3, status = 'processing', note = $4 WHERE id = $1 RETURNING *",
    [p.id, method, tel, 'PayGate ' + tx]);
  return { success: true, payment: view(row), message: 'Validez le paiement sur votre téléphone (code secret Mobile Money).' };
}

async function check(ctx) {
  const p = await loadByRef(ctx.db, ctx.params.ref);
  await checkOwner(ctx, p);
  if (p.gateway === 'paygate' && p.status === 'processing' && P.gatewayEnabled()) {
    const s = await P.paygateStatus(p.ref);
    if (s.state === 'paid') await P.confirmPayment(ctx.db, p.id, { externalRef: s.reference });
    if (s.state === 'failed') {
      await ctx.db.query("UPDATE payments SET status = 'pending', note = 'Paiement non abouti, vous pouvez réessayer' WHERE id = $1 AND status = 'processing'", [p.id]);
    }
  }
  const row = await ctx.db.one('SELECT * FROM payments WHERE id = $1', [p.id]);
  return { success: true, payment: view(row) };
}

// Notification de PayGate. On ne fait jamais confiance au contenu : on revérifie le statut.
async function paygateCallback(ctx) {
  const b = await ctx.body();
  const ref = String(b.identifier || '');
  if (!/^ASB-[A-Z0-9]{10}$/.test(ref) || !P.gatewayEnabled()) return { success: true };
  const p = await ctx.db.one('SELECT * FROM payments WHERE ref = $1', [ref]);
  if (!p || p.status === 'confirmed') return { success: true };
  const s = await P.paygateStatus(ref);
  if (s.state === 'paid') await P.confirmPayment(ctx.db, p.id, { externalRef: s.reference });
  return { success: true };
}

module.exports = {
  routes: [
    ['GET', '/payments/:ref', getPayment],
    ['POST', '/payments/:ref/submit', submitManual],
    ['POST', '/payments/:ref/initiate', initiate],
    ['POST', '/payments/:ref/check', check],
    ['POST', '/payments/paygate/callback', paygateCallback],
  ],
};
