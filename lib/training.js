// Catalogue des formations. Les bonnes réponses restent côté serveur :
// le navigateur ne reçoit jamais le corrigé.

const PASS_SCORE = 0.8; // 80 % de bonnes réponses pour obtenir le certificat

const COURSES = [
  {
    id: 1,
    slug: 'securite-chantier',
    title: 'Sécurité sur les chantiers et interventions',
    category: 'securite',
    description: 'Les règles essentielles pour travailler sans accident chez les clients et sur les chantiers : protections, travail en hauteur, électricité, réaction en cas d’accident.',
    duration_minutes: 45,
    price: 0,
    points: 10,
    available: true,
    modules: [
      {
        title: 'Repérer les risques avant de commencer',
        body: [
          'La plupart des accidents arrivent dans les premières minutes d’une intervention, quand on se met au travail sans avoir regardé autour de soi. Avant de sortir vos outils, prenez deux minutes pour observer les lieux.',
          'Les quatre grands risques à rechercher : les chutes (sol glissant, trous, escaliers, travail en hauteur), l’électricité (câbles dénudés, prises abîmées, eau à proximité), les outils (lames, disqueuses, perceuses) et les charges lourdes.',
          'Demandez au client ce qui est dangereux : une prise qui chauffe, une marche cassée, un animal. Éloignez les enfants de la zone de travail et balisez-la si nécessaire.',
          'Si un risque grave ne peut pas être supprimé (installation électrique dangereuse, structure instable), expliquez-le calmement au client et ne commencez pas le travail. Refuser une intervention dangereuse est un geste professionnel.',
        ],
      },
      {
        title: 'Les équipements de protection individuelle',
        body: [
          'Les équipements de protection individuelle (EPI) sont votre dernière barrière contre la blessure. Ils doivent être adaptés au travail, en bon état et portés pendant toute la durée du risque, pas seulement « quand on y pense ».',
          'Casque : chantier, travail sous une charge ou près d’un échafaudage. Chaussures de sécurité : objets lourds, clous, sol encombré. Gants : manipulation de matériaux coupants, produits chimiques, ciment. Lunettes : perçage, meulage, nettoyage avec projections. Protection auditive : outils bruyants utilisés longtemps. Masque : poussières de ponçage, peinture en pulvérisation, produits ménagers forts.',
          'Contrôlez vos EPI avant chaque mission : un casque fendu, des gants troués ou des lunettes rayées ne protègent plus. Remplacez-les sans attendre.',
          'Un prestataire équipé rassure aussi le client : c’est le signe d’un travail sérieux.',
        ],
      },
      {
        title: 'Travail en hauteur et électricité',
        body: [
          'Échelle : posez-la sur un sol stable, avec un angle d’environ 75 degrés (le pied à un quart de la hauteur du mur). Gardez toujours trois points d’appui (deux pieds et une main, ou deux mains et un pied). Ne montez pas sur les dernières marches et ne vous penchez pas sur le côté : déplacez l’échelle.',
          'Au-delà de quelques mètres ou pour un travail long, préférez un échafaudage monté correctement, avec garde-corps.',
          'Électricité : avant toute intervention sur un circuit, coupez le courant au disjoncteur ou au compteur, vérifiez l’absence de tension avec un testeur, puis empêchez la remise sous tension (prévenez les occupants, posez un mot sur le tableau). Ces trois étapes s’appellent la consignation.',
          'Ne travaillez jamais avec les mains ou les pieds mouillés sur une installation électrique, et n’utilisez pas un outil dont le câble est abîmé.',
        ],
      },
      {
        title: 'Gestes, postures et réaction en cas d’accident',
        body: [
          'Pour soulever une charge, rapprochez-la de votre corps, pliez les jambes et gardez le dos droit. Au-dessus d’environ 25 kg, demandez de l’aide ou utilisez un diable.',
          'Rangez vos outils au fur et à mesure : un câble ou un outil qui traîne au sol provoque des chutes.',
          'En cas d’accident, suivez trois étapes : protéger (couper le courant, éloigner le danger sans vous mettre en risque), alerter (appeler les secours avec l’adresse exacte et l’état de la victime), secourir (rester avec la victime, ne pas la déplacer si elle est blessée au dos ou à la tête).',
          'Gardez dans votre véhicule ou votre sac une petite trousse de premiers secours et les numéros d’urgence de votre ville.',
        ],
      },
    ],
    quiz: [
      { q: 'Que faire en premier en arrivant chez un client ?', options: ['Sortir ses outils pour gagner du temps', 'Observer les lieux et repérer les risques', 'Demander à être payé', 'Commencer par la partie la plus difficile'], answer: 1 },
      { q: 'Quand faut-il porter ses équipements de protection ?', options: ['Seulement si le client le demande', 'Uniquement en fin de journée', 'Pendant toute la durée du risque', 'Jamais pour un petit travail'], answer: 2 },
      { q: 'Quelle est la bonne règle sur une échelle ?', options: ['Garder trois points d’appui', 'Monter jusqu’à la dernière marche', 'Se pencher pour atteindre plus loin', 'La poser sur un sol meuble'], answer: 0 },
      { q: 'Avant d’intervenir sur un circuit électrique, il faut :', options: ['Travailler vite pour limiter le risque', 'Couper, vérifier l’absence de tension, empêcher la remise sous tension', 'Mettre des gants mouillés', 'Laisser le courant pour tester au fur et à mesure'], answer: 1 },
      { q: 'En cas d’accident, l’ordre des actions est :', options: ['Secourir, protéger, alerter', 'Alerter, partir, revenir', 'Protéger, alerter, secourir', 'Déplacer la victime puis appeler'], answer: 2 },
    ],
  },
  {
    id: 2,
    slug: 'service-client',
    title: 'Service client : gagner la confiance et les bons avis',
    category: 'service_client',
    description: 'Accueil, devis clair, comportement pendant l’intervention, fin de mission et gestion des réclamations : tout ce qui fait revenir un client et vous vaut de bonnes notes sur AssibaService.',
    duration_minutes: 35,
    price: 0,
    points: 8,
    available: true,
    modules: [
      {
        title: 'Le premier contact',
        body: [
          'Le client se fait une opinion en quelques secondes. Appelez-le rapidement après l’acceptation de votre offre, présentez-vous (nom, métier, « de la part d’AssibaService ») et confirmez l’heure de passage.',
          'Soyez ponctuel. Si vous avez un empêchement, prévenez avant l’heure prévue et proposez un nouveau créneau. Un retard annoncé est pardonné ; un retard silencieux fait perdre le client.',
          'Arrivez avec une tenue propre et vos outils. Saluez, écoutez le problème jusqu’au bout sans couper la parole, puis reformulez-le pour montrer que vous avez compris.',
        ],
      },
      {
        title: 'Un prix clair, sans surprise',
        body: [
          'Votre offre sur AssibaService fixe le prix. Expliquez ce qu’il comprend : main-d’œuvre, déplacement, matériel ou non.',
          'Si vous découvrez sur place un problème plus important, arrêtez-vous et expliquez-le avant de faire plus de travail. Le client doit accepter tout changement de prix. Ne réclamez jamais d’argent en plus à la fin sans accord préalable.',
          'Le paiement passe par AssibaService : le client a déjà payé, l’argent vous est versé dès qu’il valide la fin de mission. Ne demandez pas d’espèces en plus du montant convenu.',
        ],
      },
      {
        title: 'Pendant l’intervention',
        body: [
          'Protégez les lieux : bâche sous le chantier, chaussures propres, meubles déplacés avec l’accord du client.',
          'Tenez le client informé de l’avancement, surtout si le travail dure. Répondez poliment à ses questions, même répétées.',
          'Restez discret : téléphone en mode silencieux, pas de musique forte, respect de la vie privée et des objets de la maison.',
        ],
      },
      {
        title: 'Terminer en beauté et gérer une réclamation',
        body: [
          'À la fin, nettoyez et rangez. Montrez le résultat au client, expliquez l’entretien éventuel, puis déclarez la mission terminée dans votre espace : le client est invité à valider et à vous noter.',
          'Si le client n’est pas satisfait, écoutez sans vous défendre tout de suite, demandez précisément ce qui ne va pas et proposez une solution (retouche, explication). Une réclamation bien gérée transforme souvent un client mécontent en client fidèle.',
          'Si le désaccord persiste, ne vous emportez pas : utilisez « Signaler un problème » dans votre espace, un conseiller AssibaService arbitre.',
        ],
      },
    ],
    quiz: [
      { q: 'Vous allez être en retard à un rendez-vous. Que faites-vous ?', options: ['Rien, le client attendra', 'Je préviens avant l’heure et propose un nouveau créneau', 'J’annule sans prévenir', 'J’envoie un message après l’heure'], answer: 1 },
      { q: 'Sur place, le problème est plus grave que prévu :', options: ['Je fais le travail et j’augmente le prix à la fin', 'J’explique avant de continuer et j’obtiens l’accord du client', 'Je pars sans rien dire', 'Je fais seulement la moitié du travail'], answer: 1 },
      { q: 'Le client a payé via AssibaService. À la fin de la mission :', options: ['Je demande un supplément en espèces', 'Je déclare la mission terminée pour que le client valide', 'Je garde les clés du client', 'Je demande au client de payer une deuxième fois'], answer: 1 },
      { q: 'Face à une réclamation, la première chose à faire est :', options: ['Écouter sans se défendre tout de suite', 'Hausser le ton', 'Quitter les lieux', 'Accuser le client'], answer: 0 },
      { q: 'Pendant l’intervention, il faut :', options: ['Mettre de la musique forte', 'Protéger les lieux et tenir le client informé', 'Utiliser les affaires du client sans demander', 'Éviter de parler au client'], answer: 1 },
    ],
  },
  {
    id: 3,
    slug: 'artisanat-togolais',
    title: 'Artisanat traditionnel togolais',
    category: 'artisanat',
    description: 'Techniques traditionnelles et mise en valeur de votre savoir-faire auprès des clients. Formation en préparation avec des artisans partenaires.',
    duration_minutes: 480,
    price: 15000,
    points: 20,
    available: false,
    modules: [],
    quiz: [],
  },
];

const LEVELS = [
  { name: 'Débutant', min: 0 },
  { name: 'Intermédiaire', min: 15 },
  { name: 'Avancé', min: 40 },
  { name: 'Expert', min: 80 },
];

function levelFor(points) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) if (points >= l.min) lvl = l;
  const next = LEVELS[LEVELS.indexOf(lvl) + 1] || null;
  return { name: lvl.name, min: lvl.min, next: next ? { name: next.name, min: next.min } : null };
}

// Version envoyée au navigateur : sans les bonnes réponses
function publicCourse(c, withContent) {
  const out = {
    id: c.id, slug: c.slug, title: c.title, category: c.category, description: c.description,
    duration_minutes: c.duration_minutes, price: c.price, points: c.points, available: c.available,
    modules_count: c.modules.length, questions_count: c.quiz.length,
  };
  if (withContent) {
    out.modules = c.modules;
    out.quiz = c.quiz.map(q => ({ q: q.q, options: q.options }));
  }
  return out;
}

module.exports = { COURSES, PASS_SCORE, LEVELS, levelFor, publicCourse };
