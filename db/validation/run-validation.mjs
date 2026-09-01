// NON-PRODUCTION validation run for db/migrations/0001_new_lead_alert_outbox.
//
//   node db/validation/run-validation.mjs
//
// Requires a DISPOSABLE local PostgreSQL cluster (see README.md). It refuses to talk to
// anything that is not loopback, and it never touches a managed endpoint.
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, Report, assertNonProduction, open, rows, one, val, expectFail,
  createFreshDatabase, cleanSlate, readUp, readDown, applyBatch, closeAll,
} from './lib.mjs';
import { buildFixture, bindRuntimeLogins, LOGINS, PW } from './fixture.mjs';
import { runGatesA } from './gates-a.mjs';
import { runGatesB } from './gates-b.mjs';
import { runGatesC } from './gates-c.mjs';
import { runGatesD, assertMigratorMembership } from './gates-d.mjs';
import * as D from './data.mjs';

const DB = process.env.FM_TESTDB || 'fm_outbox_nonprod';
const R = new Report();

// --------------------------------------------------------------- catalog shape
async function shape(c) {
  return {
    tables: await rows(c, `SELECT relname, relkind FROM pg_class WHERE relnamespace='alerts'::regnamespace
                            AND relkind IN ('r','v','i','S') ORDER BY relkind, relname`),
    functions: await rows(c, `SELECT proname, pg_get_function_identity_arguments(oid) AS args, prosecdef,
                                     pg_get_userbyid(proowner) AS owner, proconfig::text AS cfg
                                FROM pg_proc WHERE pronamespace='alerts'::regnamespace ORDER BY proname, args`),
    constraints: await rows(c, `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
                                 WHERE connamespace='alerts'::regnamespace ORDER BY conname`),
    triggers: await rows(c, `SELECT tgname, tgrelid::regclass::text AS onrel FROM pg_trigger
                              WHERE NOT tgisinternal AND tgrelid IN
                                (SELECT oid FROM pg_class WHERE relnamespace='alerts'::regnamespace) ORDER BY tgname`),
    policies: await rows(c, `SELECT policyname FROM pg_policies WHERE schemaname='alerts' ORDER BY 1`),
    tableAcls: await rows(c, `SELECT relname, relacl::text FROM pg_class
                               WHERE relnamespace='alerts'::regnamespace AND relkind IN ('r','v') ORDER BY relname`),
    fnAcls: await rows(c, `SELECT proname, proacl::text FROM pg_proc
                            WHERE pronamespace='alerts'::regnamespace ORDER BY proname`),
    schemaAcl: await val(c, `SELECT nspacl::text FROM pg_namespace WHERE nspname='alerts'`),
    defaultAcls: await rows(c, `SELECT defaclobjtype, defaclacl::text FROM pg_default_acl d
                                 JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='alerts'`),
    rls: await rows(c, `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
                         WHERE relnamespace='alerts'::regnamespace AND relkind='r' ORDER BY relname`),
    roles: (await rows(c, `SELECT rolname FROM pg_roles WHERE rolname LIKE 'alerts\\_%' ORDER BY 1`)).map((r) => r.rolname),
  };
}
// The C1 gate deliberately plants an object the migration does not own; it is not part of the
// migration's own shape, so it is filtered out before the shapes are compared.
function withoutStray(s) {
  const drop = (arr, k) => arr.filter((r) => !/zz_stray/.test(String(r[k])));
  return { ...s,
    tables: drop(s.tables, 'relname'),
    constraints: drop(s.constraints, 'conname'),
    tableAcls: drop(s.tableAcls, 'relname'),
    rls: drop(s.rls, 'relname') };
}
const allRoles = async (c) => (await rows(c, `SELECT rolname FROM pg_roles ORDER BY 1`)).map((r) => r.rolname);
const exts = async (c) => rows(c, `SELECT extname, extversion FROM pg_extension ORDER BY extname`);

async function main() {
  assertNonProduction();
  const started = new Date();

  // ------------------------------------------------------------- phase 0
  const cleaned = await cleanSlate([]);
  if (cleaned.droppedRoles.length || cleaned.droppedDatabases.length) {
    R.note(`clean slate: dropped databases ${JSON.stringify(cleaned.droppedDatabases)} and leftover roles ${JSON.stringify(cleaned.droppedRoles)}`);
  }
  await createFreshDatabase(DB);
  await buildFixture(DB);
  const sup = await open(DB);
  const asRole = (login) => open(DB, login, PW);
  const ctx = { db: DB, sup, asRole };

  const extsBefore = await exts(sup);
  const rolesBefore = await allRoles(sup);
  const g5Before = await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`);

  {
    const g = R.gate('PRE', 'the section 8 precondition holds on the target database');
    const p = await one(sup, `SELECT
      (SELECT count(*) FROM information_schema.schemata WHERE schema_name='alerts')::int AS alerts_schema_exists,
      (SELECT count(*) FROM information_schema.tables WHERE table_schema='public')::int AS public_tables,
      (SELECT count(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='telegram_initdata_replays')::int AS g5_present,
      (SELECT count(*) FROM pg_roles WHERE rolname LIKE 'alerts\\_%')::int AS alerts_roles,
      current_setting('server_version_num')::int >= 130000 AS pg13_or_later`);
    g.eq('alerts schema absent', p.alerts_schema_exists, 0);
    g.eq('G5 present', p.g5_present, 1);
    g.eq('no alerts role exists yet', p.alerts_roles, 0);
    g.eq('PostgreSQL 13 or later', p.pg13_or_later, true);
    g.eq('the migrator is NOT a superuser', await val(sup,
      `SELECT rolsuper FROM pg_roles WHERE rolname=$1`, [LOGINS.migrator]), false);
  }

  // -------------------------------------------------------- phase A: apply
  const mig = await open(DB, LOGINS.migrator, PW);
  {
    const g = R.gate('A', 'CLEAN APPLY on an empty target, as a non-superuser migrator');
    const err = await applyBatch(mig, readUp());
    g.ok('the forward migration applies without error', err === null, err && `${err.code} ${err.message}`);
    if (err) { console.error(err); }
    g.eq('the alerts schema exists', Number(await val(sup,
      `SELECT count(*) FROM information_schema.schemata WHERE schema_name='alerts'`)), 1);
    g.eq('the three tables exist', (await rows(sup,
      `SELECT table_name FROM information_schema.tables WHERE table_schema='alerts' AND table_type='BASE TABLE' ORDER BY 1`))
      .map((r) => r.table_name), ['new_lead_delivery', 'new_lead_outbox', 'retention_policy']);
    g.eq('the two audit views exist', (await rows(sup,
      `SELECT table_name FROM information_schema.tables WHERE table_schema='alerts' AND table_type='VIEW' ORDER BY 1`))
      .map((r) => r.table_name), ['new_lead_delivery_audit', 'new_lead_outbox_audit']);
    g.eq('the six group roles exist', (await rows(sup,
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'alerts\\_%' ORDER BY 1`)).map((r) => r.rolname),
      ['alerts_audit', 'alerts_dispatcher', 'alerts_owner', 'alerts_reconciler', 'alerts_retention', 'alerts_writer']);
    g.eq('G5 is untouched', await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
  }
  ctx.rolesAdded = (await allRoles(sup)).filter((r) => !rolesBefore.includes(r));

  await assertMigratorMembership(R, ctx, 49, 'after CLEAN APPLY');

  // -------------------------------------------------- hash / extension deps
  {
    const g = R.gate('HASH', 'the hash and UUID dependencies, and whether the migration mutates extensions');
    const provenance = await rows(sup, `
      SELECT p.proname, n.nspname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proname IN ('sha256','gen_random_uuid','encode','convert_to','make_interval')
       ORDER BY p.proname, args`);
    g.eq('every hash/UUID primitive the DDL uses lives in pg_catalog',
      provenance.filter((p) => p.nspname !== 'pg_catalog'), []);
    g.eq('sha256(bytea) is a built-in', await val(sup,
      `SELECT 'pg_catalog.sha256(bytea)'::regprocedure::text`), 'sha256(bytea)');
    g.eq('gen_random_uuid() is a built-in', await val(sup,
      `SELECT 'pg_catalog.gen_random_uuid()'::regprocedure::text`), 'gen_random_uuid()');
    g.eq('the migration installs no extension', await exts(sup), extsBefore);
    g.eq('the only extension present is plpgsql', extsBefore.map((e) => e.extname), ['plpgsql']);
    g.eq('digest() -- the pgcrypto entry point -- is NOT present, and is NOT needed', Number(await val(sup,
      `SELECT count(*) FROM pg_proc WHERE proname='digest'`)), 0);
    g.eq('the fingerprint works with no extension installed', await val(sup,
      `SELECT alerts.request_fingerprint('fmr_00000000000000000000000000000000') =
              encode(sha256(convert_to('finmentor:new_lead:v1:fmr_00000000000000000000000000000000','UTF8')),'hex')`), true);
    g.eq('the migration text contains no CREATE EXTENSION',
      /create\s+extension/i.test(readUp() + readDown()), false);
  }

  // ------------------------------------------------ phase B: idempotent reapply
  await bindRuntimeLogins(DB);
  {
    const g = R.gate('B', 'IDEMPOTENT REAPPLY over a populated schema');
    // seed data first, so a destructive reapply would be visible
    const w = await asRole(LOGINS.writer);
    const seeds = [D.newEvent('public'), D.newEvent('concierge'), D.newEvent('miniapp')];
    for (const e of seeds) await w.query(D.ENQUEUE, D.enqueueArgs(e));
    await w.end();
    const before = await shape(sup);
    const dataBefore = {
      outbox: await rows(sup, `SELECT * FROM alerts.new_lead_outbox ORDER BY dispatch_key`),
      delivery: await rows(sup, `SELECT * FROM alerts.new_lead_delivery ORDER BY dispatch_key, channel`),
      policy: await rows(sup, `SELECT * FROM alerts.retention_policy`),
    };
    const err = await applyBatch(mig, readUp());
    g.ok('the same migration applies a second time without error', err === null, err && `${err.code} ${err.message}`);
    const after = await shape(sup);
    for (const k of Object.keys(before)) g.eq(`reapply does not change ${k}`, after[k], before[k]);
    g.eq('no duplicate role was created', after.roles.length, 6);
    g.eq('the seeded outbox rows are untouched',
      await rows(sup, `SELECT * FROM alerts.new_lead_outbox ORDER BY dispatch_key`), dataBefore.outbox);
    g.eq('the seeded delivery rows are untouched',
      await rows(sup, `SELECT * FROM alerts.new_lead_delivery ORDER BY dispatch_key, channel`), dataBefore.delivery);
    g.eq('the retention policy row is not reset or duplicated',
      await rows(sup, `SELECT * FROM alerts.retention_policy`), dataBefore.policy);
    g.eq('G5 is still untouched', await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
    ctx.appliedShape = after;
  }

  await assertMigratorMembership(R, ctx, 50, 'after IDEMPOTENT REAPPLY');

  // ----------------------------------------------------------- the gate set
  await runGatesA(R, ctx);
  await runGatesB(R, ctx);
  await runGatesC(R, ctx);
  await runGatesD(R, ctx);

  // ---------------------------------------------- phase C: rollback + reapply
  {
    const g = R.gate('C1', 'the rollback REFUSES to cascade through an object it does not own');
    await sup.query(`CREATE TABLE alerts.zz_stray_object (id int PRIMARY KEY)`);
    await sup.query(`INSERT INTO alerts.zz_stray_object VALUES (1)`);
    const err = await applyBatch(mig, readDown());
    g.ok('the rollback fails rather than dropping an unknown object',
      !!err && (err.code === '2BP01' || err.code === '42501'), err && `${err.code} ${err.message}`);
    g.ok('the failure is on the schema drop, not a silent cascade',
      !!err && /schema alerts|zz_stray_object|must be owner/i.test(err.message + ' ' + (err.detail || '')),
      err && `${err.message} :: ${err.detail}`);
    g.eq('the whole rollback transaction rolled back -- the schema is intact', withoutStray(await shape(sup)), ctx.appliedShape);
    g.eq('the stray object survives too', Number(await val(sup, `SELECT count(*) FROM alerts.zz_stray_object`)), 1);
    await sup.query(`DROP TABLE alerts.zz_stray_object`);
  }
  {
    const g = R.gate('C2', 'ROLLBACK removes only migration-owned objects');
    const err = await applyBatch(mig, readDown());
    g.ok('the rollback runs cleanly once the schema holds only its own objects',
      err === null, err && `${err.code} ${err.message}`);
    if (err) console.error(err);
    g.eq('the alerts schema is gone', Number(await val(sup,
      `SELECT count(*) FROM information_schema.schemata WHERE schema_name='alerts'`)), 0);
    g.eq('every alerts_* role is gone', (await rows(sup,
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'alerts\\_%'`)).map((r) => r.rolname), []);
    g.eq('no default ACL for the schema survives', Number(await val(sup,
      `SELECT count(*) FROM pg_default_acl`)), 0);
    g.eq('G5 survives untouched, all 8 rows',
      await rows(sup, `SELECT * FROM public.telegram_initdata_replays ORDER BY replay_key`), g5Before);
    g.eq('the unrelated schema survives', Number(await val(sup, `SELECT count(*) FROM unrelated.keep_me`)), 1);
    g.eq('the unrelated public table survives', Number(await val(sup, `SELECT count(*) FROM public.unrelated_public_table`)), 1);
    const rolesNow = await allRoles(sup);
    g.eq('every non-alerts role survives', rolesBefore.filter((r) => !rolesNow.includes(r)), []);
    g.eq('and no extra role is left behind', rolesNow.filter((r) => !rolesBefore.includes(r)), []);
  }

  await assertMigratorMembership(R, ctx, 51, 'after ROLLBACK', { rolesExist: false });
  {
    const g = R.gate('C3', 'REAPPLY AFTER ROLLBACK from a clean database');
    const err = await applyBatch(mig, readUp());
    g.ok('the forward migration applies again cleanly', err === null, err && `${err.code} ${err.message}`);
    if (err) console.error(err);
    const after = await shape(sup);
    for (const k of ['tables', 'functions', 'constraints', 'triggers', 'policies', 'rls', 'roles',
                     'tableAcls', 'fnAcls', 'schemaAcl', 'defaultAcls']) {
      g.eq(`the rebuilt schema matches the first apply: ${k}`, after[k], ctx.appliedShape[k]);
    }
    g.eq('the retention policy is back at its approved values and undecided horizons', await one(sup,
      `SELECT payload_retention_days, delivery_retention_days, automatic_repair_days,
              key_retention_days, key_retention_status,
              delivery_unknown_retention_days, delivery_unknown_retention_status
         FROM alerts.retention_policy`),
      { payload_retention_days: 30, delivery_retention_days: 180, automatic_repair_days: 7,
        key_retention_days: null, key_retention_status: 'PENDING_LEGAL_PRIVACY_FINALISATION',
        delivery_unknown_retention_days: null, delivery_unknown_retention_status: 'PENDING_OWNER' });
    g.eq('the outbox is empty -- the rollback really did destroy the keys', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_outbox`)), 0);
  }

  await assertMigratorMembership(R, ctx, 52, 'after REAPPLY AFTER ROLLBACK');

  await mig.end();

  // ------------------------------------------------------------------ output
  const out = R.render();
  console.log(out);
  const dir = path.join(ROOT, 'db', 'validation', 'results');
  fs.mkdirSync(dir, { recursive: true });
  const meta = {
    started: started.toISOString(), finished: new Date().toISOString(),
    database: DB, server_version: await val(sup, `SELECT version()`),
    gates: [...R.gates.values()], assertions: R.assertions, notes: R.notes,
  };
  fs.writeFileSync(path.join(dir, 'last-run.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(dir, 'last-run.txt'), out + '\n');
  await sup.end();
  process.exitCode = R.failed.length ? 1 : 0;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 2; })
  .finally(async () => { await closeAll(); });
