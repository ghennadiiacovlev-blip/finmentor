// FINMENTOR C3 — restore the authenticated Telegram update after the neutral callback ACK.
// The full identity/allowlist gate consumes the original envelope exactly as before.

const checked = $('Validate Basic Callback Envelope').first().json || {};
if (!checked.c3_original_update || typeof checked.c3_original_update !== 'object') throw new Error('C3_CALLBACK_ENVELOPE_MISSING');
return [{ json: checked.c3_original_update }];
