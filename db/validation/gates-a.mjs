// Gates 19-26 -- part of the owner's revision-2 gate set, executed against real PostgreSQL.
import { rows, one, val, expectFail, sleep } from './lib.mjs';
import { LOGINS } from './fixture.mjs';
import * as D from './data.mjs';

export const counts = async (sup, key) => ({
  event: Number(await val(sup, `SELECT count(*) FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [key])),
  telegram: Number(await val(sup, `SELECT count(*) FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='telegram'`, [key])),
  email: Number(await val(sup, `SELECT count(*) FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [key])),
});

// The claim function deliberately returns the OLDEST claimable row. To make a claim gate
// deterministic without changing the function, push every other row out of the window first.
export async function isolateClaimable(sup, key) {
  await sup.query(
    `UPDATE alerts.new_lead_delivery SET next_attempt_at = now() + interval '10 years'
      WHERE dispatch_key <> $1 AND status IN ('PENDING','RETRYABLE_FAILED')`, [key]);
  await sup.query(
    `UPDATE alerts.new_lead_delivery SET next_attempt_at = now() - interval '1 minute'
      WHERE dispatch_key = $1 AND status IN ('PENDING','RETRYABLE_FAILED')`, [key]);
}

export async function runGatesA(R, ctx) {
  const { sup, asRole } = ctx;

  // ---------------------------------------------------------------- gate 19
  {
    const g = R.gate(19, 'enqueue atomically creates 1 event + 1 telegram + 1 email');
    const w = await asRole(LOGINS.writer);
    const e = D.newEvent('public');
    const r = await one(w, D.ENQUEUE, D.enqueueArgs(e));
    g.eq('outcome CREATED', r.out_outcome, 'CREATED');
    g.eq('telegram created', r.out_telegram_created, true);
    g.eq('email created', r.out_email_created, true);
    g.eq('dispatch_key is the derived key', r.out_dispatch_key, e.key);
    g.eq('1 + 1 + 1', await counts(sup, e.key), { event: 1, telegram: 1, email: 1 });

    // 19b: inject a failure AFTER the event insert. Nothing of any kind may survive.
    await sup.query(`CREATE OR REPLACE FUNCTION public.zz_fail_delivery() RETURNS trigger
      LANGUAGE plpgsql AS $t$ BEGIN RAISE EXCEPTION 'ZZ_INJECTED_DELIVERY_FAILURE'; END $t$;`);
    await sup.query(`CREATE TRIGGER zz_fail BEFORE INSERT ON alerts.new_lead_delivery
      FOR EACH ROW EXECUTE FUNCTION public.zz_fail_delivery();`);
    const e2 = D.newEvent('public');
    const err = await expectFail(() => w.query(D.ENQUEUE, D.enqueueArgs(e2)));
    g.ok('the injected failure aborts the call', !!err && /ZZ_INJECTED_DELIVERY_FAILURE/.test(err.message), err && err.message);
    await sup.query(`DROP TRIGGER zz_fail ON alerts.new_lead_delivery`);
    await sup.query(`DROP FUNCTION public.zz_fail_delivery()`);
    g.eq('nothing at all survives the aborted enqueue', await counts(sup, e2.key), { event: 0, telegram: 0, email: 0 });
    await w.end();
  }

  // ---------------------------------------------------------------- gate 20
  {
    const g = R.gate(20, 'concurrent enqueue for the same canonical request -> exactly 1 + 1 + 1');
    // (a) genuinely interleaved: two sessions, the second must block on the unique index.
    const a = await asRole(LOGINS.writer), b = await asRole(LOGINS.writer);
    const e = D.newEvent('concierge');
    await a.query('BEGIN'); await b.query('BEGIN');
    const ra = await a.query(D.ENQUEUE, D.enqueueArgs(e));
    let bSettled = false;
    const pb = b.query(D.ENQUEUE, D.enqueueArgs(e));
    pb.then(() => { bSettled = true; }, () => { bSettled = true; });
    await sleep(600);
    g.ok('the second session blocks while the first holds the insert', bSettled === false);
    await a.query('COMMIT');
    const rb = await pb;
    await b.query('COMMIT');
    const outcomes = [ra.rows[0].out_outcome, rb.rows[0].out_outcome].sort();
    g.eq('exactly one CREATED and one ALREADY_PRESENT', outcomes, ['ALREADY_PRESENT', 'CREATED']);
    g.eq('1 + 1 + 1 after the race', await counts(sup, e.key), { event: 1, telegram: 1, email: 1 });
    await a.end(); await b.end();

    // (b) a released burst of six simultaneous sessions on one identity.
    const e2 = D.newEvent('miniapp');
    const cs = [];
    for (let i = 0; i < 6; i++) cs.push(await asRole(LOGINS.writer));
    const res = await Promise.allSettled(cs.map((c) => c.query(D.ENQUEUE, D.enqueueArgs(e2))));
    const ok = res.filter((r) => r.status === 'fulfilled').map((r) => r.value.rows[0].out_outcome);
    const failed = res.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    g.eq('burst: exactly one CREATED', ok.filter((o) => o === 'CREATED').length, 1);
    g.ok('burst: every other call is ALREADY_PRESENT, or the declared retryable 40001',
      ok.filter((o) => o !== 'CREATED').every((o) => o === 'ALREADY_PRESENT')
      && failed.every((m) => /ALERTS_ENQUEUE_RACE_RETRY/.test(m)),
      JSON.stringify({ ok, failed }));
    g.eq('burst: 1 + 1 + 1', await counts(sup, e2.key), { event: 1, telegram: 1, email: 1 });
    for (const c of cs) await c.end();
  }

  // ---------------------------------------------------------------- gate 21
  {
    const g = R.gate(21, 'abnormal historical state is convergently repaired, and only that');
    const w = await asRole(LOGINS.writer);
    const e = D.newEvent('public');
    await w.query(D.ENQUEUE, D.enqueueArgs(e));
    const tgBefore = await one(sup, `SELECT created_at, attempt_count, status FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);
    await sup.query(`DELETE FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [e.key]);
    const r = await one(w, D.ENQUEUE, D.enqueueArgs(e));
    g.eq('outcome REPAIRED', r.out_outcome, 'REPAIRED');
    g.eq('only the missing email row is recreated', [r.out_telegram_created, r.out_email_created], [false, true]);
    g.eq('back to 1 + 1 + 1', await counts(sup, e.key), { event: 1, telegram: 1, email: 1 });
    const tgAfter = await one(sup, `SELECT created_at, attempt_count, status FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);
    g.eq('the surviving telegram row is untouched', tgAfter, tgBefore);

    // both delivery rows missing -> exactly two restored
    await sup.query(`DELETE FROM alerts.new_lead_delivery WHERE dispatch_key=$1`, [e.key]);
    const r2 = await one(w, D.ENQUEUE, D.enqueueArgs(e));
    g.eq('both rows restored', [r2.out_outcome, r2.out_telegram_created, r2.out_email_created], ['REPAIRED', true, true]);
    g.eq('exactly two restored, not four', await counts(sup, e.key), { event: 1, telegram: 1, email: 1 });

    // an existing SENT row is never reset by a later repair
    await isolateClaimable(sup, e.key);
    const d = await asRole(LOGINS.dispatcher);
    const claim = await one(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g.ok('the dispatcher claimed the repaired telegram row', !!claim && claim.out_dispatch_key === e.key, JSON.stringify(claim || null));
    await d.query(`SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,'SENT',NULL,'synthetic-msg-1')`, [e.key, claim.out_claim_token]);
    const sentBefore = await one(sup, `SELECT status, sent_at, attempt_count, provider_message_id FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);
    g.eq('the telegram row is SENT', sentBefore.status, 'SENT');
    await sup.query(`DELETE FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [e.key]);
    await w.query(D.ENQUEUE, D.enqueueArgs(e));
    const sentAfter = await one(sup, `SELECT status, sent_at, attempt_count, provider_message_id FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);
    g.eq('an existing SENT row is never reset', sentAfter, sentBefore);
    await w.end(); await d.end();
  }

  // ---------------------------------------------------------------- gate 22
  {
    const g = R.gate(22, 'the raw Concierge request_id is not persisted anywhere in alerts.*');
    const w = await asRole(LOGINS.writer);
    const rid = D.synthConciergeId();
    const key = D.keyOf(rid);
    const r = await one(w, D.ENQUEUE, ['concierge', rid, D.leadId(), new Date().toISOString(), JSON.stringify(D.payload())]);
    g.eq('the synthetic Concierge identity enqueues', r.out_outcome, 'CREATED');

    // every text-ish column of every table AND view in the alerts schema
    const cols = await rows(sup, `
      SELECT c.table_name, c.column_name, t.table_type
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'alerts'
         AND c.data_type IN ('text','character varying','jsonb','json','character')`);
    const needles = [rid, D.SYNTH_CHAT_ID, D.SYNTH_EPOCH];
    const hits = [];
    for (const c of cols) {
      for (const n of needles) {
        const found = Number(await val(sup,
          `SELECT count(*) FROM alerts.${c.table_name} WHERE ${c.column_name}::text LIKE $1`, [`%${n}%`]));
        if (found) hits.push(`${c.table_type} alerts.${c.table_name}.${c.column_name} contains ${n}`);
      }
    }
    g.eq('no alerts table or view column holds the raw id, the chat id or the epoch', hits, []);
    g.ok('no column is even named for a raw identity', Number(await val(sup,
      `SELECT count(*) FROM information_schema.columns
        WHERE table_schema='alerts'
          AND column_name IN ('request_id','chat_id','telegram_chat_id','canonical_request_id')`)) === 0);

    const outText = JSON.stringify(r);
    g.ok('the function output carries the fingerprint, not the identifier',
      !needles.some((n) => outText.includes(n)) && outText.includes(D.fingerprintOf(rid)), outText);
    g.eq('the stored fingerprint equals the independently computed SHA-256',
      await val(sup, `SELECT request_fingerprint FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [key]),
      D.fingerprintOf(rid));

    const err = await expectFail(() => w.query(D.ENQUEUE,
      ['concierge', rid, '', new Date().toISOString(), JSON.stringify(D.payload())]));
    g.ok('an error returned to the caller never echoes the identifier',
      !!err && /ALERTS_LEAD_ID_INVALID/.test(err.message) && !needles.some((n) => JSON.stringify(err).includes(n)),
      JSON.stringify(err));
    const err2 = await expectFail(() => w.query(D.ENQUEUE,
      ['concierge', 'C-BAD-1', D.leadId(), new Date().toISOString(), JSON.stringify(D.payload())]));
    g.ok('a shape rejection echoes only the route name',
      !!err2 && /ALERTS_REQUEST_ID_SHAPE_INVALID \(route=concierge\)/.test(err2.message), err2 && err2.message);
    await w.end();
    ctx.conciergeKey = key;
    ctx.conciergeRid = rid;
  }

  // ---------------------------------------------------------------- gate 23
  {
    const g = R.gate(23, 'the fingerprint is database-computed; the caller cannot supply or spoof one');
    const args = await val(sup, `SELECT pg_get_function_arguments(p.oid) FROM pg_proc p
      WHERE p.pronamespace='alerts'::regnamespace AND p.proname='enqueue_new_lead'`);
    g.eq('exactly the five declared inputs, and no fingerprint parameter', args,
      'p_request_route text, p_request_id text, p_lead_id text, p_settled_at timestamp with time zone, p_payload jsonb');
    const argsB64 = await val(sup, `SELECT pg_get_function_arguments(p.oid) FROM pg_proc p
      WHERE p.pronamespace='alerts'::regnamespace AND p.proname='enqueue_new_lead_b64'`);
    g.ok('the comma-safe wrapper has no fingerprint parameter either', !/fingerprint/i.test(argsB64), argsB64);
    g.eq('dispatch_key is GENERATED ALWAYS from the fingerprint',
      await val(sup, `SELECT generation_expression FROM information_schema.columns
        WHERE table_schema='alerts' AND table_name='new_lead_outbox' AND column_name='dispatch_key'`),
      `('NEW_LEAD:'::text || request_fingerprint)`);
    g.eq('request_fingerprint is itself not a generated column',
      await val(sup, `SELECT is_generated FROM information_schema.columns
        WHERE table_schema='alerts' AND table_name='new_lead_outbox' AND column_name='request_fingerprint'`), 'NEVER');
    g.eq('the derivation contract holds against an independent hash', await val(sup,
      `SELECT alerts.request_fingerprint('C-123456789-1788000000000')
            = encode(sha256(convert_to('finmentor:new_lead:v1:C-123456789-1788000000000','UTF8')),'hex')`), true);
    for (const role of ['alerts_writer', 'alerts_dispatcher', 'alerts_reconciler', 'alerts_retention', 'alerts_audit']) {
      g.eq(`${role} cannot execute request_fingerprint (no hashing oracle)`, await val(sup,
        `SELECT has_function_privilege($1,'alerts.request_fingerprint(text)','EXECUTE')`, [role]), false);
    }
  }

  // ---------------------------------------------------------------- gate 24
  {
    const g = R.gate(24, 'the caller cannot choose dispatch_key');
    const err = await expectFail(() => sup.query(
      `INSERT INTO alerts.new_lead_outbox (dispatch_key, request_fingerprint, request_route, lead_id, settled_at, payload_json)
       VALUES ('NEW_LEAD:chosen', repeat('a',64), 'public', 'X', now(), '{}'::jsonb)`));
    g.eq('even a superuser insert is refused with 428C9', err && err.code, '428C9');
    const err2 = await expectFail(() => sup.query(`UPDATE alerts.new_lead_outbox SET dispatch_key='NEW_LEAD:rewritten'`));
    g.eq('the key cannot be rewritten either', err2 && err2.code, '428C9');
  }

  // ---------------------------------------------------------------- gate 25
  {
    const g = R.gate(25, 'the writer holds no direct SELECT/INSERT/UPDATE/DELETE on the event tables');
    const w = await asRole(LOGINS.writer);
    for (const [tbl, col] of [['alerts.new_lead_outbox', 'created_at'],
                              ['alerts.new_lead_delivery', 'updated_at'],
                              ['alerts.retention_policy', 'updated_at']]) {
      for (const [label, sql] of [
        ['SELECT', `SELECT 1 FROM ${tbl} LIMIT 1`],
        ['INSERT', `INSERT INTO ${tbl} DEFAULT VALUES`],
        ['UPDATE', `UPDATE ${tbl} SET ${col} = now()`],
        ['DELETE', `DELETE FROM ${tbl}`]]) {
        const err = await expectFail(() => w.query(sql));
        g.eq(`${label} on ${tbl} is denied`, err && err.code, '42501');
      }
    }
    const e = D.newEvent('public');
    await w.query(D.ENQUEUE, D.enqueueArgs(e));
    const before = await val(sup, `SELECT payload_json FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [e.key]);
    const r = await one(w, D.ENQUEUE, [e.route, e.rid, 'DIFFERENT-LEAD', new Date().toISOString(),
      JSON.stringify(D.payload({ company: 'REWRITTEN SRL' }))]);
    const after = await one(sup, `SELECT payload_json, lead_id FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [e.key]);
    g.eq('re-enqueue with a different payload does not update the event', after.payload_json, before);
    g.eq('lead_id is not overwritten either', after.lead_id, e.lead);
    g.eq('and the outcome reports ALREADY_PRESENT', r.out_outcome, 'ALREADY_PRESENT');
    g.eq('no function in the schema uses ON CONFLICT DO UPDATE', Number(await val(sup,
      `SELECT count(*) FROM pg_proc WHERE pronamespace='alerts'::regnamespace AND prosrc ~* 'DO[[:space:]]+UPDATE[[:space:]]+SET'`)), 0);
    await w.end();
  }

  // ---------------------------------------------------------------- gate 26
  {
    const g = R.gate(26, 'the dispatcher cannot arbitrarily mutate the Outbox event');
    const d = await asRole(LOGINS.dispatcher);
    for (const [label, sql] of [
      ['SELECT', `SELECT 1 FROM alerts.new_lead_outbox LIMIT 1`],
      ['INSERT', `INSERT INTO alerts.new_lead_outbox (request_fingerprint, request_route, lead_id, settled_at, payload_json)
                  VALUES (repeat('b',64),'public','X',now(),'{}'::jsonb)`],
      ['UPDATE', `UPDATE alerts.new_lead_outbox SET lead_id='HIJACKED'`],
      ['DELETE', `DELETE FROM alerts.new_lead_outbox`]]) {
      const err = await expectFail(() => d.query(sql));
      g.eq(`${label} on the outbox is denied`, err && err.code, '42501');
    }
    for (const fn of ['alerts.enqueue_new_lead(text,text,text,timestamptz,jsonb)',
                      'alerts.enqueue_new_lead_b64(text,text,text,timestamptz,text)',
                      'alerts.repair_new_lead_deliveries(text)',
                      'alerts.purge_new_lead_payloads()',
                      'alerts.purge_new_lead_deliveries()',
                      'alerts.purge_new_lead_keys()']) {
      g.eq(`the dispatcher holds no EXECUTE on ${fn}`, await val(sup,
        `SELECT has_function_privilege('alerts_dispatcher',$1,'EXECUTE')`, [fn]), false);
    }
    await d.end();
  }

  return ctx;
}
