#!/usr/bin/env node
// FINMENTOR V1 C2 — deterministic Mini App source/build/live release-integrity proof.
// Read-only: no workflow writes and no repository writes.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app-premium');
const HOST_ID = 'KBD7Q94QQnlzgYKJ';
const HOST_PATH = 'finmentor-premium-miniapp';
const BASE = String(process.env.N8N_BASE_URL || '').replace(/\/+$/, '');
const READ_KEY = String(process.env.N8N_API_KEY || '');
const SOURCE_FILES = ['index.html', 'app.css', 'content.js', 'net.js', 'app.js'];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };

function deterministicPlaceholderPage(source) {
  const page = source['index.html']
    .replace('<link rel="stylesheet" href="app.css" />', '<style>\n' + source['app.css'] + '\n</style>')
    .replace('<script src="content.js"></script>', '<script>\n' + source['content.js'] + '\n</script>')
    .replace('<script src="net.js"></script>', '<script>\n' + source['net.js'] + '\n</script>')
    .replace('<script src="app.js"></script>', '<script>\n' + source['app.js'] + '\n</script>')
    .replace('<link rel="icon" href="../favicon.svg" type="image/svg+xml" />', '');
  for (const marker of ['href="app.css"', 'src="content.js"', 'src="net.js"', 'src="app.js"']) {
    if (page.includes(marker)) fail('deterministic build left a local asset reference: ' + marker);
  }
  for (const name of ['content.js', 'net.js', 'app.js']) {
    if (/<\/script/i.test(source[name])) fail(name + ' contains a closing script tag');
  }
  return page;
}

async function main() {
  if (!BASE || !READ_KEY) fail('N8N_BASE_URL and N8N_API_KEY are required');
  const source = Object.fromEntries(SOURCE_FILES.map((name) => [name, readFileSync(join(APP, name), 'utf8')]));
  const sourceHash = sha(Buffer.from(SOURCE_FILES.map((name) => name + '\0' + sha(Buffer.from(source[name], 'utf8'))).join('\n'), 'utf8'));
  const placeholderPage = deterministicPlaceholderPage(source);

  const candidate = JSON.parse(readFileSync(join(ROOT, 'n8n', 'candidate', 'premium-miniapp-host-candidate.json'), 'utf8'));
  const candidatePage = String(candidate.nodes.find((node) => node.name === 'Serve Page')?.parameters?.responseBody || '');
  if (candidatePage !== placeholderPage) fail('tracked host candidate is not the deterministic source build');

  const workflowResponse = await fetch(BASE + '/api/v1/workflows/' + HOST_ID, {
    headers: { 'X-N8N-API-KEY': READ_KEY }, signal: AbortSignal.timeout(30000)
  });
  if (!workflowResponse.ok) fail('workflow read-back failed: HTTP ' + workflowResponse.status);
  const liveWorkflow = await workflowResponse.json();
  if (!liveWorkflow.active) fail('Mini App host workflow is inactive');
  const apiPage = String(liveWorkflow.nodes.find((node) => node.name === 'Serve Page')?.parameters?.responseBody || '');

  const expectedEndpoints = {
    gateway: BASE + '/webhook/finmentor-miniapp-gateway',
    session: BASE + '/webhook/finmentor-miniapp-session',
    submit: BASE + '/webhook/finmentor-miniapp-submit'
  };
  for (const [key, expected] of Object.entries(expectedEndpoints)) {
    const found = new RegExp(key + ':\\s*\'([^\']+)\'').exec(apiPage)?.[1];
    if (found !== expected) fail('live ' + key + ' endpoint differs from the approved production route');
  }
  const buildPage = placeholderPage
    .split('__PREMIUM_GATEWAY_URL__').join(expectedEndpoints.gateway)
    .split('__PREMIUM_SESSION_URL__').join(expectedEndpoints.session)
    .split('__PREMIUM_SUBMIT_URL__').join(expectedEndpoints.submit);
  const buildHash = sha(Buffer.from(buildPage, 'utf8'));
  const apiHash = sha(Buffer.from(apiPage, 'utf8'));
  if (apiHash !== buildHash) fail('workflow responseBody differs from the approved deterministic build');

  const publicUrl = BASE + '/webhook/' + HOST_PATH;
  const publicResponse = await fetch(publicUrl + '?c2_release_integrity=1', {
    headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(30000)
  });
  if (!publicResponse.ok) fail('public Mini App host failed: HTTP ' + publicResponse.status);
  const livePage = await publicResponse.text();
  const liveHash = sha(Buffer.from(livePage, 'utf8'));
  if (liveHash !== buildHash) fail('public Mini App bytes differ from the approved deterministic build');

  console.log('MINI APP SOURCE/BUILD/LIVE RELEASE INTEGRITY');
  console.log('SOURCE FILES = ' + SOURCE_FILES.join(', '));
  console.log('SOURCE HASH = ' + sourceHash);
  console.log('PLACEHOLDER BUILD HASH = ' + sha(Buffer.from(placeholderPage, 'utf8')));
  console.log('BUILD HASH = ' + buildHash);
  console.log('WORKFLOW READ-BACK HASH = ' + apiHash);
  console.log('LIVE HASH = ' + liveHash);
  console.log('REPO/LIVE RECONCILIATION = PASS');
  console.log('UNEXPLAINED RELEASE DRIFT = 0');
}

main().catch((error) => {
  console.error('MINI APP RELEASE INTEGRITY = FAIL — ' + error.message);
  process.exit(1);
});
