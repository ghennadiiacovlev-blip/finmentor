// Splits a migration file into top-level statements, honouring PostgreSQL dollar quoting
// ($$, $fn$, $t$ ...), single quotes with '' escaping, and -- / block comments.
// Used to identify WHICH statement fails, rather than only that the batch failed.
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    // line comment
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? n : nl + 1;
      buf += sql.slice(i, end); i = end; continue;
    }
    // block comment
    if (ch === '/' && sql[i + 1] === '*') {
      let depth = 1; let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; }
        else if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; }
        else j++;
      }
      buf += sql.slice(i, j); i = j; continue;
    }
    // single-quoted literal
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") { j++; break; }
        else j++;
      }
      buf += sql.slice(i, j); i = j; continue;
    }
    // double-quoted identifier
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') { j++; break; }
        else j++;
      }
      buf += sql.slice(i, j); i = j; continue;
    }
    // dollar-quoted string
    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        buf += sql.slice(i, end); i = end; continue;
      }
    }
    if (ch === ';') {
      const s = buf.trim();
      if (s) out.push(s + ';');
      buf = ''; i++; continue;
    }
    buf += ch; i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export const label = (stmt) => stmt.replace(/\s+/g, ' ').replace(/^--[^\n]*/, '').trim().slice(0, 110);
