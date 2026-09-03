// FINMENTOR — CRM stage compatibility map gates (C2.1).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const m = require('../n8n/src/crm/stage-map.js');

let passed = 0, failed = 0;
const check = (n, c, d) => { if (c) { passed++; console.log('PASS ' + n); } else { failed++; console.log('FAIL ' + n + (d ? ' — ' + d : '')); } };

// every value the live system writes today resolves to a business stage
const live = { 'New': 'NEW', 'Qualified': 'QUALIFIED', 'Nurture': 'NEW', 'Incomplete': 'NEW', 'Discovery Scheduled': 'MEETING', 'Documents Requested': 'QUALIFIED', 'Proposal Sent': 'PROPOSAL', 'Won': 'WON', 'Lost': 'LOST', 'Negotiation': 'NEGOTIATION', 'Discovery Done': 'MEETING', 'Documents Received': 'QUALIFIED', 'Analysis In Progress': 'QUALIFIED' };
for (const [k, v] of Object.entries(live)) check('stage: ' + k + ' -> ' + v, m.toBusinessStage(k) === v, m.toBusinessStage(k));
check('stage: empty -> NEW', m.toBusinessStage('') === 'NEW');
check('stage: owner free text "Contact" -> CONTACT', m.toBusinessStage('Contact') === 'CONTACT');
check('stage: owner free text RU "Переговоры" -> NEGOTIATION', m.toBusinessStage('Переговоры') === 'NEGOTIATION');
check('stage: owner free text RO "Ofertă trimisă" -> PROPOSAL', m.toBusinessStage('Ofertă trimisă') === 'PROPOSAL');
check('stage: unknown text -> NEW (never terminal)', m.toBusinessStage('something odd') === 'NEW' && !m.isTerminalStage('something odd'));
check('terminal: Won/Lost/closed are terminal', m.isTerminalStage('Won') && m.isTerminalStage('Lost') && m.isTerminalStage('Closed'));
check('terminal: Nurture is not terminal', !m.isTerminalStage('Nurture'));
check('labels: RU label for Discovery Scheduled', m.stageLabel('ru', 'Discovery Scheduled') === 'Встреча');
check('labels: RO label for Proposal Sent', m.stageLabel('ro', 'Proposal Sent') === 'Ofertă comercială');
check('labels: every business stage has RU and RO labels', m.BUSINESS_STAGES.every(s => m.STAGE_LABELS.ru[s] && m.STAGE_LABELS.ro[s]));
check('stored: every business stage maps to a stored value that round-trips', m.BUSINESS_STAGES.every(s => m.toBusinessStage(m.STAGE_TO_STORED[s]) === s));

console.log(`\ncrm-stage-map: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
