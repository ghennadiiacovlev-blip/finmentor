#!/usr/bin/env node
// Capture the deterministic Niagara owner memo with local headless Chrome. No network.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'qa-evidence', 'lead-intelligence-v1');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].find(existsSync);

if (!CHROME) throw new Error('Google Chrome not found');

const shots = [
  { html: 'niagara-owner-brief-desktop.html', png: 'niagara-owner-brief-desktop.png', size: '1440,1100' },
  { html: 'niagara-owner-brief-mobile.html', png: 'niagara-owner-brief-mobile-390.png', size: '390,844' }
];

for (const shot of shots) {
  const source = path.join(OUT, shot.html);
  const target = path.join(OUT, shot.png);
  if (!existsSync(source)) throw new Error('missing generated page: ' + shot.html);
  const result = spawnSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1', '--window-size=' + shot.size,
    '--screenshot=' + target, pathToFileURL(source).href
  ], { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0 || !existsSync(target)) throw new Error('Chrome capture failed for ' + shot.html + ': ' + (result.stderr || result.stdout));
  console.log('captured ' + shot.png + ' @ ' + shot.size.replace(',', 'x'));
}

const manifestPath = path.join(OUT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.visual_evidence = shots.map((shot) => ({ file: shot.png, viewport: shot.size.replace(',', 'x'), source: shot.html }));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
