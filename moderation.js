// ——— MODERATION ———
// Automated safety analysis for all platform messages.
//
// analyzeMessage(body) → { flagged: boolean, reasons: string[] }
//
// IMPORTANT: Flagging does NOT block delivery. All messages are stored and
// delivered to the recipient. Flagging only triggers coordinator review.
// False positives (e.g. a legitimate business URL) are dismissed by the coordinator.
//
// Hard-coded regex patterns catch high-confidence signals. The configurable
// flaggedTerms arrays in data.js extend coverage with phrase-level matching.

// ——— PHONE NUMBERS ———
const _MOD_PHONE = [
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,           // 123-456-7890 / 123.456.7890
  /\b\(\d{3}\)\s?\d{3}[-.\s]\d{4}\b/,           // (123) 456-7890
  /\b1[-.\s]\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,     // 1-123-456-7890
  /\b\d{10}\b/,                                   // 1234567890 (ten consecutive digits)
  /\+\d[\d\s.\-]{7,13}\d/,                        // +1 613 555 0100 (international)
];

// Free / personal email domains. School and company email domains are NOT flagged —
// a student sharing their OCDSB address is fine; sharing their Gmail is not.
const _MOD_PERSONAL_EMAIL = /@(gmail|googlemail|hotmail|outlook|live|yahoo|ymail|icloud|proton|protonmail|msn|aol|mail\.com|zoho|fastmail|tutanota)\b/i;

// Explicit URLs only (http/https or www.) — bare domain.com would cause too many
// false positives (e.g. company names like "SiB.co"). Coordinators review edge cases.
const _MOD_URL = [
  /https?:\/\/\S+/i,
  /\bwww\.[a-z0-9\-]{2,}\.[a-z]{2,}/i,
];

// Social platform names and standalone @handle patterns.
// The negative lookahead excludes email-format strings (user@school.ca is fine).
const _MOD_SOCIAL = [
  /\b(?:instagram|insta|snapchat|snap|tiktok|discord|telegram|whatsapp|facebook|twitter|x\.com|linkedin|kik|signal|wechat|imessage|facetime)\b/i,
  /(?:^|\s)@(?![a-z0-9.]+\.[a-z]{2,}\b)[a-z0-9._]{2,}/im,
];

// ——— CORE FUNCTION ———

function analyzeMessage(body) {
  if (!body || typeof body !== 'string') return { flagged: false, reasons: [] };
  const reasons = [];

  if (_MOD_PHONE.some(re => re.test(body)))    reasons.push('phone_number');
  if (_MOD_PERSONAL_EMAIL.test(body))           reasons.push('personal_email');
  if (_MOD_URL.some(re => re.test(body)))       reasons.push('url');
  if (_MOD_SOCIAL.some(re => re.test(body)))    reasons.push('social_media');

  // Phrase-level matching via the configurable flaggedTerms object (data.js)
  const ft = typeof flaggedTerms !== 'undefined' ? flaggedTerms : null;
  if (ft) {
    const lower = body.toLowerCase();
    if (ft.offPlatformPhrases.length &&
        ft.offPlatformPhrases.some(p => lower.includes(p.toLowerCase()))) {
      reasons.push('off_platform_phrase');
    }
    if (ft.profanity.length &&
        ft.profanity.some(p => lower.includes(p.toLowerCase()))) {
      reasons.push('profanity');
    }
  }

  return { flagged: reasons.length > 0, reasons };
}

// Human-readable reason labels for UI display
const _REASON_LABEL = {
  phone_number:        'Phone number detected',
  personal_email:      'Personal email address detected',
  url:                 'External link or website detected',
  social_media:        'Social media handle or platform name detected',
  off_platform_phrase: 'Off-platform communication language detected',
  profanity:           'Inappropriate language detected',
  user_report:         'Reported by a participant',
};

function moderationReasonLabels(reasons) {
  return (reasons || []).map(r => _REASON_LABEL[r] || r);
}
