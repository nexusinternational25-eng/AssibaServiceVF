// Règles métier : tarifs, commissions, catégories.
// Les montants sont en FCFA et toujours fixés ici, jamais par le navigateur.

const MATCHING_FEE = 2000; // frais de mise en relation payés par le client

// Commission prélevée sur le montant de la prestation, selon le type de service
const COMMISSION = {
  depannage: 0,
  contrat_salarie: 0.05,
  chantier: 0.05,
  consultance: 0.05,
};

const PLANS = {
  standard: { label: 'Inscription Standard', amount: 3000, months: null },
  basic: { label: 'Abonnement Basic', amount: 8000, months: 1 },
  pro: { label: 'Abonnement Pro', amount: 30000, months: 1, firstBonusMonths: 1 },
};

const INSURANCE = {
  rc_professionnelle: { label: 'Responsabilité Civile Professionnelle', amount: 9650, months: 12 },
  accident_travail: { label: 'Accident de Travail', amount: 3000, months: 12 },
  pack_complet: { label: 'Pack Complet', amount: 11500, months: 12 },
};

const CATEGORIES = {
  plomberie: 'Plomberie',
  electricite: 'Électricité',
  menage: 'Ménage',
  jardinage: 'Jardinage',
  peinture: 'Peinture',
  menuiserie: 'Menuiserie',
  informatique: 'Informatique',
  transport: 'Transport',
  evenements: 'Événementiel',
  artisanat: 'Artisanat',
  agriculture: 'Agriculture',
  sante: 'Santé',
  vitrier: 'Vitrerie',
  aluminium: 'Aluminium',
  autres: 'Autres',
};

const PURPOSE_LABELS = {
  mise_en_relation: 'Frais de mise en relation',
  prestation: 'Paiement sécurisé de la prestation',
  inscription: 'Inscription prestataire',
  abonnement: 'Abonnement prestataire',
  assurance: 'Assurance professionnelle',
};

// Fourchettes indicatives (FCFA) pour un dépannage simple, par catégorie
const BUDGET_GRID = {
  plomberie: [5000, 25000],
  electricite: [5000, 30000],
  menage: [5000, 20000],
  jardinage: [5000, 25000],
  peinture: [15000, 80000],
  menuiserie: [10000, 70000],
  informatique: [5000, 35000],
  transport: [2000, 25000],
  evenements: [25000, 200000],
  artisanat: [10000, 60000],
  agriculture: [10000, 80000],
  sante: [5000, 30000],
  vitrier: [10000, 60000],
  aluminium: [20000, 120000],
  autres: [5000, 50000],
};

const SERVICE_TYPE_FACTOR = {
  depannage: { factor: 1, label: 'dépannage ponctuel' },
  chantier: { factor: 6, label: 'chantier' },
  contrat_salarie: { factor: 4, label: 'contrat de travail' },
  consultance: { factor: 3, label: 'consultance' },
};

function paymentNumbers() {
  return {
    // Pas de numéro par défaut : un client ne doit jamais envoyer d'argent à un numéro non confirmé
    tmoney: process.env.PAY_TMONEY_NUMBER || '',
    flooz: process.env.PAY_FLOOZ_NUMBER || '',
    beneficiary: process.env.PAY_BENEFICIARY || 'AssibaService',
  };
}

module.exports = {
  MATCHING_FEE, COMMISSION, PLANS, INSURANCE, CATEGORIES, PURPOSE_LABELS,
  BUDGET_GRID, SERVICE_TYPE_FACTOR, paymentNumbers,
};
