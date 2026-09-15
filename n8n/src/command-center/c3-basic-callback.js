// FINMENTOR C3 — validate only the Telegram callback envelope required for a neutral early ACK.
// Full owner authorisation remains downstream in Verify Telegram Identity + Settings policy.

const update = $input.first().json || {};
const callback = update.callback_query;
const message = callback && callback.message;
const from = callback && callback.from;
const fromId = from && from.id;
const chatId = message && message.chat && message.chat.id;

const valid = !!callback
  && typeof callback.id === 'string' && callback.id.trim() !== ''
  && typeof callback.data === 'string' && callback.data.trim() !== ''
  && typeof fromId === 'number' && Number.isFinite(fromId)
  && from.is_bot !== true
  && typeof chatId === 'number' && Number.isFinite(chatId)
  && message.chat.type === 'private'
  && String(fromId) === String(chatId);

return [{ json: {
  c3_basic_callback_valid: valid,
  c3_callback_query_id: valid ? callback.id : '',
  c3_original_update: update
} }];
