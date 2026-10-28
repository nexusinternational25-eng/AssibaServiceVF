// Demandes de service, offres, déroulement de la mission, portefeuille prestataire.
//
// Cycle d'une demande :
//   awaiting_payment  le client doit régler les frais de mise en relation
//   open              visible par les prestataires de la catégorie, qui font des offres
//   accepted          le client a choisi une offre ; il doit payer la prestation
//   in_progress       montant payé et bloqué par AssibaService (séquestre)
//   done              le prestataire déclare la mission terminée
//   completed         le client valide ; le prestataire est crédité (moins la commission)
//   dispute           litige ouvert, arbitré par un administrateur
//   refunded          le client a été remboursé après litige
//   cancelled         annulée par le client avant paiement de la prestation
const { fail, str, int, oneOf } = require('../http');
const { requireUser } = require('../auth');
const { saveFile } = require('../files');
const { createPayment } = require('../payments');
const { MATCHING_FEE, COMMISSION, CATEGORIES } = require('../config');

const SERVICE_TYPES = Object.keys(COMMISSION);

async function providerCanWork(db, user) {
  if (user.role !== 'prestataire' || user.status !== 'active') return null;
  return db.one('SELECT * FROM providers WHERE user_id = $1 AND registration_paid = true', [user.id]);
}

async function requireActiveProvider(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['prestataire']);
  const p = await providerCanWork(ctx.db, u);
  if (!p) fail(403, 'Votre compte prestataire doit être validé avant de pouvoir répondre aux demandes');
  return { user: u, provider: p };
}

async function photosOf(db, requestId) {
  const rows = await db.query('SELECT file_id FROM request_photos WHERE request_id = $1', [requestId]);
  return rows.map(r => `/api/files/${r.file_id}`);
}

// Vue complète (client propriétaire, prestataire retenu, admin)
async function fullView(db, sr) {
  const out = { ...sr, category_label: CATEGORIES[sr.category] || sr.category, photos: await photosOf(db, sr.id) };
  if (sr.provider_id) {
    const p = await db.one(
      `SELECT u.id, u.first_name, u.last_name, u.phone, u.photo_file_id, p.business_name, p.rating_avg, p.rating_count
       FROM users u JOIN providers p ON p.user_id = u.id WHERE u.id = $1`, [sr.provider_id]);
    out.provider = p && {
      id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), phone: p.phone, business_name: p.business_name,
      rating_avg: Number(p.rating_avg), rating_count: p.rating_count,
      photo_url: p.photo_file_id ? `/api/files/${p.photo_file_id}` : null,
    };
    const c = await db.one('SELECT first_name, last_name, phone FROM users WHERE id = $1', [sr.client_id]);
    out.client = c && { name: `${c.first_name} ${c.last_name}`.trim(), phone: c.phone };
  }
  out.payments = await db.query(
    `SELECT ref, purpose, amount, status FROM payments WHERE related_id = $1 AND purpose IN ('mise_en_relation','prestation') ORDER BY id`,
    [sr.id]);
  out.review = await db.one('SELECT rating, comment FROM reviews WHERE request_id = $1', [sr.id]);
  out.dispute = await db.one("SELECT reason, status, resolution FROM disputes WHERE request_id = $1 ORDER BY id DESC LIMIT 1", [sr.id]);
  return out;
}

// Vue limitée pour un prestataire qui consulte une demande ouverte : ni adresse exacte ni contact
function limitedView(sr, photos) {
  return {
    id: sr.id, category: sr.category, category_label: CATEGORIES[sr.category] || sr.category,
    other_detail: sr.other_detail, title: sr.title, description: sr.description, city: sr.city,
    service_type: sr.service_type, preferred_date: sr.preferred_date, preferred_time: sr.preferred_time,
    is_urgent: sr.is_urgent, budget_min: sr.budget_min, budget_max: sr.budget_max,
    status: sr.status, created_at: sr.created_at, photos,
  };
}

async function createRequest(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client']);
  const b = await ctx.body();
  const category = oneOf(b.category, Object.keys(CATEGORIES), 'catégorie');
  const serviceType = oneOf(b.service_type || 'depannage', SERVICE_TYPES, 'type de service');
  const title = str(b.title, { max: 150, required: true, name: 'titre' });
  const description = str(b.description, { max: 3000, required: true, name: 'description' });
  const address = str(b.address, { max: 300, required: true, name: 'adresse' });
  const city = str(b.city, { max: 80 }) || u.city || 'Lomé';
  let date = str(b.preferred_date, { max: 10 }) || null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Date invalide');
  const budgetMin = int(b.budget_min, { min: 0, max: 100000000, name: 'budget minimum' });
  const budgetMax = int(b.budget_max, { min: 0, max: 100000000, name: 'budget maximum' });
  if (budgetMin && budgetMax && budgetMin > budgetMax) fail(400, 'Le budget minimum dépasse le budget maximum');
  const photos = Array.isArray(b.photos) ? b.photos.slice(0, 5) : [];
  const lat = Number(b.latitude); const lng = Number(b.longitude);

  const out = await ctx.db.tx(async t => {
    const sr = await t.one(
      `INSERT INTO service_requests (client_id, category, other_detail, title, description, address, city,
         latitude, longitude, service_type, commission_rate, preferred_date, preferred_time, is_urgent, budget_min, budget_max)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [u.id, category, str(b.other_service_detail, { max: 150 }), title, description, address, city,
        Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null,
        serviceType, COMMISSION[serviceType], date, str(b.preferred_time, { max: 30 }),
        b.is_urgent === true || b.is_urgent === 'true', budgetMin, budgetMax]
    );
    for (const p of photos) {
      const fid = await saveFile(t, { ownerId: u.id, kind: 'photo_demande', dataUrl: p });
      await t.query('INSERT INTO request_photos (request_id, file_id) VALUES ($1, $2)', [sr.id, fid]);
    }
    const pay = await createPayment(t, { userId: u.id, purpose: 'mise_en_relation', amount: MATCHING_FEE, relatedId: sr.id });
    return { sr, pay };
  });
  return { success: true, request: out.sr, payment_ref: out.pay.ref };
}

async function myRequests(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client']);
  const rows = await ctx.db.query(
    `SELECT sr.*,
       (SELECT count(*)::int FROM offers o WHERE o.request_id = sr.id AND o.status = 'pending') AS offers_count
     FROM service_requests sr WHERE client_id = $1 ORDER BY created_at DESC LIMIT 200`, [u.id]);
  const out = [];
  for (const sr of rows) out.push(await fullView(ctx.db, sr));
  return { success: true, requests: out };
}

async function loadRequest(db, id) {
  const sr = await db.one('SELECT * FROM service_requests WHERE id = $1', [int(id, { min: 1, name: 'demande' })]);
  if (!sr) fail(404, 'Demande introuvable');
  return sr;
}

async function getRequest(ctx) {
  const u = await requireUser(ctx.req, ctx.db);
  const sr = await loadRequest(ctx.db, ctx.params.id);
  if (u.role === 'admin' || sr.client_id === u.id || sr.provider_id === u.id) {
    return { success: true, request: await fullView(ctx.db, sr) };
  }
  const p = await providerCanWork(ctx.db, u);
  if (p && sr.status === 'open') {
    const mine = await ctx.db.one('SELECT id, amount, message, status FROM offers WHERE request_id = $1 AND provider_id = $2', [sr.id, u.id]);
    return { success: true, request: { ...limitedView(sr, await photosOf(ctx.db, sr.id)), my_offer: mine } };
  }
  fail(403, 'Accès non autorisé');
}

async function cancelRequest(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client']);
  const sr = await loadRequest(ctx.db, ctx.params.id);
  if (sr.client_id !== u.id) fail(403, 'Accès non autorisé');
  if (!['awaiting_payment', 'open', 'accepted'].includes(sr.status)) fail(400, 'Cette demande ne peut plus être annulée');
  await ctx.db.tx(async t => {
    const done = await t.one(
      "UPDATE service_requests SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('awaiting_payment','open','accepted') RETURNING id",
      [sr.id]);
    if (!done) fail(409, 'La demande a changé entre-temps, rechargez la page');
    await t.query("UPDATE offers SET status = 'rejected' WHERE request_id = $1 AND status IN ('pending','accepted')", [sr.id]);
    await t.query(
      "UPDATE payments SET status = 'rejected', note = 'Demande annulée' WHERE related_id = $1 AND purpose IN ('mise_en_relation','prestation') AND status IN ('pending','processing')",
      [sr.id]);
  });
  return { success: true };
}

// ---- Côté prestataire ----

async function openRequestsForProvider(ctx) {
  const { user, provider } = await requireActiveProvider(ctx);
  const rows = await ctx.db.query(
    `SELECT sr.*, o.id AS offer_id, o.amount AS offer_amount, o.status AS offer_status
     FROM service_requests sr
     LEFT JOIN offers o ON o.request_id = sr.id AND o.provider_id = $1
     WHERE sr.status = 'open' AND (sr.category = ANY($2) OR sr.category = 'autres')
     ORDER BY sr.is_urgent DESC, sr.created_at DESC LIMIT 100`,
    [user.id, provider.categories]);
  const out = [];
  for (const sr of rows) {
    out.push({
      ...limitedView(sr, await photosOf(ctx.db, sr.id)),
      my_offer: sr.offer_id ? { id: sr.offer_id, amount: sr.offer_amount, status: sr.offer_status } : null,
    });
  }
  return { success: true, requests: out };
}

async function providerMissions(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['prestataire']);
  const rows = await ctx.db.query(
    'SELECT * FROM service_requests WHERE provider_id = $1 ORDER BY updated_at DESC LIMIT 200', [u.id]);
  const out = [];
  for (const sr of rows) {
    const v = await fullView(ctx.db, sr);
    // Le prestataire voit son montant net
    v.commission = Math.round((sr.agreed_amount || 0) * Number(sr.commission_rate));
    v.net_amount = (sr.agreed_amount || 0) - v.commission;
    out.push(v);
  }
  return { success: true, missions: out };
}

async function makeOffer(ctx) {
  const { user } = await requireActiveProvider(ctx);
  const sr = await loadRequest(ctx.db, ctx.params.id);
  if (sr.status !== 'open') fail(400, "Cette demande n'accepte plus d'offres");
  const b = await ctx.body();
  const amount = int(b.amount, { min: 500, max: 100000000, required: true, name: 'montant' });
  const message = str(b.message, { max: 1000, name: 'message' });
  const offer = await ctx.db.one(
    `INSERT INTO offers (request_id, provider_id, amount, message) VALUES ($1, $2, $3, $4)
     ON CONFLICT (request_id, provider_id) DO UPDATE SET amount = EXCLUDED.amount, message = EXCLUDED.message,
       status = 'pending', created_at = now()
     WHERE offers.status IN ('pending','withdrawn')
     RETURNING *`,
    [sr.id, user.id, amount, message]);
  if (!offer) fail(400, 'Votre offre ne peut plus être modifiée');
  return { success: true, offer };
}

async function withdrawOffer(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['prestataire']);
  const r = await ctx.db.one(
    "UPDATE offers SET status = 'withdrawn' WHERE id = $1 AND provider_id = $2 AND status = 'pending' RETURNING id",
    [int(ctx.params.id, { min: 1 }), u.id]);
  if (!r) fail(400, 'Offre introuvable ou déjà traitée');
  return { success: true };
}

async function listOffers(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client', 'admin']);
  const sr = await loadRequest(ctx.db, ctx.params.id);
  if (u.role !== 'admin' && sr.client_id !== u.id) fail(403, 'Accès non autorisé');
  const rows = await ctx.db.query(
    `SELECT o.id, o.amount, o.message, o.status, o.created_at, u.first_name, u.last_name, u.photo_file_id,
       p.business_name, p.experience_years, p.certification, p.description, p.rating_avg, p.rating_count, p.plan,
       (SELECT count(*)::int FROM service_requests x WHERE x.provider_id = u.id AND x.status = 'completed') AS missions_done
     FROM offers o JOIN users u ON u.id = o.provider_id JOIN providers p ON p.user_id = u.id
     WHERE o.request_id = $1 AND o.status IN ('pending','accepted') ORDER BY o.amount ASC`, [sr.id]);
  return {
    success: true,
    offers: rows.map(r => ({
      id: r.id, amount: r.amount, message: r.message, status: r.status, created_at: r.created_at,
      provider: {
        name: `${r.first_name} ${r.last_name.charAt(0)}.`.trim(), business_name: r.business_name,
        experience_years: r.experience_years, certification: r.certification, description: r.description,
        rating_avg: Number(r.rating_avg), rating_count: r.rating_count, plan: r.plan, missions_done: r.missions_done,
        photo_url: r.photo_file_id ? `/api/files/${r.photo_file_id}` : null,
      },
    })),
  };
}

async function acceptOffer(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client']);
  const offerId = int(ctx.params.id, { min: 1 });
  const out = await ctx.db.tx(async t => {
    const o = await t.one('SELECT * FROM offers WHERE id = $1 FOR UPDATE', [offerId]);
    if (!o || o.status !== 'pending') fail(400, "Cette offre n'est plus disponible");
    const sr = await t.one('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [o.request_id]);
    if (sr.client_id !== u.id) fail(403, 'Accès non autorisé');
    if (sr.status !== 'open') fail(400, 'Une offre a déjà été retenue pour cette demande');
    await t.query("UPDATE offers SET status = 'accepted' WHERE id = $1", [o.id]);
    await t.query("UPDATE offers SET status = 'rejected' WHERE request_id = $1 AND id <> $2 AND status = 'pending'", [sr.id, o.id]);
    await t.query(
      "UPDATE service_requests SET status = 'accepted', provider_id = $2, accepted_offer_id = $3, agreed_amount = $4, updated_at = now() WHERE id = $1",
      [sr.id, o.provider_id, o.id, o.amount]);
    const pay = await createPayment(t, { userId: u.id, purpose: 'prestation', amount: o.amount, relatedId: sr.id });
    return pay;
  });
  return { success: true, payment_ref: out.ref };
}

// Renvoie la référence du paiement en attente pour une demande (frais ou prestation)
async function pendingPayment(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client']);
  const sr = await loadRequest(ctx.db, ctx.params.id);
  if (sr.client_id !== u.id) fail(403, 'Accès non autorisé');
  const purpose = sr.status === 'awaiting_payment' ? 'mise_en_relation' : sr.status === 'accepted' ? 'prestation' : null;
  if (!purpose) fail(400, 'Aucun paiement attendu pour cette demande');
  let p = await ctx.db.one(
    "SELECT ref FROM payments WHERE related_id = $1 AND purpose = $2 AND status IN ('pending','processing','submitted') ORDER BY id DESC LIMIT 1",
    [sr.id, purpose]);
  if (!p) {
    p = await createPayment(ctx.db, {
      userId: u.id, purpose, amount: purpose === 'prestation' ? sr.agreed_amount : MATCHING_FEE, relatedId: sr.id,
    });
  }
  return { success: true, payment_ref: p.ref };
}

async function markDone(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['prestataire']);
  const r = await ctx.db.one(
    "UPDATE service_requests SET status = 'done', updated_at = now() WHERE id = $1 AND provider_id = $2 AND status = 'in_progress' RETURNING id",
    [int(ctx.params.id, { min: 1 }), u.id]);
  if (!r) fail(400, "La mission doit être payée et en cours pour être déclarée terminée");
  return { success: true };
}

// Crédite le prestataire (montant moins commission). À appeler dans une transaction.
async function releaseToProvider(t, sr, note) {
  const commission = Math.round(sr.agreed_amount * Number(sr.commission_rate));
  const net = sr.agreed_amount - commission;
  await t.query(
    "UPDATE service_requests SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1",
    [sr.id]);
  await t.query(
    "INSERT INTO ledger (user_id, amount, kind, request_id, note) VALUES ($1, $2, 'gain', $3, $4)",
    [sr.provider_id, net, sr.id, note || `Mission n°${sr.id} (commission ${commission} FCFA)`]);
  return { commission, net };
}

async function saveReview(t, sr, rating, comment) {
  const ins = await t.one(
    `INSERT INTO reviews (request_id, client_id, provider_id, rating, comment) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (request_id) DO NOTHING RETURNING id`,
    [sr.id, sr.client_id, sr.provider_id, rating, comment]);
  if (ins) {
    await t.query(
      `UPDATE providers SET rating_count = rating_count + 1,
         rating_avg = round(((rating_avg * rating_count) + $2) / (rating_count + 1), 2)
       WHERE user_id = $1`, [sr.provider_id, rating]);
  }
}

async function confirmCompletion(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client']);
  const b = await ctx.body();
  const rating = int(b.rating, { min: 1, max: 5, name: 'note' });
  const comment = str(b.comment, { max: 1000, name: 'commentaire' });
  const out = await ctx.db.tx(async t => {
    const sr = await t.one('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [int(ctx.params.id, { min: 1 })]);
    if (!sr) fail(404, 'Demande introuvable');
    if (sr.client_id !== u.id) fail(403, 'Accès non autorisé');
    if (!['in_progress', 'done'].includes(sr.status)) fail(400, 'Cette mission ne peut pas être validée maintenant');
    const r = await releaseToProvider(t, sr);
    if (rating) await saveReview(t, sr, rating, comment);
    return r;
  });
  return { success: true, ...out };
}

async function review(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client']);
  const b = await ctx.body();
  const rating = int(b.rating, { min: 1, max: 5, required: true, name: 'note' });
  const sr = await loadRequest(ctx.db, ctx.params.id);
  if (sr.client_id !== u.id) fail(403, 'Accès non autorisé');
  if (sr.status !== 'completed') fail(400, 'Vous pourrez noter le prestataire une fois la mission validée');
  await ctx.db.tx(t => saveReview(t, sr, rating, str(b.comment, { max: 1000 })));
  return { success: true };
}

async function openDispute(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['client', 'prestataire']);
  const b = await ctx.body();
  const reason = str(b.reason, { max: 2000, required: true, name: 'motif' });
  await ctx.db.tx(async t => {
    const sr = await t.one('SELECT * FROM service_requests WHERE id = $1 FOR UPDATE', [int(ctx.params.id, { min: 1 })]);
    if (!sr) fail(404, 'Demande introuvable');
    if (sr.client_id !== u.id && sr.provider_id !== u.id) fail(403, 'Accès non autorisé');
    if (!['in_progress', 'done'].includes(sr.status)) fail(400, 'Un litige ne peut être ouvert que pendant une mission payée');
    await t.query("UPDATE service_requests SET status = 'dispute', updated_at = now() WHERE id = $1", [sr.id]);
    await t.query('INSERT INTO disputes (request_id, opened_by, reason) VALUES ($1, $2, $3)', [sr.id, u.id, reason]);
  });
  return { success: true };
}

// ---- Portefeuille ----

async function wallet(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['prestataire']);
  const balance = await ctx.db.one('SELECT COALESCE(sum(amount),0)::int AS b FROM ledger WHERE user_id = $1', [u.id]);
  const held = await ctx.db.one(
    "SELECT COALESCE(sum(agreed_amount - round(agreed_amount * commission_rate)),0)::int AS h FROM service_requests WHERE provider_id = $1 AND status IN ('in_progress','done','dispute')",
    [u.id]);
  const entries = await ctx.db.query('SELECT amount, kind, note, created_at FROM ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [u.id]);
  const withdrawals = await ctx.db.query('SELECT id, amount, method, phone, status, external_ref, created_at, processed_at FROM withdrawals WHERE provider_id = $1 ORDER BY id DESC LIMIT 50', [u.id]);
  return { success: true, balance: balance.b, held: held.h, entries, withdrawals };
}

async function requestWithdrawal(ctx) {
  const u = await requireUser(ctx.req, ctx.db, ['prestataire']);
  const b = await ctx.body();
  const amount = int(b.amount, { min: 1000, max: 100000000, required: true, name: 'montant' });
  const method = oneOf(b.method, ['tmoney', 'flooz'], 'moyen de retrait');
  const tel = require('../http').phone(b.phone || u.phone);
  const w = await ctx.db.tx(async t => {
    await t.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [u.id]); // évite deux retraits simultanés
    const bal = await t.one('SELECT COALESCE(sum(amount),0)::int AS b FROM ledger WHERE user_id = $1', [u.id]);
    if (amount > bal.b) fail(400, `Solde insuffisant (disponible : ${bal.b} FCFA)`);
    const w = await t.one(
      'INSERT INTO withdrawals (provider_id, amount, method, phone) VALUES ($1, $2, $3, $4) RETURNING *',
      [u.id, amount, method, tel]);
    await t.query(
      "INSERT INTO ledger (user_id, amount, kind, withdrawal_id, note) VALUES ($1, $2, 'retrait', $3, 'Demande de retrait')",
      [u.id, -amount, w.id]);
    return w;
  });
  return { success: true, withdrawal: w };
}

module.exports = {
  routes: [
    ['POST', '/service-requests', createRequest],
    ['GET', '/service-requests/mine', myRequests],
    ['GET', '/service-requests/:id', getRequest],
    ['POST', '/service-requests/:id/cancel', cancelRequest],
    ['GET', '/service-requests/:id/offers', listOffers],
    ['POST', '/service-requests/:id/offers', makeOffer],
    ['POST', '/service-requests/:id/payment', pendingPayment],
    ['POST', '/service-requests/:id/done', markDone],
    ['POST', '/service-requests/:id/confirm', confirmCompletion],
    ['POST', '/service-requests/:id/review', review],
    ['POST', '/service-requests/:id/dispute', openDispute],
    ['POST', '/offers/:id/accept', acceptOffer],
    ['POST', '/offers/:id/withdraw', withdrawOffer],
    ['GET', '/provider/requests', openRequestsForProvider],
    ['GET', '/provider/missions', providerMissions],
    ['GET', '/provider/wallet', wallet],
    ['POST', '/provider/withdrawals', requestWithdrawal],
  ],
  releaseToProvider,
};
