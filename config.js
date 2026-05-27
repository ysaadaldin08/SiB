// Shared config — loaded first on every page, before auth.js and data.js.
// Using var so later script loads cannot cause a SyntaxError on re-declaration.
var API_BASE = (['localhost', '127.0.0.1'].includes(location.hostname))
  ? 'http://localhost:3001/api'
  : location.origin + '/api';
var SUPABASE_URL = 'https://mhauftulhvnguualfcfw.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1oYXVmdHVsaHZuZ3V1YWxmY2Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MjMzMTIsImV4cCI6MjA5NTI5OTMxMn0.F0fSEO_1CKsjbH1aaP_UfkjvOHJEyw3-SVV7wM64o8Q';
function getToken() { return localStorage.getItem('sib_token') || ''; }

// Initialize the Supabase JS v2 client as soon as the CDN is available.
// If the CDN was already loaded synchronously (e.g. auth-callback.html), this is instant.
// Auth methods guard on window._supabase before calling.
(function () {
  function _init() { window._supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
  if (window.supabase) { _init(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
  s.onload = _init;
  document.head.appendChild(s);
}());