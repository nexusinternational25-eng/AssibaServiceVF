// Test de bout en bout de l'API sur une base locale.
// Usage : BASE=http://localhost:3100 ADMIN_PHONE=90000000 ADMIN_PASSWORD=... node scripts/test-api.js
const BASE = process.env.BASE || 'http://localhost:3000';
let failures = 0;
const stamp = Date.now().toString().slice(-6);

function check(cond, label, extra) {
  if (cond) console.log('  ok   ' + label);
  else { failures++; console.log('  ÉCHEC ' + label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); }
}

async function call(method, path, body, token) {
  const r = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.arrayBuffer();
  return { status: r.status, data };
}

// Petite image JPEG valide (1x1)
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

(async () => {
  console.log('Comptes');
  const cPhone = '91' + stamp;
  const pPhone = '92' + stamp;
  let r = await call('POST', '/auth/register', {
    role: 'client', firstName: 'Ama', lastName: 'Test', email: `ama${stamp}@exemple.tg`, phone: cPhone,
    address: 'Bè, Lomé', password: 'motdepasse1',
  });
  check(r.status === 200 && r.data.token, 'inscription client', r.data);
  const clientToken = r.data.token;

  r = await call('POST', '/auth/register', { role: 'client', firstName: 'X', lastName: 'Y', phone: cPhone, password: 'motdepasse1' });
  check(r.status === 409, 'doublon de téléphone refusé', r.data);

  r = await call('POST', '/auth/register', { role: 'client', firstName: 'X', lastName: 'Y', phone: '93' + stamp, password: 'court' });
  check(r.status === 400, 'mot de passe trop court refusé', r.data);

  r = await call('POST', '/auth/register', {
    role: 'prestataire', first_name: 'Kofi', last_name: 'Plombier', phone: pPhone, email: `kofi${stamp}@exemple.tg`,
    password: 'motdepasse2', categories: ['plomberie', 'xss<script>'], subscription_plan: 'pro', business_name: 'Kofi Services',
  });
  check(r.status === 200 && r.data.payment_ref, 'inscription prestataire avec paiement', r.data);
  let providerToken = r.data.token;
  const regRef = r.data.payment_ref;

  r = await call('POST', '/auth/login', { emailOrPhone: '+228 ' + cPhone, password: 'motdepasse1' });
  check(r.status === 200 && r.data.user.role === 'client', 'connexion par téléphone', r.data);
  r = await call('POST', '/auth/login', { emailOrPhone: `AMA${stamp}@exemple.tg`, password: 'motdepasse1' });
  check(r.status === 200, 'connexion par e-mail (majuscules)', r.data);
  r = await call('POST', '/auth/login', { emailOrPhone: cPhone, password: 'faux' });
  check(r.status === 401, 'mauvais mot de passe refusé', r.data);

  r = await call('GET', '/auth/me', null, providerToken);
  check(r.data.provider && r.data.provider.categories.length === 1, 'catégorie inconnue ignorée', r.data.provider);
  check(r.data.user.status === 'pending', 'prestataire en attente de validation', r.data.user);

  r = await call('GET', '/auth/me', null, clientToken + 'x');
  check(r.status === 401, 'jeton falsifié refusé', r.data);

  r = await call('POST', '/users/upload-photo', { photo: JPEG }, clientToken);
  check(r.status === 200 && r.data.photo_url, 'photo de profil', r.data);
  r = await call('POST', '/users/upload-photo', { photo: 'data:image/jpeg;base64,PHNjcmlwdD4=' }, clientToken);
  check(r.status === 400, 'faux fichier image refusé', r.data);
  r = await call('POST', '/provider/id-document', { document: JPEG }, providerToken);
  check(r.status === 200, "pièce d'identité", r.data);

  console.log('Admin');
  r = await call('POST', '/auth/login', { emailOrPhone: process.env.ADMIN_PHONE, password: process.env.ADMIN_PASSWORD });
  check(r.status === 200 && r.data.user.role === 'admin', 'connexion admin', r.data);
  const adminToken = r.data.token;
  r = await call('GET', '/admin/overview', null, clientToken);
  check(r.status === 403, 'client exclu de l\'admin', r.data);

  console.log('Paiement inscription prestataire (mode manuel)');
  r = await call('GET', `/payments/${regRef}`, null, clientToken);
  check(r.status === 403, "un autre compte ne voit pas le paiement", r.data);
  r = await call('GET', `/payments/${regRef}`, null, providerToken);
  check(r.data.payment && r.data.payment.amount === 30000, 'montant fixé par le serveur (30 000)', r.data);
  r = await call('POST', `/payments/${regRef}/submit`, { method: 'tmoney', phone: pPhone, transaction_id: 'TM' + stamp }, providerToken);
  check(r.data.payment && r.data.payment.status === 'submitted', 'référence SMS déclarée', r.data);
  let pays = await call('GET', '/admin/payments?status=submitted', null, adminToken);
  const regPay = pays.data.payments.find(p => p.ref === regRef);
  r = await call('POST', `/admin/payments/${regPay.id}/confirm`, null, adminToken);
  check(r.status === 200, 'paiement confirmé par admin', r.data);
  r = await call('POST', `/admin/payments/${regPay.id}/confirm`, null, adminToken);
  check(r.status === 400, 'double confirmation impossible', r.data);
  r = await call('GET', '/auth/me', null, providerToken);
  check(r.data.provider.registration_paid && r.data.provider.plan === 'pro' && r.data.provider.plan_expires_at, 'abonnement Pro activé', r.data.provider);
  const months = (new Date(r.data.provider.plan_expires_at) - Date.now()) / (30 * 864e5);
  check(months > 1.8 && months < 2.2, 'Pro : 1 mois + 1 mois offert', months);

  r = await call('GET', '/provider/requests', null, providerToken);
  check(r.status === 403, 'prestataire non validé ne voit pas les demandes', r.data);
  const users = await call('GET', '/admin/users?role=prestataire&status=pending', null, adminToken);
  const prov = users.data.users.find(u => u.phone.endsWith(pPhone));
  r = await call('POST', `/admin/users/${prov.id}/status`, { status: 'active' }, adminToken);
  check(r.status === 200, 'prestataire validé', r.data);

  console.log('Demande de service');
  r = await call('POST', '/ai/budget-suggestion', { category: 'plomberie', service_type: 'depannage', is_urgent: true, description: 'Fuite sous évier' });
  check(r.data.suggestion && r.data.suggestion.min_budget > 0, 'suggestion de budget', r.data);
  r = await call('POST', '/service-requests', { category: 'plomberie', title: 'Fuite évier', description: 'Fuite sous l\'évier de la cuisine', address: 'Rue 12, Bè', service_type: 'depannage', photos: [JPEG] }, providerToken);
  check(r.status === 403, 'un prestataire ne peut pas publier de demande', r.data);
  r = await call('POST', '/service-requests', {
    category: 'plomberie', title: 'Fuite évier', description: 'Fuite sous l\'évier de la cuisine', address: 'Rue 12, Bè',
    service_type: 'chantier', budget_min: 10000, budget_max: 30000, photos: [JPEG], is_urgent: true,
  }, clientToken);
  check(r.status === 200 && r.data.payment_ref, 'demande créée', r.data);
  const reqId = r.data.request.id;
  const feeRef = r.data.payment_ref;
  r = await call('GET', `/payments/${feeRef}`, null, clientToken);
  check(r.data.payment.amount === 2000, 'frais de mise en relation : 2 000', r.data);

  r = await call('GET', '/provider/requests', null, providerToken);
  check(!r.data.requests.some(x => x.id === reqId), 'demande non payée invisible', r.data);
  await call('POST', `/payments/${feeRef}/submit`, { method: 'flooz', phone: cPhone, transaction_id: 'FL' + stamp }, clientToken);
  r = await call('POST', `/payments/${feeRef}/submit`, { method: 'tmoney', phone: cPhone, transaction_id: 'TM' + stamp }, clientToken);
  check(r.status === 409, 'référence de transaction réutilisée refusée', r.data);
  pays = await call('GET', '/admin/payments?status=submitted', null, adminToken);
  await call('POST', `/admin/payments/${pays.data.payments.find(p => p.ref === feeRef).id}/confirm`, null, adminToken);

  r = await call('GET', '/provider/requests', null, providerToken);
  const seen = r.data.requests.find(x => x.id === reqId);
  check(seen && !seen.address && !seen.client, 'demande visible sans adresse ni contact', seen);
  check(seen && seen.photos.length === 1, 'photo de la demande listée', seen);
  const photo = await fetch(BASE + seen.photos[0], { headers: { Authorization: 'Bearer ' + providerToken } });
  check(photo.status === 200 && photo.headers.get('content-type') === 'image/jpeg', 'photo accessible au prestataire', photo.status);
  const anon = await fetch(BASE + seen.photos[0]);
  check(anon.status === 401, 'photo inaccessible sans connexion', anon.status);

  console.log('Offre, séquestre, validation');
  r = await call('POST', `/service-requests/${reqId}/offers`, { amount: 20000, message: 'Je passe demain matin' }, providerToken);
  check(r.status === 200, 'offre envoyée', r.data);
  r = await call('GET', `/service-requests/${reqId}/offers`, null, clientToken);
  check(r.data.offers.length === 1 && !r.data.offers[0].provider.phone, 'client voit l\'offre sans le téléphone', r.data.offers);
  const offerId = r.data.offers[0].id;
  r = await call('POST', `/offers/${offerId}/accept`, null, clientToken);
  check(r.status === 200 && r.data.payment_ref, 'offre acceptée', r.data);
  const escrowRef = r.data.payment_ref;
  r = await call('GET', `/payments/${escrowRef}`, null, clientToken);
  check(r.data.payment.amount === 20000, 'montant de la prestation = offre', r.data);
  r = await call('POST', `/service-requests/${reqId}/done`, null, providerToken);
  check(r.status === 400, 'impossible de terminer avant paiement', r.data);
  await call('POST', `/payments/${escrowRef}/submit`, { method: 'tmoney', phone: cPhone, transaction_id: 'TX' + stamp }, clientToken);
  pays = await call('GET', '/admin/payments?status=submitted', null, adminToken);
  await call('POST', `/admin/payments/${pays.data.payments.find(p => p.ref === escrowRef).id}/confirm`, null, adminToken);
  r = await call('GET', `/service-requests/${reqId}`, null, providerToken);
  check(r.data.request.status === 'in_progress' && r.data.request.client.phone, 'mission en cours, contact client visible', r.data.request.status);
  r = await call('POST', `/service-requests/${reqId}/done`, null, providerToken);
  check(r.status === 200, 'mission déclarée terminée', r.data);
  r = await call('POST', `/service-requests/${reqId}/confirm`, { rating: 5, comment: 'Très bien' }, clientToken);
  check(r.status === 200 && r.data.commission === 1000 && r.data.net === 19000, 'validation : commission 5 % (1 000), net 19 000', r.data);
  r = await call('POST', `/service-requests/${reqId}/confirm`, null, clientToken);
  check(r.status === 400, 'double validation impossible', r.data);

  console.log('Portefeuille et retrait');
  r = await call('GET', '/provider/wallet', null, providerToken);
  check(r.data.balance === 19000, 'solde 19 000', r.data);
  r = await call('POST', '/provider/withdrawals', { amount: 50000, method: 'tmoney' }, providerToken);
  check(r.status === 400, 'retrait supérieur au solde refusé', r.data);
  const [w1, w2] = await Promise.all([
    call('POST', '/provider/withdrawals', { amount: 15000, method: 'tmoney' }, providerToken),
    call('POST', '/provider/withdrawals', { amount: 15000, method: 'tmoney' }, providerToken),
  ]);
  check([w1.status, w2.status].sort().join() === '200,400', 'deux retraits simultanés : un seul accepté', [w1.data, w2.data]);
  r = await call('GET', '/provider/wallet', null, providerToken);
  check(r.data.balance === 4000, 'solde après retrait 4 000', r.data.balance);
  const ws = await call('GET', '/admin/withdrawals', null, adminToken);
  const wid = ws.data.withdrawals.find(w => w.status === 'pending').id;
  r = await call('POST', `/admin/withdrawals/${wid}/reject`, { note: 'Numéro erroné' }, adminToken);
  r = await call('GET', '/provider/wallet', null, providerToken);
  check(r.data.balance === 19000, 'retrait refusé : montant recrédité', r.data.balance);
  r = await call('GET', '/auth/me', null, providerToken);
  check(r.data.provider.rating_avg === 5 && r.data.provider.rating_count === 1, 'note du prestataire enregistrée', r.data.provider);

  console.log('Litige');
  r = await call('POST', '/service-requests', { category: 'plomberie', title: 'Robinet', description: 'Robinet à changer', address: 'Adidogomé', service_type: 'depannage' }, clientToken);
  const req2 = r.data.request.id;
  await call('POST', `/payments/${r.data.payment_ref}/submit`, { method: 'tmoney', phone: cPhone, transaction_id: 'A1' + stamp }, clientToken);
  pays = await call('GET', '/admin/payments?status=submitted', null, adminToken);
  await call('POST', `/admin/payments/${pays.data.payments[0].id}/confirm`, null, adminToken);
  await call('POST', `/service-requests/${req2}/offers`, { amount: 8000 }, providerToken);
  r = await call('GET', `/service-requests/${req2}/offers`, null, clientToken);
  r = await call('POST', `/offers/${r.data.offers[0].id}/accept`, null, clientToken);
  const ref2 = r.data.payment_ref;
  await call('POST', `/payments/${ref2}/submit`, { method: 'tmoney', phone: cPhone, transaction_id: 'A2' + stamp }, clientToken);
  pays = await call('GET', '/admin/payments?status=submitted', null, adminToken);
  await call('POST', `/admin/payments/${pays.data.payments[0].id}/confirm`, null, adminToken);
  r = await call('POST', `/service-requests/${req2}/dispute`, { reason: 'Le prestataire n\'est pas venu' }, clientToken);
  check(r.status === 200, 'litige ouvert', r.data);
  const ds = await call('GET', '/admin/disputes', null, adminToken);
  const d = ds.data.disputes.find(x => x.request_id === req2);
  r = await call('POST', `/admin/disputes/${d.id}/resolve`, { decision: 'refund', resolution: 'Client remboursé' }, adminToken);
  check(r.status === 200, 'litige tranché (remboursement)', r.data);
  r = await call('GET', `/service-requests/${req2}`, null, clientToken);
  check(r.data.request.status === 'refunded', 'demande remboursée', r.data.request.status);
  r = await call('GET', '/provider/wallet', null, providerToken);
  check(r.data.balance === 19000, 'solde prestataire inchangé après remboursement', r.data.balance);

  console.log('Accès croisés');
  r = await call('POST', '/auth/register', { role: 'client', firstName: 'Autre', lastName: 'Client', phone: '94' + stamp, password: 'motdepasse3' });
  const other = r.data.token;
  r = await call('GET', `/service-requests/${reqId}`, null, other);
  check(r.status === 403, "un autre client ne voit pas la demande", r.data);
  r = await call('POST', `/service-requests/${req2}/cancel`, null, other);
  check(r.status === 403, "un autre client ne peut pas annuler", r.data);

  console.log('Abonnement et assurance');
  r = await call('POST', '/subscriptions/subscribe', { plan_type: 'basic', name: 'Yao', phone: '95' + stamp, terms_accepted: true });
  check(r.status === 200 && r.data.payment_url, 'abonnement Basic créé', r.data);
  r = await call('GET', `/payments/${r.data.payment_ref}`);
  check(r.data.payment.amount === 8000, 'abonnement Basic : 8 000', r.data);
  r = await call('POST', '/insurance/subscribe', { insurance_type: 'pack_complet', name: 'Yao', phone: '95' + stamp, terms_accepted: true });
  check(r.status === 200, 'souscription assurance', r.data);
  r = await call('GET', `/payments/${r.data.payment_ref}`);
  check(r.data.payment.amount === 11500, 'Pack complet : 11 500', r.data);
  r = await call('GET', '/insurance/partners');
  check(r.data.partners.length >= 3, 'partenaires assurance', r.data);

  console.log('Mot de passe oublié');
  r = await call('POST', '/auth/forgot-password', { emailOrPhone: cPhone });
  check(r.status === 200, 'demande enregistrée', r.data);
  r = await call('GET', '/admin/password-requests', null, adminToken);
  const pr = r.data.requests.find(x => x.phone.endsWith(cPhone));
  check(!!pr, 'demande visible par l\'admin', r.data);
  r = await call('POST', `/admin/users/${pr.user_id}/reset-link`, null, adminToken);
  const token = new URL(r.data.link).searchParams.get('token');
  r = await call('GET', `/auth/verify-reset-token/${token}`);
  check(r.data.success, 'lien valide', r.data);
  r = await call('POST', '/auth/reset-password', { token, newPassword: 'nouveaumdp1', confirmPassword: 'nouveaumdp1' });
  check(r.status === 200, 'mot de passe changé', r.data);
  r = await call('GET', '/auth/me', null, clientToken);
  check(r.status === 401, 'anciennes sessions déconnectées', r.status);
  r = await call('POST', '/auth/reset-password', { token, newPassword: 'encoreunautre1' });
  check(r.status === 400, 'lien utilisable une seule fois', r.data);
  r = await call('POST', '/auth/login', { emailOrPhone: cPhone, password: 'nouveaumdp1' });
  check(r.status === 200, 'connexion avec le nouveau mot de passe', r.data);

  console.log('Limitation des tentatives');
  let last;
  for (let i = 0; i < 9; i++) last = await call('POST', '/auth/login', { emailOrPhone: '97' + stamp, password: 'x' });
  check(last.status === 429, 'blocage après 8 échecs', last.data);

  r = await call('GET', '/admin/overview', null, adminToken);
  check(r.status === 200 && r.data.revenue, 'tableau de bord admin', r.data.revenue);
  check(Number(r.data.revenue.commissions) >= 1000, 'commission comptée dans le chiffre d\'affaires', r.data.revenue);

  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
