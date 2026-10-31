// Administration : tableau de bord, comptes, paiements, litiges, retraits, assurance.
const { fail, str, int, oneOf } = require('../http');
const { requireUser, hashPassword } = require('../auth');
const { confirmPayment } = require('../payments');
const { releaseToProvider } = require('./requests');
const { publicUser, createResetLink } = require('./auth');
const { CATEGORIES } = require('../config');

const admin = ctx => requireUser(ctx.req, ctx.db, ['admin']);

async function audit(db, actor, action, target, details) {
  await db.query('INSERT INTO audit_log (actor_id, action, target, details) VALUES ($1,$2,$3,$4)',
    [actor.id, action, String(target), JSON.stringify(details || {})]);
}

// Crée le premier compte administrateur à partir des variables d'environnement
let adminChecked = false;
async function ensureAdmin(db) {
  if (adminChecked) return;
  const phoneRaw = process.env.ADMIN_PHONE;
  const pw = process.env.ADMIN_PASSWORD;
  if (!phoneRaw || !pw) { adminChecked = true; return; }
  const exists = await db.one("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (!exists) {
    const { phone, email } = require('../http');
    await db.query(
      `INSERT INTO users (role, first_name, last_name, email, phone, password_hash, status)
       VALUES ('admin', 'Administrateur', 'AssibaService', $1, $2, $3, 'active') ON CONFLICT DO NOTHING`,
      [process.env.ADMIN_EMAIL ? email(process.env.ADMIN_EMAIL) : null, phone(phoneRaw), hashPassword(pw)]);
  }
  adminChecked = true;
}

async function overview(ctx) {
  await admin(ctx);
  const q = sql => ctx.db.one(sql);
  const [users, requests, payments, revenue, todo] = await Promise.all([
    ctx.db.query("SELECT role, status, count(*)::int AS n FROM users GROUP BY role, status"),
    ctx.db.query("SELECT status, count(*)::int AS n FROM service_requests GROUP BY status"),
    ctx.db.query("SELECT purpose, status, count(*)::int AS n, COALESCE(sum(amount),0)::bigint AS total FROM payments GROUP BY purpose, status"),
    q(`SELECT
         COALESCE((SELECT sum(amount) FROM payments WHERE status = 'confirmed' AND purpose IN ('mise_en_relation','inscription','abonnement','assurance')),0)::bigint AS fees,
         COALESCE((SELECT sum(round(agreed_amount * commission_rate)) FROM service_requests WHERE status = 'completed'),0)::bigint AS commissions,
         COALESCE((SELECT sum(agreed_amount + round(agreed_amount * commission_rate)) FROM service_requests WHERE status IN ('in_progress','done','dispute')),0)::bigint AS escrow`),
    q(`SELECT
         (SELECT count(*)::int FROM payments WHERE status = 'submitted') AS payments_to_check,
         (SELECT count(*)::int FROM users u JOIN providers p ON p.user_id = u.id WHERE u.status = 'pending') AS providers_to_validate,
         (SELECT count(*)::int FROM disputes WHERE status = 'open') AS disputes_open,
         (SELECT count(*)::int FROM withdrawals WHERE status = 'pending') AS withdrawals_pending,
         (SELECT count(*)::int FROM password_resets WHERE token_hash IS NULL AND used_at IS NULL) AS password_requests`),
  ]);
  return { success: true, users, requests, payments, revenue, todo };
}

async function listUsers(ctx) {
  await admin(ctx);
  const role = ctx.query.role || null;
  const status = ctx.query.status || null;
  const search = ctx.query.q ? `%${String(ctx.query.q).toLowerCase().slice(0, 60)}%` : null;
  const rows = await ctx.db.query(
    `SELECT u.*, p.business_name, p.categories, p.plan, p.plan_expires_at, p.registration_paid,
       p.id_document_file_id, p.verified_at, p.rating_avg, p.rating_count,
       (SELECT COALESCE(sum(amount),0)::int FROM ledger l WHERE l.user_id = u.id) AS balance
     FROM users u LEFT JOIN providers p ON p.user_id = u.id
     WHERE ($1::text IS NULL OR u.role = $1) AND ($2::text IS NULL OR u.status = $2)
       AND ($3::text IS NULL OR lower(u.first_name || ' ' || u.last_name || ' ' || COALESCE(u.email,'') || ' ' || u.phone) LIKE $3)
     ORDER BY u.created_at DESC LIMIT 300`, [role, status, search]);
  return {
    success: true,
    users: rows.map(r => ({
      ...publicUser(r), last_login_at: r.last_login_at, balance: r.balance,
      provider: r.role === 'prestataire' ? {
        business_name: r.business_name, categories: (r.categories || []).map(c => CATEGORIES[c] || c),
        plan: r.plan, plan_expires_at: r.plan_expires_at, registration_paid: r.registration_paid,
        id_document_url: r.id_document_file_id ? `/api/files/${r.id_document_file_id}` : null,
        verified_at: r.verified_at, rating_avg: Number(r.rating_avg || 0), rating_count: r.rating_count,
      } : null,
    })),
  };
}

async function setUserStatus(ctx) {
  const a = await admin(ctx);
  const b = await ctx.body();
  const status = oneOf(b.status, ['active', 'pending', 'suspended'], 'statut');
  const id = int(ctx.params.id, { min: 1 });
  if (id === a.id) fail(400, 'Vous ne pouvez pas modifier votre propre compte ici');
  const u = await ctx.db.one('SELECT * FROM users WHERE id = $1', [id]);
  if (!u) fail(404, 'Utilisateur introuvable');
  if (u.role === 'prestataire' && status === 'active') {
    const p = await ctx.db.one('SELECT registration_paid FROM providers WHERE user_id = $1', [id]);
    if (!p.registration_paid && b.force !== true) fail(400, "Les frais d'inscription de ce prestataire ne sont pas encore payés");
    await ctx.db.query('UPDATE providers SET verified_at = COALESCE(verified_at, now()) WHERE user_id = $1', [id]);
  }
  // Une suspension déconnecte immédiatement l'utilisateur
  await ctx.db.query(
    'UPDATE users SET status = $2, token_version = token_version + CASE WHEN $2 = \'suspended\' THEN 1 ELSE 0 END WHERE id = $1',
    [id, status]);
  await audit(ctx.db, a, 'user.status', id, { status });
  return { success: true };
}

async function resetLink(ctx) {
  const a = await admin(ctx);
  const id = int(ctx.params.id, { min: 1 });
  const u = await ctx.db.one('SELECT id FROM users WHERE id = $1', [id]);
  if (!u) fail(404, 'Utilisateur introuvable');
  // Clôt les demandes en attente de cet utilisateur
  await ctx.db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND token_hash IS NULL AND used_at IS NULL', [id]);
  const link = await createResetLink(ctx.db, id, { byUser: false });
  await audit(ctx.db, a, 'user.reset_link', id);
  return { success: true, link };
}

async function passwordRequests(ctx) {
  await admin(ctx);
  const rows = await ctx.db.query(
    `SELECT r.id, r.created_at, u.id AS user_id, u.first_name, u.last_name, u.phone, u.email
     FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash IS NULL AND r.used_at IS NULL ORDER BY r.created_at DESC`);
  return { success: true, requests: rows };
}

async function listRequests(ctx) {
  await admin(ctx);
  const status = ctx.query.status || null;
  const rows = await ctx.db.query(
    `SELECT sr.id, sr.title, sr.category, sr.status, sr.service_type, sr.city, sr.agreed_amount, sr.is_urgent,
       sr.created_at, sr.updated_at, c.first_name || ' ' || c.last_name AS client_name, c.phone AS client_phone,
       pr.first_name || ' ' || pr.last_name AS provider_name, pr.phone AS provider_phone,
       (SELECT count(*)::int FROM offers o WHERE o.request_id = sr.id) AS offers_count
     FROM service_requests sr JOIN users c ON c.id = sr.client_id LEFT JOIN users pr ON pr.id = sr.provider_id
     WHERE ($1::text IS NULL OR sr.status = $1) ORDER BY sr.updated_at DESC LIMIT 300`, [status]);
  return { success: true, requests: rows.map(r => ({ ...r, category_label: CATEGORIES[r.category] || r.category })) };
}

async function listPayments(ctx) {
  await admin(ctx);
  const status = ctx.query.status || null;
  const rows = await ctx.db.query(
    `SELECT p.*, u.first_name || ' ' || u.last_name AS user_name, u.phone AS user_phone
     FROM payments p LEFT JOIN users u ON u.id = p.user_id
     WHERE ($1::text IS NULL OR p.status = $1) ORDER BY COALESCE(p.submitted_at, p.created_at) DESC LIMIT 300`, [status]);
  return { success: true, payments: rows };
}

async function confirm(ctx) {
  const a = await admin(ctx);
  const id = int(ctx.params.id, { min: 1 });
  const p = await confirmPayment(ctx.db, id, { adminId: a.id });
  if (!p) fail(400, 'Ce paiement est déjà traité');
  return { success: true };
}

async function reject(ctx) {
  const a = await admin(ctx);
  const b = await ctx.body();
  const note = str(b.note, { max: 300 }) || 'Paiement introuvable chez l\'opérateur';
  // Le paiement repasse en attente : le client peut saisir une autre référence
  const r = await ctx.db.one(
    "UPDATE payments SET status = 'pending', note = $2, external_ref = NULL WHERE id = $1 AND status IN ('submitted','processing') RETURNING ref",
    [int(ctx.params.id, { min: 1 }), note]);
  if (!r) fail(400, 'Ce paiement ne peut pas être refusé');
  await audit(ctx.db, a, 'payment.reject', r.ref, { note });
  return { success: true };
}

async function listDisputes(ctx) {
  await admin(ctx);
  const rows = await ctx.db.query(
    `SELECT d.*, sr.title, sr.agreed_amount, sr.status AS request_status,
       c.first_name || ' ' || c.last_name AS client_name, c.phone AS client_phone,
       pr.first_name || ' ' || pr.last_name AS provider_name, pr.phone AS provider_phone,
       o.first_name || ' ' || o.last_name AS opened_by_name
     FROM disputes d JOIN service_requests sr ON sr.id = d.request_id
     JOIN users c ON c.id = sr.client_id LEFT JOIN users pr ON pr.id = sr.provider_id JOIN users o ON o.id = d.opened_by
     ORDER BY d.status, d.created_at DESC LIMIT 200`);
  return { success: true, disputes: rows };
}

async function resolveDispute(ctx) {
  const a = await admin(ctx);
  const b = await ctx.body();
  const decision = oneOf(b.decision, ['release', 'refund'], 'décision');
  const resolution = str(b.resolution, { max: 2000, required: true, name: 'explication' });
  await ctx.db.tx(async t => {
    const d = await t.one("SELECT * FROM disputes WHERE id = $1 AND status = 'open' FOR UPDATE", [int(ctx.params.id, { min: 1 })]);
    if (!d) fail(400, 'Litige introuvable ou déjà traité');
    const sr = await t.one('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [d.request_id]);
    if (sr.status !== 'dispute') fail(400, 'La mission n\'est plus en litige');
    if (decision === 'release') {
      await releaseToProvider(t, sr, `Mission n°${sr.id} libérée après litige`);
    } else {
      await t.query("UPDATE service_requests SET status = 'refunded', updated_at = now() WHERE id = $1", [sr.id]);
      await t.query("UPDATE payments SET status = 'refunded', note = $2 WHERE related_id = $1 AND purpose = 'prestation' AND status = 'confirmed'",
        [sr.id, 'Remboursement à effectuer au client']);
    }
    await t.query("UPDATE disputes SET status = 'resolved', decision = $2, resolution = $3, resolved_at = now() WHERE id = $1",
      [d.id, decision, resolution]);
    await t.query('INSERT INTO audit_log (actor_id, action, target, details) VALUES ($1,$2,$3,$4)',
      [a.id, 'dispute.resolve', String(d.id), JSON.stringify({ decision })]);
  });
  return { success: true };
}

// Libère manuellement le paiement d'une mission terminée que le client n'a pas validée
async function forceRelease(ctx) {
  const a = await admin(ctx);
  await ctx.db.tx(async t => {
    const sr = await t.one('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [int(ctx.params.id, { min: 1 })]);
    if (!sr || sr.status !== 'done') fail(400, 'Seule une mission déclarée terminée peut être libérée');
    await releaseToProvider(t, sr, `Mission n°${sr.id} libérée par l'administration`);
    await t.query('INSERT INTO audit_log (actor_id, action, target) VALUES ($1,$2,$3)', [a.id, 'request.release', String(sr.id)]);
  });
  return { success: true };
}

async function listWithdrawals(ctx) {
  await admin(ctx);
  const rows = await ctx.db.query(
    `SELECT w.*, u.first_name || ' ' || u.last_name AS provider_name FROM withdrawals w JOIN users u ON u.id = w.provider_id
     ORDER BY (w.status = 'pending') DESC, w.created_at DESC LIMIT 200`);
  return { success: true, withdrawals: rows };
}

async function withdrawalPaid(ctx) {
  const a = await admin(ctx);
  const b = await ctx.body();
  const ref = str(b.external_ref, { max: 60, required: true, name: 'référence du transfert' });
  const r = await ctx.db.one(
    "UPDATE withdrawals SET status = 'paid', external_ref = $2, processed_at = now() WHERE id = $1 AND status = 'pending' RETURNING id",
    [int(ctx.params.id, { min: 1 }), ref]);
  if (!r) fail(400, 'Retrait introuvable ou déjà traité');
  await audit(ctx.db, a, 'withdrawal.paid', r.id, { ref });
  return { success: true };
}

async function withdrawalReject(ctx) {
  const a = await admin(ctx);
  const b = await ctx.body();
  const note = str(b.note, { max: 300 }) || 'Retrait refusé';
  await ctx.db.tx(async t => {
    const w = await t.one("UPDATE withdrawals SET status = 'rejected', note = $2, processed_at = now() WHERE id = $1 AND status = 'pending' RETURNING *",
      [int(ctx.params.id, { min: 1 }), note]);
    if (!w) fail(400, 'Retrait introuvable ou déjà traité');
    // Le montant revient sur le solde du prestataire
    await t.query("INSERT INTO ledger (user_id, amount, kind, withdrawal_id, note) VALUES ($1, $2, 'annulation_retrait', $3, $4)",
      [w.provider_id, w.amount, w.id, note]);
  });
  await audit(ctx.db, a, 'withdrawal.reject', ctx.params.id, { note });
  return { success: true };
}

async function listSubscriptions(ctx) {
  await admin(ctx);
  const subs = await ctx.db.query(
    `SELECT s.*, p.ref AS payment_ref, p.status AS payment_status FROM subscriptions s LEFT JOIN payments p ON p.id = s.payment_id
     ORDER BY s.created_at DESC LIMIT 300`);
  const ins = await ctx.db.query(
    `SELECT s.*, p.ref AS payment_ref, p.status AS payment_status FROM insurance_subscriptions s LEFT JOIN payments p ON p.id = s.payment_id
     ORDER BY s.created_at DESC LIMIT 300`);
  return { success: true, subscriptions: subs, insurance: ins };
}

async function partners(ctx) {
  await admin(ctx);
  return { success: true, partners: await ctx.db.query('SELECT * FROM insurance_partners ORDER BY sort, name') };
}

async function savePartner(ctx) {
  const a = await admin(ctx);
  const b = await ctx.body();
  const id = (ctx.params.id || str(b.id, { max: 40, required: true, name: 'identifiant' })).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  await ctx.db.query(
    `INSERT INTO insurance_partners (id, name, logo, description, active, sort) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET name = $2, logo = $3, description = $4, active = $5, sort = $6`,
    [id, str(b.name, { max: 120, required: true, name: 'nom' }), str(b.logo, { max: 20 }), str(b.description, { max: 300 }),
      b.active !== false, int(b.sort, { min: 0, max: 1000 }) || 0]);
  await audit(ctx.db, a, 'partner.save', id);
  return { success: true };
}

async function deletePartner(ctx) {
  const a = await admin(ctx);
  await ctx.db.query('DELETE FROM insurance_partners WHERE id = $1', [ctx.params.id]);
  await audit(ctx.db, a, 'partner.delete', ctx.params.id);
  return { success: true };
}

module.exports = {
  routes: [
    ['GET', '/admin/overview', overview],
    ['GET', '/admin/users', listUsers],
    ['POST', '/admin/users/:id/status', setUserStatus],
    ['POST', '/admin/users/:id/reset-link', resetLink],
    ['GET', '/admin/password-requests', passwordRequests],
    ['GET', '/admin/requests', listRequests],
    ['POST', '/admin/requests/:id/release', forceRelease],
    ['GET', '/admin/payments', listPayments],
    ['POST', '/admin/payments/:id/confirm', confirm],
    ['POST', '/admin/payments/:id/reject', reject],
    ['GET', '/admin/disputes', listDisputes],
    ['POST', '/admin/disputes/:id/resolve', resolveDispute],
    ['GET', '/admin/withdrawals', listWithdrawals],
    ['POST', '/admin/withdrawals/:id/paid', withdrawalPaid],
    ['POST', '/admin/withdrawals/:id/reject', withdrawalReject],
    ['GET', '/admin/subscriptions', listSubscriptions],
    ['GET', '/admin/insurance/partners', partners],
    ['POST', '/admin/insurance/partners', savePartner],
    ['PUT', '/admin/insurance/partners/:id', savePartner],
    ['DELETE', '/admin/insurance/partners/:id', deletePartner],
  ],
  ensureAdmin,
};
