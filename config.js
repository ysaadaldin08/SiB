// Shared config — loaded first on every page, before auth.js and data.js.
// Using var so later script loads cannot cause a SyntaxError on re-declaration.
var API_BASE = (['localhost', '127.0.0.1'].includes(location.hostname))
  ? 'http://localhost:3001/api'
  : location.origin + '/api';
var SUPABASE_URL = 'https://lrjlahdpftdphuokndgs.supabase.co';
function getToken() { return localStorage.getItem('sib_token') || ''; }
