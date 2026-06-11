// Shared config — loaded first on every page, before auth.js and data.js.
// PATH A: the browser talks to Supabase directly; there is NO Node API. The
// server/ folder is retired and is NOT the data path (see server/README.md).
// There is intentionally no API_BASE here anymore.
// Using var so later script loads cannot cause a SyntaxError on re-declaration.
var SUPABASE_URL = 'https://mhauftulhvnguualfcfw.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oYXVmdHVsaHZuZ3V1YWxmY2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjMzMTIsImV4cCI6MjA5NTI5OTMxMn0.F0fSEO_1CKsjbH1aaP_UfkjvOHJEyw3-SVV7wM64o8Q';
function getToken() { return localStorage.getItem('sib_token') || ''; }

// Initialize the Supabase JS v2 client as soon as the CDN is available.
// If the CDN was already loaded synchronously (e.g. auth-callback.html), this is instant.
// Auth methods guard on window._supabase before calling.
//
// window._supabaseReady is a promise that resolves once window._supabase exists (or
// once the CDN load has definitively failed). The data layer awaits it before the
// first query so page-load reads never fire while the client is still null — that
// race was returning silent empty results ("0 listings" / "Listing not found").
window._supabaseReady = new Promise(function (resolve) {
  function _init() {
    window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    resolve(window._supabase);
  }
  if (window.supabase) { _init(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  s.onload = _init;
  // On CDN failure we RESOLVE (not reject) — the safer option: awaiting callers never
  // hang, and there is no unhandled promise rejection to crash the page handlers.
  // window._supabase stays undefined, so _sbReady() returns null and the existing
  // `if (!sb) return []/null` guards surface a clean empty state.
  s.onerror = function () { resolve(null); };
  document.head.appendChild(s);
});
