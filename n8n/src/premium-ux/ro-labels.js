'use strict';

// FINMENTOR Premium UX — Romanian PRESENTATION dictionary.
//
// SPRINT 1, OPTION A (owner decision 2026-09-07). The Russian strings in branches.js remain the
// canonical MACHINE VALUES: they are what the client submits, what submit-projection.js writes and
// what the Pipeline stores, in both languages. Nothing in this file is ever stored or compared —
// it is read at render time only.
//
// THE KEY IS THE MACHINE VALUE. Every key below is a byte-identical Russian string from
// branches.js; the value is what a Romanian customer sees in its place. Because branches.js is
// never rewritten, a machine value cannot drift as a side effect of translation — the two live in
// different files and only one of them is authoritative for storage.
//
// This is the {v, ru, ro} shape the decision asks for, expressed as a lookup: v === ru === the key,
// ro === the value. `localize()` in locale.js is the only reader.
//
// COMPLETENESS IS ENFORCED, NOT ASSUMED. qa/premium-ux-ro-parity.test.mjs walks every
// customer-visible string reachable from the branches.js exports and fails when one has no entry
// here. There is no fallback to Russian on a Romanian customer path — a missing key is a build
// failure, never a silent Russian label in front of a Romanian customer.
//
// TERMINOLOGY. Romanian economic language first. An English professional term appears at most once,
// in parentheses, at the first meaningful occurrence in the customer flow, and never again:
// Cash Flow on the objective card, P&L and Balance on the first outcome card, CAPEX / IRR / NPV /
// Payback / MOIC / DCF where the investment vocabulary is actually introduced.

const RO_LABELS = {
  // ── objectives (first screen) ──────────────────────────────────────────────────────────────
  'Финансовое управление': 'Management financiar',
  'Отчётность, бюджетирование, контроль, финансовая функция': 'Raportare, bugetare, control, funcție financiară',
  'Прибыль и эффективность': 'Profit și eficiență',
  'Маржа, расходы, себестоимость, экономика бизнеса': 'Marjă, cheltuieli, costuri, economia afacerii',
  'Денежный поток': 'Flux de numerar',
  'Cash Flow, кассовые разрывы, ликвидность': 'Flux de numerar (Cash Flow), goluri de casă, lichiditate',
  'Инвестиция / новый проект': 'Investiție / proiect nou',
  'Финмодель, доходность, сценарии, риски': 'Model financiar, rentabilitate, scenarii, riscuri',
  'Недвижимость / сделка': 'Imobiliare / tranzacție',
  'Покупка, продажа, аренда, инвестиционная оценка': 'Achiziție, vânzare, închiriere, evaluare investițională',
  'Финансирование': 'Finanțare',
  'Банк, инвестор, структура капитала': 'Bancă, investitor, structura capitalului',
  'Нужен независимый взгляд': 'Am nevoie de o opinie independentă',
  'Помочь определить, где находится основная проблема': 'Să identificăm unde se află problema principală',
  'Другая задача': 'Altă solicitare',
  'Если задача не подходит под категории выше': 'Dacă solicitarea nu se încadrează în categoriile de mai sus',

  'Что сейчас важнее всего?': 'Ce este cel mai important acum?',
  'Один пункт. Остальное консультант уточнит в разговоре.': 'O singură opțiune. Restul va fi clarificat de consultant în discuție.',

  // ── company ────────────────────────────────────────────────────────────────────────────────
  'Компания': 'Compania',
  'Только то, что меняет подготовку консультанта.': 'Doar ce schimbă modul în care se pregătește consultantul.',

  'до €500 тыс.': 'până la 500 mii €',
  '€500 тыс. – €2 млн': '500 mii € – 2 mil. €',
  '€2–10 млн': '2–10 mil. €',
  '€10–50 млн': '10–50 mil. €',
  '€50 млн+': 'peste 50 mil. €',
  'Предпочитаю не указывать': 'Prefer să nu precizez',

  // ── current setup ──────────────────────────────────────────────────────────────────────────
  'На что уже можно опереться?': 'Pe ce vă puteți baza deja?',
  'Выберите всё, что действительно используется сегодня.': 'Selectați tot ce este folosit efectiv astăzi.',
  'Бухгалтерский учёт': 'Contabilitate',
  'Excel / ручные отчёты': 'Excel / rapoarte manuale',
  'Управленческий P&L': 'Cont de profit și pierdere managerial',
  'Бюджет': 'Buget',
  'План-факт': 'Analiza plan–realizat',
  'CFO / финансовая команда': 'Director financiar / echipă financiară',
  'Финансовая модель': 'Model financiar',
  'Система есть, но требует улучшения': 'Există un sistem, dar necesită îmbunătățiri',

  // ── decision horizon ───────────────────────────────────────────────────────────────────────
  'Когда решение должно начать работать?': 'Când trebuie să producă efecte decizia?',
  'В течение недели': 'În decurs de o săptămână',
  'Есть конкретная ситуация или решение': 'Există o situație sau o decizie concretă',
  '2–4 недели': '2–4 săptămâni',
  'Результат нужен в ближайший месяц': 'Rezultatul este necesar în luna următoare',
  '1–3 месяца': '1–3 luni',
  'Можно провести полноценный цикл анализа': 'Se poate parcurge un ciclu complet de analiză',
  'Сначала хочу обсудить подход': 'Vreau mai întâi să discutăm abordarea',
  'Пока уточняем задачу и формат работы': 'Deocamdată clarificăm solicitarea și formatul de lucru',
  'Жёсткого срока нет': 'Fără termen strict',

  // ── documents ──────────────────────────────────────────────────────────────────────────────
  'Материалы для подготовки': 'Materiale pentru pregătire',
  'Если у вас уже есть материалы по задаче, отметьте, что доступно.': 'Dacă aveți deja materiale legate de solicitare, indicați ce este disponibil.',
  'Специально готовить документы сейчас не требуется.': 'Nu este nevoie să pregătiți documente special acum.',
  'Загружайте только материалы, необходимые для рассмотрения задачи.': 'Încărcați doar materialele necesare pentru analiza solicitării.',
  'По возможности не включайте персональные данные сотрудников, клиентов или других третьих лиц, если они не нужны для анализа.': 'Pe cât posibil, nu includeți date cu caracter personal ale angajaților, clienților sau ale altor terți, dacă nu sunt necesare pentru analiză.',
  'Платёжный календарь': 'Calendar de plăți',
  'Дебиторская и кредиторская задолженность': 'Creanțe și datorii comerciale',
  'Другие материалы по задаче': 'Alte materiale legate de solicitare',
  'Продолжить без материалов': 'Continuați fără materiale',

  // ── contact ────────────────────────────────────────────────────────────────────────────────
  'Как удобнее продолжить?': 'Cum preferați să continuăm?',
  'Здесь, в Telegram': 'Aici, în Telegram',
  'По телефону': 'Prin telefon',
  'По email': 'Prin e-mail',
  'В Telegram номер телефона не нужен.': 'În Telegram nu este nevoie de numărul de telefon.',

  // ── important context ──────────────────────────────────────────────────────────────────────
  'Есть ли что-то, что особенно важно знать до разговора?': 'Este ceva important de știut înainte de discuție?',
  'Например: через месяц встреча с банком; решение нужно принять до определённой даты; есть предложение партнёра, которое необходимо проверить.': 'De exemplu: peste o lună aveți o întâlnire cu banca; decizia trebuie luată până la o anumită dată; există oferta unui partener care trebuie verificată.',

  // ── review ─────────────────────────────────────────────────────────────────────────────────
  'Бриф для консультанта': 'Brief pentru consultant',
  'Проверьте, правильно ли FINMENTOR понял ситуацию.': 'Verificați dacă FINMENTOR a înțeles corect situația.',
  'Этого достаточно, чтобы консультант подготовился к первому разговору.': 'Este suficient pentru ca consultantul să se pregătească pentru prima discuție.',
  'Передать консультанту': 'Trimiteți consultantului',
  'Изменить': 'Modificați',
  'Добавить важное': 'Adăugați ce este important',
  'Материалы — указаны': 'Materiale — indicate',
  'Материалы — не указаны': 'Materiale — neindicate',

  // ── stages ─────────────────────────────────────────────────────────────────────────────────
  'Контекст': 'Context',
  'Подготовка': 'Pregătire',
  'Проверка': 'Verificare',

  // ── privacy ────────────────────────────────────────────────────────────────────────────────
  'FINMENTOR использует указанные вами данные для рассмотрения обращения, подготовки консультанта и связи с вами.': 'FINMENTOR folosește datele indicate de dumneavoastră pentru analiza solicitării, pregătirea consultantului și pentru a vă contacta.',
  'Передавая brief, вы подтверждаете, что ознакомились с информацией об обработке персональных данных.': 'Prin trimiterea brief-ului confirmați că ați luat cunoștință de informațiile privind prelucrarea datelor cu caracter personal.',
  'Результаты Финансового рентгена бизнеса (Financial X-Ray) и план действий на 30 дней готовятся автоматизированно с участием искусственного интеллекта на основе обезличенных ответов и являются предварительным управленческим анализом, а не аудитом и не индивидуальной финансовой консультацией. Итоговые экспертные рекомендации FINMENTOR формируются после проверки человеком. Технические записи об обработке (без персональных данных) хранятся в Supabase (ЕС).': 'Rezultatele Testului financiar FINMENTOR și planul de acțiune pentru 30 de zile sunt pregătite automatizat, cu ajutorul inteligenței artificiale (AI), pe baza răspunsurilor anonimizate, și reprezintă o analiză managerială preliminară, nu un audit și nici o consultanță financiară individuală. Recomandările finale ale experților FINMENTOR se formulează după verificarea de către o persoană. Înregistrările tehnice privind prelucrarea (fără date cu caracter personal) sunt păstrate în Supabase (UE).',
  'Как мы обрабатываем данные': 'Cum prelucrăm datele',
  'Политика конфиденциальности': 'Politica de confidențialitate',
  'Конфиденциальность и данные': 'Confidențialitate și date',

  'Финальный объём анализа консультант определит после изучения материалов.': 'Volumul final al analizei va fi stabilit de consultant după studierea materialelor.',
  'Если окно не закрылось, закройте его в верхней части экрана Telegram.': 'Dacă fereastra nu s-a închis, închideți-o din partea de sus a ecranului Telegram.',
  'Опишу ситуацию своими словами': 'Descriu situația cu propriile cuvinte',
  'Опишу ожидаемый результат сам': 'Descriu chiar eu rezultatul așteptat',

  // ── problems: financial management ─────────────────────────────────────────────────────────
  'Где сейчас основная сложность?': 'Unde este principala dificultate acum?',
  'Нет своевременной управленческой отчётности': 'Lipsește raportarea managerială la timp',
  'Цифры появляются слишком поздно для принятия решений': 'Cifrele apar prea târziu pentru a lua decizii',
  'Не доверяем данным': 'Nu avem încredere în date',
  'Отчёты есть, но цифры расходятся или вызывают вопросы': 'Există rapoarte, dar cifrele nu corespund sau ridică semne de întrebare',
  'Нет бюджета и план-факта': 'Nu există buget și analiză plan–realizat',
  'Сложно контролировать отклонения и заранее видеть результат': 'Este greu să controlăm abaterile și să anticipăm rezultatul',
  'Финансы зависят от ручной работы': 'Finanțele depind de munca manuală',
  'Много Excel, сверок и процессов, завязанных на отдельных людей': 'Prea mult Excel, reconcilieri și procese legate de anumite persoane',
  'Нет полноценной финансовой функции': 'Nu există o funcție financiară completă',
  'Нужно выстроить роль CFO, ответственность и систему управления': 'Trebuie definit rolul directorului financiar, responsabilitățile și sistemul de management',
  'Система есть, но хотим её улучшить': 'Sistemul există, dar vrem să îl îmbunătățim',
  'Нужно повысить качество, скорость и управляемость': 'Trebuie îmbunătățite calitatea, viteza și controlul',

  // ── problems: profitability ────────────────────────────────────────────────────────────────
  'Где сейчас теряется экономический результат?': 'Unde se pierde acum rezultatul economic?',
  'Не понимаем реальную прибыль': 'Nu înțelegem profitul real',
  'Бухгалтерский результат не даёт полной управленческой картины': 'Rezultatul contabil nu oferă o imagine managerială completă',
  'Снижается маржа': 'Marja scade',
  'Выручка есть, но прибыльность бизнеса ухудшается': 'Vânzările există, dar profitabilitatea afacerii se deteriorează',
  'Расходы растут быстрее бизнеса': 'Cheltuielile cresc mai repede decât afacerea',
  'Нужно определить причины и точки контроля': 'Trebuie identificate cauzele și punctele de control',
  'Не видим прибыль по направлениям': 'Nu vedem profitul pe direcții de activitate',
  'Непонятно, какие продукты, объекты или подразделения создают результат': 'Nu este clar ce produse, obiective sau divizii generează rezultatul',
  'Не уверены в себестоимости': 'Nu avem certitudine privind costul',
  'Нужно правильно распределить затраты и определить экономику продукта': 'Trebuie repartizate corect cheltuielile și stabilită economia produsului',
  'Нужно пересмотреть цены': 'Trebuie revizuite prețurile',
  'Нет уверенности, что текущая цена обеспечивает нужную доходность': 'Nu există certitudinea că prețul actual asigură rentabilitatea necesară',

  // ── problems: cash flow ────────────────────────────────────────────────────────────────────
  'Что именно происходит с деньгами?': 'Ce se întâmplă concret cu banii?',
  'Прибыль есть, денег не хватает': 'Există profit, dar banii nu ajung',
  'Продажи идут, но на счёте постоянно тесно': 'Vânzările merg, dar în cont este permanent strâmt',
  'Нет ясного прогноза': 'Nu există o prognoză clară',
  'Непонятно, что будет с деньгами через 2–3 месяца': 'Nu este clar ce se va întâmpla cu banii peste 2–3 luni',
  'Кассовые разрывы повторяются': 'Golurile de casă se repetă',
  'Приходится закрывать их срочно и дорого': 'Trebuie acoperite urgent și costisitor',
  'Платежи идут хаотично': 'Plățile se fac haotic',
  'Нет календаря и приоритетов по оплатам': 'Nu există calendar și priorități de plată',
  'Проблемы с дебиторкой': 'Probleme cu încasarea creanțelor',
  'Деньги слишком долго остаются у клиентов': 'Banii rămân prea mult timp la clienți',

  // ── problems: investment ───────────────────────────────────────────────────────────────────
  'Какое решение нужно принять по проекту?': 'Ce decizie trebuie luată privind proiectul?',
  'Стоит ли инвестировать': 'Merită să investim',
  'Нужно объективно оценить экономическую целесообразность': 'Trebuie evaluată obiectiv oportunitatea economică',
  'Неясна реальная доходность': 'Rentabilitatea reală nu este clară',
  'Нужно проверить возврат капитала и денежные потоки': 'Trebuie verificate recuperarea capitalului și fluxurile de numerar',
  'Слишком много неопределённости': 'Prea multă incertitudine',
  'Нужно сравнить сценарии и ключевые риски': 'Trebuie comparate scenariile și riscurile principale',
  'Есть предложение партнёра': 'Există oferta unui partener',
  'Нужно проверить экономику и условия сделки': 'Trebuie verificate economia și condițiile tranzacției',
  'Нужно определить объём инвестиций': 'Trebuie stabilit volumul investiției',
  'CAPEX и будущая потребность в финансировании пока неясны': 'Investițiile de capital (CAPEX) și necesarul viitor de finanțare sunt încă neclare',
  'Есть финансовая модель, но ей не доверяем': 'Există un model financiar, dar nu avem încredere în el',
  'Нужна независимая проверка': 'Este necesară o verificare independentă',

  // ── problems: real estate ──────────────────────────────────────────────────────────────────
  'Какое решение рассматриваете?': 'Ce decizie analizați?',
  'Покупка объекта': 'Achiziția unui imobil',
  'Продажа объекта': 'Vânzarea unui imobil',
  'Оставить объект и сдавать в аренду': 'Păstrarea imobilului și darea în chirie',
  'Нужно определить справедливую стоимость': 'Trebuie stabilită valoarea justă',
  'Реконструкция / redevelopment': 'Reconstrucție / reconversie',
  'Нужно проверить доходность объекта': 'Trebuie verificată rentabilitatea imobilului',
  'Есть риск по арендатору или договору': 'Există un risc legat de chiriaș sau de contract',

  // ── problems: financing ────────────────────────────────────────────────────────────────────
  'Что сейчас требует решения?': 'Ce necesită o decizie acum?',
  'Нужно банковское финансирование': 'Este necesară finanțarea bancară',
  'Нужно привлечь инвестора': 'Trebuie atras un investitor',
  'Не устраивает текущая долговая нагрузка': 'Gradul actual de îndatorare nu este convenabil',
  'Нужно рефинансирование': 'Este necesară refinanțarea',
  'Нужно финансирование нового проекта': 'Este necesară finanțarea unui proiect nou',
  'Нужно подготовиться к переговорам с банком': 'Trebuie pregătite negocierile cu banca',
  'Неясно, сколько долга бизнес может безопасно обслуживать': 'Nu este clar ce nivel de datorie poate susține afacerea în siguranță',

  // ── problems: free text branches ───────────────────────────────────────────────────────────
  'Какое решение сейчас сложно принять?': 'Ce decizie vă este greu să luați acum?',
  'Опишите ситуацию своими словами.': 'Descrieți situația cu propriile cuvinte.',
  'Особенно полезно понять, какое решение вы откладываете или где вам не хватает финансовой информации.': 'Este deosebit de util să înțelegem ce decizie amânați sau unde vă lipsesc informațiile financiare.',
  'Например: бизнес растёт, но я не понимаю, почему денег становится меньше и могу ли сейчас открывать ещё одну точку.': 'De exemplu: afacerea crește, dar nu înțeleg de ce sunt tot mai puțini bani și dacă pot deschide acum încă un punct de lucru.',
  'Расскажите о задаче': 'Descrieți solicitarea',
  'Опишите ситуацию так, как рассказали бы её консультанту на первой встрече.': 'Descrieți situația așa cum i-ați povesti-o consultantului la prima întâlnire.',
  'Что происходит, какое решение нужно принять и что сейчас мешает его принять?': 'Ce se întâmplă, ce decizie trebuie luată și ce vă împiedică acum să o luați?',

  // ── outcomes: financial management ─────────────────────────────────────────────────────────
  'Какой результат вам нужен в первую очередь?': 'Ce rezultat vă este necesar în primul rând?',
  'Получать управленческую отчётность вовремя': 'Să primiți raportarea managerială la timp',
  'P&L, Cash Flow, Balance и ключевые показатели': 'Cont de profit și pierdere (P&L), flux de numerar, bilanț managerial (Balance) și indicatori-cheie',
  'Настроить бюджетирование и план-факт': 'Să organizați bugetarea și analiza plan–realizat',
  'Планировать результат и контролировать отклонения': 'Să planificați rezultatul și să controlați abaterile',
  'Создать понятную систему финансового контроля': 'Să creați un sistem clar de control financiar',
  'Ответственность, правила, сроки и контрольные точки': 'Responsabilități, reguli, termene și puncte de control',
  'Выстроить финансовую функцию / CFO': 'Să organizați funcția financiară / directorul financiar',
  'Определить процессы, роли и формат управления': 'Să definiți procesele, rolurile și formatul de management',
  'Автоматизировать финансовую отчётность': 'Să automatizați raportarea financiară',
  'Снизить ручную работу и зависимость от Excel': 'Să reduceți munca manuală și dependența de Excel',
  'Провести диагностику существующей системы': 'Să faceți diagnosticul sistemului existent',
  'Понять, что работает, а что необходимо перестроить': 'Să înțelegeți ce funcționează și ce trebuie reconstruit',

  // ── outcomes: profitability ────────────────────────────────────────────────────────────────
  'Что хотите получить на выходе?': 'Ce doriți să obțineți ca rezultat?',
  'Понять реальную прибыльность бизнеса': 'Să înțelegeți profitabilitatea reală a afacerii',
  'Найти источники потерь и лишних расходов': 'Să identificați sursele de pierderi și cheltuielile inutile',
  'Посчитать прибыль по направлениям / продуктам': 'Să calculați profitul pe direcții / produse',
  'Определить корректную себестоимость': 'Să stabiliți costul corect',
  'Пересмотреть цены и маржинальность': 'Să revizuiți prețurile și marjele',
  'Создать систему постоянного контроля эффективности': 'Să creați un sistem permanent de control al eficienței',

  // ── outcomes: cash flow ────────────────────────────────────────────────────────────────────
  'Понять причины кассовых разрывов': 'Să înțelegeți cauzele golurilor de casă',
  'Найти, где именно теряется ликвидность': 'Să identificați exact unde se pierde lichiditatea',
  'Получить прогноз движения денег': 'Să obțineți o prognoză a mișcării banilor',
  'Понимать cash position на несколько месяцев вперёд': 'Să cunoașteți poziția de numerar cu câteva luni înainte',
  'Настроить платежи и контроль': 'Să organizați plățile și controlul',
  'Платёжный календарь, приоритеты, ответственность': 'Calendar de plăți, priorități, responsabilități',
  'Подготовиться к банку / финансированию': 'Să vă pregătiți pentru bancă / finanțare',
  'Показать понятный прогноз и способность обслуживать обязательства': 'Să prezentați o prognoză clară și capacitatea de a susține obligațiile',
  'Построить систему управления Cash Flow': 'Să construiți un sistem de gestiune a fluxului de numerar',
  'Не разовый расчёт, а работающий процесс': 'Nu un calcul singular, ci un proces care funcționează',
  'Нужна рекомендация, с чего начать': 'Am nevoie de o recomandare privind punctul de plecare',
  'Сначала определить правильный формат решения': 'Să stabilim mai întâi formatul potrivit al soluției',

  // ── outcomes: investment ───────────────────────────────────────────────────────────────────
  'Какой результат вам нужен?': 'Ce rezultat vă este necesar?',
  'GO / NO-GO по инвестиции': 'Investim / nu investim',
  'Профессиональная финансовая модель': 'Un model financiar profesionist',
  'Расчёт IRR / NPV / Payback / MOIC': 'Rata internă de rentabilitate, valoarea actualizată netă, perioada de recuperare și multiplul capitalului investit (IRR / NPV / Payback / MOIC)',
  'Сравнение нескольких сценариев': 'Compararea mai multor scenarii',
  'Оптимальная структура финансирования': 'Structura optimă de finanțare',
  'Независимая проверка проекта или предложения партнёра': 'Verificarea independentă a proiectului sau a ofertei partenerului',

  // ── outcomes: real estate ──────────────────────────────────────────────────────────────────
  'Что нужно получить для принятия решения?': 'Ce vă este necesar pentru a lua decizia?',
  'Оценить инвестиционную привлекательность': 'Evaluarea atractivității investiționale',
  'Определить максимальную цену покупки': 'Stabilirea prețului maxim de achiziție',
  'Определить минимальную цену продажи': 'Stabilirea prețului minim de vânzare',
  'Посчитать доходность владения': 'Calculul rentabilității deținerii',
  'Сравнить: продать или оставить': 'Comparație: vindem sau păstrăm',
  'Построить DCF / сценарную модель': 'Construirea unui model bazat pe fluxuri de numerar actualizate (DCF) și pe scenarii',
  'Оценить риски арендаторов и денежных потоков': 'Evaluarea riscurilor legate de chiriași și de fluxurile de numerar',

  // ── outcomes: financing ────────────────────────────────────────────────────────────────────
  'Какого результата ожидаете?': 'Ce rezultat așteptați?',
  'Определить необходимый объём финансирования': 'Stabilirea volumului necesar de finanțare',
  'Подготовить финансовую модель для банка': 'Pregătirea unui model financiar pentru bancă',
  'Определить безопасную долговую нагрузку': 'Stabilirea unui grad de îndatorare sigur',
  'Сравнить варианты финансирования': 'Compararea variantelor de finanțare',
  'Подготовить материалы для инвестора': 'Pregătirea materialelor pentru investitor',
  'Выстроить структуру капитала': 'Construirea structurii capitalului',

  // ── outcomes: independent view ─────────────────────────────────────────────────────────────
  'Чем FINMENTOR должен помочь в первую очередь?': 'Cu ce trebuie să ajute FINMENTOR în primul rând?',
  'Разобраться, где находится основная проблема': 'Să lămurim unde se află problema principală',
  'Определить приоритеты': 'Stabilirea priorităților',
  'Получить независимую оценку ситуации': 'O evaluare independentă a situației',
  'Понять, какие цифры нужно начать контролировать': 'Să înțelegeți ce cifre trebuie urmărite',
  'Подготовить варианты решения': 'Pregătirea variantelor de soluție',
  'Сначала обсудить ситуацию с консультантом': 'Mai întâi o discuție cu consultantul',

  // ── outcomes: other ────────────────────────────────────────────────────────────────────────
  'Какой результат был бы для вас полезен?': 'Ce rezultat v-ar fi util?',
  'Получить расчёт': 'Un calcul',
  'Получить финансовую модель': 'Un model financiar',
  'Сравнить варианты': 'Compararea variantelor',
  'Проверить существующий расчёт / предложение': 'Verificarea unui calcul / a unei oferte existente',
  'Получить независимую рекомендацию': 'O recomandare independentă',
  'Обсудить задачу с консультантом': 'O discuție cu consultantul despre solicitare',

  // ── focus map (what the analysis will look at) ──────────────────────────────────────────────
  'Качество управленческой информации': 'Calitatea informației manageriale',
  'Планирование и контроль': 'Planificare și control',
  'Организация финансовой функции': 'Organizarea funcției financiare',
  'Факторы прибыли и маржи': 'Factorii profitului și ai marjei',
  'Себестоимость и структура расходов': 'Costurile și structura cheltuielilor',
  'Экономика направлений / продуктов': 'Economia direcțiilor / produselor',
  'Ликвидность и причины cash gap': 'Lichiditatea și cauzele golurilor de numerar',
  'Оборотный капитал': 'Capitalul de lucru',
  'Прогноз движения денежных средств': 'Prognoza fluxurilor de numerar',
  'Экономика проекта и исходные допущения': 'Economia proiectului și ipotezele inițiale',
  'Доходность и чувствительность сценариев': 'Rentabilitatea și sensibilitatea scenariilor',
  'Структура инвестиций и ключевые риски': 'Structura investiției și riscurile principale',
  'Денежный поток объекта': 'Fluxul de numerar al imobilului',
  'Доходность и стоимость капитала': 'Rentabilitatea și costul capitalului',
  'Сценарии владения / продажи': 'Scenarii de deținere / vânzare',
  'Потребность в капитале': 'Necesarul de capital',
  'Способность обслуживать обязательства': 'Capacitatea de a susține obligațiile',
  'Структура финансирования': 'Structura finanțării',
  'Управленческое решение, которое нужно принять': 'Decizia managerială care trebuie luată',
  'Качество доступной финансовой информации': 'Calitatea informației financiare disponibile',
  'Приоритеты для дальнейшего анализа': 'Prioritățile pentru analiza următoare',
  'Контекст задачи': 'Contextul solicitării',
  'Решение, которое требуется принять': 'Decizia care trebuie luată',
  'Каких данных не хватает для следующего шага': 'Ce date lipsesc pentru pasul următor',

  // ── edit screen ────────────────────────────────────────────────────────────────────────────
  'Что хотите изменить?': 'Ce doriți să modificați?',
  'Поправим один пункт и вернёмся к брифу.': 'Corectăm un singur punct și revenim la brief.',
  'Вернуться к брифу': 'Înapoi la brief',
  'Роль': 'Rol',
  'Масштаб': 'Dimensiune',
  'Задача': 'Obiectiv',
  'Проблема': 'Problemă',
  'Ожидаемый результат': 'Rezultat așteptat',
  'Текущая система': 'Sistemul actual',
  'Срок': 'Termen',
  'Материалы': 'Materiale',
  'Контакт': 'Contact',
  'Важный контекст': 'Context important',

  // ── success ────────────────────────────────────────────────────────────────────────────────
  'Принято': 'Primit',
  'Передано консультанту': 'Transmis consultantului',
  'Контекст передан команде FINMENTOR.': 'Contextul a fost transmis echipei FINMENTOR.',
  'Консультант увидит информацию о компании, вашу задачу и какие материалы доступны до первого разговора.': 'Consultantul va vedea informațiile despre companie, solicitarea dumneavoastră și ce materiale sunt disponibile înainte de prima discuție.',
  'Консультант увидит информацию о компании и вашу задачу до первого разговора.': 'Consultantul va vedea informațiile despre companie și solicitarea dumneavoastră înainte de prima discuție.',
  'Повторять всё сначала не потребуется.': 'Nu va fi nevoie să reluați totul de la început.',
  'Что дальше': 'Ce urmează',
  'FINMENTOR изучит бриф.': 'FINMENTOR va studia brief-ul.',
  'При необходимости уточним детали.': 'Dacă este nevoie, vom clarifica detaliile.',
  'Согласуем следующий контакт.': 'Vom stabili următorul contact.',
  'Вернуться в Telegram': 'Înapoi în Telegram',

  // ── failure ────────────────────────────────────────────────────────────────────────────────
  'Заявка пока не отправлена': 'Solicitarea nu a fost încă trimisă',
  'Возникла техническая ошибка при передаче.': 'A apărut o eroare tehnică la transmitere.',
  'Ваше обращение не считается принятым.': 'Solicitarea dumneavoastră nu este considerată primită.',
  'Повторно проходить вопросы не нужно.': 'Nu este nevoie să parcurgeți din nou întrebările.',
  'Повторить отправку': 'Trimiteți din nou',
  'Вернуться к резюме': 'Înapoi la sinteză',

  // ── bootstrap failure ──────────────────────────────────────────────────────────────────────
  'Не удалось открыть форму': 'Formularul nu a putut fi deschis',
  'Возникла техническая ошибка при подключении.': 'A apărut o eroare tehnică la conectare.',
  'Ничего не было отправлено.': 'Nu a fost trimis nimic.',
  'Закройте окно и откройте форму заново из чата.': 'Închideți fereastra și deschideți din nou formularul din conversație.',
  'Закрыть': 'Închideți',

  // ── session expired ────────────────────────────────────────────────────────────────────────
  'Время сессии истекло': 'Sesiunea a expirat',
  'Форма была открыта больше 72 часов назад.': 'Formularul a fost deschis acum mai bine de 72 de ore.',
  'Ваше обращение не было отправлено консультанту.': 'Solicitarea dumneavoastră nu a fost trimisă consultantului.',
  'Откройте форму заново из чата, чтобы продолжить.': 'Deschideți din nou formularul din conversație pentru a continua.',

  // ── resume ─────────────────────────────────────────────────────────────────────────────────
  'У вас есть незавершённый бриф.': 'Aveți un brief nefinalizat.',
  'Можно продолжить с того места, где остановились — подтверждённые данные сохранены.': 'Puteți continua de unde ați rămas — datele confirmate sunt păstrate.',
  'Продолжить': 'Continuați',
  'Начать заново': 'Începeți din nou',

  // ── Concierge (Telegram) ───────────────────────────────────────────────────────────────────
  '<b>FINMENTOR</b>\n<i>Подготовка к первой встрече</i>': '<b>FINMENTOR</b>\n<i>Pregătirea primei întâlniri</i>',
  'Здравствуйте.': 'Bună ziua.',
  '<b>Консультант должен понимать ваш бизнес ещё до начала разговора.</b>': '<b>Consultantul trebuie să vă înțeleagă afacerea încă înainte de începerea discuției.</b>',
  'FINMENTOR поможет заранее зафиксировать компанию, задачу и ожидаемый результат — чтобы первая встреча началась сразу по существу.': 'FINMENTOR vă ajută să notați din timp compania, solicitarea și rezultatul așteptat — astfel încât prima întâlnire să înceapă direct la obiect.',
  '<b>Выберите удобный формат:</b>': '<b>Alegeți formatul potrivit:</b>',
  '<b>Описать задачу</b> — расскажите ситуацию своими словами.\n<b>Подготовить бриф</b> — структурируйте ключевой контекст за несколько минут.': '<b>Descrieți solicitarea</b> — povestiți situația cu propriile cuvinte.\n<b>Pregătiți brief-ul</b> — structurați contextul esențial în câteva minute.',
  '<i>Перед отправкой всё можно проверить и изменить.</i>': '<i>Înainte de trimitere puteți verifica și modifica totul.</i>',
  'Описать задачу': 'Descrieți solicitarea',
  'Подготовить бриф': 'Pregătiți brief-ul',
  '<b>Расскажите о ситуации своими словами.</b>': '<b>Povestiți situația cu propriile cuvinte.</b>',
  'Представьте, что первый разговор с консультантом уже начался.': 'Imaginați-vă că prima discuție cu consultantul a început deja.',
  'Что происходит в бизнесе, какое решение вам нужно принять и что сейчас мешает сделать это уверенно?': 'Ce se întâmplă în afacere, ce decizie trebuie să luați și ce vă împiedică acum să o luați cu încredere?',
  '<i>Можно писать свободно — FINMENTOR сам выделит ключевой контекст.</i>': '<i>Puteți scrie liber — FINMENTOR va extrage singur contextul esențial.</i>',
  '<b>Проверьте, правильно ли FINMENTOR понял контекст.</b>': '<b>Verificați dacă FINMENTOR a înțeles corect contextul.</b>',
  'Ваша роль': 'Rolul dumneavoastră',
  'Основная ситуация': 'Situația principală',
  '<i>Если всё верно, этот контекст перейдёт в бриф — повторно отвечать на эти вопросы не потребуется.</i>': '<i>Dacă totul este corect, acest context va trece în brief — nu va fi nevoie să răspundeți din nou la aceste întrebări.</i>',
  'Всё верно': 'Totul este corect',
  'Исправить': 'Corectați',
  '<b>Контекст сохранён.</b>': '<b>Contextul a fost salvat.</b>',
  'Осталось уточнить несколько деталей, которые помогут консультанту подготовиться к первой встрече.': 'Mai rămân de clarificat câteva detalii care îl vor ajuta pe consultant să se pregătească pentru prima întâlnire.',
  '<i>В брифе не придётся повторять подтверждённую информацию.</i>': '<i>În brief nu va trebui să repetați informațiile deja confirmate.</i>',
  'Открыть бриф': 'Deschideți brief-ul',
  '<b>Последнее обращение уже передано FINMENTOR.</b>': '<b>Ultima solicitare a fost deja transmisă către FINMENTOR.</b>',
  'Можно дополнить его новой информацией или начать отдельный вопрос.': 'O puteți completa cu informații noi sau puteți deschide o solicitare separată.',
  'Добавить к обращению': 'Completați solicitarea',
  'Начать новый вопрос': 'Deschideți o solicitare nouă',
  '<b>Добавить к текущему обращению</b>': '<b>Completarea solicitării curente</b>',
  'Напишите то, что важно передать консультанту дополнительно.': 'Scrieți ce este important să îi transmiteți suplimentar consultantului.',
  'Это сообщение будет связано с уже существующим обращением и не создаст новое.': 'Acest mesaj va fi asociat solicitării existente și nu va crea una nouă.',
  '<b>Информация добавлена.</b>': '<b>Informația a fost adăugată.</b>',
  'Консультант увидит её вместе с текущим обращением.': 'Consultantul o va vedea împreună cu solicitarea curentă.',
  '<i>Новое обращение не создавалось.</i>': '<i>Nu a fost creată o solicitare nouă.</i>',
  'Вернуться': 'Înapoi',
  '<b>Начать новый вопрос?</b>': '<b>Deschideți o solicitare nouă?</b>',
  'Текущее обращение останется без изменений.': 'Solicitarea curentă rămâne neschimbată.',
  'Для новой задачи будет создан отдельный бриф.': 'Pentru noua solicitare va fi creat un brief separat.',
  '<b>Не удалось продолжить.</b>': '<b>Continuarea nu a fost posibilă.</b>',
  'Произошла техническая ошибка.': 'A apărut o eroare tehnică.',
  'Текущее действие не завершено, и новое обращение не создано.': 'Acțiunea curentă nu a fost finalizată și nu a fost creată o solicitare nouă.',
  '<i>Попробуйте ещё раз — новый вопрос создавать не нужно, сохранённые шаги повторять не потребуется.</i>': '<i>Încercați din nou — nu este nevoie să deschideți o solicitare nouă, iar pașii salvați nu trebuie repetați.</i>',
  'Повторить': 'Încercați din nou',
  '<b>У вас есть незавершённый бриф.</b>': '<b>Aveți un brief nefinalizat.</b>',
  '<b>Начать новый бриф?</b>': '<b>Începeți un brief nou?</b>',
  'Текущий черновик будет заменён.': 'Ciorna curentă va fi înlocuită.',
  'Уже переданные обращения это не затронет.': 'Solicitările deja transmise nu vor fi afectate.',
  'Начать новое': 'Începeți din nou'
};

// ── Mini App shell ───────────────────────────────────────────────────────────────────────────
//
// Strings hardcoded in app-premium/app.js OUTSIDE the `UI` locale table — screen titles, field
// labels, role options, the progress strip and the submitting/loading copy. They are not part of
// the branches.js contract, so they were never localised; before Sprint 1 they were the reason a
// Romanian customer met Russian chrome around Romanian content.
//
// The role options below ('Собственник', 'Генеральный директор', …) are MACHINE VALUES: app.js
// stores the Russian literal and the Pipeline keeps it. Only what is painted changes, and only
// because `el()` translates at the render boundary while `set()` never does.
//
// qa/premium-ux-ro-parity.test.mjs re-extracts these from app.js and fails on any that is missing
// here, so a new hardcoded Russian string cannot quietly appear on the Romanian path.
const SHELL_RO = {
  'срок': 'termen',
  'материалы': 'materiale',
  'Уже понятно': 'Deja clar',
  'Осталось уточнить ': 'Mai rămâne de clarificat ',
  ' и ': ' și ',
  'Осталось проверить бриф.': 'Mai rămâne de verificat brief-ul.',
  'Открываем форму…': 'Se deschide formularul…',
  'Подготовка к встрече': 'Pregătirea întâlnirii',
  'Подготовим бриф для консультанта.': 'Pregătim brief-ul pentru consultant.',
  'Несколько уточнений — и консультант FINMENTOR войдёт в первый разговор уже подготовленным. Около трёх минут.': 'Câteva clarificări și consultantul FINMENTOR va intra pregătit în prima discuție. Durează aproximativ trei minute.',
  'Из Telegram': 'Din Telegram',
  'спрашивать не будем': 'nu vom întreba',
  'Начать': 'Începeți',
  'подтверждено': 'confirmat',
  'Название': 'Denumirea',
  'Чем занимается': 'Domeniul de activitate',
  'Например: сеть продуктовых магазинов': 'De exemplu: rețea de magazine alimentare',
  'Ваша роль в компании': 'Rolul dumneavoastră în companie',
  'Это меняет то, с чего консультант начнёт разговор.': 'Aceasta schimbă punctul din care consultantul începe discuția.',
  'Собственник': 'Proprietar',
  'Генеральный директор': 'Director general',
  'Финансовый директор': 'Director financiar',
  'Руководитель направления': 'Responsabil de direcție',
  'Другая роль': 'Alt rol',
  // extracted role label from context-extraction.js (Concierge confirm screen)
  'Руководитель': 'Manager',
  'Масштаб компании': 'Dimensiunea companiei',
  'Ориентировочный годовой оборот.': 'Cifra de afaceri anuală aproximativă.',
  'Опишите ожидаемый результат.': 'Descrieți rezultatul așteptat.',
  'Телефон': 'Telefon',
  'Что важно знать до разговора?': 'Ce este important de știut înainte de discuție?',
  'Необязательно.': 'Opțional.',
  'Сформировать бриф': 'Generați brief-ul',
  'Горизонт': 'Orizont',
  'Важно до встречи': 'Important înainte de întâlnire',
  'Фокус первой встречи': 'Focusul primei întâlniri',
  'Контекст компании': 'Contextul companiei',
  'готов': 'gata',
  'готова': 'gata',
  'Передать бриф консультанту?': 'Trimiteți brief-ul consultantului?',
  ' категорий материалов': ' categorii de materiale',
  'без материалов': 'fără materiale',
  'ответ в Telegram': 'răspuns în Telegram',
  'ответ по контакту': 'răspuns prin datele de contact',
  'Передаём бриф…': 'Se trimite brief-ul…',
  'Не закрывайте окно.': 'Nu închideți fereastra.',
  'Статус:': 'Stare:'
};

module.exports = { RO_LABELS, SHELL_RO };
