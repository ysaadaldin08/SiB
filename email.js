// ——— EMAIL TRANSPORT ———
// TODO: Replace this mock with Resend/Postmark transport before going to production.
// To swap the transport, replace the body of sendEmail() only — the call signature
// { to, subject, body, type } must stay unchanged so all callers need zero updates.

// Shared HTML escaper (also defined in auth.js via var — safe redeclaration)
var _htmlEsc = function (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

function sendEmail({ to, subject, body, type }) {
  // Log full email to console in every environment
  console.group('%c[email] ' + type, 'color:#7c3aed;font-weight:bold;font-size:12px');
  console.log('To:', to);
  console.log('Subject:', subject);
  console.log('Body:\n' + body);
  console.groupEnd();

  // Extract the first URL or hash-link from the body text for the dev CTA
  const linkMatch = body.match(/(https?:\/\/[^\s]+|#verify\?[^\s]+)/);

  if (type === 'verification' && linkMatch) {
    _showDevEmailToast({ to, subject, link: linkMatch[1] });
  } else {
    showToast('📧 Email queued for ' + to);
  }
}

function _showDevEmailToast({ to, subject, link }) {
  // Remove any previous dev toast before showing a new one
  const prev = document.getElementById('_devEmailToast');
  if (prev) prev.remove();

  const el = document.createElement('div');
  el.id = '_devEmailToast';
  el.style.cssText = [
    'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
    'background:#1e1b4b', 'color:#e0e7ff', 'border-radius:14px',
    'padding:16px 20px 14px', 'max-width:400px', 'width:calc(100% - 32px)',
    'z-index:99999', 'box-shadow:0 8px 40px rgba(0,0,0,0.45)',
    'font-size:13px', 'line-height:1.5', 'font-family:inherit'
  ].join(';');

  el.innerHTML = `
    <button onclick="this.closest('#_devEmailToast').remove()"
      style="position:absolute;top:10px;right:12px;background:none;border:none;color:#a5b4fc;
             font-size:20px;cursor:pointer;line-height:1;padding:0;" aria-label="Close">×</button>
    <div style="font-weight:700;color:#a5b4fc;font-size:11px;text-transform:uppercase;
                letter-spacing:0.08em;margin-bottom:8px;">Dev — email not sent</div>
    <div style="margin-bottom:2px;opacity:.7;font-size:12px;">
      To: <span style="color:#e0e7ff;">${_htmlEsc(to)}</span>
    </div>
    <div style="margin-bottom:12px;opacity:.7;font-size:12px;">
      Subject: <span style="color:#e0e7ff;">${_htmlEsc(subject)}</span>
    </div>
    <a href="${_htmlEsc(link)}"
      style="display:inline-flex;align-items:center;gap:7px;background:#4f46e5;color:#fff;
             padding:9px 16px;border-radius:9px;text-decoration:none;font-weight:700;font-size:12.5px;">
      ✓ Click to verify (dev only)
    </a>`;

  document.body.appendChild(el);
}
