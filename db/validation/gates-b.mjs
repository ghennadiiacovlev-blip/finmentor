// Gates 27-32 -- role isolation, RLS, retention purge and provider neutrality.
import { open, rows, one, val, expectFail } from './lib.mjs';
import { LOGINS, PW } from './fixture.mjs';
import { counts, isolateClaimable } from './gates-a.mjs';
import * as D from './data.mjs';

// Every function the migration creates, as callable signatures with harmless arguments.
export const ALERTS_CALLS = [
  [`alerts.request_fingerprint(text)`, `SELECT alerts.request_fingerprint('x')`],
  [`alerts.enqueue_new_lead(text,text,text,timestamp with time zone,jsonb)`,
   `SELECT * FROM alerts.enqueue_new_lead('public','fmr_00000000000000000000000000000000','L',now(),'{}'::jsonb)`],
  [`alerts.enqueue_new_lead_b64(text,text,text,timestamp with time zone,text)`,
   `SELECT * FROM alerts.enqueue_new_lead_b64('public','fmr_00000000000000000000000000000000','L',now(),'e30=')`],
  [`alerts.claim_new_lead_delivery(text,integer)`, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`],
  [`alerts.finalise_new_lead_delivery(text,text,uuid,text,text,text,interval)`,
   `SELECT alerts.finalise_new_lead_delivery('k','telegram','00000000-0000-0000-0000-000000000000'::uuid,'SENT')`],
  [`alerts.expire_stale_claims(interval)`, `SELECT alerts.expire_stale_claims()`],
  [`alerts.new_lead_attention()`, `SELECT * FROM alerts.new_lead_attention()`],
  [`alerts.new_lead_events_present(text[])`, `SELECT * FROM alerts.new_lead_events_present(ARRAY['x'])`],
  [`alerts.repair_new_lead_deliveries(text)`, `SELECT * FROM alerts.repair_new_lead_deliveries('k')`],
  [`alerts.purge_new_lead_payloads()`, `SELECT alerts.purge_new_lead_payloads()`],
  [`alerts.purge_new_lead_deliveries()`, `SELECT alerts.purge_new_lead_deliveries()`],
  [`alerts.purge_new_lead_keys()`, `SELECT alerts.purge_new_lead_keys()`],
  [`alerts.touch_updated_at()`, `SELECT alerts.touch_updated_at()`],
];

export const ALERTS_VIEWS = ['alerts.new_lead_outbox_audit', 'alerts.new_lead_delivery_audit'];
export const ALERTS_TABLES = ['alerts.new_lead_outbox', 'alerts.new_lead_delivery', 'alerts.retention_policy'];

export async function runGatesB(R, ctx) {
  const { db, sup, asRole } = ctx;

  // ---------------------------------------------------------------- gate 27
  {
    const g = R.gate(27, 'the real role + RLS + SECURITY DEFINER combination works for every runtime role');
    g.eq('RLS is enabled and FORCE is off on all three tables',
      await rows(sup, `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
                        WHERE relnamespace='alerts'::regnamespace AND relkind='r' ORDER BY relname`),
      [{ relname: 'new_lead_delivery', relrowsecurity: true, relforcerowsecurity: false },
       { relname: 'new_lead_outbox', relrowsecurity: true, relforcerowsecurity: false },
       { relname: 'retention_policy', relrowsecurity: true, relforcerowsecurity: false }]);
    g.eq('there are zero policies', Number(await val(sup, `SELECT count(*) FROM pg_policies WHERE schemaname='alerts'`)), 0);
    g.eq('alerts_owner does NOT hold BYPASSRLS (the exemption comes from ownership)',
      await val(sup, `SELECT rolbypassrls FROM pg_roles WHERE rolname='alerts_owner'`), false);

    // writer
    const w = await asRole(LOGINS.writer);
    const e = D.newEvent('public');
    const wr = await rows(w, D.ENQUEUE, D.enqueueArgs(e));
    g.eq('alerts_writer: enqueue returns a row, not zero rows', wr.length, 1);
    const e2 = D.newEvent('miniapp');
    const wr2 = await rows(w, D.ENQUEUE_B64, [e2.route, e2.rid, e2.lead, e2.settled.toISOString(), D.b64(e2.pl)]);
    g.eq('alerts_writer: the comma-safe b64 wrapper returns a row', wr2.length, 1);
    g.eq('alerts_writer: the b64 wrapper produced the same key', wr2[0].out_dispatch_key, e2.key);

    // dispatcher
    await isolateClaimable(sup, e.key);
    const d = await asRole(LOGINS.dispatcher);
    const cl = await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g.eq('alerts_dispatcher: claim returns a row, not zero rows', cl.length, 1);
    g.eq('alerts_dispatcher: the claim carries the payload it must render', cl[0].out_payload_json.company, 'Synthetic SRL');
    g.eq('alerts_dispatcher: finalise returns OK', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,'SENT')`, [cl[0].out_dispatch_key, cl[0].out_claim_token]), 'OK');
    g.ok('alerts_dispatcher: expire_stale_claims runs', typeof Number(await val(d, `SELECT alerts.expire_stale_claims()`)) === 'number');

    // make one row need attention, so the attention feed is proven non-empty
    await isolateClaimable(sup, e.key);
    const cl2 = await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('email')`);
    g.eq('alerts_dispatcher: the email channel claims independently', cl2.length, 1);
    await sup.query(`UPDATE alerts.new_lead_delivery SET claimed_at = now() - interval '1 hour'
                      WHERE dispatch_key=$1 AND channel='email'`, [e.key]);
    g.eq('alerts_dispatcher: a dead claim becomes DELIVERY_UNKNOWN, not RETRYABLE_FAILED',
      Number(await val(d, `SELECT alerts.expire_stale_claims()`)) >= 1, true);
    g.eq('the expired row is DELIVERY_UNKNOWN', await val(sup,
      `SELECT status FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [e.key]), 'DELIVERY_UNKNOWN');
    const att = await rows(d, `SELECT * FROM alerts.new_lead_attention()`);
    g.ok('alerts_dispatcher: the attention feed returns rows', att.length >= 1, `rows=${att.length}`);
    g.ok('the attention feed carries no payload column', !Object.keys(att[0] || {}).some((k) => /payload/i.test(k)),
      JSON.stringify(Object.keys(att[0] || {})));

    // reconciler
    const rec = await asRole(LOGINS.reconciler);
    const pres = await rows(rec, `SELECT * FROM alerts.new_lead_events_present($1::text[])`, [[e.rid, D.publicId()]]);
    g.eq('alerts_reconciler: events_present returns two rows', pres.length, 2);
    g.eq('alerts_reconciler: it finds the present one and misses the absent one',
      pres.map((p) => p.out_present).sort(), [false, true]);
    await sup.query(`DELETE FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [e.key]);
    const rep = await rows(rec, `SELECT * FROM alerts.repair_new_lead_deliveries($1)`, [e.key]);
    g.eq('alerts_reconciler: repair returns a row and recreates only the missing channel',
      [rep.length, rep[0].out_telegram_created, rep[0].out_email_created], [1, false, true]);
    const recEnq = await rows(rec, D.ENQUEUE, D.enqueueArgs(D.newEvent('public')));
    g.eq('alerts_reconciler: it may also re-enqueue', recEnq.length, 1);

    // retention
    const ret = await asRole(LOGINS.retention);
    g.ok('alerts_retention: purge_new_lead_payloads runs', Number(await val(ret, `SELECT alerts.purge_new_lead_payloads()`)) >= 0);
    g.ok('alerts_retention: purge_new_lead_deliveries runs', Number(await val(ret, `SELECT alerts.purge_new_lead_deliveries()`)) >= 0);
    const keyErr = await expectFail(() => ret.query(`SELECT alerts.purge_new_lead_keys()`));
    g.ok('alerts_retention: purge_new_lead_keys REFUSES while the horizon is undecided',
      !!keyErr && /ALERTS_KEY_RETENTION_PENDING_LEGAL_PRIVACY_FINALISATION/.test(keyErr.message)
      && keyErr.code === '0A000', keyErr && keyErr.message);

    // audit
    const aud = await asRole(LOGINS.audit);
    const ob = await rows(aud, `SELECT * FROM alerts.new_lead_outbox_audit`);
    const dv = await rows(aud, `SELECT * FROM alerts.new_lead_delivery_audit`);
    g.ok('alerts_audit: the outbox audit view returns rows, not zero rows', ob.length >= 1, `rows=${ob.length}`);
    g.ok('alerts_audit: the delivery audit view returns rows, not zero rows', dv.length >= 1, `rows=${dv.length}`);
    const audErr = await expectFail(() => aud.query(`SELECT 1 FROM alerts.new_lead_outbox LIMIT 1`));
    g.eq('alerts_audit: the base table itself stays denied', audErr && audErr.code, '42501');

    await w.end(); await d.end(); await rec.end(); await ret.end(); await aud.end();
    ctx.gate27Key = e.key;
  }

  // ---------------------------------------------------------------- gate 28
  {
    const g = R.gate(28, 'PUBLIC / anon / authenticated / service_role cannot execute the privileged functions');
    g.eq('PUBLIC holds EXECUTE on no function in the schema', await rows(sup,
      `SELECT p.proname FROM pg_proc p WHERE p.pronamespace='alerts'::regnamespace
        AND has_function_privilege('public', p.oid, 'EXECUTE') ORDER BY 1`), []);
    const auth = await open(db, LOGINS.authenticator, PW);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await auth.query(`SET ROLE ${role}`);
      for (const [sig, call] of ALERTS_CALLS) {
        const err = await expectFail(() => auth.query(call));
        g.eq(`${role} denied on ${sig}`, err && err.code, '42501');
      }
      for (const rel of [...ALERTS_TABLES, ...ALERTS_VIEWS]) {
        const err = await expectFail(() => auth.query(`SELECT 1 FROM ${rel} LIMIT 1`));
        g.eq(`${role} denied SELECT on ${rel}`, err && err.code, '42501');
      }
      await auth.query(`RESET ROLE`);
    }
    g.eq('service_role really does carry BYPASSRLS -- and still reaches nothing',
      await val(sup, `SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'`), true);
    // a fresh unprivileged login
    const nob = await open(db, LOGINS.nobody, PW);
    for (const [sig, call] of ALERTS_CALLS.slice(0, 6)) {
      const err = await expectFail(() => nob.query(call));
      g.eq(`an unprivileged login is denied on ${sig}`, err && err.code, '42501');
    }
    await nob.end(); await auth.end();
  }

  // ---------------------------------------------------------------- gate 29
  {
    const g = R.gate(29, 'the G5 authority cannot execute any alerts function');
    const g5 = await open(db, LOGINS.g5, PW);
    await g5.query(`SET ROLE g5_authority`);
    g.ok('the G5 authority really can reach G5', Number(await val(g5,
      `SELECT count(*) FROM public.telegram_initdata_replays`)) === 8);
    for (const [sig, call] of ALERTS_CALLS) {
      const err = await expectFail(() => g5.query(call));
      g.eq(`g5_authority denied on ${sig}`, err && err.code, '42501');
    }
    for (const rel of [...ALERTS_TABLES, ...ALERTS_VIEWS]) {
      const err = await expectFail(() => g5.query(`SELECT 1 FROM ${rel} LIMIT 1`));
      g.eq(`g5_authority denied SELECT on ${rel}`, err && err.code, '42501');
    }
    await g5.end();
  }

  // ---------------------------------------------------------------- gate 30
  {
    const g = R.gate(30, 'no alerts role can reach the G5 replay ledger');
    for (const login of [LOGINS.writer, LOGINS.dispatcher, LOGINS.reconciler, LOGINS.retention, LOGINS.audit]) {
      const c = await open(db, login, PW);
      for (const [label, sql] of [
        ['SELECT', `SELECT 1 FROM public.telegram_initdata_replays LIMIT 1`],
        ['INSERT', `INSERT INTO public.telegram_initdata_replays (replay_key, expires_at) VALUES (repeat('c',64), now())`],
        ['UPDATE', `UPDATE public.telegram_initdata_replays SET correlation_id='x'`],
        ['DELETE', `DELETE FROM public.telegram_initdata_replays`]]) {
        const err = await expectFail(() => c.query(sql));
        g.eq(`${login} denied ${label} on G5`, err && err.code, '42501');
      }
      await c.end();
    }
    g.eq('no alerts_* grantee appears on the G5 table', await rows(sup,
      `SELECT grantee FROM information_schema.role_table_grants
        WHERE table_schema='public' AND table_name='telegram_initdata_replays'
          AND grantee LIKE 'alerts\\_%'`), []);
    g.eq('no membership edge exists between alerts_* and any G5 role', await rows(sup,
      `SELECT r.rolname AS member, g.rolname AS granted
         FROM pg_auth_members m
         JOIN pg_roles r ON r.oid=m.member
         JOIN pg_roles g ON g.oid=m.roleid
        WHERE (r.rolname LIKE 'alerts\\_%' AND g.rolname NOT LIKE 'alerts\\_%')
           OR (g.rolname LIKE 'alerts\\_%' AND r.rolname IN ('g5_authority','${LOGINS.g5}'))`), []);
    g.eq('the G5 ledger still holds its 8 synthetic rows, untouched', Number(await val(sup,
      `SELECT count(*) FROM public.telegram_initdata_replays`)), 8);
  }

  // ---------------------------------------------------------------- gate 31
  {
    const g = R.gate(31, 'the 30-day payload purge leaves the durable identity internally consistent');
    const w = await asRole(LOGINS.writer);
    const e = D.newEvent('concierge');
    const old = new Date(Date.now() - 40 * 86400000);
    await w.query(D.ENQUEUE, [e.route, e.rid, e.lead, old.toISOString(), JSON.stringify(e.pl)]);
    g.eq('the aged event starts with 1 + 1 + 1', await counts(sup, e.key), { event: 1, telegram: 1, email: 1 });
    const before = await one(sup, `SELECT request_fingerprint, dispatch_key, request_route, lead_id, settled_at, created_at
                                     FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [e.key]);

    const ret = await asRole(LOGINS.retention);
    const n = Number(await val(ret, `SELECT alerts.purge_new_lead_payloads()`));
    g.ok('the purge reports at least one row purged', n >= 1, `n=${n}`);
    const after = await one(sup, `SELECT request_fingerprint, dispatch_key, request_route, lead_id, settled_at, created_at,
                                         payload_json, payload_purged_at
                                    FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [e.key]);
    g.eq('payload_json is emptied to {}', after.payload_json, {});
    g.ok('payload_purged_at is stamped', after.payload_purged_at instanceof Date, String(after.payload_purged_at));
    g.eq('the durable identity is unchanged', {
      request_fingerprint: after.request_fingerprint, dispatch_key: after.dispatch_key,
      request_route: after.request_route, lead_id: after.lead_id,
      settled_at: after.settled_at, created_at: after.created_at }, before);
    g.eq('the fingerprint still satisfies its own CHECK', await val(sup,
      `SELECT request_fingerprint ~ '^[0-9a-f]{64}$' FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [e.key]), true);
    g.eq('both delivery rows survive with a valid foreign key', await counts(sup, e.key),
      { event: 1, telegram: 1, email: 1 });
    g.eq('no orphan delivery row exists anywhere', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_delivery d
         LEFT JOIN alerts.new_lead_outbox o ON o.dispatch_key=d.dispatch_key WHERE o.dispatch_key IS NULL`)), 0);

    // the purged event is not claimable, and it surfaces for the owner instead
    await isolateClaimable(sup, e.key);
    const d = await asRole(LOGINS.dispatcher);
    g.eq('a purged event is not claimable on telegram',
      (await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`)).length, 0);
    g.eq('a purged event is not claimable on email',
      (await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('email')`)).length, 0);
    const att = await rows(d, `SELECT * FROM alerts.new_lead_attention()`);
    g.ok('it surfaces as UNDELIVERED_PAYLOAD_PURGED', att.some((a) =>
      a.out_dispatch_key === e.key && a.out_reason === 'UNDELIVERED_PAYLOAD_PURGED'),
      JSON.stringify(att.filter((a) => a.out_dispatch_key === e.key)));

    // no delivery is accidentally re-created
    const re = await one(w, D.ENQUEUE, [e.route, e.rid, e.lead, old.toISOString(), JSON.stringify(e.pl)]);
    g.eq('re-enqueue after purge does not resurrect anything', re.out_outcome, 'EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW');
    g.eq('still exactly 1 + 1 + 1', await counts(sup, e.key), { event: 1, telegram: 1, email: 1 });
    await sup.query(`DELETE FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [e.key]);
    const re2 = await one(w, D.ENQUEUE, [e.route, e.rid, e.lead, old.toISOString(), JSON.stringify(e.pl)]);
    g.eq('and a deleted delivery row is NOT silently recreated after the horizon',
      [re2.out_outcome, re2.out_email_created], ['EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW', false]);
    g.eq('the email row stays absent', (await counts(sup, e.key)).email, 0);
    await w.end(); await ret.end(); await d.end();
    ctx.purgedKey = e.key;
  }

  // ---------------------------------------------------------------- gate 32
  {
    const g = R.gate(32, 'zero Microsoft-specific schema coupling');
    const cols = async (t) => (await rows(sup,
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='alerts' AND table_name=$1 ORDER BY column_name`, [t])).map((r) => r.column_name);
    g.eq('new_lead_outbox columns are exactly the frozen set', await cols('new_lead_outbox'),
      ['created_at', 'dispatch_key', 'event_type', 'fingerprint_version', 'lead_id', 'payload_json',
       'payload_purged_at', 'request_fingerprint', 'request_route', 'schema_version', 'settled_at']);
    g.eq('new_lead_delivery columns are exactly the frozen set', await cols('new_lead_delivery'),
      ['attempt_count', 'channel', 'claim_token', 'claimed_at', 'created_at', 'dispatch_key',
       'last_error_code', 'next_attempt_at', 'provider_message_id', 'sent_at', 'status', 'updated_at']);
    g.eq('retention_policy columns are exactly the frozen set', await cols('retention_policy'),
      ['automatic_repair_days', 'decided_at', 'delivery_retention_days',
       'delivery_unknown_retention_days', 'delivery_unknown_retention_status',
       'key_retention_days', 'key_retention_status',
       'payload_retention_days', 'singleton', 'updated_at']);
    const providerish = /tenant|mailbox|graph|internet_message|client_id|client_secret|oauth|azure|microsoft|smtp|exchange|o365|m365/i;
    const names = await rows(sup, `
      SELECT column_name AS n FROM information_schema.columns WHERE table_schema='alerts'
      UNION ALL SELECT conname FROM pg_constraint WHERE connamespace='alerts'::regnamespace
      UNION ALL SELECT relname FROM pg_class WHERE relnamespace='alerts'::regnamespace
      UNION ALL SELECT proname FROM pg_proc WHERE pronamespace='alerts'::regnamespace
      UNION ALL SELECT typname FROM pg_type WHERE typnamespace='alerts'::regnamespace`);
    g.eq('no object name anywhere in the schema is provider-specific',
      names.map((r) => r.n).filter((n) => providerish.test(n)), []);
    const defs = await rows(sup, `
      SELECT conname AS n, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE connamespace='alerts'::regnamespace`);
    g.eq('no CHECK constraint mentions a provider', defs.filter((r) => providerish.test(r.d)).map((r) => r.n), []);
    const bodies = await rows(sup, `SELECT proname AS n, prosrc AS d FROM pg_proc WHERE pronamespace='alerts'::regnamespace`);
    g.eq('no function body mentions a provider', bodies.filter((r) => providerish.test(r.d)).map((r) => r.n), []);
    g.eq('provider_message_id is nullable and provider-neutral', await one(sup,
      `SELECT is_nullable, data_type FROM information_schema.columns
        WHERE table_schema='alerts' AND table_name='new_lead_delivery' AND column_name='provider_message_id'`),
      { is_nullable: 'YES', data_type: 'text' });
    g.eq('the channel CHECK names only telegram and email', await val(sup,
      `SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE connamespace='alerts'::regnamespace AND conname='new_lead_delivery_channel_ck'`),
      `CHECK ((channel = ANY (ARRAY['telegram'::text, 'email'::text])))`);
  }

  return ctx;
}
