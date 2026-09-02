// NON-PRODUCTION validation run for db/migrations/0003_alerts_writer_relay_login.
//
//   node db/validation/run-validation-0003.mjs
//
// Proves gates R1-R30 of docs/TELEGRAM_DURABLE_NEW_LEAD_DELIVERY_PLAN.md §8: the Cloud Run relay
// identity is created with exactly the authority the writer group confers and nothing else, it is
// a STRANGER to the two n8n runtime logins, and its rollback removes it without disturbing a
// single neighbour.
//
// Run as the NOSUPERUSER CREATEROLE migrator shape, on a DISPOSABLE loopback cluster. It refuses
// to talk to anything that is not loopback and never touches a managed endpoint.
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, Report, assertNonProduction, open, rows, one, val, expectFail,
  createFreshDatabase, cleanSlate, readUp, readUp2, readDown2, readUp3, readDown3, openRaw,
  readDown, applyBatch, closeAll,
} from './lib.mjs';
import { buildFixture, LOGINS, PW } from './fixture.mjs';
import { arm, disarm, RT_PW } from './gates-e.mjs';

const DB = process.env.FM_TESTDB3 || 'fm_outbox_relay_nonprod';
const RELAY = 'alerts_writer_relay_rt';
const N8N = ['alerts_dispatcher_rt', 'alerts_writer_rt'];
const GROUPS = ['alerts_audit', 'alerts_dispatcher', 'alerts_owner', 'alerts_reconciler',
                'alerts_retention', 'alerts_writer'];
const R = new Report();

const FUNCTIONS = [
  ['alerts.enqueue_new_lead(text,text,text,timestamptz,jsonb)', true],
  ['alerts.enqueue_new_lead_b64(text,text,text,timestamptz,text)', true],
  ['alerts.claim_new_lead_delivery(text,integer)', false],
  ['alerts.finalise_new_lead_delivery(text,text,uuid,text,text,text,interval)', false],
  ['alerts.expire_stale_claims(interval)', false],
  ['alerts.new_lead_attention()', false],
  ['alerts.request_fingerprint(text)', false],
  ['alerts.new_lead_events_present(text[])', false],
  ['alerts.repair_new_lead_deliveries(text)', false],
  ['alerts.purge_new_lead_payloads()', false],
  ['alerts.purge_new_lead_deliveries()', false],
  ['alerts.purge_new_lead_keys()', false],
];
const RELATIONS = ['alerts.new_lead_outbox', 'alerts.new_lead_delivery', 'alerts.retention_policy',
                   'alerts.new_lead_outbox_audit', 'alerts.new_lead_delivery_audit'];
const VERBS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

const roleNames = async (c, like) =>
  (await rows(c, `SELECT rolname FROM pg_roles WHERE rolname LIKE $1 ORDER BY 1`, [like]))
    .map((r) => r.rolname);

// Everything observable about a login, read as a superuser -- deliberately NOT through the
// migration's own assertion block, which is the thing under test.
async function loginState(sup, login) {
  const attrs = await one(sup, `SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls,
                                       rolcreaterole, rolcreatedb, rolreplication, rolconfig
                                  FROM pg_roles WHERE rolname = $1`, [login]);
  if (!attrs) return null;
  const memberships = await rows(sup, `
    SELECT t.rolname AS in_role, m.inherit_option, m.set_option, m.admin_option
      FROM pg_auth_members m JOIN pg_roles t ON t.oid = m.roleid
                             JOIN pg_roles g ON g.oid = m.member
     WHERE g.rolname = $1 ORDER BY 1`, [login]);
  const heldBy = await rows(sup, `
    SELECT g.rolname AS member, m.inherit_option, m.set_option, m.admin_option
      FROM pg_auth_members m JOIN pg_roles t ON t.oid = m.roleid
                             JOIN pg_roles g ON g.oid = m.member
     WHERE t.rolname = $1 ORDER BY 1`, [login]);
  const hasPassword = await val(sup, `SELECT rolpassword IS NOT NULL FROM pg_authid WHERE rolname = $1`, [login]);
  return { attrs, memberships, heldBy, hasPassword };
}

async function main() {
  assertNonProduction();
  const started = new Date();

  const cleaned = await cleanSlate([]);
  if (cleaned.droppedRoles.length || cleaned.droppedDatabases.length) {
    R.note(`clean slate: dropped databases ${JSON.stringify(cleaned.droppedDatabases)} and leftover roles ${JSON.stringify(cleaned.droppedRoles)}`);
  }
  await createFreshDatabase(DB);
  await buildFixture(DB);
  const sup = await open(DB);
  const mig = await open(DB, LOGINS.migrator, PW);
  const notices = [];
  mig.on('notice', (n) => notices.push(String(n.message || '')));
  const g5Before = await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`);

  // ------------------------------------------------------------------- R1
  {
    const g = R.gate('R1', 'CLEAN APPLY 0001 -> 0002 -> 0003, as the non-superuser migrator');
    g.eq('the migrator is NOT a superuser', await val(sup,
      `SELECT rolsuper FROM pg_roles WHERE rolname = $1`, [LOGINS.migrator]), false);
    let err = await applyBatch(mig, readUp());
    g.ok('0001 applies cleanly', err === null, err && `${err.code} ${err.message}`);
    err = await applyBatch(mig, readUp2());
    g.ok('0002 applies cleanly', err === null, err && `${err.code} ${err.message}`);
    err = await applyBatch(mig, readUp3());
    g.ok('0003 applies cleanly', err === null, err && `${err.code} ${err.message}`);
    if (err) console.error(err);
    g.eq('all three runtime logins now exist, and only those three',
      await roleNames(sup, 'alerts\\_%\\_rt'), [...N8N, RELAY].sort());
    g.eq('the six group roles are untouched',
      (await roleNames(sup, 'alerts\\_%')).filter((r) => !r.endsWith('_rt')), GROUPS);
  }

  // Captured AFTER 0003 applies: the n8n identities as 0003 left them.
  const writerAfter3 = await loginState(sup, 'alerts_writer_rt');
  const dispatcherAfter3 = await loginState(sup, 'alerts_dispatcher_rt');

  // ------------------------------------------------------- R3-R12, R17, R27
  {
    const g = R.gate('R3-R12', 'the relay role contract, measured from the catalog rather than trusted');
    g.eq('R3 the relay role exists exactly once', await roleNames(sup, 'alerts\\_writer\\_relay\\_rt'), [RELAY]);
    const st = await loginState(sup, RELAY);
    g.eq('R4 PASSWORD NULL -- the migration created no secret', st.hasPassword, false);
    g.eq('R5 it can log in and inherits nothing by default',
      [st.attrs.rolcanlogin, st.attrs.rolinherit], [true, false]);
    g.eq('R5 it holds no role attribute at all',
      [st.attrs.rolsuper, st.attrs.rolbypassrls, st.attrs.rolcreaterole,
       st.attrs.rolcreatedb, st.attrs.rolreplication], [false, false, false, false, false]);
    g.eq('R6/R7/R8/R9 exactly one membership: alerts_writer, inherit yes, set no, admin no',
      st.memberships, [{ in_role: 'alerts_writer', inherit_option: true, set_option: false, admin_option: false }]);
    g.eq('R10/R11/R12 the timeouts and search_path are ON THE ROLE',
      (st.attrs.rolconfig || []).slice().sort(),
      ['lock_timeout=5s', 'search_path=pg_catalog', 'statement_timeout=8s']);
    g.eq('R17 no alerts_owner membership, direct or inherited',
      await one(sup, `SELECT pg_has_role($1,'alerts_owner','USAGE') AS inherit,
                             pg_has_role($1,'alerts_owner','MEMBER') AS member`, [RELAY]),
      { inherit: false, member: false });
    g.eq('nothing can SET ROLE into the relay or inherit from it',
      st.heldBy.filter((h) => h.set_option || h.inherit_option), []);
    g.eq('USAGE on the alerts schema, and no CREATE anywhere', await one(sup,
      `SELECT has_schema_privilege($1,'alerts','USAGE') AS alerts_usage,
              has_schema_privilege($1,'alerts','CREATE') AS alerts_create,
              has_schema_privilege($1,'public','CREATE') AS public_create`, [RELAY]),
      { alerts_usage: true, alerts_create: false, public_create: false });
    g.eq('R27 the migration wrote no password verifier for any runtime login this run',
      Number(await val(sup, `SELECT count(*) FROM pg_authid WHERE rolname LIKE 'alerts\\_%\\_rt' AND rolpassword IS NOT NULL`)), 0);
  }

  // ------------------------------------------------------------- R13-R16
  {
    const g = R.gate('R13-R16', 'the relay can do its own job and NOTHING else');
    const wrongExec = [];
    for (const [fn, expected] of FUNCTIONS) {
      const actual = await val(sup, `SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE')`, [RELAY, fn]);
      if (actual !== expected) wrongExec.push(`${fn} = ${actual}, expected ${expected}`);
    }
    g.eq('R13/R14 EXECUTE on the two enqueue functions, and on nothing else in the schema', wrongExec, []);

    const wrongTable = [];
    for (const rel of RELATIONS) {
      for (const v of VERBS) {
        if (await val(sup, `SELECT has_table_privilege($1,$2,$3)`, [RELAY, rel, v])) wrongTable.push(`${v} ${rel}`);
      }
    }
    g.eq('R15 no direct table privilege anywhere in alerts, by any verb', wrongTable, []);

    const wrongG5 = [];
    for (const v of VERBS) {
      if (await val(sup, `SELECT has_table_privilege($1,'public.telegram_initdata_replays',$2)`, [RELAY, v])) {
        wrongG5.push(v);
      }
    }
    g.eq('R16 nothing at all on G5', wrongG5, []);
    g.eq('R30 G5 rows are byte-identical to before the migration',
      await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
  }

  // ----------------------------------------------------------- R18/R19
  {
    const g = R.gate('R18-R19', 'SET ROLE is denied -- proven by ATTEMPTING it, not by asking the catalog');

    // MEASURED, NOT ASSUMED. pg_has_role(...,'MEMBER') answers "is a member", and in PG16+ that
    // is NOT the same question as "may SET ROLE": the per-grant set_option governs. It returns
    // TRUE here even though set_option is false, so a catalog-only test would have reported the
    // opposite of the truth. The only honest test is to open a session and try.
    g.eq('pg_has_role MEMBER is true -- and does NOT mean SET ROLE is permitted (PG16+ set_option)',
      await val(sup, `SELECT pg_has_role($1,'alerts_writer','MEMBER')`, [RELAY]), true);
    g.eq('the grant itself says set_option = false', await val(sup,
      `SELECT m.set_option FROM pg_auth_members m JOIN pg_roles t ON t.oid=m.roleid
        JOIN pg_roles gg ON gg.oid=m.member WHERE gg.rolname=$1 AND t.rolname='alerts_writer'`, [RELAY]), false);

    // Arm the relay just long enough to hold a real session as it, then disarm.
    await arm(sup, RELAY);
    const rc = await openRaw(DB, RELAY, RT_PW);
    try {
      const e1 = await expectFail(() => rc.query(`SET ROLE alerts_writer`));
      g.ok('R19 SET ROLE alerts_writer is REFUSED from a real session', !!e1 && e1.code === '42501',
        e1 ? `${e1.code} ${e1.message}` : 'the relay BECAME alerts_writer');
      const e2 = await expectFail(() => rc.query(`SET ROLE alerts_owner`));
      g.ok('R18 SET ROLE alerts_owner is REFUSED', !!e2 && e2.code === '42501',
        e2 ? `${e2.code} ${e2.message}` : 'the relay BECAME alerts_owner');
      const who = await one(rc, `SELECT current_user, session_user`);
      g.eq('and it is still itself afterwards', [who.current_user, who.session_user], [RELAY, RELAY]);
      g.eq('the role settings reach the session', await one(rc,
        `SELECT current_setting('statement_timeout') AS st, current_setting('lock_timeout') AS lt,
                current_setting('search_path') AS sp`),
        { st: '8s', lt: '5s', sp: 'pg_catalog' });
    } finally {
      await rc.end().catch(() => {});
      await disarm(sup, RELAY);
    }
    g.eq('and the relay is INERT again -- the harness left no armed credential behind',
      (await loginState(sup, RELAY)).hasPassword, false);
    g.eq('it is a member of no platform role', await one(sup,
      `SELECT pg_has_role($1,'postgres','MEMBER') AS pg,
              pg_has_role($1,$2,'MEMBER') AS migrator`, [RELAY, LOGINS.migrator]),
      { pg: false, migrator: false });
  }

  // ----------------------------------------------------------- R20/R21
  {
    const g = R.gate('R20-R21', 'the n8n identities are STRANGERS to the relay, and 0003 did not touch them');
    for (const [login, st] of [['alerts_writer_rt', writerAfter3], ['alerts_dispatcher_rt', dispatcherAfter3]]) {
      const grp = login === 'alerts_writer_rt' ? 'alerts_writer' : 'alerts_dispatcher';
      g.eq(`${login}: still exactly one membership, into its own group`,
        st.memberships, [{ in_role: grp, inherit_option: true, set_option: false, admin_option: false }]);
      g.eq(`${login}: role settings untouched`, (st.attrs.rolconfig || []).slice().sort(),
        ['lock_timeout=5s', 'search_path=pg_catalog', 'statement_timeout=8s']);
      g.eq(`${login}: still has no password verifier -- 0003 did not arm or disarm it`, st.hasPassword, false);
    }
    const between = await rows(sup, `
      SELECT g.rolname AS member, t.rolname AS in_role
        FROM pg_auth_members m JOIN pg_roles t ON t.oid = m.roleid
                               JOIN pg_roles g ON g.oid = m.member
       WHERE (g.rolname = $1 AND t.rolname = ANY($2)) OR (t.rolname = $1 AND g.rolname = ANY($2))`,
      [RELAY, N8N]);
    g.eq('no membership exists between the relay and either n8n login, in either direction', between, []);
  }

  // ------------------------------------------------------------------ R2
  {
    const g = R.gate('R2', 'IDEMPOTENT REAPPLY, and CONVERGENCE from a hand-altered state');
    const err = await applyBatch(mig, readUp3());
    g.ok('a second apply succeeds and changes nothing', err === null, err && `${err.code} ${err.message}`);
    g.eq('still exactly one relay role', await roleNames(sup, 'alerts\\_writer\\_relay\\_rt'), [RELAY]);

    // Drift the grant the way a careless MIGRATOR would. pg_auth_members is keyed on the
    // GRANTOR (0002 finding 2), so this UPDATES the migration's own row -- which is exactly
    // the drift the migration is able to repair.
    await mig.query(`GRANT alerts_writer TO ${RELAY} WITH SET TRUE`);
    g.eq('drift planted: SET ROLE is now possible', await val(sup,
      `SELECT bool_or(m.set_option) FROM pg_auth_members m JOIN pg_roles t ON t.oid=m.roleid
        JOIN pg_roles gg ON gg.oid=m.member WHERE gg.rolname=$1 AND t.rolname='alerts_writer'`, [RELAY]), true);
    const err2 = await applyBatch(mig, readUp3());
    g.ok('the migration re-applies over the drift', err2 === null, err2 && `${err2.code} ${err2.message}`);
    g.eq('and CONVERGES: set_option is back to false', (await loginState(sup, RELAY)).memberships,
      [{ in_role: 'alerts_writer', inherit_option: true, set_option: false, admin_option: false }]);
  }

  // ----------------------------------------------------------------- R2b
  {
    const g = R.gate('R2b', "a grant the migration CANNOT repair -- a stranger's -- makes it REFUSE");
    // Planted by a SUPERUSER, so it lands as a SECOND row with a different grantor. The
    // migration cannot reach it, and the right behaviour is to fail closed rather than report
    // success over a credential it does not govern.
    await sup.query(`GRANT alerts_writer TO ${RELAY} WITH SET TRUE`);
    g.eq('a second membership row now exists, same role, different grantor',
      Number(await val(sup, `SELECT count(*) FROM pg_auth_members m JOIN pg_roles gg ON gg.oid=m.member
                              WHERE gg.rolname=$1`, [RELAY])), 2);
    const err = await applyBatch(mig, readUp3());
    g.ok('the migration REFUSES to commit', !!err && /ALERTS_RELAY_POSTCONDITION_FAILED/.test(err.message || ''),
      err ? `${err.code} ${err.message}` : 'the migration reported success over a grant it cannot govern');
    g.ok('and it names the reason', !!err && /extra_membership/.test(err.message || ''), err && err.message);
    // Restore, as only a superuser can.
    await sup.query(`REVOKE alerts_writer FROM ${RELAY}`);
    await applyBatch(mig, readUp3());
    g.eq('after the stranger grant is removed, the migration converges again',
      (await loginState(sup, RELAY)).memberships,
      [{ in_role: 'alerts_writer', inherit_option: true, set_option: false, admin_option: false }]);
  }

  // ------------------------------------------------------------------ R24
  {
    const g = R.gate('R24', "0001's rollback REFUSES while the relay login exists (amendment 2.3-A)");
    const e = await expectFail(() => applyBatch(mig, readDown()).then((x) => { if (x) throw x; }));
    g.ok('it refuses, by name', !!e && /ALERTS_ROLLBACK_RUNTIME_LOGIN_PRESENT/.test(e.message),
      e ? `${e.code} ${e.message}` : '0001 rollback SUCCEEDED with runtime logins present');
    g.ok('and the message names the relay login specifically', !!e && /alerts_writer_relay_rt/.test(e.message),
      e && e.message);
    g.eq('nothing was dropped', (await roleNames(sup, 'alerts\\_%')).filter((r) => !r.endsWith('_rt')), GROUPS);
    R.note(`0001 rollback with the relay login present: ${e && e.message}`);
  }

  // ------------------------------------------------------------------ R23
  {
    const g = R.gate('R23', "0002's rollback is INDEPENDENT -- it must not remove the relay login");
    const err = await applyBatch(mig, readDown2());
    g.ok('0002 rolls back cleanly', err === null, err && `${err.code} ${err.message}`);
    g.eq('both n8n runtime logins are gone', await roleNames(sup, 'alerts\\_%\\_rt'), [RELAY]);
    g.eq('the relay login SURVIVED 0002 rollback', await roleNames(sup, 'alerts\\_writer\\_relay\\_rt'), [RELAY]);
    const st = await loginState(sup, RELAY);
    g.eq('and it is unchanged: same membership, same settings',
      [st.memberships, (st.attrs.rolconfig || []).slice().sort()],
      [[{ in_role: 'alerts_writer', inherit_option: true, set_option: false, admin_option: false }],
       ['lock_timeout=5s', 'search_path=pg_catalog', 'statement_timeout=8s']]);
    g.eq('the six group roles are intact', (await roleNames(sup, 'alerts\\_%')).filter((r) => !r.endsWith('_rt')), GROUPS);
  }

  // ------------------------------------------------------------ R22/R25/R29
  {
    const g = R.gate('R22-R25', '0003 rollback removes the relay and NOTHING else');
    const outboxBefore = Number(await val(sup, `SELECT count(*) FROM alerts.new_lead_outbox`));
    const fnCountBefore = Number(await val(sup,
      `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='alerts'`));
    const err = await applyBatch(mig, readDown3());
    g.ok('R22 the rollback applies without error', err === null, err && `${err.code} ${err.message}`);
    g.eq('R22 the relay login is gone', await roleNames(sup, 'alerts\\_writer\\_relay\\_rt'), []);
    g.eq('R25 the six group roles survive', (await roleNames(sup, 'alerts\\_%')).filter((r) => !r.endsWith('_rt')), GROUPS);
    g.eq('R29 no alerts function was added or removed', Number(await val(sup,
      `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='alerts'`)),
      fnCountBefore);
    g.eq('R29 the outbox is untouched', Number(await val(sup, `SELECT count(*) FROM alerts.new_lead_outbox`)), outboxBefore);
    g.eq('R30 G5 is still byte-identical',
      await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
  }

  // ------------------------------------------------------------------ R26
  {
    const g = R.gate('R26', 'REAPPLY AFTER ROLLBACK, and 0001 rollback works once the relay is gone');
    let err = await applyBatch(mig, readUp3());
    g.ok('0003 re-applies cleanly on a rolled-back database', err === null, err && `${err.code} ${err.message}`);
    const st = await loginState(sup, RELAY);
    g.eq('the contract is identical to the first apply',
      [st.hasPassword, st.memberships, (st.attrs.rolconfig || []).slice().sort()],
      [false, [{ in_role: 'alerts_writer', inherit_option: true, set_option: false, admin_option: false }],
       ['lock_timeout=5s', 'search_path=pg_catalog', 'statement_timeout=8s']]);

    // And the ordering contract, proven the right way round: relay down, then 0001 down.
    err = await applyBatch(mig, readDown3());
    g.ok('0003 rolls back again', err === null, err && `${err.code} ${err.message}`);
    err = await applyBatch(mig, readDown());
    g.ok("0001's rollback now SUCCEEDS, with no runtime login left anywhere", err === null,
      err && `${err.code} ${err.message}`);
    g.eq('every alerts role is gone', await roleNames(sup, 'alerts\\_%'), []);
    g.eq('R30 G5 SURVIVED the full teardown -- it was never 0003 or 0001 business',
      await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
  }

  // ------------------------------------------------------------ R28 / notes
  {
    const g = R.gate('R28', 'the migration creates no secret and no external object');
    const upText = readUp3() + readDown3();
    g.ok('no PASSWORD literal anywhere in either file', !/PASSWORD\s+'/i.test(upText));
    g.ok('PASSWORD NULL is the only password statement', /PASSWORD NULL/.test(upText));
    g.ok('no GCP / Secret Manager / HTTP reference', !/gcloud|secretmanager|googleapis|https?:\/\//i.test(upText));
    // The n8n identity may be NAMED (the stranger assertion and the rollback's before/after
    // snapshot both need it) but never ACTED ON. Every DDL in these files goes through
    // format(%I), so a role that is only ever a QUOTED STRING is a role only ever read about.
    const bare = [];
    for (const name of ['alerts_writer_rt', 'alerts_dispatcher_rt']) {
      const re = new RegExp(`(.)${name}(.)`, 'g');
      let m;
      while ((m = re.exec(upText)) !== null) {
        if (m[1] !== "'" || m[2] !== "'") bare.push(`${name} at ...${m[0]}...`);
      }
    }
    g.eq('the n8n identities appear ONLY as quoted literals -- never as an identifier acted on', bare, []);
    const authidReadable = await val(mig, `SELECT has_table_privilege(current_user,'pg_authid','SELECT')`);
    const skipped = notices.some((n) => /ALERTS_RELAY_PASSWORD_CHECK_SKIPPED/.test(n));
    R.note(`pg_authid readable by the migrator on this cluster: ${authidReadable}; ` +
           `the migration's own password post-condition was ${skipped ? 'SKIPPED, with a NOTICE' : 'CHECKED'}`);
    g.eq('the password post-condition is either taken or announced -- never silently passed',
      skipped, !authidReadable);
  }

  R.note('alerts_writer_rt = n8n Postgres identity; alerts_writer_relay_rt = Cloud Run relay identity. ' +
         'Shared authority = inherited membership in the NOLOGIN group alerts_writer, and nothing else.');
  R.note('Cloud Run europe-west3 (Frankfurt) and Supabase eu-central-1 (Frankfurt) are the same metro, ' +
         'which is a GEOGRAPHIC statement only: the path still crosses Google Cloud to Supabase/AWS, ' +
         'and live latency and egress cost remain UNMEASURED until the hosted probe runs.');

  await mig.end();

  const out = R.render();
  console.log(out);
  const dir = path.join(ROOT, 'db', 'validation', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    started: started.toISOString(), finished: new Date().toISOString(),
    database: DB, server_version: await val(sup, `SELECT version()`),
    gates: [...R.gates.values()], assertions: R.assertions, notes: R.notes,
  };
  fs.writeFileSync(path.join(dir, 'last-run-0003.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'last-run-0003.txt'), out + '\n');
  await sup.end();
  process.exitCode = R.failed.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 2; })
  .finally(async () => { await closeAll(); });
