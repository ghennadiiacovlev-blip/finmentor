// Builds a SYNTHETIC non-production database that resembles the deployed Supabase project
// closely enough to prove the gates: the G5 replay ledger (shape copied from the deployed
// catalog, ZERO production rows), the Supabase client roles, a non-superuser migrator with
// the CREATEROLE shape Supabase's `postgres` has, and unrelated objects that the rollback
// must leave alone.
import { open, rows } from './lib.mjs';

export const LOGINS = {
  migrator:      'fm_migrator',
  writer:        'fm_writer',
  dispatcher:    'fm_dispatcher',
  dispatcher2:   'fm_dispatcher_b',
  reconciler:    'fm_reconciler',
  retention:     'fm_retention',
  audit:         'fm_audit',
  g5:            'fm_g5_authority',
  authenticator: 'fm_authenticator',
  nobody:        'fm_nobody',
};
export const PW = 'fmtest_local_only';

export const RUNTIME_ROLE_OF = {
  [LOGINS.writer]: 'alerts_writer',
  [LOGINS.dispatcher]: 'alerts_dispatcher',
  [LOGINS.dispatcher2]: 'alerts_dispatcher',
  [LOGINS.reconciler]: 'alerts_reconciler',
  [LOGINS.retention]: 'alerts_retention',
  [LOGINS.audit]: 'alerts_audit',
};

export async function buildFixture(db) {
  const c = await open(db);

  // --- Supabase-shaped client roles. anon/authenticated/service_role are NOLOGIN and are
  //     reached by SET ROLE from the authenticator, exactly as PostgREST does.
  await c.query(`
    DO $fx$
    DECLARE r text;
    BEGIN
      FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
      END LOOP;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        -- Supabase's service_role carries BYPASSRLS. Gate 28 proves that is not a privilege.
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'g5_authority') THEN
        CREATE ROLE g5_authority NOLOGIN;
      END IF;
    END $fx$;`);

  // --- login roles used to prove the gates AS each runtime role, not as postgres.
  for (const [, name] of Object.entries(LOGINS)) {
    await c.query(`DO $fx$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${name}', '${PW}');
      END IF;
    END $fx$;`);
  }
  // The Supabase `postgres` shape: NOSUPERUSER, CREATEROLE, CREATEDB, LOGIN.
  await c.query(`ALTER ROLE ${LOGINS.migrator} NOSUPERUSER CREATEROLE CREATEDB`);
  await c.query(`GRANT anon, authenticated, service_role TO ${LOGINS.authenticator}`);
  await c.query(`GRANT g5_authority TO ${LOGINS.g5}`);

  // --- G5: shape copied from the deployed catalog. SYNTHETIC ROWS ONLY.
  await c.query(`
    CREATE TABLE IF NOT EXISTS public.telegram_initdata_replays (
      replay_key    text PRIMARY KEY CHECK (replay_key ~ '^[0-9a-f]{64}$'),
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      expires_at    timestamptz NOT NULL,
      correlation_id text CHECK (correlation_id IS NULL OR length(correlation_id) <= 80)
    );`);
  await c.query(`ALTER TABLE public.telegram_initdata_replays ENABLE ROW LEVEL SECURITY`);
  await c.query(`COMMENT ON TABLE public.telegram_initdata_replays IS
    'G5: single-use ledger for Telegram initData. SYNTHETIC NON-PRODUCTION COPY OF THE SHAPE ONLY.'`);
  await c.query(`GRANT SELECT, INSERT ON public.telegram_initdata_replays TO g5_authority`);
  // RLS is on, so the G5 authority needs a policy to actually see its own ledger. Without one
  // gate 29's premise -- "this role really can reach G5" -- would be vacuously true.
  await c.query(`DO $fx$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                    AND tablename='telegram_initdata_replays' AND policyname='g5_authority_all') THEN
      CREATE POLICY g5_authority_all ON public.telegram_initdata_replays
        FOR ALL TO g5_authority USING (true) WITH CHECK (true);
    END IF;
  END $fx$;`);
  await c.query(`
    INSERT INTO public.telegram_initdata_replays (replay_key, expires_at, correlation_id)
    SELECT encode(sha256(convert_to('synthetic-g5-' || g::text, 'UTF8')), 'hex'),
           now() + interval '1 day', 'synthetic-' || g
      FROM generate_series(1, 8) g
    ON CONFLICT DO NOTHING;`);

  // --- unrelated objects the rollback must not touch.
  await c.query(`CREATE SCHEMA IF NOT EXISTS unrelated`);
  await c.query(`CREATE TABLE IF NOT EXISTS unrelated.keep_me (id int PRIMARY KEY, note text)`);
  await c.query(`INSERT INTO unrelated.keep_me VALUES (1,'survives rollback') ON CONFLICT DO NOTHING`);
  await c.query(`CREATE TABLE IF NOT EXISTS public.unrelated_public_table (id int PRIMARY KEY)`);
  await c.query(`INSERT INTO public.unrelated_public_table VALUES (1) ON CONFLICT DO NOTHING`);

  // The migrator needs to be able to create the schema in this database.
  await c.query(`GRANT CREATE, CONNECT ON DATABASE ${JSON.stringify(db).replace(/"/g, '"')} TO ${LOGINS.migrator}`);

  await c.end();
}

// Grant the migration's group roles to the fixture login roles. This is a FIXTURE action:
// the migration itself creates no login and grants nothing to one (gate 48).
export async function bindRuntimeLogins(db) {
  const c = await open(db);
  for (const [login, role] of Object.entries(RUNTIME_ROLE_OF)) {
    await c.query(`GRANT ${role} TO ${login}`);
  }
  await c.end();
}

export async function roleSnapshot(db) {
  const c = await open(db);
  const r = await rows(c, `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole,
                                  (rolpassword IS NOT NULL) AS has_password
                             FROM pg_authid ORDER BY rolname`);
  await c.end();
  return r;
}

export async function extensionSnapshot(db) {
  const c = await open(db);
  const r = await rows(c, `SELECT extname, extversion FROM pg_extension ORDER BY extname`);
  await c.end();
  return r;
}
