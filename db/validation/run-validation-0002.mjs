// NON-PRODUCTION validation run for db/migrations/0002_alerts_runtime_logins.
//
//   node db/validation/run-validation-0002.mjs
//
// Requires a DISPOSABLE local PostgreSQL cluster (see README.md), and -- unlike the 0001 suite --
// one whose pg_hba.conf actually ENFORCES authentication. Gate E4 opens with a negative control
// that fails the run on a `trust` cluster, because "this credential cannot log in" is not a
// measurement anyone can take where every credential can log in.
//
// It refuses to talk to anything that is not loopback, and never touches a managed endpoint.
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, Report, assertNonProduction, open, openRaw, rows, one, val, expectFail, attemptConnect,
  createFreshDatabase, cleanSlate, readUp, readDown, readUp2, readDown2, applyBatch, closeAll,
} from './lib.mjs';
import { buildFixture, LOGINS, PW } from './fixture.mjs';
import { runGatesE, RT, RT_PW, arm, disarm } from './gates-e.mjs';

const DB = process.env.FM_TESTDB2 || 'fm_outbox_rt_nonprod';
const LOGINS_RT = [RT.writer, RT.dispatcher];
const GROUPS = ['alerts_audit', 'alerts_dispatcher', 'alerts_owner', 'alerts_reconciler',
                'alerts_retention', 'alerts_writer'];
const R = new Report();

const roleNames = async (c, like) =>
  (await rows(c, `SELECT rolname FROM pg_roles WHERE rolname LIKE $1 ORDER BY 1`, [like]))
    .map((r) => r.rolname);

// The whole observable state of one runtime login, read from the catalog as a superuser --
// deliberately NOT through the migration's own assertion block, which is the thing under test.
async function loginState(sup, login) {
  const attrs = await one(sup, `SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls,
                                       rolcreaterole, rolcreatedb, rolreplication, rolconfig
                                  FROM pg_roles WHERE rolname = $1`, [login]);
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

const FUNCTIONS = [
  ['alerts.enqueue_new_lead(text,text,text,timestamptz,jsonb)', RT.writer],
  ['alerts.enqueue_new_lead_b64(text,text,text,timestamptz,text)', RT.writer],
  ['alerts.claim_new_lead_delivery(text,integer)', RT.dispatcher],
  ['alerts.finalise_new_lead_delivery(text,text,uuid,text,text,text,interval)', RT.dispatcher],
  ['alerts.expire_stale_claims(interval)', RT.dispatcher],
  ['alerts.new_lead_attention()', RT.dispatcher],
  ['alerts.request_fingerprint(text)', '-'],
  ['alerts.new_lead_events_present(text[])', '-'],
  ['alerts.repair_new_lead_deliveries(text)', '-'],
  ['alerts.purge_new_lead_payloads()', '-'],
  ['alerts.purge_new_lead_deliveries()', '-'],
  ['alerts.purge_new_lead_keys()', '-'],
];
const RELATIONS = ['alerts.new_lead_outbox', 'alerts.new_lead_delivery', 'alerts.retention_policy',
                   'alerts.new_lead_outbox_audit', 'alerts.new_lead_delivery_audit'];
const VERBS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

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
  // The migration NOTICEs the one post-condition it cannot take on a cluster where pg_authid is
  // closed to the migrator. A skipped check that says nothing is a check that passed by default,
  // so the notices are captured and asserted rather than scrolling past.
  const notices = [];
  mig.on('notice', (n) => notices.push(String(n.message || '')));
  const g5Before = await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`);

  // ------------------------------------------------------------------ PRE
  {
    const g = R.gate('PRE', 'GATE 1 starts where GATE 0 finished: 0001 applied, and no runtime login anywhere');
    g.eq('the migrator is NOT a superuser', await val(sup,
      `SELECT rolsuper FROM pg_roles WHERE rolname = $1`, [LOGINS.migrator]), false);
    const err = await applyBatch(mig, readUp());
    g.ok('0001 applies cleanly first', err === null, err && `${err.code} ${err.message}`);
    g.eq('the six group roles exist', await roleNames(sup, 'alerts\\_%'), GROUPS);
    g.eq('and no runtime login exists yet', await roleNames(sup, 'alerts\\_%\\_rt'), []);
    g.eq('the outbox is empty', Number(await val(sup, `SELECT count(*) FROM alerts.new_lead_outbox`)), 0);
  }

  // ------------------------------------------------------------------- E1
  {
    const g = R.gate('E1', 'CLEAN APPLY of 0002, as the non-superuser migrator');
    const err = await applyBatch(mig, readUp2());
    g.ok('the forward migration applies without error', err === null, err && `${err.code} ${err.message}`);
    if (err) console.error(err);
    g.eq('both runtime logins exist, and only those two', await roleNames(sup, 'alerts\\_%\\_rt'),
      [RT.dispatcher, RT.writer]);
    g.eq('0001 is untouched: still exactly six group roles', await roleNames(sup, 'alerts\\_%')
      .then((all) => all.filter((r) => !r.endsWith('_rt'))), GROUPS);
    g.eq('G5 is untouched', await rows(sup,
      `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
  }

  // ------------------------------------------------------------------- E2
  {
    const g = R.gate('E2', 'the §2.4 post-conditions, measured from the catalog rather than trusted');
    for (const [login, grp] of [[RT.writer, 'alerts_writer'], [RT.dispatcher, 'alerts_dispatcher']]) {
      const st = await loginState(sup, login);
      g.eq(`${login}: it can log in and inherits nothing by default`,
        [st.attrs.rolcanlogin, st.attrs.rolinherit], [true, false]);
      g.eq(`${login}: it holds no role attribute at all`,
        [st.attrs.rolsuper, st.attrs.rolbypassrls, st.attrs.rolcreaterole,
         st.attrs.rolcreatedb, st.attrs.rolreplication], [false, false, false, false, false]);
      g.eq(`${login}: the timeouts are ON THE ROLE`, (st.attrs.rolconfig || []).slice().sort(),
        ['lock_timeout=5s', 'search_path=pg_catalog', 'statement_timeout=8s']);
      g.eq(`${login}: it has NO password verifier -- it cannot be used yet`, st.hasPassword, false);
      g.eq(`${login}: exactly one membership, into its own group, INHERIT yes / SET no`,
        st.memberships, [{ in_role: grp, inherit_option: true, set_option: false, admin_option: false }]);
      g.eq(`${login}: nothing can SET ROLE into it or inherit from it`,
        st.heldBy.filter((h) => h.set_option || h.inherit_option), []);
      g.eq(`${login}: USAGE on the schema, and no CREATE`, await one(sup,
        `SELECT has_schema_privilege($1,'alerts','USAGE') AS usage,
                has_schema_privilege($1,'alerts','CREATE') AS create`, [login]),
        { usage: true, create: false });
    }

    // EXECUTE, both ways round -- the cross-denial is the point.
    const wrongExec = [];
    for (const login of LOGINS_RT) {
      for (const [fn, holder] of FUNCTIONS) {
        const actual = await val(sup, `SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE')`, [login, fn]);
        if (actual !== (holder === login)) wrongExec.push(`${login} ${fn} = ${actual}`);
      }
    }
    g.eq('every EXECUTE grant is exactly right, and every denial with it', wrongExec, []);

    const wrongTable = [];
    for (const login of LOGINS_RT) {
      for (const rel of RELATIONS) {
        for (const v of VERBS) {
          if (await val(sup, `SELECT has_table_privilege($1,$2,$3)`, [login, rel, v])) {
            wrongTable.push(`${login} ${v} ${rel}`);
          }
        }
      }
      for (const v of VERBS) {
        if (await val(sup, `SELECT has_table_privilege($1,'public.telegram_initdata_replays',$2)`, [login, v])) {
          wrongTable.push(`${login} ${v} G5`);
        }
      }
    }
    g.eq('no table privilege in the schema, and nothing at all on G5', wrongTable, []);

    // The one post-condition whose availability differs between this cluster and finmentor-prod.
    const authidReadable = await val(mig, `SELECT has_table_privilege(current_user,'pg_authid','SELECT')`);
    const skipped = notices.some((n) => /ALERTS_RT_PASSWORD_CHECK_SKIPPED/.test(n));
    R.note(`pg_authid readable by the migrator on this cluster: ${authidReadable}; ` +
           `the migration's own password post-condition was ${skipped ? 'SKIPPED, with a NOTICE' : 'CHECKED'}`);
    g.eq('the password post-condition is either taken or announced -- never silently passed',
      skipped, !authidReadable);
    g.eq('and the harness takes it regardless, as a superuser',
      (await loginState(sup, RT.writer)).hasPassword, false);
  }

  // ------------------------------------------------------------------- E3
  {
    const g = R.gate('E3', 'the migrator keeps ADMIN and nothing else -- it cannot BECOME a credential it made');
    const held = await rows(sup, `
      SELECT t.rolname AS in_role, m.admin_option, m.inherit_option, m.set_option
        FROM pg_auth_members m JOIN pg_roles t ON t.oid = m.roleid
                               JOIN pg_roles g ON g.oid = m.member
       WHERE g.rolname = $1 AND t.rolname LIKE 'alerts\\_%' ORDER BY 1`, [LOGINS.migrator]);
    R.note(`migrator memberships after 0002: ${JSON.stringify(held)}`);
    g.eq('the migrator holds SET or INHERIT on nothing in the alerts family',
      held.filter((h) => h.set_option || h.inherit_option), []);
    g.eq('it does hold ADMIN on both runtime logins -- that is what makes 0002 re-runnable',
      held.filter((h) => h.in_role.endsWith('_rt') && h.admin_option).map((h) => h.in_role).sort(),
      [RT.dispatcher, RT.writer]);
    const e = await expectFail(() => mig.query(`SET ROLE ${RT.writer}`));
    g.ok('and SET ROLE into the credential is refused', !!e && e.code === '42501',
      e ? `${e.code} ${e.message}` : 'the migrator BECAME the runtime login');
  }

  // -------------------------------------------------------------- E4/E5/E6
  // openRaw, not open: see lib.mjs. A harness that SETs its own timeouts on the connection would
  // measure itself and report it as the role.
  await runGatesE(R, { db: DB, sup, openRt: (login) => openRaw(DB, login, RT_PW) });

  // ------------------------------------------------------------------- E7
  {
    const g = R.gate('E7', 'IDEMPOTENT REAPPLY, and CONVERGENCE from a hand-altered state');
    const before = await Promise.all(LOGINS_RT.map((l) => loginState(sup, l)));
    let err = await applyBatch(mig, readUp2());
    g.ok('the same migration applies a second time without error', err === null, err && `${err.code} ${err.message}`);
    err = await applyBatch(mig, readUp2());
    g.ok('and a third time', err === null, err && `${err.code} ${err.message}`);
    g.eq('nothing about either login changed', await Promise.all(LOGINS_RT.map((l) => loginState(sup, l))), before);

    // Someone grants the credential the ability to become its own group -- the exact mistake
    // note 3 of §2.3 exists to survive. A bare re-run must UNDO it, not shrug at it.
    //
    // THE PLANT IS MADE BY THE MIGRATOR, and that is the whole point of the gate. pg_auth_members
    // is keyed on (roleid, member, GRANTOR): a grant made by anyone else is a SECOND row, not an
    // update of this one, and no re-run of this migration can reach it. Convergence is over the
    // migration's OWN grants. What happens to a stranger's grant is E8.
    await mig.query(`GRANT alerts_writer TO ${RT.writer} WITH SET TRUE`);
    g.eq('planted: the writer can now SET ROLE its group', (await loginState(sup, RT.writer)).memberships,
      [{ in_role: 'alerts_writer', inherit_option: true, set_option: true, admin_option: false }]);
    err = await applyBatch(mig, readUp2());
    g.ok('the migration re-runs over the altered state', err === null, err && `${err.code} ${err.message}`);
    g.eq('and it is REPAIRED -- named grant options update an existing membership',
      (await loginState(sup, RT.writer)).memberships,
      [{ in_role: 'alerts_writer', inherit_option: true, set_option: false, admin_option: false }]);

    // The same for a timeout someone RESET by hand.
    await mig.query(`ALTER ROLE ${RT.dispatcher} RESET statement_timeout`);
    g.eq('planted: the dispatcher has lost its statement_timeout',
      ((await loginState(sup, RT.dispatcher)).attrs.rolconfig || []).slice().sort(),
      ['lock_timeout=5s', 'search_path=pg_catalog']);
    err = await applyBatch(mig, readUp2());
    g.ok('the migration re-runs', err === null, err && `${err.code} ${err.message}`);
    g.eq('and the timeout is back', ((await loginState(sup, RT.dispatcher)).attrs.rolconfig || []).slice().sort(),
      ['lock_timeout=5s', 'search_path=pg_catalog', 'statement_timeout=8s']);
  }

  // ------------------------------------------------------------------- E8
  {
    const g = R.gate('E8', 'a grant the migration CANNOT repair -- a stranger\'s -- makes it REFUSE');
    // Granted by the SUPERUSER, not the migrator. On finmentor-prod that is exactly the shape of
    // "someone with the dashboard open granted a role by hand": pg_auth_members keys on the
    // grantor, so this is a second membership row that no re-run of 0002 can update or revoke.
    // The migration must therefore fail closed rather than commit a credential it cannot govern.
    await sup.query(`GRANT alerts_dispatcher TO ${RT.writer}`);
    const planted = await loginState(sup, RT.writer);
    g.eq('planted, by a different grantor: the writer is also a member of alerts_dispatcher',
      planted.memberships.map((m) => m.in_role), ['alerts_dispatcher', 'alerts_writer']);
    const err = await applyBatch(mig, readUp2());
    g.ok('the migration ABORTS rather than committing a credential nobody approved',
      !!err && /ALERTS_RT_POSTCONDITION_FAILED/.test(err.message || ''),
      err ? `${err.code} ${err.message}` : 'the migration COMMITTED');
    g.ok('and the failure names the reason', !!err && /extra_membership/.test(err.message || ''),
      err && err.message);
    g.eq('the aborted run changed nothing', await loginState(sup, RT.writer), planted);

    // The same shape one level down: the SUPERUSER re-grants the login's own group with SET TRUE.
    // A second row again -- so the repair E7 proved is NOT available here, and refusing is the
    // only correct outcome. This is the one thing an operator must be told: 0002 converges over
    // its own grants and fails closed over anyone else's.
    await sup.query(`REVOKE alerts_dispatcher FROM ${RT.writer}`);
    await sup.query(`GRANT alerts_writer TO ${RT.writer} WITH SET TRUE`);
    g.eq('a stranger\'s grant of the SAME group is a SECOND row, not an update',
      (await loginState(sup, RT.writer)).memberships.length, 2);
    const err2 = await applyBatch(mig, readUp2());
    g.ok('and the migration refuses that too', !!err2 && /extra_membership/.test(err2.message || ''),
      err2 ? `${err2.code} ${err2.message}` : 'the migration COMMITTED');

    await sup.query(`REVOKE alerts_writer FROM ${RT.writer}`);
    const err3 = await applyBatch(mig, readUp2());
    g.ok('once the stranger\'s grant is gone it applies again', err3 === null, err3 && `${err3.code} ${err3.message}`);
    g.eq('and the migration\'s own membership was never disturbed by any of it',
      (await loginState(sup, RT.writer)).memberships,
      [{ in_role: 'alerts_writer', inherit_option: true, set_option: false, admin_option: false }]);
  }

  // ------------------------------------------------------------------- E9
  {
    const g = R.gate('E9', 'a re-run must NEVER disarm a credential the owner has armed');
    await arm(sup, RT.writer, 'fmtest_local_only_owner_set');
    g.eq('armed out of band, as the owner would', (await loginState(sup, RT.writer)).hasPassword, true);
    const err = await applyBatch(mig, readUp2());
    g.ok('the migration re-runs', err === null, err && `${err.code} ${err.message}`);
    g.eq('the password survives the re-run', (await loginState(sup, RT.writer)).hasPassword, true);
    const e = await attemptConnect(DB, RT.writer, 'fmtest_local_only_owner_set');
    g.ok('and the live credential still works after the re-run', e === null, e && `${e.code} ${e.message}`);
    await disarm(sup, RT.writer);
  }

  // ------------------------------------------------------------------ E10
  {
    const g = R.gate('E10', 'ROLLBACK removes the two logins and NOTHING ELSE');
    const outboxBefore = await rows(sup, `SELECT dispatch_key FROM alerts.new_lead_outbox ORDER BY 1`);
    const err = await applyBatch(mig, readDown2());
    g.ok('the rollback runs cleanly', err === null, err && `${err.code} ${err.message}`);
    g.eq('both runtime logins are gone', await roleNames(sup, 'alerts\\_%\\_rt'), []);
    g.eq('the six group roles survive', await roleNames(sup, 'alerts\\_%'), GROUPS);
    g.eq('the schema still holds its three tables', (await rows(sup,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='alerts' AND table_type='BASE TABLE' ORDER BY 1`)).map((r) => r.table_name),
      ['new_lead_delivery', 'new_lead_outbox', 'retention_policy']);
    g.eq('the delivered rows survive -- a credential rollback is not a data rollback',
      await rows(sup, `SELECT dispatch_key FROM alerts.new_lead_outbox ORDER BY 1`), outboxBefore);
    g.eq('G5 is untouched', await rows(sup,
      `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
    const left = await rows(sup, `
      SELECT t.rolname FROM pg_auth_members m JOIN pg_roles t ON t.oid = m.roleid
                                              JOIN pg_roles g ON g.oid = m.member
       WHERE g.rolname = $1 AND t.rolname LIKE '%\\_rt'`, [LOGINS.migrator]);
    g.eq('and the temporary membership the rollback granted itself is gone with the role', left, []);
  }

  // ------------------------------------------------------------------ E11
  {
    const g = R.gate('E11', 'REAPPLY AFTER ROLLBACK');
    const err = await applyBatch(mig, readUp2());
    g.ok('the forward migration applies again cleanly', err === null, err && `${err.code} ${err.message}`);
    for (const [login, grp] of [[RT.writer, 'alerts_writer'], [RT.dispatcher, 'alerts_dispatcher']]) {
      const st = await loginState(sup, login);
      g.eq(`${login}: rebuilt with no password`, st.hasPassword, false);
      g.eq(`${login}: rebuilt with its timeouts`, (st.attrs.rolconfig || []).slice().sort(),
        ['lock_timeout=5s', 'search_path=pg_catalog', 'statement_timeout=8s']);
      g.eq(`${login}: rebuilt with the same single membership`, st.memberships,
        [{ in_role: grp, inherit_option: true, set_option: false, admin_option: false }]);
    }
  }

  // ------------------------------------------------------------------ E12
  {
    const g = R.gate('E12', 'ROLLBACK ORDERING is enforced, not documented (0001 amendment 2.3-A)');
    // Before the amendment this SUCCEEDED and left two orphaned logins behind -- members of
    // nothing, still able to authenticate, pointing at a schema that had just been dropped.
    const err = await applyBatch(mig, readDown());
    const rtLeft = await roleNames(sup, 'alerts\\_%\\_rt');
    const groupsLeft = (await roleNames(sup, 'alerts\\_%')).filter((r) => !r.endsWith('_rt'));
    R.note(`0001 rollback with runtime logins present: ${err ? `${err.code} ${err.message}` : 'SUCCEEDED'}; ` +
           `runtime logins left = ${JSON.stringify(rtLeft)}; group roles left = ${JSON.stringify(groupsLeft)}`);
    g.ok('0001\'s rollback REFUSES while a runtime login exists',
      !!err && /ALERTS_ROLLBACK_RUNTIME_LOGIN_PRESENT/.test(err.message || ''),
      err ? `${err.code} ${err.message}` : 'it SUCCEEDED and orphaned the credentials');
    g.ok('and it names both logins and what to do', !!err &&
      /alerts_dispatcher_rt, alerts_writer_rt/.test(err.message || '') && /0002 first/.test(err.message || ''),
      err && err.message);
    g.eq('nothing was dropped by the refusal', [rtLeft.length, groupsLeft.length], [2, 6]);
    g.eq('the schema is intact', Number(await val(sup,
      `SELECT count(*) FROM information_schema.tables WHERE table_schema='alerts'`)), 5);

    // In the right order, both come apart cleanly.
    const errRt = await applyBatch(mig, readDown2());
    g.ok('0002 rolls back first', errRt === null, errRt && `${errRt.code} ${errRt.message}`);
    const err0 = await applyBatch(mig, readDown());
    g.ok('and then 0001 rolls back', err0 === null, err0 && `${err0.code} ${err0.message}`);
    g.eq('the cluster is back to nothing-applied', await roleNames(sup, 'alerts\\_%'), []);
    g.eq('G5 survived every rollback in this run', await rows(sup,
      `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
  }

  // ------------------------------------------------------------------ E13
  {
    const g = R.gate('E13', '0002 REFUSES to create a credential when 0001 is not applied');
    const err = await applyBatch(mig, readUp2());
    g.ok('it aborts with ALERTS_RT_GROUP_MISSING',
      !!err && /ALERTS_RT_GROUP_MISSING/.test(err.message || ''),
      err ? `${err.code} ${err.message}` : 'the migration COMMITTED against a missing schema');
    g.eq('and no login was left behind by the attempt', await roleNames(sup, 'alerts\\_%\\_rt'), []);
  }

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
  fs.writeFileSync(path.join(dir, 'last-run-0002.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'last-run-0002.txt'), out + '\n');
  await sup.end();
  process.exitCode = R.failed.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 2; })
  .finally(async () => { await closeAll(); });
