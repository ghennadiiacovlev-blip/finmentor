// Gates 33-48, the section 7 repair window, and the hash/extension dependency.
import { open, rows, one, val, expectFail, sleep } from './lib.mjs';
import { LOGINS, PW } from './fixture.mjs';
import { counts, isolateClaimable } from './gates-a.mjs';
import * as D from './data.mjs';

const rowOf = (sup, key, ch) => one(sup,
  `SELECT * FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel=$2`, [key, ch]);

// Enqueue an event and return it already isolated as the only claimable one.
async function seed(ctx, route = 'public', settledAt = new Date()) {
  const w = await ctx.asRole(LOGINS.writer);
  const e = D.newEvent(route);
  await w.query(D.ENQUEUE, [e.route, e.rid, e.lead, settledAt.toISOString(), JSON.stringify(e.pl)]);
  await w.end();
  await isolateClaimable(ctx.sup, e.key);
  return e;
}

export async function runGatesC(R, ctx) {
  const { db, sup, asRole } = ctx;

  // ---------------------------------------------------------------- gate 33
  {
    const g = R.gate(33, 'a malformed route identity is rejected before any insert');
    const w = await asRole(LOGINS.writer);
    const bad = [
      ['public', 'fmr_XYZ', 'wrong alphabet'],
      ['public', 'fmr_0123456789abcdef', 'too short'],
      ['public', D.miniappId(), 'a Mini App identity on the public route'],
      ['miniapp', D.publicId(), 'a public identity on the Mini App route'],
      ['concierge', D.publicId(), 'a public identity on the Concierge route'],
      ['concierge', 'C-abc-1788000000000', 'a non-numeric chat id'],
      ['concierge', 'C-123-123', 'an epoch that is too short'],
      ['public', '', 'an empty identity'],
      ['public', null, 'a null identity'],
    ];
    for (const [route, rid, why] of bad) {
      const err = await expectFail(() => w.query(D.ENQUEUE,
        [route, rid, D.leadId(), new Date().toISOString(), JSON.stringify(D.payload())]));
      g.ok(`rejected: ${why}`, !!err && /ALERTS_REQUEST_ID_SHAPE_INVALID/.test(err.message) && err.code === '22023',
        err && err.message);
    }
    for (const route of ['PUBLIC', 'web', '', null, 'concierge ']) {
      const err = await expectFail(() => w.query(D.ENQUEUE,
        [route, D.publicId(), D.leadId(), new Date().toISOString(), JSON.stringify(D.payload())]));
      g.ok(`an unknown route "${route}" is rejected first`, !!err && /ALERTS_ROUTE_INVALID/.test(err.message), err && err.message);
    }
    const total = Number(await val(sup, `SELECT count(*) FROM alerts.new_lead_outbox`));
    g.ok('no rejected call left a row behind', total === Number(await val(sup, `SELECT count(*) FROM alerts.new_lead_outbox`)));
    await w.end();
  }

  // ---------------------------------------------------------------- gate 34
  {
    const g = R.gate(34, 'a malformed or forbidden payload rolls the whole enqueue transaction back');
    const w = await asRole(LOGINS.writer);
    const cases = [
      // AMENDMENT 2.2-D: the message reports HOW MANY keys were forbidden, never WHICH. A JSON
      // key is a caller-controlled string, so a key name is caller data like any other value.
      [D.payload({ raw_json: '{"a":1}' }), /^ALERTS_PAYLOAD_KEY_FORBIDDEN \(n=1\)$/, 'a forbidden key'],
      [D.payload({ initData: 'x', signature: 'y' }), /^ALERTS_PAYLOAD_KEY_FORBIDDEN \(n=2\)$/, 'two forbidden keys'],
      [D.payload({ contact_channel: 'sms' }), /ALERTS_CONTACT_CHANNEL_INVALID/, 'an unknown contact channel'],
    ];
    for (const [pl, re, why] of cases) {
      const e = D.newEvent('public');
      const err = await expectFail(() => w.query(D.ENQUEUE, [e.route, e.rid, e.lead, e.settled.toISOString(), JSON.stringify(pl)]));
      g.ok(`rejected: ${why}`, !!err && re.test(err.message) && err.code === '22023', err && err.message);
      g.eq(`nothing committed for: ${why}`, await counts(sup, e.key), { event: 0, telegram: 0, email: 0 });
      g.ok(`no payload VALUE is echoed for: ${why}`, !!err && !err.message.includes('Synthetic SRL')
        && !err.message.includes('@synthetic_handle_only'), err && err.message);
      g.ok(`no payload KEY NAME is echoed for: ${why} (amendment 2.2-D)`,
        !!err && !/raw_json|initData|signature/.test(err.message + ' ' + (err.detail || '')), err && err.message);
    }
    for (const [raw, why] of [['[]', 'a JSON array'], ['"str"', 'a JSON string'], ['null', 'JSON null']]) {
      const e = D.newEvent('public');
      const err = await expectFail(() => w.query(D.ENQUEUE, [e.route, e.rid, e.lead, e.settled.toISOString(), raw]));
      g.ok(`rejected: ${why}`, !!err && /ALERTS_PAYLOAD_NOT_OBJECT/.test(err.message), err && err.message);
      g.eq(`nothing committed for: ${why}`, await counts(sup, e.key), { event: 0, telegram: 0, email: 0 });
    }
    // the table CHECK is a second, independent lock -- prove it directly as the owner
    const errCk = await expectFail(() => sup.query(
      `INSERT INTO alerts.new_lead_outbox (request_fingerprint, request_route, lead_id, settled_at, payload_json)
       VALUES (repeat('d',64),'public','X',now(),'{"raw_json":"leak"}'::jsonb)`));
    g.eq('the allowlist CHECK refuses a forbidden key even from the owner', errCk && errCk.code, '23514');
    await w.end();
  }

  // ---------------------------------------------------------------- gate 35
  {
    const g = R.gate(35, 'a failure while creating ONE delivery row rolls the whole transaction back');
    await sup.query(`CREATE OR REPLACE FUNCTION public.zz_fail_email() RETURNS trigger
      LANGUAGE plpgsql AS $t$ BEGIN RAISE EXCEPTION 'ZZ_EMAIL_ROW_FAILED'; END $t$;`);
    await sup.query(`CREATE TRIGGER zz_fail_email BEFORE INSERT ON alerts.new_lead_delivery
      FOR EACH ROW WHEN (NEW.channel = 'email') EXECUTE FUNCTION public.zz_fail_email();`);
    const w = await asRole(LOGINS.writer);
    const e = D.newEvent('public');
    const err = await expectFail(() => w.query(D.ENQUEUE, D.enqueueArgs(e)));
    g.ok('the email-row failure aborts the call', !!err && /ZZ_EMAIL_ROW_FAILED/.test(err.message), err && err.message);
    await sup.query(`DROP TRIGGER zz_fail_email ON alerts.new_lead_delivery`);
    await sup.query(`DROP FUNCTION public.zz_fail_email()`);
    g.eq('event = 0, telegram = 0, email = 0 -- the successful telegram insert is rolled back too',
      await counts(sup, e.key), { event: 0, telegram: 0, email: 0 });
    // and the caller can simply retry afterwards
    const r = await one(w, D.ENQUEUE, D.enqueueArgs(e));
    g.eq('a retry after the failure creates the complete set', r.out_outcome, 'CREATED');
    g.eq('1 + 1 + 1 on retry', await counts(sup, e.key), { event: 1, telegram: 1, email: 1 });
    await w.end();
  }

  // ------------------------------------------------------------- gates 36/37
  {
    const g36 = R.gate(36, 'finalise requires the correct claim_token');
    const g37 = R.gate(37, 'a wrong claim_token changes zero rows');
    const e = await seed(ctx);
    const d = await asRole(LOGINS.dispatcher);
    const cl = await one(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g36.eq('claimed the seeded row', cl.out_dispatch_key, e.key);
    const claimedRow = await rowOf(sup, e.key, 'telegram');

    g37.eq('a random token is refused', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'telegram',gen_random_uuid(),'SENT')`, [e.key]), 'NOT_OWNED');
    g37.eq('a null token is refused', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'telegram',NULL,'SENT')`, [e.key]), 'NOT_OWNED');
    g37.eq('the right token on the WRONG channel is refused', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'email',$2,'SENT')`, [e.key, cl.out_claim_token]), 'NOT_OWNED');
    g37.eq('the right token on the WRONG key is refused', await val(d,
      `SELECT alerts.finalise_new_lead_delivery('NEW_LEAD:'||repeat('e',64),'telegram',$1,'SENT')`, [cl.out_claim_token]), 'NOT_OWNED');
    g37.eq('the row is byte-for-byte unchanged by every refused finalise', await rowOf(sup, e.key, 'telegram'), claimedRow);

    g36.eq('the correct token succeeds', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,'SENT',NULL,'synthetic-provider-id')`,
      [e.key, cl.out_claim_token]), 'OK');
    const sent = await rowOf(sup, e.key, 'telegram');
    g36.eq('the row is SENT with sent_at set and the token cleared',
      [sent.status, sent.sent_at !== null, sent.claim_token], ['SENT', true, null]);
    g36.eq('replaying the same token after finalise is refused', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,'SENT')`, [e.key, cl.out_claim_token]), 'NOT_OWNED');
    await d.end();
    ctx.sentKey = e.key;
  }

  // ---------------------------------------------------------------- gate 38
  {
    const g = R.gate(38, 'two dispatchers racing for one delivery produce exactly one claim winner');
    const e = await seed(ctx);
    // (a) deterministic interleaving: the loser must get zero rows, not an error and not a duplicate
    const d1 = await asRole(LOGINS.dispatcher), d2 = await asRole(LOGINS.dispatcher2);
    await d1.query('BEGIN');
    const c1 = await rows(d1, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    const c2 = await rows(d2, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g.eq('the first dispatcher wins the row', c1.length, 1);
    g.eq('the second gets zero rows while the row is locked (SKIP LOCKED)', c2.length, 0);
    await d1.query('COMMIT');
    const c3 = await rows(d2, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g.eq('and zero rows after the commit, because the row is CLAIMED', c3.length, 0);
    g.eq('attempt_count advanced exactly once', Number((await rowOf(sup, e.key, 'telegram')).attempt_count), 1);
    await d1.end(); await d2.end();

    // (b) a released burst of five dispatchers on one row
    const e2 = await seed(ctx);
    const cs = [];
    for (let i = 0; i < 5; i++) cs.push(await asRole(i % 2 ? LOGINS.dispatcher : LOGINS.dispatcher2));
    const res = await Promise.allSettled(cs.map((c) => c.query(`SELECT * FROM alerts.claim_new_lead_delivery('telegram')`)));
    const won = res.filter((r) => r.status === 'fulfilled' && r.value.rows.length === 1);
    g.eq('burst: exactly one winner', won.length, 1);
    g.eq('burst: nobody errored', res.filter((r) => r.status === 'rejected').length, 0);
    g.eq('burst: attempt_count advanced exactly once', Number((await rowOf(sup, e2.key, 'telegram')).attempt_count), 1);
    g.eq('burst: exactly one distinct claim token exists', Number(await val(sup,
      `SELECT count(DISTINCT claim_token) FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='telegram'`, [e2.key])), 1);
    for (const c of cs) await c.end();
  }

  // ---------------------------------------------------------------- gate 39
  {
    const g = R.gate(39, 'a SENT delivery can never be reclaimed');
    for (const ch of ['telegram', 'email']) {
      const e = await seed(ctx);
      const d = await asRole(LOGINS.dispatcher);
      const cl = await one(d, `SELECT * FROM alerts.claim_new_lead_delivery($1)`, [ch]);
      await d.query(`SELECT alerts.finalise_new_lead_delivery($1,$2,$3,'SENT')`, [e.key, ch, cl.out_claim_token]);
      await isolateClaimable(sup, e.key);
      const again = await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery($1)`, [ch]);
      g.eq(`a SENT ${ch} row is never returned by the claim`, again.length, 0);
      const row = await rowOf(sup, e.key, ch);
      g.eq(`the SENT ${ch} row keeps attempt_count = 1`, Number(row.attempt_count), 1);
      g.eq(`the SENT ${ch} row cannot be forced back by a stale token`, await val(d,
        `SELECT alerts.finalise_new_lead_delivery($1,$2,$3,'RETRYABLE_FAILED','SYNTH_ERR')`,
        [e.key, ch, cl.out_claim_token]), 'NOT_OWNED');
      g.eq(`the SENT ${ch} row is still SENT`, (await rowOf(sup, e.key, ch)).status, 'SENT');
      await d.end();
    }
    // and the state invariant is enforced by constraint, not only by the function
    const err = await expectFail(() => sup.query(
      `UPDATE alerts.new_lead_delivery SET status='SENT', sent_at=NULL WHERE status='SENT'`));
    g.eq('a SENT row without sent_at is refused by CHECK', err && err.code, '23514');
  }

  // ---------------------------------------------------------------- gate 40
  {
    const g = R.gate(40, 'DELIVERY_UNKNOWN is never automatically reclaimed');
    const e = await seed(ctx);
    const d = await asRole(LOGINS.dispatcher);
    const cl = await one(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g.eq('finalise can declare DELIVERY_UNKNOWN', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,'DELIVERY_UNKNOWN','PROVIDER_TIMEOUT')`,
      [e.key, cl.out_claim_token]), 'OK');
    await isolateClaimable(sup, e.key);
    g.eq('a DELIVERY_UNKNOWN row is not returned by the claim',
      (await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`)).length, 0);
    await sup.query(`UPDATE alerts.new_lead_delivery SET next_attempt_at = now() - interval '1 year'
                      WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);
    g.eq('not even with next_attempt_at far in the past',
      (await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`)).length, 0);

    // the same for a claim that died: expire_stale_claims must produce DELIVERY_UNKNOWN
    const e2 = await seed(ctx);
    const cl2 = await one(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g.ok('claimed a second row', !!cl2);
    await sup.query(`UPDATE alerts.new_lead_delivery SET claimed_at = now() - interval '1 hour'
                      WHERE dispatch_key=$1 AND channel='telegram'`, [e2.key]);
    await d.query(`SELECT alerts.expire_stale_claims()`);
    const r2 = await rowOf(sup, e2.key, 'telegram');
    g.eq('an expired claim becomes DELIVERY_UNKNOWN, not RETRYABLE_FAILED',
      [r2.status, r2.last_error_code, r2.claim_token], ['DELIVERY_UNKNOWN', 'CLAIM_EXPIRED', null]);
    await isolateClaimable(sup, e2.key);
    g.eq('and it is not reclaimed', (await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`)).length, 0);
    g.ok('it appears in the owner attention feed instead',
      (await rows(d, `SELECT * FROM alerts.new_lead_attention()`)).some(
        (a) => a.out_dispatch_key === e2.key && a.out_reason === 'DELIVERY_UNKNOWN'));
    // a floor exists so nobody can expire claims aggressively
    const errShort = await expectFail(() => d.query(`SELECT alerts.expire_stale_claims(interval '10 seconds')`));
    g.ok('expire_stale_claims refuses a sub-minute window',
      !!errShort && /ALERTS_EXPIRY_TOO_SHORT/.test(errShort.message), errShort && errShort.message);
    await d.end();
  }

  // ------------------------------------------------------------- gates 41/42
  {
    const g41 = R.gate(41, 'RETRYABLE_FAILED cannot be reclaimed before next_attempt_at');
    const g42 = R.gate(42, 'RETRYABLE_FAILED becomes claimable after next_attempt_at');
    const e = await seed(ctx);
    const d = await asRole(LOGINS.dispatcher);
    const cl = await one(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g41.eq('finalise records a retryable failure', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,'RETRYABLE_FAILED','PROVIDER_5XX')`,
      [e.key, cl.out_claim_token]), 'OK');
    const back = await rowOf(sup, e.key, 'telegram');
    g41.eq('the row is RETRYABLE_FAILED with the token cleared', [back.status, back.claim_token], ['RETRYABLE_FAILED', null]);
    g41.ok('next_attempt_at was pushed into the future', back.next_attempt_at > new Date(), String(back.next_attempt_at));
    g41.ok('the backoff floor of 30 seconds is applied',
      back.next_attempt_at.getTime() - Date.now() >= 25000, String(back.next_attempt_at));
    await sup.query(`UPDATE alerts.new_lead_delivery SET next_attempt_at = now() + interval '10 years'
                      WHERE dispatch_key <> $1 AND status IN ('PENDING','RETRYABLE_FAILED')`, [e.key]);
    g41.eq('it is not claimable while next_attempt_at is in the future',
      (await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`)).length, 0);

    await sup.query(`UPDATE alerts.new_lead_delivery SET next_attempt_at = now() - interval '1 second'
                      WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);
    const again = await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g42.eq('once next_attempt_at has passed it is claimable again', again.length, 1);
    g42.eq('and it is the same row', again[0].out_dispatch_key, e.key);
    g42.eq('attempt_count advanced to 2', Number(again[0].out_attempt_count), 2);

    // the attempt ceiling is honoured
    await sup.query(`UPDATE alerts.new_lead_delivery
                        SET status='RETRYABLE_FAILED', claim_token=NULL, claimed_at=NULL,
                            attempt_count=8, next_attempt_at=now() - interval '1 minute'
                      WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);
    g42.eq('a row at the attempt ceiling is not claimed',
      (await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`)).length, 0);
    g42.eq('but a caller may raise the ceiling explicitly',
      (await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram', 9)`)).length, 1);
    await d.end();
  }

  // ---------------------------------------------------------------- gate 43
  {
    const g = R.gate(43, 'a telegram claim cannot mutate the email row, and the reverse');
    const e = await seed(ctx);
    const emailBefore = await rowOf(sup, e.key, 'email');
    const d = await asRole(LOGINS.dispatcher);
    const cl = await one(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g.eq('the telegram claim touched the telegram row only', await rowOf(sup, e.key, 'email'), emailBefore);
    await d.query(`SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,'PERMANENT_FAILED','PROVIDER_403')`,
      [e.key, cl.out_claim_token]);
    g.eq('the telegram finalise touched the telegram row only', await rowOf(sup, e.key, 'email'), emailBefore);
    g.eq('the telegram row really did change', (await rowOf(sup, e.key, 'telegram')).status, 'PERMANENT_FAILED');

    await isolateClaimable(sup, e.key);
    const tgBefore = await rowOf(sup, e.key, 'telegram');
    const cl2 = await one(d, `SELECT * FROM alerts.claim_new_lead_delivery('email')`);
    g.eq('the email claim picked the email row', cl2.out_channel, 'email');
    g.eq('the email claim touched the email row only', await rowOf(sup, e.key, 'telegram'), tgBefore);
    await d.query(`SELECT alerts.finalise_new_lead_delivery($1,'email',$2,'SENT')`, [e.key, cl2.out_claim_token]);
    g.eq('the email finalise touched the email row only', await rowOf(sup, e.key, 'telegram'), tgBefore);
    g.eq('a channel is refused outright if it is not one of the two', (await expectFail(
      () => d.query(`SELECT * FROM alerts.claim_new_lead_delivery('sms')`))).code, '22023');
    const errCh = await expectFail(() => sup.query(
      `UPDATE alerts.new_lead_delivery SET channel='sms' WHERE dispatch_key=$1 AND channel='email'`, [e.key]));
    g.eq('and by CHECK constraint as well', errCh && errCh.code, '23514');
    await d.end();
  }

  // ---------------------------------------------------------------- gate 44
  {
    const g = R.gate(44, 'the outbox payload after purge contains no contact_value');
    const key = ctx.purgedKey;
    g.ok('a purged event from gate 31 is available', !!key, String(key));
    const row = await one(sup, `SELECT payload_json, payload_purged_at FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [key]);
    g.eq('the payload is exactly {}', row.payload_json, {});
    g.eq('the payload holds no keys at all', Object.keys(row.payload_json).length, 0);
    g.eq('no purged row anywhere retains a contact_value', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_outbox WHERE payload_purged_at IS NOT NULL AND payload_json ? 'contact_value'`)), 0);
    g.eq('no purged row retains any other key either', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_outbox WHERE payload_purged_at IS NOT NULL AND payload_json <> '{}'::jsonb`)), 0);
    g.eq('the synthetic contact value is gone from that row', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_outbox WHERE dispatch_key=$1 AND payload_json::text LIKE '%synthetic_handle_only%'`, [key])), 0);
    const errPurge = await expectFail(() => sup.query(
      `UPDATE alerts.new_lead_outbox SET payload_json='{"contact_value":"leak"}'::jsonb WHERE dispatch_key=$1`, [key]));
    g.eq('the purge CHECK refuses to put a payload back on a purged row', errPurge && errPurge.code, '23514');
    g.eq('the audit view reports the purged row as carrying no contact value', await one(sup,
      `SELECT has_contact_value, payload_present FROM alerts.new_lead_outbox_audit WHERE dispatch_key=$1`, [key]),
      { has_contact_value: false, payload_present: false });
  }

  // ---------------------------------------------------------------- gate 45
  {
    const g = R.gate(45, 'the audit views expose no raw request_id');
    const defOutbox = await val(sup, `SELECT pg_get_viewdef('alerts.new_lead_outbox_audit'::regclass, true)`);
    g.ok('the outbox audit view does not select payload_json itself', !/^\s*payload_json,?\s*$/m.test(defOutbox), defOutbox.slice(0, 400));
    const audCols = (await rows(sup, `SELECT column_name FROM information_schema.columns
      WHERE table_schema='alerts' AND table_name='new_lead_outbox_audit' ORDER BY column_name`)).map((r) => r.column_name);
    g.eq('the outbox audit view exposes a frozen, payload-free column set', audCols,
      ['created_at', 'dispatch_key', 'event_type', 'fingerprint_version', 'has_contact_value', 'lead_id',
       'payload_present', 'payload_purged_at', 'request_fingerprint', 'request_route', 'schema_version', 'settled_at']);
    const aud = await asRole(LOGINS.audit);
    const needles = [ctx.conciergeRid, D.SYNTH_CHAT_ID, D.SYNTH_EPOCH].filter(Boolean);
    for (const v of ['new_lead_outbox_audit', 'new_lead_delivery_audit']) {
      const all = JSON.stringify(await rows(aud, `SELECT * FROM alerts.${v}`));
      for (const n of needles) g.ok(`alerts.${v} contains no ${n === D.SYNTH_CHAT_ID ? 'chat id' : 'raw identifier'}`, !all.includes(n));
      g.ok(`alerts.${v} carries no contact value`, !all.includes('synthetic_handle_only'));
    }
    g.ok('the delivery audit view has no payload column',
      !(await rows(sup, `SELECT column_name FROM information_schema.columns
        WHERE table_schema='alerts' AND table_name='new_lead_delivery_audit'`)).some((r) => /payload/i.test(r.column_name)));
    await aud.end();
  }

  // ---------------------------------------------------------------- gate 46
  {
    const g = R.gate(46, 'SECURITY DEFINER controls: owner, pinned search_path, no dynamic SQL, no PUBLIC EXECUTE');
    const fns = await rows(sup, `
      SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig::text AS cfg,
             p.prosrc, has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec
        FROM pg_proc p WHERE p.pronamespace='alerts'::regnamespace ORDER BY p.proname`);
    g.eq('the schema contains exactly the 13 expected functions', fns.map((f) => f.proname),
      ['claim_new_lead_delivery', 'enqueue_new_lead', 'enqueue_new_lead_b64', 'expire_stale_claims',
       'finalise_new_lead_delivery', 'new_lead_attention', 'new_lead_events_present',
       'purge_new_lead_deliveries', 'purge_new_lead_keys', 'purge_new_lead_payloads',
       'repair_new_lead_deliveries', 'request_fingerprint', 'touch_updated_at']);
    g.eq('every function is owned by alerts_owner', fns.filter((f) => f.owner !== 'alerts_owner').map((f) => f.proname), []);
    g.eq('every function pins search_path = pg_catalog',
      fns.filter((f) => f.cfg !== '{search_path=pg_catalog}').map((f) => `${f.proname}:${f.cfg}`), []);
    g.eq('PUBLIC holds EXECUTE on none of them', fns.filter((f) => f.public_exec).map((f) => f.proname), []);
    g.eq('no function body contains dynamic SQL',
      fns.filter((f) => /\bEXECUTE\s+(format\s*\(|'|"|\w+\s*\|\|)/i.test(f.prosrc)).map((f) => f.proname), []);
    const expectedSecdef = ['claim_new_lead_delivery', 'enqueue_new_lead', 'expire_stale_claims',
      'finalise_new_lead_delivery', 'new_lead_attention', 'new_lead_events_present',
      'purge_new_lead_deliveries', 'purge_new_lead_keys', 'purge_new_lead_payloads', 'repair_new_lead_deliveries'];
    g.eq('exactly the runtime-facing functions are SECURITY DEFINER',
      fns.filter((f) => f.prosecdef).map((f) => f.proname), expectedSecdef);
    g.eq('the three that are not SECURITY DEFINER are the b64 wrapper, the hash and the trigger',
      fns.filter((f) => !f.prosecdef).map((f) => f.proname),
      ['enqueue_new_lead_b64', 'request_fingerprint', 'touch_updated_at']);
    g.eq('every object in the schema is owned by alerts_owner', await rows(sup,
      `SELECT relname, pg_get_userbyid(relowner) AS owner FROM pg_class
        WHERE relnamespace='alerts'::regnamespace AND relkind IN ('r','v')
          AND pg_get_userbyid(relowner) <> 'alerts_owner'`), []);
    g.eq('the schema itself is owned by alerts_owner', await val(sup,
      `SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='alerts'`), 'alerts_owner');
    g.eq('PUBLIC holds nothing on the schema', await val(sup,
      `SELECT has_schema_privilege('public','alerts','USAGE')`), false);
  }

  // ---------------------------------------------------------------- gate 47
  {
    const g = R.gate(47, 'no runtime login inherits alerts_owner');
    const members = await rows(sup, `
      SELECT r.rolname, r.rolcanlogin
        FROM pg_roles r
       WHERE pg_has_role(r.rolname, 'alerts_owner', 'USAGE') AND r.rolname <> 'alerts_owner'
       ORDER BY r.rolname`);
    const logins = members.filter((m) => m.rolcanlogin && m.rolname !== 'postgres').map((m) => m.rolname);
    g.eq('no login role at all inherits alerts_owner -- the migrator included, after 2.2-A', logins, []);
    g.eq('none of the five runtime group roles is a member of alerts_owner',
      members.map((m) => m.rolname).filter((n) => /^alerts_/.test(n)), []);
    for (const login of [LOGINS.writer, LOGINS.dispatcher, LOGINS.reconciler, LOGINS.retention, LOGINS.audit, LOGINS.nobody]) {
      g.eq(`${login} does not have alerts_owner`, await val(sup,
        `SELECT pg_has_role($1,'alerts_owner','USAGE')`, [login]), false);
    }
    // The revision-2.1 residual -- the migrator keeping alerts_owner for good -- is CLOSED by
    // amendment 2.2-A. What remains is ADMIN OPTION, and it is recorded rather than hidden.
    g.eq('not even the migrator inherits it', await val(sup,
      `SELECT pg_has_role($1,'alerts_owner','USAGE')`, [LOGINS.migrator]), false);
    R.note('gate 47: the revision-2.1 residual is CLOSED. The migration now revokes the migrator SET and INHERIT '
      + 'on alerts_owner before COMMIT (2.2-A). What it keeps is ADMIN OPTION, which confers neither -- it is what '
      + 'makes the migration re-runnable and rollback-able without a superuser. Gates 49-52.');
  }

  // ---------------------------------------------------------------- gate 48
  {
    const g = R.gate(48, 'the migration creates no LOGIN credential and stores no password or secret');
    const roles = await rows(sup, `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole,
                                          (rolpassword IS NOT NULL) AS has_password, rolvaliduntil
                                     FROM pg_authid WHERE rolname LIKE 'alerts\\_%' ORDER BY rolname`);
    g.eq('exactly the six group roles exist', roles.map((r) => r.rolname),
      ['alerts_audit', 'alerts_dispatcher', 'alerts_owner', 'alerts_reconciler', 'alerts_retention', 'alerts_writer']);
    g.eq('none can log in', roles.filter((r) => r.rolcanlogin).map((r) => r.rolname), []);
    g.eq('none holds a password', roles.filter((r) => r.has_password).map((r) => r.rolname), []);
    g.eq('none is superuser or BYPASSRLS', roles.filter((r) => r.rolsuper || r.rolbypassrls).map((r) => r.rolname), []);
    g.eq('none can create roles', roles.filter((r) => r.rolcreaterole).map((r) => r.rolname), []);
    g.eq('the migration added no role beyond those six', ctx.rolesAdded.filter((n) => !/^alerts_/.test(n)), []);
    g.eq('no secret-shaped literal appears in any function body', await rows(sup,
      `SELECT proname FROM pg_proc WHERE pronamespace='alerts'::regnamespace
         AND prosrc ~* '(password|secret|api[_-]?key|token[[:space:]]*=|bearer|client_secret)'
         AND prosrc !~ 'claim_token'`), []);
    g.eq('the schema declares no foreign server or user mapping', Number(await val(sup,
      `SELECT (SELECT count(*) FROM pg_foreign_server) + (SELECT count(*) FROM pg_user_mapping)`)), 0);
  }

  // ------------------------------------------------------- section 7: window
  {
    const g = R.gate('W7', 'the approved 7-day repair window: inside repairs, outside refuses, reconciler still can');
    const w = await asRole(LOGINS.writer);
    const rec = await asRole(LOGINS.reconciler);
    const mk = async (daysAgo) => {
      const e = D.newEvent('public');
      const t = new Date(Date.now() - daysAgo * 86400000);
      await w.query(D.ENQUEUE, [e.route, e.rid, e.lead, t.toISOString(), JSON.stringify(e.pl)]);
      await sup.query(`DELETE FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [e.key]);
      return { e, t };
    };
    for (const days of [0, 3, 6.99]) {
      const { e, t } = await mk(days);
      const r = await one(w, D.ENQUEUE, [e.route, e.rid, e.lead, t.toISOString(), JSON.stringify(e.pl)]);
      g.eq(`day ${days}: a missing delivery is repaired`, [r.out_outcome, r.out_email_created], ['REPAIRED', true]);
    }
    for (const days of [7.01, 10, 45]) {
      const { e, t } = await mk(days);
      const r = await one(w, D.ENQUEUE, [e.route, e.rid, e.lead, t.toISOString(), JSON.stringify(e.pl)]);
      g.eq(`day ${days}: ordinary enqueue does NOT resurrect the delivery`,
        [r.out_outcome, r.out_email_created], ['EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW', false]);
      g.eq(`day ${days}: the email row is still absent`, (await counts(sup, e.key)).email, 0);
      const rr = await one(rec, `SELECT * FROM alerts.repair_new_lead_deliveries($1)`, [e.key]);
      g.eq(`day ${days}: only the explicit reconciler authority repairs it`,
        [rr.out_telegram_created, rr.out_email_created], [false, true]);
      g.eq(`day ${days}: back to 1 + 1 + 1`, await counts(sup, e.key), { event: 1, telegram: 1, email: 1 });
    }
    const errRep = await expectFail(() => rec.query(`SELECT * FROM alerts.repair_new_lead_deliveries($1)`,
      ['NEW_LEAD:' + 'f'.repeat(64)]));
    g.ok('the reconciler cannot repair an event that does not exist',
      !!errRep && /ALERTS_EVENT_NOT_FOUND/.test(errRep.message), errRep && errRep.message);
    g.eq('the window is NOT a hard-coded constant in the function body', Number(await val(sup,
      `SELECT count(*) FROM pg_proc WHERE pronamespace='alerts'::regnamespace AND proname='enqueue_new_lead'
         AND prosrc ~ 'interval ''7 days'''`)), 0);
    g.eq('alerts.retention_policy holds the repair window as data', (await rows(sup,
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='alerts' AND table_name='retention_policy' AND column_name ~ 'repair'`))
      .map((r) => r.column_name), ['automatic_repair_days']);
    R.note('REPAIR WINDOW = 7 DAYS, OWNER-APPROVED 2026-09-01, with the operational rationale recorded in docs 12: '
      + 'a NEW LEAD alert older than seven days must not be resurrected and sent as if it were fresh. It is held in '
      + 'alerts.retention_policy.automatic_repair_days, so changing it is an UPDATE, not a migration (gates 53-57).');
    await w.end(); await rec.end();
  }

  // ------------------------------------------------------ retention policy
  {
    const g = R.gate('RET', 'retention windows are policy data, and no horizon defaults to forever');
    g.eq('the singleton policy row holds the approved windows and an UNDECIDED key horizon',
      await one(sup, `SELECT payload_retention_days, delivery_retention_days, key_retention_days, key_retention_status
                        FROM alerts.retention_policy`),
      { payload_retention_days: 30, delivery_retention_days: 180, key_retention_days: null,
        key_retention_status: 'PENDING_LEGAL_PRIVACY_FINALISATION' });
    g.eq('there is exactly one policy row and a second cannot be added', (await expectFail(
      () => sup.query(`INSERT INTO alerts.retention_policy (singleton) VALUES (false)`))).code, '23514');
    g.eq('a bounded key decision cannot be recorded without a horizon', (await expectFail(
      () => sup.query(`UPDATE alerts.retention_policy SET key_retention_status='DECIDED_BOUNDED'`))).code, '23514');
    g.eq('nothing in the schema says "forever"', Number(await val(sup,
      `SELECT count(*) FROM pg_proc WHERE pronamespace='alerts'::regnamespace AND prosrc ~* 'forever'`)), 0);
    // terminal delivery retention sweeps only terminal rows.
    // updated_at is maintained by the new_lead_delivery_touch trigger, so it cannot be backdated
    // while the trigger is live -- the trigger is what makes the 180-day horizon meaningful.
    const e = await seed(ctx);
    await sup.query(`ALTER TABLE alerts.new_lead_delivery DISABLE TRIGGER new_lead_delivery_touch`);
    await sup.query(`UPDATE alerts.new_lead_delivery
                        SET status='DELIVERY_UNKNOWN', attempt_count=1, claim_token=NULL,
                            updated_at = now() - interval '400 days'
                      WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);
    await sup.query(`UPDATE alerts.new_lead_delivery
                        SET status='SENT', sent_at=now(), claim_token=NULL, attempt_count=1,
                            updated_at = now() - interval '400 days'
                      WHERE dispatch_key=$1 AND channel='email'`, [e.key]);
    await sup.query(`ALTER TABLE alerts.new_lead_delivery ENABLE TRIGGER new_lead_delivery_touch`);
    g.ok('updated_at could only be backdated with the trigger disabled -- the trigger owns it',
      (await one(sup, `SELECT updated_at FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [e.key]))
        .updated_at < new Date(Date.now() - 300 * 86400000));
    const ret = await asRole(LOGINS.retention);
    const n = Number(await val(ret, `SELECT alerts.purge_new_lead_deliveries()`));
    g.ok('the 180-day sweep deletes terminal rows', n >= 1, `n=${n}`);
    g.eq('a SENT row past the horizon is swept', (await counts(sup, e.key)).email, 0);
    g.eq('a DELIVERY_UNKNOWN row awaiting an owner decision is NEVER swept', (await counts(sup, e.key)).telegram, 1);
    g.eq('the key row survives the delivery sweep', (await counts(sup, e.key)).event, 1);
    await ret.end();
    R.note('DELIVERY_UNKNOWN maximum retention is still PENDING OWNER: purge_new_lead_deliveries sweeps only SENT '
      + 'and PERMANENT_FAILED, so nothing removes an unresolved row. Revision 2.2-C makes that a RECORDED pending '
      + 'decision rather than an omission -- the horizon is a NULL column with a PENDING_OWNER status, and the sweep '
      + 'RAISES if the status ever changes without the deletion code being written (gate 58). The payload behind such '
      + 'a row is still purged at 30 days, so an unresolved delivery does not preserve contact_value (gate 58).');
  }

  return ctx;
}
