// FINMENTOR — what Telegram does to an outgoing HTML message, modelled.
//
// Telegram does not hand a callback back the HTML the bot sent. It hands back PLAIN text plus an
// entity list: offsets and lengths in UTF-16 code units. `editMessageText` then requires text, so
// refreshing a keyboard means rebuilding the HTML from that pair — and if the rebuild is not
// byte-exact the owner watches a premium alert lose its formatting the moment they press a button.
//
// This is the inverse direction, and it exists so a gate can produce a realistic (text, entities)
// pair from a renderer's own HTML without a Telegram round trip. It is TEST-SIDE ONLY: nothing in
// n8n/src/ imports it, and nothing deployed contains it.

function toTelegram(html) {
  const TAG = { b: 'bold', i: 'italic', u: 'underline', s: 'strikethrough', code: 'code', pre: 'pre' };
  const entities = [];
  const open = [];
  let text = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i);
      if (close === -1) { text += html[i]; i++; continue; }
      const raw = html.slice(i + 1, close).trim();
      const isEnd = raw.startsWith('/');
      const name = (isEnd ? raw.slice(1) : raw.split(/\s/)[0]).toLowerCase();
      if (TAG[name]) {
        if (isEnd) {
          for (let k = open.length - 1; k >= 0; k--) {
            if (open[k].name === name) {
              entities.push({ type: TAG[name], offset: open[k].offset, length: text.length - open[k].offset });
              open.splice(k, 1);
              break;
            }
          }
        } else { open.push({ name, offset: text.length }); }
        i = close + 1;
        continue;
      }
      text += html[i]; i++; continue;
    }
    if (html.startsWith('&amp;', i)) { text += '&'; i += 5; continue; }
    if (html.startsWith('&lt;', i)) { text += '<'; i += 4; continue; }
    if (html.startsWith('&gt;', i)) { text += '>'; i += 4; continue; }
    text += html[i]; i++;
  }
  entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
  return { text, entities };
}

module.exports = { toTelegram: toTelegram };
