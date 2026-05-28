// Server-side message moderation — mirrors the client-side logic in moderation.js.
// The server MUST re-run this analysis and ignore client-supplied flagged/flag_reasons
// values. A malicious sender could set flagged:false in the request body to bypass the
// client-side warning dialog and coordinator notification.

const _MOD_PHONE = [
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
  /\b\(\d{3}\)\s?\d{3}[-.\s]\d{4}\b/,
  /\b1[-.\s]\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
  /\b\d{10}\b/,
  /\+\d[\d\s.\-]{7,13}\d/,
];

const _MOD_PERSONAL_EMAIL = /@(gmail|googlemail|hotmail|outlook|live|yahoo|ymail|icloud|proton|protonmail|msn|aol|mail\.com|zoho|fastmail|tutanota)\b/i;

const _MOD_URL = [
  /https?:\/\/\S+/i,
  /\bwww\.[a-z0-9\-]{2,}\.[a-z]{2,}/i,
];

const _MOD_SOCIAL = [
  /\b(?:instagram|insta|snapchat|snap|tiktok|discord|telegram|whatsapp|facebook|twitter|x\.com|linkedin|kik|signal|wechat|imessage|facetime)\b/i,
  /(?:^|\s)@(?![a-z0-9.]+\.[a-z]{2,}\b)[a-z0-9._]{2,}/im,
];

const _OFF_PLATFORM_PHRASES = [
  'text me', 'call me', 'my number is', 'my phone is', 'phone number is',
  'add me on', 'dm me', "let's move this to", 'email me at', 'reach me at',
  'contact me at', 'message me on', 'find me on', 'follow me on',
  'my instagram', 'my snapchat', 'my discord', 'my telegram', 'my whatsapp',
  'on instagram', 'on snapchat', 'on discord', 'on telegram', 'on whatsapp',
  'text me at', 'call me at', 'phone me', "i'll text you", "i'll call you",
  'outside of this', 'off this platform', 'off-platform', 'another way to reach',
];

function analyzeMessage(body) {
  if (!body || typeof body !== 'string') return { flagged: false, reasons: [] };
  const reasons = [];
  if (_MOD_PHONE.some(re => re.test(body)))  reasons.push('phone_number');
  if (_MOD_PERSONAL_EMAIL.test(body))         reasons.push('personal_email');
  if (_MOD_URL.some(re => re.test(body)))     reasons.push('url');
  if (_MOD_SOCIAL.some(re => re.test(body)))  reasons.push('social_media');
  const lower = body.toLowerCase();
  if (_OFF_PLATFORM_PHRASES.some(p => lower.includes(p))) reasons.push('off_platform_phrase');
  return { flagged: reasons.length > 0, reasons };
}

module.exports = { analyzeMessage };
