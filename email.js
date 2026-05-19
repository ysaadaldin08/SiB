// ——— EMAIL TRANSPORT ———
// TODO: Replace this mock with Resend/Postmark transport before going to production.
// To swap the transport, replace the body of sendEmail() only — the call signature
// { to, subject, body, type } must stay unchanged so all callers need zero updates.

function sendEmail({ to, subject, body, type }) {
  if (window.SIB_DEBUG) {
    console.group('%c[email] ' + type, 'color:#7c3aed;font-weight:bold;font-size:12px');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Body:\n' + body);
    console.groupEnd();
  }

  showToast('📧 Email sent to ' + to);
}
