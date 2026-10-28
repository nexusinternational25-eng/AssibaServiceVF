// Comptes : inscription, connexion, profil, mot de passe oublié, fichiers.
const { fail, str, int, phone, email, oneOf } = require('../http');
const A = require('../auth');
const { saveFile } = require('../files');
const { PLANS, CATEGORIES } = require('../config');
const { createPayment } = require('../payments');
const { sendMail, siteUrl } = require('../mail');

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, role: u.role, first_name: u.first_name, last_name: u.last_name,
    name: `${u.first_name} ${u.last_name}`.trim(), email: u.email, phone: u.phone,
    address: u.address, city: u.city, status: u.status,
    photo_url: u.photo_file_id ? `/api/files/${u.photo_file_id}` : null,
    created_at: u.created_at,
  };
}

async function balanceOf(db, userId) {
  const r = await db.one('SELECT COALESCE(sum(amount), 0)::int AS b FROM ledger WHERE user_id = $1', [userId]);
  return r.b;
}

async function register(ctx) {
  const b = await ctx.body();
  const role = oneOf(b.role, ['client', 'prestataire'], 'type de compte');
  const firstName = str(b.firstName || b.first_name, { max: 80, required: true, name: 'prénom' });
  const lastName = str(b.lastName || b.last_name, { max: 80, required: true, name: 'nom' });
  const tel = phone(b.phone);
  const mail = email(b.email);
  const address = str(b.address, { max: 300, name: 'adresse' });
  const city = str(b.city, { max: 80, name: 'ville' }) || 'Lomé';
  A.checkPasswordStrength(b.password);

  let categories = [];
  let plan = null;
  if (role === 'prestataire') {
    categories = Array.isArray(b.categories) ? b.categories.filter(c => CATEGORIES[c]) : [];
    if (!categories.length) fail(400, 'Choisissez au moins une catégorie de service');
    plan = oneOf(b.subscription_plan || 'standard', Object.keys(PLANS), 'abonnement');
  }

  const dup = await ctx.db.one(
    'SELECT phone, email FROM users WHERE phone = $1 OR ($2::text IS NOT NULL AND lower(email) = $2)',
    [tel, mail]
  );
  if (dup) fail(409, dup.phone === tel ? 'Ce numéro de téléphone est déjà utilisé' : 'Cette adresse e-mail est déjà utilisée');

  const out = await ctx.db.tx(async t => {
    const user = await t.one(
      `INSERT INTO users (role, first_name, last_name, email, phone, address, city, password_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [role, firstName, lastName, mail, tel, address, city, A.hashPassword(b.password), role === 'client' ? 'active' : 'pending']
    );
    let payment = null;
    if (role === 'prestataire') {
      await t.query(
        `INSERT INTO providers (user_id, business_name, experience_years, certification, description, categories, other_category, plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [user.id, str(b.business_name, { max: 120 }), str(b.experience_years, { max: 20 }),
          str(b.certification, { max: 200 }), str(b.description, { max: 2000 }), categories,
          str(b.other_category_detail, { max: 120 }), plan]
      );
      const sub = await t.one(
        `INSERT INTO subscriptions (user_id, plan, name, phone, email) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [user.id, plan, `${firstName} ${lastName}`, tel, mail]
      );
      payment = await createPayment(t, { userId: user.id, purpose: 'inscription', amount: PLANS[plan].amount, relatedId: sub.id });
      await t.query('UPDATE subscriptions SET payment_id = $1 WHERE id = $2', [payment.id, sub.id]);
    }
    return { user, payment };
  });

  return {
    success: true,
    user_id: out.user.id,
    user: publicUser(out.user),
    token: A.signToken(out.user),
    payment_ref: out.payment ? out.payment.ref : null,
  };
}

async function login(ctx) {
  const b = await ctx.body();
  const ident = str(b.emailOrPhone || b.email || b.phone, { max: 200, required: true, name: 'identifiant' }).toLowerCase();
  const password = String(b.password || '');
  const keys = ['id:' + ident, 'ip:' + ctx.ip];
  await A.checkRateLimit(ctx.db, keys);

  let user = null;
  if (ident.includes('@')) {
    user = await ctx.db.one('SELECT * FROM users WHERE lower(email) = $1', [ident]);
  } else {
    let tel = null;
    try { tel = phone(ident); } catch (_) { tel = null; }
    if (tel) user = await ctx.db.one('SELECT * FROM users WHERE phone = $1', [tel]);
  }
  const ok = user && A.verifyPassword(password, user.password_hash);
  await A.recordAttempt(ctx.db, keys, !!ok);
  if (!ok) fail(401, 'Identifiant ou mot de passe incorrect');
  if (user.status === 'suspended') fail(403, 'Ce compte est suspendu. Contactez le support.');
  await ctx.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return { success: true, token: A.signToken(user), user: publicUser(user) };
}

async function me(ctx) {
  const u = await A.requireUser(ctx.req, ctx.db);
  const out = { success: true, user: publicUser(u) };
  if (u.role === 'prestataire') {
    const p = await ctx.db.one('SELECT * FROM providers WHERE user_id = $1', [u.id]);
    const pendingPay = await ctx.db.one(
      `SELECT ref, amount, status FROM payments WHERE user_id = $1 AND purpose IN ('inscription','abonnement')
       AND status IN ('pending','processing','submitted') ORDER BY id DESC LIMIT 1`, [u.id]);
    out.provider = {
      business_name: p.business_name, description: p.description, categories: p.categories,
      experience_years: p.experience_years, certification: p.certification,
      plan: p.plan, plan_expires_at: p.plan_expires_at, registration_paid: p.registration_paid,
      id_document_uploaded: !!p.id_document_file_id, verified: !!p.verified_at,
      rating_avg: Number(p.rating_avg), rating_count: p.rating_count,
      pending_payment: pendingPay,
    };
    out.balance = await balanceOf(ctx.db, u.id);
  }
  return out;
}

async function updateMe(ctx) {
  const u = await A.requireUser(ctx.req, ctx.db);
  const b = await ctx.body();
  const mail = b.email !== undefined ? email(b.email) : u.email;
  if (mail && mail !== u.email) {
    const dup = await ctx.db.one('SELECT id FROM users WHERE lower(email) = $1 AND id <> $2', [mail, u.id]);
    if (dup) fail(409, 'Cette adresse e-mail est déjà utilisée');
  }
  await ctx.db.query(
    'UPDATE users SET first_name = $2, last_name = $3, email = $4, address = $5, city = $6 WHERE id = $1',
    [u.id,
      str(b.first_name ?? u.first_name, { max: 80, required: true, name: 'prénom' }),
      str(b.last_name ?? u.last_name, { max: 80, name: 'nom' }),
      mail,
      str(b.address ?? u.address, { max: 300, name: 'adresse' }),
      str(b.city ?? u.city, { max: 80, name: 'ville' })]
  );
  if (u.role === 'prestataire' && (b.categories || b.description !== undefined || b.business_name !== undefined)) {
    const p = await ctx.db.one('SELECT * FROM providers WHERE user_id = $1', [u.id]);
    let cats = p.categories;
    if (Array.isArray(b.categories)) {
      cats = b.categories.filter(c => CATEGORIES[c]);
      if (!cats.length) fail(400, 'Choisissez au moins une catégorie de service');
    }
    await ctx.db.query(
      'UPDATE providers SET categories = $2, description = $3, business_name = $4 WHERE user_id = $1',
      [u.id, cats, str(b.description ?? p.description, { max: 2000 }), str(b.business_name ?? p.business_name, { max: 120 })]
    );
  }
  return me(ctx);
}

async function changePassword(ctx) {
  const u = await A.requireUser(ctx.req, ctx.db);
  const b = await ctx.body();
  if (!A.verifyPassword(String(b.current_password || ''), u.password_hash)) fail(400, 'Mot de passe actuel incorrect');
  A.checkPasswordStrength(b.new_password);
  const row = await ctx.db.one(
    'UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING *',
    [u.id, A.hashPassword(b.new_password)]
  );
  return { success: true, token: A.signToken(row) };
}

// Crée un lien de réinitialisation valable 24 h et renvoie l'URL
async function createResetLink(db, userId, { byUser }) {
  const token = A.randomToken();
  await db.query('UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await db.query(
    "INSERT INTO password_resets (user_id, token_hash, expires_at, requested_by_user) VALUES ($1, $2, now() + interval '24 hours', $3)",
    [userId, A.sha256(token), byUser]
  );
  return `${siteUrl()}/reset-password.html?token=${token}`;
}

async function forgotPassword(ctx) {
  const b = await ctx.body();
  const ident = str(b.emailOrPhone || b.email, { max: 200, required: true, name: 'identifiant' }).toLowerCase();
  await A.checkRateLimit(ctx.db, ['forgot:' + ident]);
  await A.recordAttempt(ctx.db, ['forgot:' + ident], false);
  let user = null;
  if (ident.includes('@')) user = await ctx.db.one('SELECT * FROM users WHERE lower(email) = $1', [ident]);
  else {
    let tel = null;
    try { tel = phone(ident); } catch (_) {}
    if (tel) user = await ctx.db.one('SELECT * FROM users WHERE phone = $1', [tel]);
  }
  let sent = false;
  if (user) {
    if (user.email && process.env.RESEND_API_KEY) {
      const link = await createResetLink(ctx.db, user.id, { byUser: true });
      sent = await sendMail({
        to: user.email,
        subject: 'Réinitialisation de votre mot de passe AssibaService',
        text: `Bonjour ${user.first_name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 24 heures) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nL'équipe AssibaService`,
      });
    }
    if (!sent) {
      // Pas d'e-mail possible : la demande apparaît dans l'espace administrateur,
      // qui envoie le lien au client par WhatsApp ou SMS.
      await ctx.db.query(
        'INSERT INTO password_resets (user_id, requested_by_user) VALUES ($1, true)', [user.id]
      );
    }
  }
  return {
    success: true,
    message: sent
      ? 'Si un compte correspond, un e-mail vient de vous être envoyé.'
      : 'Votre demande est enregistrée. Notre équipe vous contacte rapidement pour réinitialiser votre mot de passe.',
  };
}

async function findValidReset(db, token) {
  if (!token || token.length < 20) return null;
  return db.one(
    `SELECT r.*, u.email, u.phone FROM password_resets r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > now()`,
    [A.sha256(token)]
  );
}

async function verifyResetToken(ctx) {
  const r = await findValidReset(ctx.db, ctx.params.token);
  if (!r) return { success: false, error: 'Lien invalide ou expiré' };
  return { success: true, email: r.email || r.phone };
}

async function resetPassword(ctx) {
  const b = await ctx.body();
  const pw = b.newPassword || b.password;
  if (b.confirmPassword !== undefined && b.confirmPassword !== pw) fail(400, 'Les mots de passe ne correspondent pas');
  A.checkPasswordStrength(pw);
  const r = await findValidReset(ctx.db, String(b.token || ''));
  if (!r) fail(400, 'Lien invalide ou expiré');
  await ctx.db.tx(async t => {
    await t.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [r.id]);
    await t.query(
      'UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1',
      [r.user_id, A.hashPassword(pw)]
    );
  });
  return { success: true };
}

async function uploadPhoto(ctx) {
  const u = await A.requireUser(ctx.req, ctx.db);
  const b = await ctx.body();
  const id = await saveFile(ctx.db, { ownerId: u.id, kind: 'photo_profil', dataUrl: b.photo });
  await ctx.db.query('UPDATE users SET photo_file_id = $2 WHERE id = $1', [u.id, id]);
  return { success: true, photo_url: `/api/files/${id}` };
}

async function uploadIdDocument(ctx) {
  const u = await A.requireUser(ctx.req, ctx.db, ['prestataire']);
  const b = await ctx.body();
  const id = await saveFile(ctx.db, { ownerId: u.id, kind: 'piece_identite', dataUrl: b.document, allowPdf: true });
  await ctx.db.query('UPDATE providers SET id_document_file_id = $2 WHERE user_id = $1', [u.id, id]);
  return { success: true };
}

// Accès aux fichiers : propriétaire, administrateur, ou parties d'une demande
async function getFile(ctx) {
  const u = await A.requireUser(ctx.req, ctx.db);
  const id = String(ctx.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail(404, 'Fichier introuvable');
  const f = await ctx.db.one('SELECT * FROM files WHERE id = $1', [id]);
  if (!f) fail(404, 'Fichier introuvable');
  let allowed = u.role === 'admin' || f.owner_id === u.id;
  if (!allowed && f.kind === 'photo_profil') {
    // Photo de profil visible par l'autre partie d'une mission
    const link = await ctx.db.one(
      `SELECT 1 FROM service_requests sr JOIN users x ON x.photo_file_id = $1
       WHERE (sr.client_id = $2 AND sr.provider_id = x.id) OR (sr.provider_id = $2 AND sr.client_id = x.id) LIMIT 1`,
      [id, u.id]
    );
    allowed = !!link;
  }
  if (!allowed && f.kind === 'photo_demande') {
    const sr = await ctx.db.one(
      `SELECT sr.* FROM request_photos rp JOIN service_requests sr ON sr.id = rp.request_id WHERE rp.file_id = $1`, [id]
    );
    if (sr) {
      if (sr.provider_id === u.id) allowed = true;
      else if (u.role === 'prestataire' && u.status === 'active' && sr.status === 'open') allowed = true;
    }
  }
  if (!allowed) fail(403, 'Accès non autorisé');
  ctx.res.statusCode = 200;
  ctx.res.setHeader('Content-Type', f.mime);
  ctx.res.setHeader('Cache-Control', 'private, max-age=3600');
  ctx.res.setHeader('X-Content-Type-Options', 'nosniff');
  ctx.res.setHeader('Content-Disposition', 'inline');
  ctx.res.end(Buffer.from(f.data_b64, 'base64'));
  return undefined;
}

module.exports = {
  routes: [
    ['POST', '/auth/register', register],
    ['POST', '/auth/login', login],
    ['GET', '/auth/me', me],
    ['PUT', '/auth/me', updateMe],
    ['POST', '/auth/change-password', changePassword],
    ['POST', '/auth/forgot-password', forgotPassword],
    ['GET', '/auth/verify-reset-token/:token', verifyResetToken],
    ['POST', '/auth/reset-password', resetPassword],
    ['POST', '/users/upload-photo', uploadPhoto],
    ['POST', '/provider/id-document', uploadIdDocument],
    ['GET', '/files/:id', getFile],
  ],
  publicUser, balanceOf, createResetLink,
};
