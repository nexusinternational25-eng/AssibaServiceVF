// Formations : catalogue, contenu, quiz corrigé côté serveur, certificats vérifiables.
const crypto = require('crypto');
const { fail, int } = require('../http');
const { currentUser, requireUser } = require('../auth');
const T = require('../training');

function findCourse(id) {
  const c = T.COURSES.find(x => x.id === int(id, { min: 1, name: 'formation' }));
  if (!c) fail(404, 'Formation introuvable');
  return c;
}

async function summary(db, userId) {
  const rows = await db.query('SELECT * FROM training_progress WHERE user_id = $1', [userId]);
  const points = rows.filter(r => r.status === 'completed')
    .reduce((s, r) => s + ((T.COURSES.find(c => c.id === r.course_id) || {}).points || 0), 0);
  return { rows, points, level: T.levelFor(points) };
}

async function list(ctx) {
  const u = await currentUser(ctx.req, ctx.db);
  const out = { success: true, courses: T.COURSES.map(c => T.publicCourse(c, false)), levels: T.LEVELS, pass_score: T.PASS_SCORE };
  if (u) {
    const s = await summary(ctx.db, u.id);
    out.points = s.points;
    out.level = s.level;
    out.progress = s.rows.map(r => ({
      course_id: r.course_id, status: r.status, attempts: r.attempts, best_score: Number(r.best_score),
      certificate_code: r.certificate_code, completed_at: r.completed_at,
    }));
  }
  return out;
}

async function open(ctx) {
  const u = await requireUser(ctx.req, ctx.db);
  const c = findCourse(ctx.params.id);
  if (!c.available) fail(400, 'Cette formation n’est pas encore disponible');
  await ctx.db.query(
    'INSERT INTO training_progress (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.id, c.id]);
  return { success: true, course: T.publicCourse(c, true) };
}

async function quiz(ctx) {
  const u = await requireUser(ctx.req, ctx.db);
  const c = findCourse(ctx.params.id);
  if (!c.available || !c.quiz.length) fail(400, 'Cette formation n’est pas encore disponible');
  const b = await ctx.body();
  const answers = Array.isArray(b.answers) ? b.answers : [];
  if (answers.length !== c.quiz.length) fail(400, 'Répondez à toutes les questions');
  const wrong = [];
  c.quiz.forEach((q, i) => { if (Number(answers[i]) !== q.answer) wrong.push(i); });
  const score = (c.quiz.length - wrong.length) / c.quiz.length;
  const passed = score >= T.PASS_SCORE;
  const row = await ctx.db.tx(async t => {
    await t.query('INSERT INTO training_progress (user_id, course_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [u.id, c.id]);
    const cur = await t.one('SELECT * FROM training_progress WHERE user_id = $1 AND course_id = $2 FOR UPDATE', [u.id, c.id]);
    const code = cur.certificate_code || (passed ? 'CERT-' + crypto.randomBytes(5).toString('hex').toUpperCase() : null);
    return t.one(
      `UPDATE training_progress SET attempts = attempts + 1, best_score = GREATEST(best_score, $3),
         status = CASE WHEN $4 THEN 'completed' ELSE status END,
         completed_at = CASE WHEN $4 AND completed_at IS NULL THEN now() ELSE completed_at END,
         certificate_code = $5
       WHERE user_id = $1 AND course_id = $2 RETURNING *`,
      [u.id, c.id, score, passed, code]);
  });
  const s = await summary(ctx.db, u.id);
  return {
    success: true, score, passed, wrong, pass_score: T.PASS_SCORE,
    certificate_code: row.certificate_code, points: s.points, level: s.level,
  };
}

// Vérification publique d'un certificat (nom, formation, date) à partir de son code
async function certificate(ctx) {
  const code = String(ctx.params.code || '').toUpperCase();
  if (!/^CERT-[0-9A-F]{10}$/.test(code)) fail(404, 'Certificat introuvable');
  const r = await ctx.db.one(
    `SELECT tp.*, u.first_name, u.last_name, u.role FROM training_progress tp JOIN users u ON u.id = tp.user_id
     WHERE tp.certificate_code = $1 AND tp.status = 'completed'`, [code]);
  if (!r) fail(404, 'Certificat introuvable');
  const c = T.COURSES.find(x => x.id === r.course_id);
  return {
    success: true,
    certificate: {
      code, name: `${r.first_name} ${r.last_name}`.trim(), course: c ? c.title : 'Formation',
      duration_minutes: c ? c.duration_minutes : null, score: Number(r.best_score), completed_at: r.completed_at,
    },
  };
}

module.exports = {
  routes: [
    ['GET', '/training/courses', list],
    ['GET', '/training/courses/:id', open],
    ['POST', '/training/courses/:id/quiz', quiz],
    ['GET', '/training/certificates/:code', certificate],
  ],
};
