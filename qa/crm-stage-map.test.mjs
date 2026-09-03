// FINMENTOR — CRM stage compatibility map gates (C2.1).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { inlineCrmStageResolver } from '../scripts/lib/inline-crm-stage.mjs';
const require = createRequire(import.meta.url);
const m = require('../n8n/src/crm/stage-map.js');

let passed = 0, failed = 0;
const check = (n, c, d) => { if (c) { passed++; console.log('PASS ' + n); } else { failed++; console.log('FAIL ' + n + (d ? ' — ' + d : '')); } };

// every value the live system writes today resolves to a business stage
const live = { 'New': 'NEW', 'Qualified': 'QUALIFIED', 'Nurture': 'NEW', 'Incomplete': 'NEW', 'Discovery Scheduled': 'MEETING', 'Documents Requested': 'QUALIFIED', 'Proposal Sent': 'PROPOSAL', 'Won': 'WON', 'Lost': 'LOST', 'Negotiation': 'NEGOTIATION', 'Discovery Done': 'MEETING', 'Documents Received': 'QUALIFIED', 'Analysis In Progress': 'QUALIFIED' };
for (const [k, v] of Object.entries(live)) check('stage: ' + k + ' -> ' + v, m.toBusinessStage(k) === v, m.toBusinessStage(k));
check('stage: empty -> UNKNOWN', m.toBusinessStage('') === 'UNKNOWN');
check('stage: owner free text "Contact" -> CONTACT', m.toBusinessStage('Contact') === 'CONTACT');
check('stage: owner free text RU "Переговоры" -> NEGOTIATION', m.toBusinessStage('Переговоры') === 'NEGOTIATION');
check('stage: owner free text RO "Ofertă trimisă" -> PROPOSAL', m.toBusinessStage('Ofertă trimisă') === 'PROPOSAL');
check('stage: unknown stays observable UNKNOWN', m.toBusinessStage('something odd') === 'UNKNOWN' && !m.isTerminalStage('something odd'));
check('stage: Nurture -> NEW is explicit compatibility, not a stored rewrite', m.STAGE_COMPAT.nurture === 'NEW' && m.STAGE_TO_STORED.NEW === 'New');
check('stage: legacy Closed explicitly means terminal LOST', m.toBusinessStage('Closed') === 'LOST' && m.isTerminalStage('Closed'));
check('terminal: Won/Lost/closed are terminal', m.isTerminalStage('Won') && m.isTerminalStage('Lost') && m.isTerminalStage('Closed'));
check('terminal: automated transitions cannot reopen Won/Lost', !m.canAutomatedTransition('Won', 'Contact') && !m.canAutomatedTransition('Lost', 'Qualified'));
check('unknown: automated transitions refuse to guess', !m.canAutomatedTransition('something odd', 'New'));
check('terminal: Nurture is not terminal', !m.isTerminalStage('Nurture'));
check('labels: RU label for Discovery Scheduled', m.stageLabel('ru', 'Discovery Scheduled') === 'Встреча');
check('labels: RO label for Proposal Sent', m.stageLabel('ro', 'Proposal Sent') === 'Ofertă comercială');
check('labels: every business stage has RU and RO labels', m.BUSINESS_STAGES.every(s => m.STAGE_LABELS.ru[s] && m.STAGE_LABELS.ro[s]));
check('stored: known business stages map to stored values that round-trip', m.BUSINESS_STAGES.filter(s => s !== 'UNKNOWN').every(s => m.toBusinessStage(m.STAGE_TO_STORED[s]) === s));
const inlinedActions = inlineCrmStageResolver(readFileSync(new URL('../n8n/src/lead-alerts/actions.js', import.meta.url), 'utf8'), readFileSync(new URL('../n8n/src/crm/stage-map.js', import.meta.url), 'utf8'));
const LAA = new Function(inlinedActions + '; return LAA;')();
check('runtime: deployable alert actions use the shared resolver for terminal states', LAA.chooseActions('priority', { deal_stage: 'Lost', sla_status: 'active' }).length === 0 && LAA.chooseActions('priority', { deal_stage: 'Closed', sla_status: 'active' }).length === 0);

console.log(`\ncrm-stage-map: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
