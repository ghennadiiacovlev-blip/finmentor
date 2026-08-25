from pathlib import Path
import re

analytics = Path('analytics.js').read_text(encoding='utf-8')
if analytics.count('G-94L98WZ12') != 1:
    raise SystemExit('Expected exactly one correct GA4 measurement ID')
if 'G-94L9B8WZ12' in analytics:
    raise SystemExit('Regressed GA4 measurement ID found')
for needle in [
    "gtag('get', GA4_ID, 'client_id'",
    "gtag('get', GA4_ID, 'session_id'",
    'getAttributionContext: getAttributionContext',
    'enrichLeadPayload: enrichLeadPayload',
]:
    if needle not in analytics:
        raise SystemExit(f'Missing analytics contract: {needle}')

for path in ['main.js', 'questionnaire.html', 'ro/questionnaire.html']:
    text = Path(path).read_text(encoding='utf-8')
    if 'enrichLeadPayload(payload, 1800)' not in text:
        raise SystemExit(f'{path}: lead enrichment call missing')
    if 'analytics_consent' not in text:
        raise SystemExit(f'{path}: analytics_consent fallback missing')

for src, out in [('questionnaire.html', '/tmp/q-ru.js'), ('ro/questionnaire.html', '/tmp/q-ro.js')]:
    text = Path(src).read_text(encoding='utf-8')
    blocks = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', text, flags=re.I | re.S)
    candidates = [b for b in blocks if 'postQuestionnairePayload' in b]
    if len(candidates) != 1:
        raise SystemExit(f'{src}: expected one questionnaire script, got {len(candidates)}')
    Path(out).write_text(candidates[0], encoding='utf-8')

print('STATIC_QA_PREP_PASS')
