// Gates E4-E6 of the ALERTS RUNTIME LOGINS validation: the properties that only exist once a
// credential is ARMED and a real session is opened with it. Nothing here can be established from
// the catalog -- "it cannot authenticate", "the timeout actually fires", "the writer cannot
// claim" are all statements about a live connection.
//
// The owner's out-of-band `ALTER ROLE ... PASSWORD` (§2.6 step 2) is played here by the
// superuser fixture. The password below is a throwaway for a loopback-only cluster that holds
// no real data, and it is set and removed again inside this run.
import { rows, one, val, expectFail, attemptConnect } from './lib.mjs';
import * as D from './data.mjs';

export const RT = { writer: 'alerts_writer_rt', dispatcher: 'alerts_dispatcher_rt' };
export const RT_PW = 'fmtest_local_only_rt';

const arm = (sup, login, pw = RT_PW) =>
  sup.query(`ALTER ROLE ${login} PASSWORD ${quoteLit(pw)}`);
const disarm = (sup, login) => sup.query(`ALTER ROLE ${login} PASSWORD NULL`);
const quoteLit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const denied = (e) => !!e && e.code === '42501';

export async function runGatesE(R, ctx) {
  const { db, sup } = ctx;

  // ------------------------------------------------------------------ E4
  {
    const g = R.gate('E4', 'the credential is INERT until the owner arms it -- and the timeouts arrive with it');

    // NEGATIVE CONTROL, first. Every assertion below is of the form "this connection is
    // refused". On a cluster whose pg_hba says `trust` they would be refused for no reason at
    // all, or accepted for no reason at all -- either way the experiment would not have run.
    // So: a KNOWN-BAD password for a role that certainly has one must be refused.
    const control = await attemptConnect(db, 'postgres', 'definitely-not-the-password');
    g.ok('CONTROL: authentication is actually enforced on this cluster (a wrong password is refused)',
      !!control && /password|authentication/i.test(control.message || ''),
      control ? `${control.code} ${control.message}` : 'a wrong password was ACCEPTED -- pg_hba is trust, arm it (see README)');

    for (const login of [RT.writer, RT.dispatcher]) {
      const e = await attemptConnect(db, login, 'anything-at-all');
      g.ok(`${login} cannot authenticate while its password is NULL`,
        !!e && /password|authentication/i.test(e.message || ''),
        e ? `${e.code} ${e.message}` : 'CONNECTED -- a login with no verifier authenticated');
    }

    // The owner's step 2, played by the fixture.
    await arm(sup, RT.writer);
    const w = await ctx.openRt(RT.writer);
    const s = await one(w, `SELECT current_user, session_user,
                                   current_setting('statement_timeout') AS st,
                                   current_setting('lock_timeout') AS lt,
                                   current_setting('search_path') AS sp`);
    g.eq('once armed it connects, and it connects AS ITSELF', [s.current_user, s.session_user],
      [RT.writer, RT.writer]);
    g.eq('statement_timeout is 8s from the first statement of the session', s.st, '8s');
    g.eq('lock_timeout is 5s from the first statement of the session', s.lt, '5s');
    g.eq('search_path is pg_catalog', s.sp, 'pg_catalog');

    // Where the value CAME FROM. A default that happens to match is not the same measurement:
    // `source = user` is the per-role ALTER ROLE ... SET, applied at session start-up.
    g.eq('and it comes from the ROLE, not from a default or the client',
      (await rows(w, `SELECT name, source FROM pg_settings
                       WHERE name IN ('statement_timeout','lock_timeout') ORDER BY name`)),
      [{ name: 'lock_timeout', source: 'user' }, { name: 'statement_timeout', source: 'user' }]);

    // And it BITES. A setting that is present but not enforced protects nothing.
    const slow = await expectFail(() => w.query(`SELECT pg_catalog.pg_sleep(9)`));
    g.ok('the 8s statement_timeout actually fires', !!slow && slow.code === '57014',
      slow ? `${slow.code} ${slow.message}` : 'pg_sleep(9) COMPLETED');

    // The honest limit of it. statement_timeout is USERSET: the role setting is a DEFAULT, not
    // a cap, and any client may raise it for its own session. That is not a hole to be closed --
    // no per-role setting can be -- but the §8 auto_explain argument must be read as "no query
    // runs long by ACCIDENT", never as "no query can run long".
    await w.query(`SET statement_timeout = '90s'`);
    g.eq('a client CAN raise it -- a role setting is a default, not a cap',
      await val(w, `SELECT current_setting('statement_timeout')`), '90s');
    await w.query(`RESET statement_timeout`);
    g.eq('and RESET returns to the ROLE value, not to the cluster default',
      await val(w, `SELECT current_setting('statement_timeout')`), '8s');
    await w.end();
  }

  // ------------------------------------------------------------------ E5
  {
    const g = R.gate('E5', 'each credential can do its own job and NOTHING ELSE -- measured per login');
    await arm(sup, RT.dispatcher);
    const w = await ctx.openRt(RT.writer);
    const d = await ctx.openRt(RT.dispatcher);

    // --- the writer's job
    const ev = D.newEvent('public');
    const enq = await rows(w, D.ENQUEUE_B64,
      [ev.route, ev.rid, ev.lead, ev.settled.toISOString(), D.b64(ev.pl)]);
    g.eq('the writer can enqueue through its own credential', enq.length, 1);
    g.eq('one event row', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_outbox WHERE dispatch_key = $1`, [ev.key])), 1);
    g.eq('one telegram row and one email row', await rows(sup,
      `SELECT channel, status FROM alerts.new_lead_delivery WHERE dispatch_key = $1 ORDER BY channel`,
      [ev.key]), [{ channel: 'email', status: 'PENDING' }, { channel: 'telegram', status: 'PENDING' }]);

    // --- and nothing else
    g.ok('the writer CANNOT claim', denied(await expectFail(() =>
      w.query(`SELECT * FROM alerts.claim_new_lead_delivery('telegram')`))));
    g.ok('the writer CANNOT finalise', denied(await expectFail(() =>
      w.query(`SELECT alerts.finalise_new_lead_delivery('k','telegram',
                 '00000000-0000-0000-0000-000000000000'::uuid,'SENT')`))));
    g.ok('the writer CANNOT expire stale claims', denied(await expectFail(() =>
      w.query(`SELECT alerts.expire_stale_claims('15 minutes')`))));

    // --- the dispatcher's job
    const cl = await rows(d, `SELECT * FROM alerts.claim_new_lead_delivery('telegram')`);
    g.eq('the dispatcher claims exactly one row through its own credential', cl.length, 1);
    g.eq('and it is the row the writer just enqueued', cl[0].out_dispatch_key, ev.key);
    g.eq('the dispatcher finalises it', await val(d,
      `SELECT alerts.finalise_new_lead_delivery($1,'telegram',$2,'SENT',NULL,'msg-1')`,
      [cl[0].out_dispatch_key, cl[0].out_claim_token]), 'OK');
    g.eq('the telegram row is SENT with attempt_count 1, and EMAIL IS UNTOUCHED', await rows(sup,
      `SELECT channel, status, attempt_count, (sent_at IS NOT NULL) AS has_sent_at
         FROM alerts.new_lead_delivery WHERE dispatch_key = $1 ORDER BY channel`, [ev.key]),
      [{ channel: 'email', status: 'PENDING', attempt_count: 0, has_sent_at: false },
       { channel: 'telegram', status: 'SENT', attempt_count: 1, has_sent_at: true }]);

    // --- and nothing else
    g.ok('the dispatcher CANNOT enqueue', denied(await expectFail(() =>
      d.query(D.ENQUEUE_B64, [ev.route, D.publicId(), ev.lead, ev.settled.toISOString(), D.b64(ev.pl)]))));
    g.ok('the dispatcher CANNOT enqueue through the jsonb entry point either', denied(await expectFail(() =>
      d.query(D.ENQUEUE, D.enqueueArgs(D.newEvent('public'))))));

    // --- neither may touch a table, a view, G5, or become its own group
    for (const [name, c] of [['writer', w], ['dispatcher', d]]) {
      for (const rel of ['alerts.new_lead_outbox', 'alerts.new_lead_delivery',
                         'alerts.retention_policy', 'alerts.new_lead_outbox_audit',
                         'alerts.new_lead_delivery_audit']) {
        g.ok(`the ${name} cannot SELECT ${rel}`, denied(await expectFail(() =>
          c.query(`SELECT count(*) FROM ${rel}`))));
      }
      g.ok(`the ${name} cannot read G5`, denied(await expectFail(() =>
        c.query(`SELECT count(*) FROM public.telegram_initdata_replays`))));
      g.ok(`the ${name} cannot write G5`, denied(await expectFail(() =>
        c.query(`INSERT INTO public.telegram_initdata_replays (replay_key, expires_at)
                 VALUES (repeat('a',64), now() + interval '1 day')`))));
      g.ok(`the ${name} cannot SET ROLE into its own group`, denied(await expectFail(() =>
        c.query(`SET ROLE ${name === 'writer' ? 'alerts_writer' : 'alerts_dispatcher'}`))));
      g.ok(`the ${name} cannot SET ROLE into the OTHER group`, denied(await expectFail(() =>
        c.query(`SET ROLE ${name === 'writer' ? 'alerts_dispatcher' : 'alerts_writer'}`))));
      g.ok(`the ${name} cannot create anything in the alerts schema`, denied(await expectFail(() =>
        c.query(`CREATE TABLE alerts.zz_${name}_probe (id int)`))));
    }
    await w.end();
    await d.end();
    ctx.sentKey = ev.key;
  }

  // ------------------------------------------------------------------ E6
  {
    const g = R.gate('E6', 'DISARMING is a single statement, and it is complete');
    for (const login of [RT.writer, RT.dispatcher]) {
      await disarm(sup, login);
      const e = await attemptConnect(ctx.db, login, RT_PW);
      g.ok(`${login} cannot authenticate once its password is set back to NULL`,
        !!e && /password|authentication/i.test(e.message || ''),
        e ? `${e.code} ${e.message}` : 'CONNECTED with the old password');
    }
    g.eq('and the row it already delivered is untouched by any of this', await val(sup,
      `SELECT status FROM alerts.new_lead_delivery
        WHERE dispatch_key = $1 AND channel = 'telegram'`, [ctx.sentKey]), 'SENT');
  }
}

export { arm, disarm };
