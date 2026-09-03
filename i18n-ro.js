/* FINMENTOR — Romanian i18n bundle.
   Loaded ONLY on /ro/ pages, BEFORE main.js and assistant.js.
   Defines window.FM_I18N consumed via tr(key, ruFallback) and I18N.* structures.
   RU pages never load this file. */
(function () {
  'use strict';

  // Same Discovery Call target logic as assistant.js disco(): scripts run at end of body, DOM is parsed.
  var DISCO = document.getElementById('consult') ? '#consult' : 'index.html#consult';

  window.FM_I18N = {
    lang: 'ro',

    strings: {
      /* ---- header / drawer ---- */
      logoAria: 'finmentor — pagina principală',
      menuOpen: 'Deschideți meniul',
      menuClose: 'Închideți meniul',
      mobileNavAria: 'Navigare mobilă',
      navHome: 'Pagina principală',
      navAudience: 'Pentru cine',
      navSteps: 'Cum lucrăm',
      navSolutions: 'Soluții',
      navMaterials: 'Materiale',
      navXray: 'Test de sănătate financiară',
      navContacts: 'Contacte',
      langLabel: 'Limbă · Язык',
      langAria: 'Selectarea limbii',
      ctaXray: 'Începeți Testul de sănătate financiară',
      ctaBot: 'Mai bine scrieți direct → FINMENTOR Bot',

      /* ---- cases block ---- */
      caseKicker: 'Studiu de caz',
      caseProblem: 'Problema',
      caseSolution: 'Decizia FINMENTOR',
      caseResult: 'Rezultatul',
      caseCtaBcs: 'Construiți sistemul de management',
      caseCtaDefault: 'Discutați cazul dvs.',

      /* ---- forms / cookies ---- */
      formFail: '<strong>Trimiterea automată a solicitării nu a reușit.</strong> Copiați textul solicitării și trimiteți-l în <a href="https://t.me/finmentor_md_bot" target="_blank" rel="noopener noreferrer">FINMENTOR Bot</a> sau la <a href="mailto:cfo@finmentor.md">cfo@finmentor.md</a>.',
      formConflict: '<strong>Această solicitare a fost deja procesată.</strong> Datele s-au schimbat față de momentul trimiterii, așa că nu a fost acceptată din nou. Începeți o solicitare nouă.',
      formNewRequest: 'Începeți o solicitare nouă',
      scanConflict: 'Această solicitare a fost deja procesată. Datele s-au schimbat, așa că nu a fost acceptată din nou. Începeți o solicitare nouă.',
      cookieAria: 'Setările cookies FINMENTOR',
      cookieTitle: 'Cookies și analitică',
      cookieText: 'FINMENTOR folosește cookies tehnice și analitică anonimizată. Datele personale nu se trimit în GA4.',
      cookieDeny: 'Doar cele necesare',
      cookieAccept: 'Accept',

      /* ---- questionnaire copy ---- */
      qCopyTitle: 'FINMENTOR — Chestionar de diagnostic',
      copied: 'Copiat ✓',
      copyAnswers: 'Copiați răspunsurile',

      /* ---- working-capital scan share ---- */
      wcShareTitle: 'Mini-scanarea capitalului de lucru — FINMENTOR',
      wcResult: 'Rezultat',
      wcName: 'Nume',
      wcCompany: 'Companie',
      wcContact: 'Contact',
      wcComment: 'Comentariu',
      wcShareUrl: 'https://www.finmentor.md/ro/working-capital-scan.html',

      /* ---- financial navigator (assistant) ---- */
      faDisclaimer: 'Asistentul ajută la alegerea primului pas. Nu este o concluzie financiară și nici o recomandare individuală.',
      faLaunchAria: 'Ajutor la alegerea pasului următor',
      faLaunchLg: 'Aveți nevoie de un indiciu?',
      faLaunchSm: 'Ajutor la alegerea pasului',
      faPanelTitle: 'Navigatorul financiar FINMENTOR',
      faCloseAria: 'Închideți navigatorul',
      faIntro: 'Vă ajut să alegeți primul pas: mini-scanarea, diagnosticul, Discovery Call sau pagina potrivită. Nu este o concluzie financiară — pentru analiza datelor este necesar diagnosticul.',
      faQ: 'Ce vă îngrijorează acum cel mai mult?',
      faBackAria: 'Înapoi la selecție',
      faBack: 'Înapoi'
    },

    groups: [
      { id: 'expertise', label: 'Expertiză' },
      { id: 'industry', label: 'Industrii' },
      { id: 'system', label: 'Sistem' }
    ],

    cases: [
      { id: 'finance', group: 'expertise', chip: 'Finance', dir: 'Finance · Contabilitate managerială',
        title: 'Proprietarul nu înțelege profitul real al afacerii',
        problem: 'Profit contabil există, dar banii din conturi nu ajung.',
        solution: 'Construirea P&L, Cash Flow, a contabilității manageriale și a analizei plan–realizat.',
        result: 'Proprietarul vede profitul real, marjele, costurile și punctele de pierdere.' },
      { id: 'treasury', group: 'expertise', chip: 'Treasury', dir: 'Treasury · Trezorerie',
        title: 'Banii se cheltuiesc haotic, apar goluri de numerar',
        problem: 'Plățile merg fără priorități, nu există rezerve și fonduri.',
        solution: 'Planificare pe fonduri, calendarul plăților, limite, rezerve, controlul Cash Gap.',
        result: 'Banii se distribuie după reguli, proprietarul vede din timp deficitul de lichiditate.' },
      { id: 'bi', group: 'expertise', chip: 'Power BI + 1C', dir: 'Power BI + 1C Integration',
        title: 'Conducătorul primește rapoartele din 1C târziu și manual',
        problem: 'Datele există în 1C, Excel și tabele diferite, dar o imagine unică a afacerii nu există.',
        solution: 'Integrarea 1C cu Power BI, configurarea modelului de date, dashboard-uri automate.',
        tagsLabel: 'Ce se vede în Power BI',
        tags: ['venituri','profit','cheltuieli','creanțe','datorii furnizori','solduri de bani','vânzări','depozit','marje','KPI','plan–realizat','cash flow','chirie','CAPEX','proiecte'],
        result: 'Proprietarul deschide dashboard-ul și vede afacerea în timp real — fără pregătirea manuală a rapoartelor.' },
      { id: 'ai', group: 'expertise', chip: 'Digital Automation', dir: 'Digital Automation',
        title: 'Raportarea financiară se adună manual',
        problem: 'Angajații pierd mult timp cu colectarea datelor, aprobările și rapoartele.',
        solution: 'Automatizare prin Make, n8n și scenarii digitale.',
        tagsLabel: 'Exemple de automatizare',
        tags: ['colectarea automată a rapoartelor','notificări despre riscuri','controlul creanțelor restante','notificări către responsabili','analiza abaterilor și alerte automate','raport managerial','integrare Google Sheets / email / CRM / 1C / Power BI'],
        result: 'Mai puțină muncă manuală, control mai rapid, mai puține erori.' },
      { id: 'realestate', group: 'industry', chip: 'Imobiliare', dir: 'Real Estate · Imobiliare',
        title: 'Imobilul se închiriază, dar proprietarul nu îi înțelege randamentul',
        problem: 'Chirie există, dar nu există analiza NOI, ROA, a recuperării, a riscurilor chiriașilor și a chiriei de piață.',
        solution: 'Modelul de randament al imobilului, analiza chiriașilor, rent-to-sales, NPV, IRR, Cap Rate, DSCR.',
        result: 'Proprietarul înțelege dacă imobilul este avantajos, unde sunt riscurile și cum crește valoarea activului.' },
      { id: 'construction', group: 'industry', chip: 'Construcții', dir: 'Construction · Construcții',
        title: 'CAPEX scapă de sub control',
        problem: 'Cheltuielile de construcție cresc, antreprenorii schimbă devizele, un control transparent al bugetului nu există.',
        solution: 'Dashboard CAPEX, plan–realizat pe articole, controlul antreprenorilor, bugetul proiectului, cash flow-ul construcției.',
        result: 'Proprietarul vede abaterile, depășirile și prognoza bugetului până la finalizarea proiectului.' },
      { id: 'production', group: 'industry', chip: 'Producție', dir: 'Production · Producție',
        title: 'Compania nu înțelege costul și marjele produselor',
        problem: 'Vânzările cresc, dar profitul nu se mărește.',
        solution: 'Analiza costului, a marjelor, a stocurilor, KPI de producție și plan–realizat pe costuri.',
        result: 'Se vede ce produse sunt profitabile, unde sunt pierderile și ce trebuie optimizat.' },
      { id: 'ecommerce', group: 'industry', chip: 'E-commerce', dir: 'E-commerce',
        title: 'Rulajul crește, dar bani și profit nu există',
        problem: 'Marketingul, depozitul, logistica și retururile mănâncă marja.',
        solution: 'Unit economics, CAC, LTV, ROMI, marjele canalelor, cash flow, dashboard Power BI.',
        result: 'Proprietarul înțelege ce canale și produse câștigă cu adevărat.' },
      { id: 'trade', group: 'industry', chip: 'Comerț', dir: 'Trade · Comerț și distribuție',
        title: 'Banii sunt înghețați în depozit',
        problem: 'Stocuri mari, rotație scăzută, nu există analiza profitabilității categoriilor.',
        solution: 'Analiză ABC/XYZ, rotație, marje, dashboard de depozit, plan de achiziții.',
        result: 'Mai puțini bani înghețați, gestionare mai bună a sortimentului și a achizițiilor.' },
      { id: 'bcs', group: 'system', chip: 'Business Control System', dir: 'Business Control System',
        title: 'Proprietarul vrea să vadă toată afacerea într-un singur sistem',
        problem: 'Finanțele, vânzările, depozitul, proiectele, KPI și banii — în locuri diferite.',
        solution: 'Business Control System — un circuit unic de management al afacerii.',
        tagsLabel: 'Include',
        tags: ['P&L','Cash Flow','Treasury','planificare pe fonduri','Power BI','integrare 1C','KPI','AI automation','harta riscurilor','plan de acțiuni pe 90 de zile'],
        result: 'Proprietarul conduce afacerea prin cifre, analitică și AI.' }
    ],

    wcLevels: {
      low: {
        band: 'Risc scăzut · control de bază există',
        title: 'Aveți deja o parte din control',
        text: 'Pasul următor — legați capitalul de lucru de Cash Flow, calendarul plăților și raportarea managerială regulată.'
      },
      medium: {
        band: 'Risc mediu · banii se pot bloca',
        title: 'Există semne că banii se blochează',
        text: 'Se pare că banii se pot bloca în creanțe, stocuri, avansuri sau în disciplina de plată. Merită făcut un diagnostic al capitalului de lucru și al Cash Flow.'
      },
      high: {
        band: 'Risc ridicat · este necesar un diagnostic',
        title: 'Banii, probabil, sunt gestionați reactiv',
        text: 'Este foarte probabil ca plățile să se decidă manual, cash gap-ul să se vadă târziu, iar profitul să nu se transforme în cash flow liber. Se recomandă Financial Health Check sau Discovery Call.'
      }
    },

    assistantScenarios: [
      { choose: 'assistant_choose_working_capital',
        opt: 'Profit există, dar banii nu ajung',
        a: 'Deseori cauza este în capitalul de lucru: creanțe, stocuri, avansuri sau condiții de plată. Începeți cu mini-scanarea scurtă.',
        ctas: [
          { l: 'Începeți mini-scanarea', h: 'working-capital-scan.html', e: 'assistant_click_mini_scan', p: true },
          { l: 'Pagina despre capitalul de lucru', h: 'working-capital.html' },
          { l: 'Discovery Call', h: DISCO, e: 'assistant_click_discovery_call' }
        ] },
      { choose: 'assistant_choose_treasury',
        opt: 'Plățile merg haotic',
        a: 'Într-o asemenea situație sunt necesare, de regulă, calendarul plăților, prioritățile de plată și controlul acoperirii pe 7 / 14 / 30 de zile.',
        ctas: [
          { l: 'Deschideți trezoreria', h: 'kaznacheystvo.html', p: true },
          { l: 'Vedeți metodologia', h: 'methodology.html' },
          { l: 'Discovery Call', h: DISCO, e: 'assistant_click_discovery_call' }
        ] },
      { choose: 'assistant_choose_reporting',
        opt: 'Nu există un P&L / Cash Flow clar',
        a: 'Dacă proprietarul nu vede profitul, banii și riscurile într-o singură logică, primul pas este de regulă Financial Health Check.',
        ctas: [
          { l: 'Treceți diagnosticul complet', h: 'questionnaire.html', p: true },
          { l: 'Discovery Call', h: DISCO, e: 'assistant_click_discovery_call' },
          { l: 'Business Control System', h: 'business-control-system.html' }
        ] },
      { choose: 'assistant_choose_powerbi',
        opt: 'Vreau un dashboard Power BI',
        a: 'Power BI are sens doar după definirea logicii financiare: ce indicatori se calculează, din ce surse se iau datele și cine răspunde de calitatea datelor.',
        ctas: [
          { l: 'Power BI pentru proprietar', h: 'power-bi-dlya-sobstvennika.html', p: true },
          { l: 'Integrarea 1C → Power BI', h: 'power-bi-dlya-sobstvennika.html' },
          { l: 'Discovery Call', h: DISCO, e: 'assistant_click_discovery_call' }
        ] },
      { choose: 'assistant_choose_fit',
        opt: 'Vreau să înțeleg dacă FINMENTOR mi se potrivește',
        a: 'Cel mai bun prim pas este un Discovery Call de 20–30 de minute. Este o discuție scurtă de calificare, ca să înțelegem dacă diagnosticul are sens.',
        ctas: [
          { l: 'Programați un Discovery Call', h: DISCO, e: 'assistant_click_discovery_call', p: true },
          { l: 'Vedeți scenariile anonime', h: 'cases.html' },
          { l: 'Lăsați un mesaj în FINMENTOR Bot', h: 'https://t.me/finmentor_md_bot', e: 'assistant_click_bot', tg: true }
        ] }
    ]
  };
})();
