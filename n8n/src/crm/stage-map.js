// FINMENTOR CRM — business pipeline stages and the compatibility map from the values that
// already live in Pipeline.deal_stage (written by Lead Intake and the Command Center).
//
// The stored values are NOT rewritten (C2.1: no destructive rewrite of history). Any surface
// that needs the business stage — Daily Digest sections, Mini App / bot copy, the X-Ray
// analysis owner alert, dashboards — resolves it through toBusinessStage() and renders it
// through STAGE_LABELS[locale]. Technical constants stay English.
//
// Inlined into n8n Code nodes by build scripts; keep it dependency-free.

const BUSINESS_STAGES = ['NEW', 'CONTACT', 'QUALIFIED', 'MEETING', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];

// Stored value (lower-cased, trimmed) -> business stage. Free-text stages typed by the owner
// through `stage <ID> <text>` are matched by the same table, then by keyword fallback.
const STAGE_COMPAT = {
  'new': 'NEW',
  'incomplete': 'NEW',
  'nurture': 'NEW',              // parking state; still a lead that has not been contacted
  'contact': 'CONTACT',
  'contacted': 'CONTACT',
  'qualified': 'QUALIFIED',
  'documents requested': 'QUALIFIED',
  'documents received': 'QUALIFIED',
  'analysis in progress': 'QUALIFIED',
  'discovery scheduled': 'MEETING',
  'discovery done': 'MEETING',
  'meeting': 'MEETING',
  'proposal sent': 'PROPOSAL',
  'proposal': 'PROPOSAL',
  'negotiation': 'NEGOTIATION',
  'won': 'WON',
  'lost': 'LOST',
  'closed': 'LOST'
};

const STAGE_KEYWORDS = [
  [/won|заключ|semnat/i, 'WON'],
  [/lost|closed|не состоя|закрыт|pierdut|fără rezultat/i, 'LOST'],
  [/negot|перегов|negoc/i, 'NEGOTIATION'],
  [/proposal|предлож|ofert/i, 'PROPOSAL'],
  [/meeting|discovery|встреч|întâln/i, 'MEETING'],
  [/qualif|document|analys|квалиф|calific/i, 'QUALIFIED'],
  [/contact|контакт/i, 'CONTACT']
];

function toBusinessStage(storedValue) {
  const s = String(storedValue || '').trim().toLowerCase();
  if (!s) return 'NEW';
  if (STAGE_COMPAT[s]) return STAGE_COMPAT[s];
  for (const [re, stage] of STAGE_KEYWORDS) { if (re.test(s)) return stage; }
  return 'NEW';
}

function isTerminalStage(storedValue) {
  const b = toBusinessStage(storedValue);
  return b === 'WON' || b === 'LOST';
}

const STAGE_LABELS = {
  ru: {
    NEW: 'Новое обращение',
    CONTACT: 'Контакт установлен',
    QUALIFIED: 'Квалифицирован',
    MEETING: 'Встреча',
    PROPOSAL: 'Коммерческое предложение',
    NEGOTIATION: 'Переговоры',
    WON: 'Сделка заключена',
    LOST: 'Сделка не состоялась'
  },
  ro: {
    NEW: 'Solicitare nouă',
    CONTACT: 'Contact stabilit',
    QUALIFIED: 'Calificat',
    MEETING: 'Întâlnire',
    PROPOSAL: 'Ofertă comercială',
    NEGOTIATION: 'Negociere',
    WON: 'Contract semnat',
    LOST: 'Fără rezultat'
  }
};

// The stored deal_stage value the Command Center should write for each business stage, so a
// future `stage <ID> <text>` command and the Dashboard funnel keep matching.
const STAGE_TO_STORED = {
  NEW: 'New',
  CONTACT: 'Contact',
  QUALIFIED: 'Qualified',
  MEETING: 'Discovery Scheduled',
  PROPOSAL: 'Proposal Sent',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost'
};

function stageLabel(locale, storedValue) {
  const L = STAGE_LABELS[String(locale || '').toLowerCase().slice(0, 2) === 'ro' ? 'ro' : 'ru'];
  return L[toBusinessStage(storedValue)];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BUSINESS_STAGES, STAGE_COMPAT, STAGE_LABELS, STAGE_TO_STORED, toBusinessStage, isTerminalStage, stageLabel };
}
