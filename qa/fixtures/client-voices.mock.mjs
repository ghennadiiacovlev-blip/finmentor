// ============================================================================
// FINMENTOR — DESIGN MOCK for the «Client voices» module. NOT PUBLIC. NEVER SHIPPED.
//
// These are NOT client testimonials. They are placeholder sentences written by the
// design pass to let the owner judge composition, wrapping and rhythm at every width.
// No client, company, industry claim, number or outcome here is real. The only way
// they reach a page is the local preview server in qa/client-voices-preview.mjs,
// which serves this text in place of data/testimonials.js. The QA gate
// (qa/client-voices.test.mjs) proves no public page references this file.
// ============================================================================

export const MOCK_TESTIMONIALS_JS = `
/* DESIGN MOCK — NOT PUBLIC — served only by the local preview. */
(function (root) {
  root.FM_TESTIMONIALS = {
    version: 1,
    preview: true,
    entries: [
      { id: 'mock-ru-1', language: 'ru', featured: true, is_published: true, consent_status: 'approved',
        quote: 'Раньше я видел отчёты. Теперь я вижу, какие решения они от меня требуют — и в каком порядке.',
        person_display: '', role: 'Собственник', industry: 'дистрибуция', company_display: '', company_permission: false,
        date: '2026', source: 'design mock' },
      { id: 'mock-ru-2', language: 'ru', featured: false, is_published: true, consent_status: 'approved',
        quote: 'Платёжный календарь перестал быть спором о том, кому платить первым.',
        person_display: '', role: 'Финансовый директор', industry: 'розничная торговля', company_display: '', company_permission: false,
        date: '2026', source: 'design mock' },
      { id: 'mock-ru-3', language: 'ru', featured: false, is_published: true, consent_status: 'approved',
        quote: 'Разговор о следующем объекте впервые шёл о капитале и риске, а не о том, сколько осталось на счёте.',
        person_display: '', role: 'Собственник', industry: 'коммерческая недвижимость', company_display: '', company_permission: false,
        date: '2025', source: 'design mock' },
      { id: 'mock-ro-1', language: 'ro', featured: true, is_published: true, consent_status: 'approved',
        quote: 'Înainte vedeam rapoarte. Acum văd ce decizii îmi cer — și în ce ordine.',
        person_display: '', role: 'Proprietar', industry: 'distribuție', company_display: '', company_permission: false,
        date: '2026', source: 'design mock' },
      { id: 'mock-ro-2', language: 'ro', featured: false, is_published: true, consent_status: 'approved',
        quote: 'Calendarul plăților a încetat să fie o dispută despre cine este plătit primul.',
        person_display: '', role: 'Director financiar', industry: 'comerț cu amănuntul', company_display: '', company_permission: false,
        date: '2026', source: 'design mock' },
      { id: 'mock-ro-3', language: 'ro', featured: false, is_published: true, consent_status: 'approved',
        quote: 'Discuția despre următorul imobil a fost, pentru prima dată, despre capital și risc, nu despre cât a rămas în cont.',
        person_display: '', role: 'Proprietar', industry: 'imobiliare comerciale', company_display: '', company_permission: false,
        date: '2025', source: 'design mock' }
    ]
  };
})(window);
`;
