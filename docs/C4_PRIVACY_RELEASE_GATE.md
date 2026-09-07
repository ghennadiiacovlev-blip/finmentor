# C4.9 — Legal / privacy release gate: audit and the minimal text that needs OWNER approval

**Date:** 2026-09-03 · **Status:** ONE approval pending (text below). No new legal project.

## What the live texts already say (audited)

| requirement | where it is today | verdict |
|---|---|---|
| submitted data is used to prepare FINMENTOR analysis | `privacy.html` §2 («…для подготовки консультации»), Mini App ack («для рассмотрения обращения, подготовки консультанта и связи с вами») | present, but says "consultation", not "analysis" |
| automation / AI may assist processing | `privacy.html` §8 (n8n, Google Sheets, Telegram, OpenAI, anonymised data only) | present |
| final expert recommendations may require human review | `terms.html` §5/§6 only; absent from `privacy.html` and from the Mini App ack | gap |
| Financial X-Ray is management analysis, not statutory audit | `questionnaire.html`, `ro/questionnaire.html`, `app/index.html`; absent from privacy | present on the product page; acceptable |
| analytics separately consent-gated | `privacy.html` §4, cookie banner, `analytics.js` | present |
| Supabase as a processor (G5 ledger, privacy acknowledgements — no personal data) | not named anywhere | gap (already recorded in `docs/PREMIUM_UX_LEGAL_NOTICE_DIFF.md`) |

## Minimal text requiring OWNER approval (exact wording)

To be inserted as one paragraph at the end of `privacy.html` §8 and `ro/privacy.html` §8, and as
a third line of the Mini App privacy screen (`n8n/src/premium-ux/privacy-notice.js`, both locales).

**RU**

> Результаты Финансового рентгена бизнеса (Financial X-Ray) и план действий на 30 дней готовятся
> автоматизированно с участием искусственного интеллекта на основе обезличенных ответов и являются
> предварительным управленческим анализом, а не аудитом и не индивидуальной финансовой
> консультацией. Итоговые экспертные рекомендации FINMENTOR формируются после проверки человеком.
> Технические записи об обработке (без персональных данных) хранятся в Supabase (ЕС).

**RO**

> Rezultatele Testului de sănătate financiară FINMENTOR și planul de acțiune pentru 30 de zile sunt
> pregătite automatizat, cu ajutorul inteligenței artificiale, pe baza răspunsurilor anonimizate și
> reprezintă o evaluare managerială preliminară, nu un audit și nu o consultanță financiară
> individuală. Recomandările finale ale experților FINMENTOR sunt formulate după verificare umană.
> Înregistrările tehnice privind prelucrarea (fără date cu caracter personal) sunt stocate în
> Supabase (UE).

Two facts in that text are the owner's to confirm, not the engineer's: (1) that "Supabase (ЕС/UE)"
is the wording the owner wants for the processor (the project is `finmentor-prod`, region
eu-central-1), and (2) that "проверка человеком / verificare umană" is a commitment the owner will
keep for every CLIENT_READY promotion (the system enforces it: nothing reaches the customer before
the owner's review tap).

Until approved, the customer-facing result surface (C3.4) must show the analysis only after
CLIENT_READY, which is already how the store works, and the existing privacy texts remain live
unchanged.
