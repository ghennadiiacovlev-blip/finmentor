export function inlineCrmStageResolver(actionsSource, stageSource) {
  const marker = '// __CRM_STAGE_RESOLVER__';
  if (!actionsSource.includes(marker)) throw new Error('CRM stage resolver marker missing from actions source');
  const body = stageSource.replace(/if \(typeof module[\s\S]*$/, '').trim();
  const inlined = [
    'var CRM_STAGE_RESOLVER = (function () {', body,
    // STAGE_TO_STORED is exposed so the terminal closes (GATE 2) write the stored value the CRM
    // resolver itself defines, rather than a second copy of the same table.
    'return { toBusinessStage: toBusinessStage, isTerminalStage: isTerminalStage, canAutomatedTransition: canAutomatedTransition, stageLabel: stageLabel, STAGE_TO_STORED: STAGE_TO_STORED };',
    '})();'
  ].join('\n');
  return actionsSource.replace(marker, inlined);
}
