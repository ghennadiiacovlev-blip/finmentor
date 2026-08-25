// FINMENTOR Command Center — authenticated Telegram identity gate.
//
// Deployed as the n8n Code node "Verify Telegram Identity". Its only upstream is the
// Telegram Trigger, which registers the webhook with Telegram using a secret_token and
// rejects any request whose X-Telegram-Bot-Api-Secret-Token does not match before the
// update ever reaches this workflow. Nothing below trusts a caller-supplied HTTP body.
//
// This node runs BEFORE Settings and before any Pipeline node, so a rejected update
// performs zero Sheets reads, zero CRM writes and produces zero Telegram output.
// Rejection is a silent drop (return []), which also denies an attacker an oracle.

const u = $input.first().json ?? {};

const isCallback = Object.prototype.hasOwnProperty.call(u, 'callback_query');
const cq = isCallback ? u.callback_query : null;
const msg = isCallback ? cq && cq.message : u.message;
const from = isCallback ? cq && cq.from : u.message && u.message.from;

// 1. Sender and chat must both exist and be genuine Telegram numeric ids.
const fromId = from && from.id;
const chatId = msg && msg.chat && msg.chat.id;
if (typeof fromId !== 'number' || !Number.isFinite(fromId)) return [];
if (typeof chatId !== 'number' || !Number.isFinite(chatId)) return [];

// 2. Bots may never drive the Command Center.
if (from.is_bot === true) return [];

// 3. Private chat only. group / supergroup / channel updates are rejected outright.
if (!msg.chat || msg.chat.type !== 'private') return [];

// 4. Owner-private invariant. In a Telegram private chat the chat id always equals the
//    sender id. Enforcing it collapses authorisation identity and reply destination into
//    a single value, which is what removes the from/chat confused-deputy exfiltration:
//    an attacker can no longer authorise as the owner while replying to their own chat.
if (String(chatId) !== String(fromId)) return [];

// 5. Payload must be usable before anything downstream runs.
const text = isCallback ? (cq.data ?? '') : (u.message.text ?? '');
if (typeof text !== 'string' || !text.trim()) return [];

return [{
  json: {
    verified: true,
    verified_from_id: String(fromId),
    verified_chat_id: String(chatId),
    is_callback: isCallback,
    callback_query_id: isCallback ? String(cq.id ?? '') : '',
    text: text.trim(),
    update_id: typeof u.update_id === 'number' ? u.update_id : null
  }
}];
