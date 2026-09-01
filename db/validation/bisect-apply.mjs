// Applies a migration STATEMENT BY STATEMENT so a failure names the exact statement.
//   node db/validation/bisect-apply.mjs [up|down] [--fresh] [--twice]
import { open, readUp, readDown, createFreshDatabase, assertNonProduction } from './lib.mjs';
import { buildFixture, LOGINS, PW } from './fixture.mjs';
import { splitStatements, label } from './split-sql.mjs';

const DB = process.env.FM_TESTDB || 'fm_outbox_bisect';
const which = process.argv[2] || 'up';
const fresh = process.argv.includes('--fresh');
const twice = process.argv.includes('--twice');

async function apply(sql, tag) {
  const c = await open(DB, LOGINS.migrator, PW);
  await c.query(`SET lock_timeout = '5s'`);
  await c.query(`SET statement_timeout = '30s'`);
  const stmts = splitStatements(sql);
  let failed = null;
  for (let i = 0; i < stmts.length; i++) {
    try { await c.query(stmts[i]); }
    catch (e) {
      failed = { index: i, code: e.code, message: e.message, detail: e.detail, statement: stmts[i] };
      break;
    }
  }
  if (failed) {
    console.log(`\n### ${tag}: FAILED at statement ${failed.index + 1}/${stmts.length}`);
    console.log(`### ${failed.code} ${failed.message}${failed.detail ? ' :: ' + failed.detail : ''}`);
    console.log('--- statement ---');
    console.log(failed.statement);
    console.log('--- previous statement ---');
    console.log(failed.index > 0 ? label(stmts[failed.index - 1]) : '(none)');
    try { await c.query('ROLLBACK'); } catch {}
  } else {
    console.log(`### ${tag}: all ${stmts.length} statements applied`);
  }
  await c.end();
  return failed;
}

assertNonProduction();
if (fresh) { await createFreshDatabase(DB); await buildFixture(DB); }
const sql = which === 'down' ? readDown() : readUp();
await apply(sql, `${which} #1`);
if (twice) await apply(sql, `${which} #2`);
