export function inlineCrmStageResolver(actionsSource, stageSource) {
  const marker = '// __CRM_STAGE_RESOLVER__';
  if (!actionsSource.includes(marker)) throw new Error('CRM stage resolver marker missing from actions source');
  const body = stageSource.replace(/if \(typeof module[\s\S]*$/, '').trim();
  const inlined = [
    'var CRM_STAGE_RESOLVER = (function () {', body,
    'return { toBusinessStage: toBusinessStage, isTerminalStage: isTerminalStage, canAutomatedTransition: canAutomatedTransition, stageLabel: stageLabel };',
    '})();'
  ].join('\n');
  return actionsSource.replace(marker, inlined);
}
