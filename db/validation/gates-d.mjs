// Gates 49-61 -- the revision 2.2 hardening.
//
//   49-52  the migrator's membership in alerts_owner, asserted after EVERY phase
//   53-57  the automatic repair window as POLICY DATA rather than a function literal
//   58     the payload still purges while a DELIVERY_UNKNOWN stays unresolved
//   59-61  no alerts exception, and no persisted alerts row, carries a caller-supplied secret --
//          checked against the caller-visible error AND against the server log, twice: once with
//          the cluster logging everything, and once with finmentor-prod's own logging settings.
import fs from 'node:fs';
import { open, connect, rows, one, val, expectFail } from './lib.mjs';
import { LOGINS, PW } from './fixture.mjs';
import { counts } from './gates-a.mjs';

// The PostgreSQL logging collector writes from another process. fs.statSync().size can report a
// length the very next read does not yet return, which silently turns "I found nothing in the
// log" into a FALSE PASS -- observed on Windows during this pass. Mark and read with the same
// call, and give the collector a moment to flush first.
const logFlush = () => new Promise((r) => setTimeout(r, 1500));
const logMark = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').length : null);
async function logSince(f, mark) {
  await logFlush();
  return fs.readFileSync(f, 'utf8').slice(mark);
}
import * as D from './data.mjs';

// ---------------------------------------------------------------------------- 49-52
// pg_has_role(...,'MEMBER') is TRUE for the automatic CREATEROLE grant that carries neither SET
// nor INHERIT (see docs 4.1), so MEMBER on its own proves nothing. The role-state proof is the
// pg_auth_members options themselves, corroborated by an actual SET ROLE attempt.
export async function membershipRows(sup, who) {
  return rows(sup, `
    SELECT r.rolname, m.admin_option, m.inherit_option, m.set_option
      FROM pg_auth_members m
      JOIN pg_roles r ON r.oid = m.roleid
      JOIN pg_roles g ON g.oid = m.member
     WHERE g.rolname = $1 AND r.rolname LIKE 'alerts\\_%'
     ORDER BY r.rolname, m.admin_option DESC`, [who]);
}

// `phase` names the migration phase this is asserted after; `expectRoles` is false once the
// rollback has destroyed the roles, because a membership in a role that does not exist is not a
// weaker claim than one that does -- it is a stronger one.
export async function assertMigratorMembership(R, ctx, id, phase, { rolesExist = true } = {}) {
  const { sup } = ctx;
  const g = R.gate(id, `${phase}: the migrator holds no usable membership in alerts_owner`);
  const mem = await membershipRows(sup, LOGINS.migrator);

  g.eq('no alerts_* membership grants the migrator SET ROLE',
    mem.filter((m) => m.set_option).map((m) => m.rolname), []);
  g.eq('no alerts_* membership grants the migrator inherited privileges',
    mem.filter((m) => m.inherit_option).map((m) => m.rolname), []);
  g.eq('the migrator does not hold the privileges of alerts_owner (pg_has_role USAGE)',
    rolesExist ? await val(sup, `SELECT pg_has_role($1,'alerts_owner','USAGE')`, [LOGINS.migrator]) : false,
    false);

  if (rolesExist) {
    // The decisive proof: ask PostgreSQL to do the thing the membership would allow.
    const mig = await open(ctx.db, LOGINS.migrator, PW);
    const err = await expectFail(() => mig.query('SET ROLE alerts_owner'));
    g.ok('SET ROLE alerts_owner is refused for the migrator',
      !!err && err.code === '42501', err ? `${err.code} ${err.message}` : 'ALLOWED');
    const errUse = await expectFail(() => mig.query('SELECT 1 FROM alerts.new_lead_outbox LIMIT 1'));
    g.ok('the migrator cannot even reach the schema it created',
      !!errUse && errUse.code === '42501', errUse ? `${errUse.code} ${errUse.message}` : 'ALLOWED');
    await mig.end();
    // What IS kept, stated rather than hidden: ADMIN OPTION, and only that.
    g.ok('the migrator keeps ADMIN OPTION on alerts_owner, which is what makes the migration re-runnable',
      mem.some((m) => m.rolname === 'alerts_owner' && m.admin_option),
      JSON.stringify(mem));
  } else {
    g.eq('no alerts_* role exists, so no membership in one can survive either', mem, []);
    g.eq('and the catalog agrees', (await rows(sup,
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'alerts\\_%'`)).map((r) => r.rolname), []);
  }
  return g;
}

// ---------------------------------------------------------------------------- helpers
const errText = (e) => e ? [e.message, e.detail, e.hint, e.where, e.internalQuery, e.schema,
                            e.table, e.column, e.constraint, e.dataType].filter(Boolean).join(' | ') : '';

async function scanForSecret(sup, needle) {
  // Every text-ish column of every alerts table AND view, value by value.
  const cols = await rows(sup, `
    SELECT c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'alerts'
       AND c.data_type IN ('text','character varying','character','jsonb','json','name')
     ORDER BY c.table_name, c.column_name`);
  const hits = [];
  for (const c of cols) {
    const n = Number(await val(sup,
      `SELECT count(*) FROM alerts.${c.table_name} WHERE ${c.column_name}::text LIKE '%' || $1 || '%'`,
      [needle]));
    if (n > 0) hits.push(`${c.table_name}.${c.column_name}=${n}`);
  }
  return { columnsScanned: cols.length, hits };
}

export async function runGatesD(R, ctx) {
  const { db, sup, asRole } = ctx;

  // ------------------------------------------------------------------- gate 53
  {
    const g = R.gate(53, 'the automatic repair window is policy DATA, not a literal in the function');
    g.eq('alerts.retention_policy carries automatic_repair_days', await one(sup,
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema='alerts' AND table_name='retention_policy' AND column_name='automatic_repair_days'`),
      { data_type: 'integer', is_nullable: 'NO', column_default: '7' });
    g.eq('the shipped value is the owner-approved 7 days', Number(await val(sup,
      `SELECT automatic_repair_days FROM alerts.retention_policy`)), 7);
    g.eq('no interval literal for the repair window survives in enqueue_new_lead', Number(await val(sup,
      `SELECT count(*) FROM pg_proc WHERE pronamespace='alerts'::regnamespace AND proname='enqueue_new_lead'
         AND prosrc ~ 'interval ''7 days'''`)), 0);
    g.eq('enqueue_new_lead reads the column instead', Number(await val(sup,
      `SELECT count(*) FROM pg_proc WHERE pronamespace='alerts'::regnamespace AND proname='enqueue_new_lead'
         AND prosrc ~ 'automatic_repair_days'`)), 1);
    g.eq('the window is bounded, so a typo cannot make it a century', (await expectFail(
      () => sup.query(`UPDATE alerts.retention_policy SET automatic_repair_days = 4000`))).code, '23514');
    g.eq('and it cannot be set to zero either', (await expectFail(
      () => sup.query(`UPDATE alerts.retention_policy SET automatic_repair_days = 0`))).code, '23514');
    // A missing policy row must FAIL LOUDLY, not fall back to a hidden default.
    const probe = await asRole(LOGINS.writer);
    const e = D.newEvent('public');
    await sup.query(`DELETE FROM alerts.retention_policy`);
    const errNoPolicy = await expectFail(() => probe.query(D.ENQUEUE, D.enqueueArgs(e)));
    g.ok('with no policy row the enqueue REFUSES rather than assuming a default',
      !!errNoPolicy && /ALERTS_REPAIR_POLICY_MISSING/.test(errNoPolicy.message), errNoPolicy && errNoPolicy.message);
    g.eq('and it wrote nothing at all', (await counts(sup, e.key)), { event: 0, telegram: 0, email: 0 });
    await sup.query(`INSERT INTO alerts.retention_policy (singleton) VALUES (true)`);
    await probe.end();
  }

  // -------------------------------------------------------------- gates 54-57
  {
    const g54 = R.gate(54, 'changing the policy 7 -> 5 changes behaviour with NO function migration');
    const g55 = R.gate(55, 'inside the policy window an ordinary enqueue repairs a missing delivery');
    const g56 = R.gate(56, 'outside the policy window an ordinary enqueue refuses resurrection');
    const g57 = R.gate(57, 'outside the window only the explicit reconciler authority repairs');

    const w = await asRole(LOGINS.writer);
    const rec = await asRole(LOGINS.reconciler);
    const fnBefore = await one(sup, `SELECT oid::text, prosrc, xmin::text FROM pg_proc
                                      WHERE pronamespace='alerts'::regnamespace AND proname='enqueue_new_lead'`);

    // Seeds an event settled `daysAgo` ago whose email delivery row has been removed.
    const gap = async (daysAgo) => {
      const e = D.newEvent('public');
      const t = new Date(Date.now() - daysAgo * 86400000);
      await w.query(D.ENQUEUE, [e.route, e.rid, e.lead, t.toISOString(), JSON.stringify(e.pl)]);
      await sup.query(`DELETE FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='email'`, [e.key]);
      return { e, t };
    };
    const reenqueue = ({ e, t }) => one(w, D.ENQUEUE, [e.route, e.rid, e.lead, t.toISOString(), JSON.stringify(e.pl)]);

    const setWindow = async (days) => {
      await sup.query(`UPDATE alerts.retention_policy SET automatic_repair_days = $1`, [days]);
      return Number(await val(sup, `SELECT automatic_repair_days FROM alerts.retention_policy`));
    };

    // --- at the approved 7 days
    g55.eq('the window in force is the approved 7', await setWindow(7), 7);
    for (const days of [0, 3, 6.9]) {
      const s = await gap(days);
      const r = await reenqueue(s);
      g55.eq(`day ${days} <= 7: repaired`, [r.out_outcome, r.out_email_created], ['REPAIRED', true]);
      g55.eq(`day ${days}: back to 1 + 1 + 1`, await counts(sup, s.e.key), { event: 1, telegram: 1, email: 1 });
    }
    const outside7 = [];
    for (const days of [7.1, 10, 45]) {
      const s = await gap(days);
      const r = await reenqueue(s);
      g56.eq(`day ${days} > 7: no resurrection`,
        [r.out_outcome, r.out_email_created], ['EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW', false]);
      g56.eq(`day ${days}: the email row is still absent`, (await counts(sup, s.e.key)).email, 0);
      outside7.push(s);
    }
    for (const s of outside7) {
      const rr = await one(rec, `SELECT * FROM alerts.repair_new_lead_deliveries($1)`, [s.e.key]);
      g57.eq('the reconciler repairs beyond the automatic window',
        [rr.out_telegram_created, rr.out_email_created], [false, true]);
      g57.eq('and leaves exactly 1 + 1 + 1', await counts(sup, s.e.key), { event: 1, telegram: 1, email: 1 });
    }
    const errRep = await expectFail(() => rec.query(`SELECT * FROM alerts.repair_new_lead_deliveries($1)`,
      ['NEW_LEAD:' + 'f'.repeat(64)]));
    g57.ok('but it cannot conjure an event that never existed',
      !!errRep && /ALERTS_EVENT_NOT_FOUND/.test(errRep.message), errRep && errRep.message);
    g57.eq('the writer holds no EXECUTE on the reconciler repair authority', (await expectFail(
      () => w.query(`SELECT * FROM alerts.repair_new_lead_deliveries($1)`, ['NEW_LEAD:' + 'a'.repeat(64)]))).code, '42501');

    // --- move the policy to 5 and prove the SAME function behaves differently
    g54.eq('the policy is changed by an UPDATE of one integer', await setWindow(5), 5);
    const s6 = await gap(6);
    const r6 = await reenqueue(s6);
    g54.eq('day 6, which repaired at 7, now refuses at 5',
      [r6.out_outcome, r6.out_email_created], ['EVENT_EXISTS_OUTSIDE_REPAIR_WINDOW', false]);
    const s4 = await gap(4);
    const r4 = await reenqueue(s4);
    g54.eq('day 4 still repairs at 5', [r4.out_outcome, r4.out_email_created], ['REPAIRED', true]);
    const fnAfter = await one(sup, `SELECT oid::text, prosrc, xmin::text FROM pg_proc
                                     WHERE pronamespace='alerts'::regnamespace AND proname='enqueue_new_lead'`);
    g54.eq('the function was not migrated: same oid', fnAfter.oid, fnBefore.oid);
    g54.eq('the function was not migrated: byte-identical body', fnAfter.prosrc, fnBefore.prosrc);
    g54.eq('the function row was not even rewritten: same xmin', fnAfter.xmin, fnBefore.xmin);

    // --- and back to the approved value, so the rest of the run sees the shipped policy
    g54.eq('restored to the owner-approved 7', await setWindow(7), 7);
    await w.end(); await rec.end();
  }

  // ------------------------------------------------------------------- gate 58
  {
    const g = R.gate(58, 'the payload still purges while a DELIVERY_UNKNOWN stays unresolved');
    const w = await asRole(LOGINS.writer);
    const ret = await asRole(LOGINS.retention);
    const e = D.newEvent('public');
    const old = new Date(Date.now() - 40 * 86400000);
    await w.query(D.ENQUEUE, [e.route, e.rid, e.lead, old.toISOString(), JSON.stringify(e.pl)]);
    await sup.query(`UPDATE alerts.new_lead_delivery
                        SET status='DELIVERY_UNKNOWN', attempt_count=1, claim_token=NULL,
                            last_error_code='CLAIM_EXPIRED'
                      WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]);

    const purged = Number(await val(ret, `SELECT alerts.purge_new_lead_payloads()`));
    g.ok('the 30-day payload purge runs and touches rows', purged >= 1, `n=${purged}`);
    const row = await one(sup, `SELECT payload_json, payload_purged_at FROM alerts.new_lead_outbox WHERE dispatch_key=$1`, [e.key]);
    g.eq('the payload is emptied even though the delivery is unresolved', row.payload_json, {});
    g.ok('payload_purged_at is stamped', !!row.payload_purged_at);
    g.eq('contact_value is gone from the row', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_outbox WHERE dispatch_key=$1 AND payload_json ? 'contact_value'`, [e.key])), 0);
    g.eq('the DELIVERY_UNKNOWN row is still there, still unresolved', await one(sup,
      `SELECT status, claim_token FROM alerts.new_lead_delivery WHERE dispatch_key=$1 AND channel='telegram'`, [e.key]),
      { status: 'DELIVERY_UNKNOWN', claim_token: null });

    // ... and the terminal sweep still refuses to remove it.
    await sup.query(`ALTER TABLE alerts.new_lead_delivery DISABLE TRIGGER new_lead_delivery_touch`);
    await sup.query(`UPDATE alerts.new_lead_delivery SET updated_at = now() - interval '400 days'
                      WHERE dispatch_key=$1`, [e.key]);
    await sup.query(`ALTER TABLE alerts.new_lead_delivery ENABLE TRIGGER new_lead_delivery_touch`);
    await ret.query(`SELECT alerts.purge_new_lead_deliveries()`);
    g.eq('400 days later the unresolved DELIVERY_UNKNOWN is STILL not swept',
      (await counts(sup, e.key)).telegram, 1);

    // AMENDMENT 2.2-C: recording a decision the code does not implement must fail loudly.
    await sup.query(`UPDATE alerts.retention_policy
                        SET delivery_unknown_retention_status='DECIDED_BOUNDED',
                            delivery_unknown_retention_days=365`);
    const err = await expectFail(() => ret.query(`SELECT alerts.purge_new_lead_deliveries()`));
    g.ok('recording a DELIVERY_UNKNOWN horizon makes the sweep REFUSE, not silently do nothing',
      !!err && /ALERTS_DELIVERY_UNKNOWN_HORIZON_NOT_IMPLEMENTED/.test(err.message) && err.code === '0A000',
      err && `${err.code} ${err.message}`);
    g.eq('the unresolved row survives that too', (await counts(sup, e.key)).telegram, 1);
    g.eq('a bounded decision cannot be recorded without a horizon', (await expectFail(
      () => sup.query(`UPDATE alerts.retention_policy SET delivery_unknown_retention_days = NULL`))).code, '23514');
    await sup.query(`UPDATE alerts.retention_policy
                        SET delivery_unknown_retention_status='PENDING_OWNER',
                            delivery_unknown_retention_days=NULL`);
    g.eq('back to PENDING_OWNER, which is the shipped state', await one(sup,
      `SELECT delivery_unknown_retention_status AS s, delivery_unknown_retention_days AS d
         FROM alerts.retention_policy`), { s: 'PENDING_OWNER', d: null });
    await w.end(); await ret.end();
  }

  // -------------------------------------------------------------- gates 59-61
  {
    const g59 = R.gate(59, 'no alerts exception carries the raw request id');
    const g60 = R.gate(60, 'no alerts exception carries contact_value or any payload value');
    const g61 = R.gate(61, 'after every failure path, no alerts table or view holds the raw request id');

    // Two secrets that exist only to be searched for. The chat id is embedded in a VALID
    // Concierge identity so the paths past the shape check can be reached with it.
    const CHAT = '918273645012';
    const RID = `C-${CHAT}-1788000000001`;
    const CONTACT = '@zz_secret_contact_zz_918273645012';
    const logFile = process.env.FM_PGLOG || null;
    const logAt = logMark(logFile);

    const w = await asRole(LOGINS.writer);
    const disp = await asRole(LOGINS.dispatcher);
    const rec = await asRole(LOGINS.reconciler);
    const ret = await asRole(LOGINS.retention);
    const good = () => JSON.stringify(D.payload({ contact_value: CONTACT }));
    const now = () => new Date().toISOString();

    // Every RAISE the schema can produce, driven through the granted API only.
    const cases = [
      ['ALERTS_ROUTE_INVALID', () => w.query(D.ENQUEUE, ['not_a_route', RID, D.leadId(), now(), good()])],
      ['ALERTS_REQUEST_ID_SHAPE_INVALID', () => w.query(D.ENQUEUE, ['public', RID, D.leadId(), now(), good()])],
      ['ALERTS_REQUEST_ID_SHAPE_INVALID/malformed', () => w.query(D.ENQUEUE, ['concierge', RID + 'X', D.leadId(), now(), good()])],
      ['ALERTS_LEAD_ID_INVALID', () => w.query(D.ENQUEUE, ['concierge', RID, '', now(), good()])],
      ['ALERTS_LEAD_ID_INVALID/long', () => w.query(D.ENQUEUE, ['concierge', RID, 'L'.repeat(65), now(), good()])],
      ['ALERTS_SETTLED_AT_INVALID', () => w.query(D.ENQUEUE, ['concierge', RID, D.leadId(), '2000-01-01T00:00:00Z', good()])],
      ['ALERTS_PAYLOAD_NOT_OBJECT', () => w.query(D.ENQUEUE, ['concierge', RID, D.leadId(), now(), '[1,2,3]'])],
      // THE 2.2-D CASE: the forbidden KEY NAME is itself the raw identity.
      ['ALERTS_PAYLOAD_KEY_FORBIDDEN/key-is-the-secret',
        () => w.query(D.ENQUEUE, ['concierge', RID, D.leadId(), now(), JSON.stringify({ [RID]: 1, company: 'x' })])],
      ['ALERTS_PAYLOAD_KEY_FORBIDDEN/contact-in-key',
        () => w.query(D.ENQUEUE, ['concierge', RID, D.leadId(), now(), JSON.stringify({ [CONTACT]: 1 })])],
      ['ALERTS_CONTACT_CHANNEL_INVALID',
        () => w.query(D.ENQUEUE, ['concierge', RID, D.leadId(), now(),
          JSON.stringify(D.payload({ contact_channel: CONTACT, contact_value: CONTACT }))])],
      ['b64/ALERTS_PAYLOAD_NOT_OBJECT',
        () => w.query(D.ENQUEUE_B64, ['concierge', RID, D.leadId(), now(), D.b64([CONTACT])])],
      ['ALERTS_CHANNEL_INVALID', () => disp.query(`SELECT * FROM alerts.claim_new_lead_delivery($1)`, [CONTACT])],
      ['ALERTS_OUTCOME_INVALID', () => disp.query(
        `SELECT alerts.finalise_new_lead_delivery($1,$2,$3,$4)`,
        ['NEW_LEAD:' + 'a'.repeat(64), 'telegram', '00000000-0000-0000-0000-000000000000', CONTACT])],
      ['ALERTS_ERROR_CODE_INVALID', () => disp.query(
        `SELECT alerts.finalise_new_lead_delivery($1,$2,$3,$4,$5)`,
        ['NEW_LEAD:' + 'a'.repeat(64), 'telegram', '00000000-0000-0000-0000-000000000000', 'SENT', CONTACT])],
      ['ALERTS_PROVIDER_ID_INVALID', () => disp.query(
        `SELECT alerts.finalise_new_lead_delivery($1,$2,$3,$4,$5,$6)`,
        ['NEW_LEAD:' + 'a'.repeat(64), 'telegram', '00000000-0000-0000-0000-000000000000',
         'RETRYABLE_FAILED', 'X_FAIL', CONTACT])],
      ['ALERTS_EXPIRY_TOO_SHORT', () => disp.query(`SELECT alerts.expire_stale_claims($1::interval)`, ['1 second'])],
      ['ALERTS_EVENT_NOT_FOUND', () => rec.query(`SELECT * FROM alerts.repair_new_lead_deliveries($1)`,
        ['NEW_LEAD:' + D.fingerprintOf(RID)])],
      ['ALERTS_KEY_RETENTION_PENDING', () => ret.query(`SELECT alerts.purge_new_lead_keys()`)],
    ];

    for (const [name, fn] of cases) {
      const err = await expectFail(fn);
      const text = errText(err);
      g59.ok(`${name}: raises`, !!err, 'the call SUCCEEDED, so the path was not exercised');
      g59.ok(`${name}: the error carries no raw request id`, !text.includes(RID), text);
      g59.ok(`${name}: the error carries no chat id fragment`, !text.includes(CHAT), text);
      g60.ok(`${name}: the error carries no contact_value`, !text.includes(CONTACT), text);
      g60.ok(`${name}: the error carries no "Failing row contains" dump`,
        !/Failing row contains/i.test(text), text);
      g59.ok(`${name}: the error is a stable ALERTS_* code`,
        !!err && (/ALERTS_[A-Z0-9_]+/.test(err.message) || err.code === '42501'), err && err.message);
    }

    // The one path that used to leak, called out by name so a regression is unmissable.
    const leaky = await expectFail(() => w.query(D.ENQUEUE,
      ['concierge', RID, D.leadId(), now(), JSON.stringify({ [RID]: 1 })]));
    g59.eq('the forbidden-key error reports a COUNT, never the key names',
      (leaky && leaky.message || '').replace(/\d+/g, 'N'), 'ALERTS_PAYLOAD_KEY_FORBIDDEN (n=N)');

    // ---- gate 61: nothing landed anywhere
    const scanRid = await scanForSecret(sup, RID);
    const scanChat = await scanForSecret(sup, CHAT);
    const scanContact = await scanForSecret(sup, CONTACT);
    g61.ok('every text and jsonb column of every alerts table and view was scanned',
      scanRid.columnsScanned >= 20, `columns=${scanRid.columnsScanned}`);
    g61.eq('the raw request id appears in no alerts column', scanRid.hits, []);
    g61.eq('the chat id fragment appears in no alerts column', scanChat.hits, []);
    g61.eq('the contact value appears in no alerts column', scanContact.hits, []);
    g61.eq('no outbox row was created by any failure path', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_outbox WHERE request_fingerprint = $1`, [D.fingerprintOf(RID)])), 0);
    g61.eq('the fingerprint of the secret identity is not present either', Number(await val(sup,
      `SELECT count(*) FROM alerts.new_lead_outbox WHERE dispatch_key = $1`, ['NEW_LEAD:' + D.fingerprintOf(RID)])), 0);

    // ---- the server log, under DELIBERATELY MAXIMAL logging
    if (logFile && logAt !== null) {
      const tail = await logSince(logFile, logAt);
      const lines = tail.split(/\r?\n/);
      const hits = lines.filter((l) => l.includes(RID) || l.includes(CONTACT));

      // THE CONTROL, ARMED. Every assertion below has the shape "no line of kind X carries the
      // secret". Every one of them is VACUOUSLY TRUE on a cluster that was never started with
      // maximal logging -- and the note would then report "0 lines carry the raw identifier",
      // which reads like the strongest possible result when it actually means the experiment
      // never ran. Two guards, because each catches what the other cannot:
      //   1. the settings really are maximal, read back from the server, not assumed;
      //   2. the scan really does find the identifier SOMEWHERE, so "it is not in the places
      //      that matter" is a falsifiable claim rather than an artefact of an unread file.
      const MAXIMAL = [
        ['log_statement', 'all'], ['log_min_duration_statement', '0'],
        ['log_parameter_max_length', '-1'], ['log_parameter_max_length_on_error', '-1'],
        ['log_error_verbosity', 'verbose'],
      ];
      const wrong = [];
      for (const [k, want] of MAXIMAL) {
        const got = String(await val(sup, `SELECT current_setting($1)`, [k]));
        if (got !== want) wrong.push(`${k}=${got} (want ${want})`);
      }
      g59.eq('the maximal-logging control is ARMED at the cluster -- see db/validation/README.md',
        wrong, []);
      g59.ok('positive control: under maximal logging the scan DOES find the identifier in the log',
        hits.length > 0,
        'the scan found the identifier NOWHERE in the log, so every "no line carries it" '
        + 'assertion below is vacuous -- the cluster is not logging, or the log is not being read');
      // Classify every line that DOES carry a secret by which PostgreSQL setting emitted it.
      // The point of the gate is not "nothing is ever logged" -- under log_statement = all the
      // bind parameters obviously are. It is that NOTHING THE SCHEMA ITSELF WRITES carries them,
      // so every exposure is governed by a cluster setting the owner can see and set.
      const byStatementLogging = (l) =>
        /LOG:\s+\S*\s*(statement:|duration:|execute |parse |bind )/.test(l) || /^\s*\S.*STATEMENT:/.test(l);
      const byParamsOnError = (l) =>
        /DETAIL:\s+Parameters:/i.test(l) || /portal with parameters:/.test(l);
      const authoredByTheSchema = (l) => /(ERROR|CONTEXT|HINT|WARNING|NOTICE):/.test(l)
        && !byParamsOnError(l) && !byStatementLogging(l);

      g59.eq('under log_statement=all, NO line the schema itself writes carries the raw id or contact value',
        hits.filter(authoredByTheSchema), []);
      g59.eq('and no ERROR line -- the text of our own RAISE -- carries them either',
        hits.filter((l) => /ERROR:/.test(l) && !byParamsOnError(l) && !byStatementLogging(l)), []);
      const unclassified = hits.filter((l) => !byStatementLogging(l) && !byParamsOnError(l));
      g59.eq('every line that does carry them is attributable to a named logging setting',
        unclassified.slice(0, 3), []);
      const nOnError = hits.filter((l) => /portal with parameters:/.test(l)).length;
      const nBind = hits.filter((l) => /DETAIL:\s+Parameters:/i.test(l)).length;
      const nStmt = hits.filter(byStatementLogging).length;
      R.note(`server log under DELIBERATELY MAXIMAL logging (log_statement=all, log_min_duration_statement=0, `
        + `log_parameter_max_length=-1, log_parameter_max_length_on_error=-1, log_error_verbosity=verbose)`
        + `${wrong.length ? ' -- NOT ARMED: ' + wrong.join(', ') + '. The count below is therefore NOT a result' : ''}: `
        + `${hits.length} lines carry the raw identifier or the contact value -- ${nStmt} statement lines `
        + `(log_statement / log_min_duration_statement), ${nBind} bind-parameter DETAIL lines `
        + `(log_parameter_max_length), ${nOnError} on-error parameter dumps `
        + `(log_parameter_max_length_on_error). NONE is authored by an alerts RAISE. This is the worst case, `
        + `provoked on purpose; finmentor-prod's own settings are replayed below.`);
    } else {
      R.note('FM_PGLOG not set: the server-log scan was SKIPPED, and the log claims are unproven for this run.');
    }

    // ---- the same failure paths again, with finmentor-prod's OWN logging settings
    if (logFile) {
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET log_statement = 'ddl'`);
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET log_min_duration_statement = -1`);
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET log_duration = off`);
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET log_min_error_statement = 'error'`);
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET log_error_verbosity = 'default'`);
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET log_parameter_max_length_on_error = 0`);
      const at = logMark(logFile);
      const w2 = await open(db, LOGINS.writer, PW);
      const RID2 = `C-${CHAT}-1788000000002`;
      const CONTACT2 = CONTACT + '_prodlike';
      // one successful enqueue, and the two paths that reach a RAISE with caller data in hand
      await w2.query(D.ENQUEUE, ['concierge', RID2, D.leadId(), now(),
        JSON.stringify(D.payload({ contact_value: CONTACT2 }))]);
      await expectFail(() => w2.query(D.ENQUEUE, ['concierge', RID2, D.leadId(), now(),
        JSON.stringify({ [RID2]: 1 })]));
      await expectFail(() => w2.query(D.ENQUEUE, ['public', RID2, D.leadId(), now(),
        JSON.stringify(D.payload({ contact_value: CONTACT2 }))]));
      await w2.end();
      const tail2 = await logSince(logFile, at);
      const hits2 = tail2.split(/\r?\n/).filter((l) => l.includes(RID2) || l.includes(CONTACT2));
      const g = R.gate(59, 'no alerts exception carries the raw request id');
      g.eq('with finmentor-prod\'s logging settings, the raw id reaches the server log ZERO times',
        hits2, []);
      g.eq('and neither does contact_value',
        tail2.split(/\r?\n/).filter((l) => l.includes(CONTACT2)), []);
      for (const s of ['log_statement', 'log_min_duration_statement', 'log_duration',
                       'log_min_error_statement', 'log_error_verbosity', 'log_parameter_max_length_on_error']) {
        await sup.query(`ALTER ROLE ${LOGINS.writer} RESET ${s}`);
      }
      R.note('Replayed with finmentor-prod\'s effective logging settings (log_statement=ddl, '
        + 'log_min_duration_statement=-1, log_duration=off, log_parameter_max_length_on_error=0): the raw '
        + 'canonical request id appeared in the server log ZERO times, on the successful path and on both '
        + 'failure paths.');
    }

    await w.end(); await disp.end(); await rec.end(); await ret.end();

    // ------------------------------------------------------------------ gate 62
    // NOT on the owner's list. Added because the read-only production preflight found the one
    // logging path the two obvious settings do not close: finmentor-prod preloads auto_explain
    // and arms it at 10 000 ms with auto_explain.log_parameter_max_length = -1, which logs bind
    // parameters IN FULL for any statement that crosses the threshold -- including a SUCCESSFUL
    // one. The owner asked for the exact conditions, so this proves them instead of quoting the
    // manual, and proves the proposed mitigation in the same run.
    if (logFile && process.env.FM_SKIP_SLOW !== '1') {
      const g = R.gate(62, 'auto_explain: a slow but SUCCESSFUL enqueue, and the mitigation that closes it');
      const CHAT3 = '918273645013';
      const setRole = async (pairs) => {
        for (const [k, v] of pairs) await sup.query(`ALTER ROLE ${LOGINS.writer} SET ${k} = ${v}`);
      };
      // finmentor-prod's ACTUAL effective values, read on 2026-09-01.
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET session_preload_libraries = 'auto_explain'`);
      await setRole([
        ['auto_explain.log_min_duration', '10000'], ['auto_explain.log_parameter_max_length', '-1'],
        ['auto_explain.log_nested_statements', 'off'], ['auto_explain.log_analyze', 'off'],
        ['auto_explain.log_timing', 'on'], ['auto_explain.log_level', "'log'"],
        ['log_statement', "'ddl'"], ['log_min_duration_statement', '-1'], ['log_duration', 'off'],
        ['log_min_error_statement', "'error'"], ['log_error_verbosity', "'default'"],
        ['log_parameter_max_length_on_error', '0'],
      ]);

      // Make one enqueue slow WITHOUT touching the function: hold the lock its delivery insert needs.
      const slowEnqueue = async (rid, contact, waitMs) => {
        const blocker = await open(db);                       // separate superuser session
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE alerts.new_lead_delivery IN ACCESS EXCLUSIVE MODE');
        const at = logMark(logFile);
        // A RAW client on purpose: lib.open() issues its own SET statement_timeout / lock_timeout,
        // which would override exactly the role-level caps this gate is here to prove.
        const wS = connect(db, LOGINS.writer, PW);
        await wS.connect();
        const p = wS.query(D.ENQUEUE, ['concierge', rid, D.leadId(), new Date().toISOString(),
                                       JSON.stringify(D.payload({ contact_value: contact }))])
                    .then((r) => ({ ok: true, r }), (e) => ({ ok: false, e }));
        await new Promise((r) => setTimeout(r, waitMs));
        await blocker.query('ROLLBACK');
        const outcome = await p;
        await wS.end(); await blocker.end();
        const tail = await logSince(logFile, at);
        return { outcome, tail, lines: tail.split(/\r?\n/) };
      };

      const RID3 = `C-${CHAT3}-1788000000003`;
      const CONTACT3 = '@zz_slow_contact_zz_918273645013';
      const slow = await slowEnqueue(RID3, CONTACT3, 11000);
      g.ok('the slow enqueue SUCCEEDED -- this is not an error path',
        slow.outcome.ok && slow.outcome.r.rows[0].out_outcome === 'CREATED',
        JSON.stringify(slow.outcome.ok ? slow.outcome.r.rows[0] : slow.outcome.e.message));
      g.ok('auto_explain fired at the 10 s threshold', /LOG:.*plan:/.test(slow.tail),
        slow.lines.filter((l) => /plan:/.test(l)).slice(0, 1).join(''));
      const leaked = slow.lines.filter((l) => l.includes(RID3) || l.includes(CONTACT3));
      // THE FINDING, asserted as a fact rather than described: it DOES leak.
      g.ok('CONFIRMED: with prod\'s auto_explain settings the raw request id IS written to the server log '
         + 'by a SUCCESSFUL enqueue that crosses 10 s', leaked.length > 0, `lines=${leaked.length}`);
      g.ok('and it arrives as auto_explain\'s "Query Parameters", not as anything the schema wrote',
        leaked.every((l) => /Query Parameters:|\$\d+ = /.test(l)),
        JSON.stringify(leaked.filter((l) => !/Query Parameters:|\$\d+ = /.test(l)).slice(0, 2)));

      // ---- THE MITIGATION, proven: cap the runtime role below auto_explain's threshold.
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET statement_timeout = '8s'`);
      await sup.query(`ALTER ROLE ${LOGINS.writer} SET lock_timeout = '5s'`);
      const RID4 = `C-${CHAT3}-1788000000004`;
      const CONTACT4 = '@zz_slow_contact_zz_mitigated';
      const mit = await slowEnqueue(RID4, CONTACT4, 11000);
      g.ok('with statement_timeout below the threshold the contended enqueue is aborted, not logged',
        !mit.outcome.ok && ['57014', '55P03'].includes(mit.outcome.e.code),
        mit.outcome.ok ? 'it SUCCEEDED' : `${mit.outcome.e.code} ${mit.outcome.e.message}`);
      g.eq('auto_explain never fires, because no statement ever reaches 10 s',
        mit.lines.filter((l) => /plan:/.test(l)), []);
      g.eq('and the raw request id appears in the server log ZERO times',
        mit.lines.filter((l) => l.includes(RID4) || l.includes(CONTACT4)), []);
      g.eq('the aborted attempt committed nothing', await counts(sup, 'NEW_LEAD:' + D.fingerprintOf(RID4)),
        { event: 0, telegram: 0, email: 0 });

      for (const s of ['session_preload_libraries', 'auto_explain.log_min_duration',
                       'auto_explain.log_parameter_max_length', 'auto_explain.log_nested_statements',
                       'auto_explain.log_analyze', 'auto_explain.log_timing', 'auto_explain.log_level',
                       'log_statement', 'log_min_duration_statement', 'log_duration',
                       'log_min_error_statement', 'log_error_verbosity',
                       'log_parameter_max_length_on_error', 'statement_timeout', 'lock_timeout']) {
        await sup.query(`ALTER ROLE ${LOGINS.writer} RESET ${s}`);
      }
      R.note('RAW REQUEST ID ORDINARY-STATEMENT LOG RISK, PROVEN NOT INFERRED: with finmentor-prod\'s exact '
        + 'settings (auto_explain preloaded, log_min_duration 10 000 ms, log_parameter_max_length -1, '
        + 'log_nested_statements off) a SUCCESSFUL enqueue that crosses 10 s writes the raw canonical request id '
        + 'and contact_value to the server log as auto_explain "Query Parameters". It is NOT reachable in normal '
        + 'operation -- an enqueue is sub-millisecond -- but it is reachable under lock contention, and prod has '
        + 'lock_timeout = 0 with statement_timeout = 120 s, so the 10-120 s window is open. MITIGATION PROVEN in '
        + 'the same run: ALTER ROLE <runtime login> SET statement_timeout = \'8s\', lock_timeout = \'5s\' -- the '
        + 'same values Supabase already sets for its own `authenticator` role -- caps every statement below the '
        + 'threshold, auto_explain never fires, and the identifier reaches the log zero times. This is a RUNTIME '
        + 'CREDENTIAL precondition, not a DDL change, and it changes NO database logging setting.');
    } else if (logFile) {
      R.note('gate 62 (auto_explain) SKIPPED by FM_SKIP_SLOW=1 -- the production logging finding is UNPROVEN in this run.');
    }
  }

  return ctx;
}
