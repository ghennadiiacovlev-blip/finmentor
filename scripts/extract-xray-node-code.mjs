// FINMENTOR — prints the jsCode of one Code node from the generated X-Ray Analysis SDK file,
// so a single node can be re-pushed to the live workflow (n8n MCP update_workflow /
// setNodeParameter on /jsCode) without resending the whole workflow.
//
// Usage: node scripts/extract-xray-node-code.mjs "Validate + Store Rows" [outFile]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK = path.join(__dirname, '..', 'n8n', 'candidate', 'xray-analysis-workflow.sdk.js');
const nodeName = process.argv[2];
const outFile = process.argv[3];
if (!nodeName) { console.error('node name required'); process.exit(2); }

const s = fs.readFileSync(SDK, 'utf8');
const key = "name: " + JSON.stringify(nodeName).replace(/^"|"$/g, "'") + ", parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ";
const i = s.indexOf(key);
if (i < 0) { console.error('node not found: ' + nodeName); process.exit(1); }
let j = i + key.length;
if (s[j] !== '"') { console.error('unexpected literal start'); process.exit(1); }
let lit = '"'; j++;
while (j < s.length) {
  const c = s[j];
  if (c === '\\') { lit += c + s[j + 1]; j += 2; continue; }
  lit += c; j++;
  if (c === '"') break;
}
const code = JSON.parse(lit);
if (outFile) { fs.writeFileSync(outFile, code); console.log('wrote ' + outFile + ' (' + code.length + ' chars)'); }
else { process.stdout.write(code); }
