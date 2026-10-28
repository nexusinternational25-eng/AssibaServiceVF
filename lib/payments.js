// Paiements TMoney / Flooz.
// Deux modes :
//  - PayGate Global (agrégateur togolais) si PAYGATE_AUTH_TOKEN est configuré :
//    le client valide le paiement sur son téléphone, la confirmation est automatique.
//  - Manuel sinon : le client paie sur le numéro marchand puis saisit la référence
//    du SMS reçu ; un administrateur vérifie et confirme.
const crypto = require('crypto');
const { fail } = require('./http');
const { PLANS, INSURANCE } = require('./config');

const PAYGATE_URL = 'https://paygateglobal.com';

function gatewayEnabled() {
  return !!process.env.PAYGATE_AUTH_TOKEN;
}

function newRef() {
  // 10 caractères sans ambiguïté (pas de 0/O, 1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return 'ASB-' + s;
}

async function createPayment(db, { userId = null, purpose, amount, relatedId = null, method = null, phone = null }) {
  if (!Number.isInteger(amount) || amount <= 0) fail(500, 'Montant invalide');
  return db.one(
    `INSERT INTO payments (ref, user_id, purpose, amount, related_id, method, payer_phone, gateway)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [newRef(), userId, purpose, amount, relatedId, method, phone, gatewayEnabled() ? 'paygate' : 'manual']
  );
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// Confirme un paiement et applique son effet. Idempotent : un paiement déjà
// confirmé n'est jamais appliqué deux fois.
async function confirmPayment(db, paymentId, { adminId = null, externalRef = null } = {}) {
  return db.tx(async t => {
    const p = await t.one(
      `UPDATE payments SET status = 'confirmed', confirmed_at = now(), confirmed_by = $2,
         external_ref = COALESCE($3, external_ref)
       WHERE id = $1 AND status IN ('pending','processing','submitted') RETURNING *`,
      [paymentId, adminId, externalRef]
    );
    if (!p) return null;

    if (p.purpose === 'mise_en_relation') {
      await t.query(
        "UPDATE service_requests SET status = 'open', updated_at = now() WHERE id = $1 AND status = 'awaiting_payment'",
        [p.related_id]
      );
    } else if (p.purpose === 'prestation') {
      await t.query(
        "UPDATE service_requests SET status = 'in_progress', updated_at = now() WHERE id = $1 AND status = 'accepted'",
        [p.related_id]
      );
    } else if (p.purpose === 'inscription' || p.purpose === 'abonnement') {
      const sub = await t.one('SELECT * FROM subscriptions WHERE id = $1', [p.related_id]);
      if (sub) {
        const plan = PLANS[sub.plan];
        let ends = null;
        if (plan && plan.months) {
          let months = plan.months;
          // Mois offert sur la première souscription Pro
          if (plan.firstBonusMonths && sub.user_id) {
            const prev = await t.one(
              "SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1 AND plan = $2 AND status = 'active'",
              [sub.user_id, sub.plan]
            );
            if (prev.n === 0) months += plan.firstBonusMonths;
          }
          // Prolonge à partir de la fin de l'abonnement en cours s'il n'est pas expiré
          const current = sub.user_id
            ? await t.one('SELECT plan_expires_at FROM providers WHERE user_id = $1', [sub.user_id])
            : null;
          const base = current && current.plan_expires_at && new Date(current.plan_expires_at) > new Date()
            ? current.plan_expires_at : new Date();
          ends = addMonths(base, months);
        }
        await t.query(
          "UPDATE subscriptions SET status = 'active', starts_at = now(), ends_at = $2 WHERE id = $1",
          [sub.id, ends]
        );
        if (sub.user_id) {
          await t.query(
            `UPDATE providers SET registration_paid = true, plan = $2,
               plan_expires_at = CASE WHEN $3::timestamptz IS NULL THEN plan_expires_at ELSE $3::timestamptz END
             WHERE user_id = $1`,
            [sub.user_id, sub.plan, ends]
          );
        }
      }
    } else if (p.purpose === 'assurance') {
      const ins = await t.one('SELECT * FROM insurance_subscriptions WHERE id = $1', [p.related_id]);
      if (ins) {
        const months = (INSURANCE[ins.insurance_type] || {}).months || 12;
        await t.query(
          "UPDATE insurance_subscriptions SET status = 'active', starts_at = now(), ends_at = $2 WHERE id = $1",
          [ins.id, addMonths(new Date(), months)]
        );
      }
    }
    await t.query(
      'INSERT INTO audit_log (actor_id, action, target, details) VALUES ($1, $2, $3, $4)',
      [adminId, 'payment.confirm', p.ref, JSON.stringify({ purpose: p.purpose, amount: p.amount })]
    );
    return p;
  });
}

// ---- PayGate Global ----

async function paygatePost(path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(PAYGATE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auth_token: process.env.PAYGATE_AUTH_TOKEN, ...body }),
      signal: ctrl.signal,
    });
    return await r.json();
  } catch (e) {
    fail(502, 'Le service de paiement ne répond pas. Réessayez dans un instant.');
  } finally {
    clearTimeout(timer);
  }
}

async function paygateInitiate(payment, { method, phone }) {
  const network = method === 'flooz' ? 'FLOOZ' : 'TMONEY';
  const out = await paygatePost('/api/v1/pay', {
    phone_number: phone.replace(/^\+228/, ''),
    amount: payment.amount,
    description: `AssibaService ${payment.ref}`,
    identifier: payment.ref,
    network,
  });
  if (!out || Number(out.status) !== 0) {
    const messages = { 2: 'Configuration du paiement invalide', 4: 'Paramètres de paiement invalides', 6: 'Paiement déjà initié' };
    fail(502, messages[out && out.status] || "Le paiement n'a pas pu être initié");
  }
  return out.tx_reference;
}

// Interroge PayGate ; renvoie 'paid', 'pending' ou 'failed'
async function paygateStatus(ref) {
  const out = await paygatePost('/api/v2/status', { identifier: ref });
  const s = Number(out && out.status);
  if (s === 0) return { state: 'paid', reference: out.payment_reference || out.tx_reference };
  if (s === 2) return { state: 'pending' };
  return { state: 'failed' };
}

module.exports = {
  gatewayEnabled, createPayment, confirmPayment, paygateInitiate, paygateStatus, newRef,
};
