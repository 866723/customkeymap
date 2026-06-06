// GitHub OAuth (web application flow) for commit-back.
//
// The client_secret never leaves the server: the browser opens /api/oauth/login (popup),
// GitHub redirects back to /api/oauth/callback, and this function exchanges the code for an
// access token using the secret, then hands the token to the opener window via postMessage.
// After that, commits go from the browser to GitHub directly with that token; the server
// never sees the token again, and never sees the user's repo writes.
//
// Required env (set in Cloudflare Pages, Settings, Variables and secrets, Production):
//   GITHUB_CLIENT_ID      (variable)  the OAuth App's client id
//   GITHUB_CLIENT_SECRET  (secret)    the OAuth App's client secret
// The OAuth App's "Authorization callback URL" must be <origin>/api/oauth/callback.

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname.replace(/^\/api\/oauth\/?/, '').replace(/\/+$/, '');
  const clientId = envVal(env, 'GITHUB_CLIENT_ID');
  const clientSecret = envVal(env, 'GITHUB_CLIENT_SECRET');
  const redirectUri = origin + '/api/oauth/callback';

  if (path === 'login') {
    if (!clientId) return relay({ error: 'not_configured' }, origin);
    const scope = url.searchParams.get('scope') === 'repo' ? 'repo' : 'public_repo';
    const state = crypto.randomUUID();
    const authorize = 'https://github.com/login/oauth/authorize?' + new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, scope, state, allow_signup: 'true',
    });
    return new Response(null, {
      status: 302,
      headers: {
        'Location': authorize,
        'Set-Cookie': `gh_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      },
    });
  }

  if (path === 'callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookieState = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)gh_state=([^;]+)/);
    if (!code || !state || !cookieState || cookieState[1] !== state)
      return relay({ error: 'state_mismatch' }, origin);   // CSRF guard
    if (!clientSecret) return relay({ error: 'not_configured' }, origin);

    let data = {};
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'customkeymap' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
      });
      data = await res.json();
    } catch (e) { data = { error: 'exchange_failed' }; }

    return relay({ token: data.access_token || null, scope: data.scope || '', error: data.error || (data.access_token ? null : 'no_token') }, origin);
  }

  return page('Not found', 404);
}

// Hand the result to the opener window (same origin only) and close the popup.
function relay(payload, origin) {
  const json = JSON.stringify({ type: 'ck-gh-oauth', ...payload });
  const body = `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#16181d">
<script>
(function(){
  var msg = ${json};
  try { if (window.opener) { window.opener.postMessage(msg, ${JSON.stringify(origin)}); } } catch (e) {}
  if (window.opener) { window.close(); document.body.textContent = 'You can close this window.'; }
  else { document.body.textContent = msg.token ? 'Signed in - you can close this window.' : ('Sign-in failed: ' + (msg.error || 'unknown')); }
})();
</script>
Signing you in…</body>`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': 'gh_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',   // clear state
    },
  });
}

// Read an env var, tolerating a stray-whitespace var name from a dashboard typo.
function envVal(env, name) {
  if (env[name]) return env[name];
  for (const k of Object.keys(env)) if (k.trim() === name && env[k]) return env[k];
  return undefined;
}

function page(text, status) {
  return new Response('<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px">' + text + '</body>',
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
