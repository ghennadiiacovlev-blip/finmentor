// FINMENTOR X-Ray Analysis — customer/owner labels (machine-readable copy of
// docs/FINMENTOR_PRODUCT_LANGUAGE_STANDARD.md). Internal codes stay English.
//
// Inlined into n8n Code nodes by scripts/build-xray-analysis-workflow.mjs. Keep it free of
// require() and of anything n8n's sandbox lacks.

const XRAY_LABELS = {
  ru: {
    zone: {
      GREEN:   { name: 'ЗЕЛЁНАЯ ЗОНА',    line: 'Устойчивый финансовый контроль' },
      YELLOW:  { name: 'ЖЁЛТАЯ ЗОНА',     line: 'Отдельные зоны требуют усиления' },
      ORANGE:  { name: 'ОРАНЖЕВАЯ ЗОНА',  line: 'Существенные пробелы в финансовом управлении' },
      RED:     { name: 'КРАСНАЯ ЗОНА',    line: 'Высокий риск потери финансового контроля' },
      UNKNOWN: { name: 'ЗОНА НЕ ОПРЕДЕЛЕНА', line: 'Недостаточно данных для оценки' }
    },
    product: {
      CFO_ADVISORY_SESSION:     'CFO Advisory Session — разбор одного решения',
      FINANCIAL_HEALTH_CHECK:  'Комплексная финансовая диагностика (Financial Health Check)',
      BUSINESS_CONTROL_SYSTEM: 'Business Control System — система финансового контроля',
      CFO_CONTROL_PARTNER:      'CFO Control Partner — регулярный контроль собственника',
      CFO_AI_CONTROL:           'CFO AI Control — расширенный контур контроля',
      NEEDS_CLARIFICATION:      'Сначала требуется уточнение',
      MONTHLY_CFO_SUPPORT:     'Monthly CFO Support — ежемесячное сопровождение CFO',
      DISCOVERY_CALL:          'Диагностическая встреча (Discovery Call)'
    },
    review: {
      AI_DRAFT:        'Предварительный анализ ИИ',
      OWNER_REVIEW:    'Экспертная проверка FINMENTOR',
      OWNER_EDITED:    'Отредактировано владельцем',
      CLIENT_READY:    'Готово для клиента',
      CLIENT_NOTIFIED: 'Клиент уведомлён',
      CLIENT_VIEWED:   'Клиент открыл результат',
      ANALYSIS_FAILED: 'Анализ не выполнен'
    },
    insufficient: 'НЕДОСТАТОЧНО ДАННЫХ',
    week: ['Неделя 1 (дни 1–7)', 'Неделя 2 (дни 8–14)', 'Неделя 3 (дни 15–21)', 'Неделя 4 (дни 22–30)']
  },
  ro: {
    zone: {
      GREEN:   { name: 'ZONA VERDE',      line: 'Control financiar stabil' },
      YELLOW:  { name: 'ZONA GALBENĂ',    line: 'Anumite zone necesită consolidare' },
      ORANGE:  { name: 'ZONA PORTOCALIE', line: 'Lacune semnificative în managementul financiar' },
      RED:     { name: 'ZONA ROȘIE',      line: 'Risc ridicat de pierdere a controlului financiar' },
      UNKNOWN: { name: 'ZONĂ NEDETERMINATĂ', line: 'Date insuficiente pentru evaluare' }
    },
    product: {
      CFO_ADVISORY_SESSION:     'CFO Advisory Session — analiza unei decizii',
      FINANCIAL_HEALTH_CHECK:  'Diagnostic financiar complet (Financial Health Check)',
      BUSINESS_CONTROL_SYSTEM: 'Business Control System — sistem de control financiar',
      CFO_CONTROL_PARTNER:      'CFO Control Partner — control financiar recurent',
      CFO_AI_CONTROL:           'CFO AI Control — sistem avansat de control',
      NEEDS_CLARIFICATION:      'Mai întâi sunt necesare clarificări',
      MONTHLY_CFO_SUPPORT:     'Monthly CFO Support — asistență CFO lunară',
      DISCOVERY_CALL:          'Întâlnire de diagnostic (Discovery Call)'
    },
    review: {
      AI_DRAFT:        'Analiză preliminară AI',
      OWNER_REVIEW:    'Verificare de specialist FINMENTOR',
      OWNER_EDITED:    'Editat de proprietar',
      CLIENT_READY:    'Pregătit pentru client',
      CLIENT_NOTIFIED: 'Client notificat',
      CLIENT_VIEWED:   'Clientul a deschis rezultatul',
      ANALYSIS_FAILED: 'Analiza nu a fost realizată'
    },
    insufficient: 'DATE INSUFICIENTE',
    week: ['Săptămâna 1 (zilele 1–7)', 'Săptămâna 2 (zilele 8–14)', 'Săptămâna 3 (zilele 15–21)', 'Săptămâna 4 (zilele 22–30)']
  }
};

const XRAY_PRODUCT_CODES = ['CFO_ADVISORY_SESSION', 'FINANCIAL_HEALTH_CHECK', 'BUSINESS_CONTROL_SYSTEM', 'CFO_CONTROL_PARTNER', 'CFO_AI_CONTROL', 'NEEDS_CLARIFICATION', 'MONTHLY_CFO_SUPPORT', 'DISCOVERY_CALL'];
const XRAY_ZONES = ['GREEN', 'YELLOW', 'ORANGE', 'RED', 'UNKNOWN'];
const XRAY_REVIEW_STATES = ['AI_DRAFT', 'OWNER_REVIEW', 'OWNER_EDITED', 'CLIENT_READY', 'CLIENT_NOTIFIED', 'CLIENT_VIEWED', 'ANALYSIS_FAILED'];

function xrayLocale(value) {
  return String(value || '').toLowerCase().slice(0, 2) === 'ro' ? 'ro' : 'ru';
}

function xrayZoneLabel(locale, zone) {
  const L = XRAY_LABELS[xrayLocale(locale)];
  const z = XRAY_ZONES.includes(String(zone)) ? String(zone) : 'UNKNOWN';
  return L.zone[z];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { XRAY_LABELS, XRAY_PRODUCT_CODES, XRAY_ZONES, XRAY_REVIEW_STATES, xrayLocale, xrayZoneLabel };
}
