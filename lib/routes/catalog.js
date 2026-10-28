// Catalogue public : catégories, suggestion de budget, abonnements, assurance.
const { fail, str, int, phone, email, oneOf } = require('../http');
const { currentUser } = require('../auth');
const { createPayment } = require('../payments');
const C = require('../config');

async function categories() {
  return {
    success: true,
    categories: Object.entries(C.CATEGORIES).map(([id, label]) => ({ id, label })),
    matching_fee: C.MATCHING_FEE,
    commission: C.COMMISSION,
    plans: C.PLANS,
    insurance: C.INSURANCE,
  };
}

// Estimation à partir d'une grille de prix observés, ajustée selon le type et l'urgence
async function budgetSuggestion(ctx) {
  const b = await ctx.body();
  const category = C.BUDGET_GRID[b.category] ? b.category : 'autres';
  const type = C.SERVICE_TYPE_FACTOR[b.service_type] ? b.service_type : 'depannage';
  const [lo, hi] = C.BUDGET_GRID[category];
  const t = C.SERVICE_TYPE_FACTOR[type];
  const desc = String(b.description || '').toLowerCase();
  const factors = [`catégorie ${C.CATEGORIES[category].toLowerCase()}`, t.label];
  let mult = t.factor;
  if (b.is_urgent === true || b.is_urgent === 'true') { mult *= 1.3; factors.push('intervention urgente (+30 %)'); }
  const bigWords = ['maison', 'villa', 'immeuble', 'complet', 'complète', 'toute', 'plusieurs', 'rénovation', 'installation'];
  if (bigWords.some(w => desc.includes(w))) { mult *= 1.5; factors.push('ampleur des travaux décrite'); }
  const round = v => Math.max(1000, Math.round(v / 500) * 500);
  return {
    success: true,
    suggestion: {
      min_budget: round(lo * mult),
      max_budget: round(hi * mult),
      confidence: desc.length > 80 ? 0.75 : 0.6,
      factors,
    },
  };
}

// Abonnement prestataire (page Abonnements). Si le visiteur est connecté
// en tant que prestataire, l'abonnement est rattaché à son compte.
async function subscribe(ctx) {
  const b = await ctx.body();
  const plan = oneOf(b.plan_type, Object.keys(C.PLANS), 'formule');
  if (b.terms_accepted !== true) fail(400, 'Vous devez accepter les conditions');
  const u = await currentUser(ctx.req, ctx.db);
  const userId = u && u.role === 'prestataire' ? u.id : null;
  const name = str(b.name || (u && `${u.first_name} ${u.last_name}`), { max: 120, required: true, name: 'nom' });
  const tel = phone(b.phone || (u && u.phone));
  const mail = email(b.email);
  const details = {
    business_category: str(b.business_category, { max: 60 }), other_category: str(b.other_category, { max: 120 }),
    experience_years: str(b.experience_years, { max: 20 }), business_size: str(b.business_size, { max: 40 }),
    marketing_consent: b.marketing_consent === true,
  };
  const out = await ctx.db.tx(async t => {
    const sub = await t.one(
      'INSERT INTO subscriptions (user_id, plan, name, phone, email, details) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [userId, plan, name, tel, mail, JSON.stringify(details)]);
    const pay = await createPayment(t, { userId, purpose: 'abonnement', amount: C.PLANS[plan].amount, relatedId: sub.id });
    await t.query('UPDATE subscriptions SET payment_id = $1 WHERE id = $2', [pay.id, sub.id]);
    return pay;
  });
  return { success: true, payment_ref: out.ref, payment_url: `paiement.html?ref=${out.ref}` };
}

async function insurancePartners(ctx) {
  const rows = await ctx.db.query('SELECT id, name, logo, description, active FROM insurance_partners WHERE active ORDER BY sort, name');
  return { success: true, partners: rows };
}

async function insuranceSubscribe(ctx) {
  const b = await ctx.body();
  const type = oneOf(b.insurance_type, Object.keys(C.INSURANCE), "type d'assurance");
  if (b.terms_accepted !== true) fail(400, 'Vous devez accepter les conditions');
  const u = await currentUser(ctx.req, ctx.db);
  const name = str(b.name, { max: 120, required: true, name: 'nom' });
  const tel = phone(b.phone);
  const mail = email(b.email);
  const amount = C.INSURANCE[type].amount;
  const details = {
    other_activity: str(b.other_activity, { max: 120 }),
    preferred_payment: str(b.payment_method, { max: 30 }),
    partner_id: str(b.partner_id, { max: 40 }) || null,
  };
  const out = await ctx.db.tx(async t => {
    const ins = await t.one(
      `INSERT INTO insurance_subscriptions (user_id, insurance_type, name, phone, email, business_type, details, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [u ? u.id : null, type, name, tel, mail, str(b.business_type, { max: 60 }), JSON.stringify(details), amount]);
    const pay = await createPayment(t, { userId: u ? u.id : null, purpose: 'assurance', amount, relatedId: ins.id });
    await t.query('UPDATE insurance_subscriptions SET payment_id = $1 WHERE id = $2', [pay.id, ins.id]);
    return pay;
  });
  return { success: true, payment_ref: out.ref, payment_url: `paiement.html?ref=${out.ref}` };
}

// Chiffres publics affichés sur le site (aucune donnée personnelle)
async function publicStats(ctx) {
  const r = await ctx.db.one(
    `SELECT (SELECT count(*)::int FROM users WHERE role = 'prestataire' AND status = 'active') AS providers,
            (SELECT count(*)::int FROM service_requests WHERE status = 'completed') AS missions`);
  return { success: true, stats: r };
}

module.exports = {
  routes: [
    ['GET', '/categories', categories],
    ['POST', '/ai/budget-suggestion', budgetSuggestion],
    ['POST', '/subscriptions/subscribe', subscribe],
    ['GET', '/insurance/partners', insurancePartners],
    ['POST', '/insurance/subscribe', insuranceSubscribe],
    ['GET', '/stats', publicStats],
  ],
};
