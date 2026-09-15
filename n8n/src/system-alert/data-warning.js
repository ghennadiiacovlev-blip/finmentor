// FINMENTOR C2 — transition detector for the existing Daily Digest data-quality sets.
//
// This module does not decide whether a field is required. Build Daily Digest already owns that
// rule and supplies the three sets it has calculated since C1. This module only fingerprints those
// sets, emits a warning when the condition changes, and emits one silent clear transition so the
// central SYSTEM ALERT state can permit the same condition if it later recurs.

'use strict';

const crypto = require('crypto');
const CHECK_KEY = 'daily-digest:required-lead-data';

function strings(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value == null ? '' : value).trim())
    .filter(Boolean)
    .sort();
}

function canonical(summary) {
  const s = summary && typeof summary === 'object' ? summary : {};
  return {
    missing_required_contact: strings(s.missing_required_contact),
    missing_next_action: strings(s.missing_next_action),
    expired_snooze: strings(s.expired_snooze)
  };
}

function counts(canonicalSets) {
  return {
    missing_required_contact_count: canonicalSets.missing_required_contact.length,
    missing_next_action_count: canonicalSets.missing_next_action.length,
    expired_snooze_count: canonicalSets.expired_snooze.length
  };
}

function fingerprint(canonicalSets) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalSets), 'utf8').digest('hex');
}

function root(store) {
  const target = store && typeof store === 'object' ? store : {};
  if (!target.finmentor_c2_data_warning || typeof target.finmentor_c2_data_warning !== 'object') {
    target.finmentor_c2_data_warning = {};
  }
  return target.finmentor_c2_data_warning;
}

function evaluate(summary, store, occurredAt) {
  const sets = canonical(summary);
  const tally = counts(sets);
  const total = tally.missing_required_contact_count + tally.missing_next_action_count + tally.expired_snooze_count;
  const state = root(store);

  if (total === 0) {
    if (!state.fingerprint) { return { emit: false, reason: 'STILL_CLEAR', event: null }; }
    delete state.fingerprint;
    return {
      emit: true,
      reason: 'CLEAR_TRANSITION',
      event: Object.assign({
        event_type: 'data_warning',
        check_key: CHECK_KEY,
        fingerprint: '',
        occurred_at: String(occurredAt || '')
      }, tally)
    };
  }

  const next = fingerprint(sets);
  if (state.fingerprint === next) {
    return { emit: false, reason: 'UNCHANGED_DATA_WARNING', event: null };
  }
  state.fingerprint = next;
  return {
    emit: true,
    reason: 'NEW_OR_CHANGED_DATA_WARNING',
    event: Object.assign({
      event_type: 'data_warning',
      check_key: CHECK_KEY,
      fingerprint: next,
      occurred_at: String(occurredAt || '')
    }, tally)
  };
}

module.exports = { CHECK_KEY, canonical, counts, fingerprint, evaluate };
