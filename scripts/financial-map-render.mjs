// replacement tail for genmap.mjs (render + emit)
export function makeRender({ T, CHAPTERS, PRINCIPLES, L, ECO_DETAIL }) {
  const li = a => a.map(x => `<li>${x}</li>`).join('');

  function hero(lang) {
    const t = T[lang], o = [];
    const a = s => o.push(s);
    a(`        <p class="fmap__subtitle">${t.sub}</p>`);
    a(`        <p class="doc-hero__lead">${t.lead}</p>`);
    a('        <div class="fmap__chains">');
    a('          <div class="fmap-chain">');
    a(`            <p class="fmap-chain__label">${t.chainEco}</p>`);
    a(`            <ol class="fmap-chain__primary">${li(t.ecoPrimary)}</ol>`);
    a(`            <ol class="fmap-chain__detail">${li(ECO_DETAIL)}</ol>`);
    a('          </div>');
    a('          <div class="fmap-chain">');
    a(`            <p class="fmap-chain__label">${t.chainMgmt}</p>`);
    a(`            <ol class="fmap-chain__primary">${li(t.mgmtPrimary)}</ol>`);
    a(`            <p class="fmap-chain__label" style="margin-top:var(--sp-5)">${t.layersLabel}</p>`);
    a(`            <ul class="fmap-chain__detail" style="margin-top:var(--sp-3);padding-top:0;border-top:0">${li(t.layers)}</ul>`);
    a('          </div>');
    a('        </div>');
    a(`        <p class="materials-hero__actions"><a href="#financial-map" class="hero__link">${t.aHero}&nbsp;&darr;</a> <a href="#library" class="hero__link">${t.aLib}&nbsp;&darr;</a></p>`);
    return o.join('\n') + '\n';
  }

  function map(lang) {
    const t = T[lang], i = lang === 'ru' ? 0 : 1, o = [];
    const a = s => o.push(s);
    a('    <section class="fmap" id="financial-map" aria-labelledby="financial-map-title">');
    a('      <div class="container">');
    a(`        <p class="fmap__eyebrow">${t.eyebrow}</p>`);
    a(`        <h2 class="fmap__title" id="financial-map-title">${t.mapH2}</h2>`);
    a(`        <p class="fmap__lead">${t.mapLead}</p>`);
    a('        <section class="fmap-layers" aria-labelledby="fmap-layers-title">');
    a(`          <h3 class="fmap-layers__title" id="fmap-layers-title">${t.layersTitle}</h3>`);
    a(`          <p class="fmap-layers__note">${t.layersNote}</p>`);
    a('          <ul class="fmap-layers__list">');
    for (const [name, text] of t.layersDetail) {
      a(`            <li class="fmap-layer"><p class="fmap-layer__name">${name}</p><p class="fmap-layer__text">${text}</p></li>`);
    }
    a('          </ul>');
    a('        </section>');
    a('        <div class="fmap__chapters">');
    for (const ch of CHAPTERS) {
      a('          <section class="fmap-chapter">');
      a('            <div class="fmap-chapter__head">');
      a(`              <span class="fmap-chapter__num">${ch.num[i]}</span>`);
      a(`              <h3 class="fmap-chapter__title">${ch.title[i]}</h3>`);
      a(`              <p class="fmap-chapter__note">${ch.note[i]}</p>`);
      a('            </div>');
      a('            <div class="fmap-stages">');
      for (const st of ch.stages) {
        const loc = lang === 'ru' ? st.ru : st.ro;
        a(`              <details class="fmap-stage" id="stage-${st.no}">`);
        a('                <summary class="fmap-stage__summary">');
        a(`                  <span class="fmap-stage__no">${st.no}</span>`);
        a(`                  <span class="fmap-stage__name">${st.name[i]}<em>${st.en}</em></span>`);
        a('                  <span class="fmap-stage__toggle" aria-hidden="true"></span>');
        a('                </summary>');
        a('                <div class="fmap-stage__body">');
        a(`                  <p class="fmap-stage__q">${loc.q}</p>`);
        a(`                  <p class="fmap-stage__rule">${loc.rule}</p>`);
        a('                  <dl class="fmap-stage__row">');
        a(`                    <dt>${t.tool}</dt><dd>${loc.tool}</dd>`);
        a(`                    <dt>${t.kpi}</dt><dd><ul class="fmap-tags">${li(st.kpi.map(x => x[i]))}</ul></dd>`);
        a(`                    <dt>${t.flags}</dt><dd><ul class="fmap-tags fmap-tags--flag">${li(st.flags)}</ul></dd>`);
        a(`                    <dt>${t.dec}</dt><dd><ul class="fmap-tags fmap-tags--decision">${li(st.dec)}</ul></dd>`);
        a(`                    <dt>${t.links}</dt><dd><div class="fmap-stage__links" style="margin-top:0;padding-top:0;border-top:0">${st.links.map(h => `<a href="${h}">${L[h][i]}</a>`).join('')}</div></dd>`);
        a('                  </dl>');
        if (st.next) {
          const [nru, nro, target] = st.next;
          const tgt = CHAPTERS.flatMap(c => c.stages).find(x => x.no === target);
          a(`                  <p class=\"fmap-stage__next\"><span class=\"fmap-stage__next-label\">${t.nextLabel}</span>${lang === 'ru' ? nru : nro} <a href=\"#stage-${target}\">${target} · ${tgt.name[i]} &rarr;</a></p>`);
        }
        a('                </div>');
        a('              </details>');
      }
      a('            </div>');
      a('          </section>');
    }
    a('        </div>');
    a('        <div class="fmap-loop">');
    a(`          <p class="fmap-loop__title">${t.loopTitle}</p>`);
    a(`          <p class="fmap-loop__text">${t.loopText}</p>`);
    a(`          <ol class="fmap-loop__chain">${li(t.loopChain)}</ol>`);
    a('        </div>');
    a('        <section class="fmap-principles" aria-labelledby="fmap-principles-title">');
    a('          <div class="fmap-principles__head">');
    a(`            <h3 class="fmap-principles__title" id="fmap-principles-title">${t.prTitle}</h3>`);
    a(`            <p class="fmap-principles__note">${t.prNote}</p>`);
    a('          </div>');
    a('          <ul class="fmap-principles__list">');
    for (const [f, ru, ro] of PRINCIPLES) {
      a('            <li class="fmap-principle">');
      a(`              <p class="fmap-principle__formula">${f}</p>`);
      a(`              <p class="fmap-principle__text">${lang === 'ru' ? ru : ro}</p>`);
      a('            </li>');
    }
    a('          </ul>');
    a('        </section>');
    a('      </div>');
    a('    </section>');
    return o.join('\n') + '\n';
  }

  return { hero, map };
}
