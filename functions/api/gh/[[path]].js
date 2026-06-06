// Cloudflare Pages Function: same-origin GitHub API read-proxy.
// Deployed with the site at /api/gh/* (e.g. /api/gh/repos/foo/bar/git/trees/main).
// Injects a server-side token (env.GH_TOKEN) so the public GitHub API limit
// (60/hr/IP unauthenticated) becomes 5,000/hr shared, with no user auth, and edge-caches
// responses so the token is rarely spent. Read-only, allow-listed and GET-only; not a
// general open proxy.

// Only these GitHub API paths (rate_limit is free and read-only, for diagnostics).
const ALLOW = /^(repos|users|orgs|search\/code)\/|^rate_limit$/;

// Read the server token, tolerating a stray-whitespace var name (e.g. " GH_TOKEN"),
// a near-invisible dashboard typo that otherwise silently disables authentication.
function ghToken(env) {
  if (env.GH_TOKEN) return env.GH_TOKEN;
  for (const k of Object.keys(env)) if (k.trim() === 'GH_TOKEN' && env[k]) return env[k];
  return undefined;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method !== 'GET')
    return json({ message: 'Method not allowed' }, 405);

  const sub = (Array.isArray(params.path) ? params.path.join('/') : (params.path || '')).replace(/^\/+/, '');
  if (!ALLOW.test(sub))
    return json({ message: 'Path not allowed' }, 403);

  const search = new URL(request.url).search;
  const target = `https://api.github.com/${sub}${search}`;

  // Edge cache keyed by the target (independent of caller); short TTL.
  const cache = caches.default;
  const cacheKey = new Request(target, { method: 'GET' });
  let res = await cache.match(cacheKey);
  if (!res) {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'customkeymap-visualizer',
    };
    const token = ghToken(env);
    const hasToken = !!token;
    if (hasToken) headers['Authorization'] = `Bearer ${token}`;
    const upstream = await fetch(target, { headers });
    res = new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
    res.headers.set('Cache-Control', 'public, max-age=300');     // 5-min edge cache
    res.headers.set('X-Proxied', '1');                            // marker: response came from the proxy
    // Diagnostics: was a server token attached, and what does GitHub say about quota?
    res.headers.set('X-GH-Auth', hasToken ? '1' : '0');
    // Distinguish "binding not applied" (undefined) from "blank value" (empty) from "set".
    res.headers.set('X-GH-Tok', token ? 'set' : (env.GH_TOKEN === '' ? 'empty' : 'undefined'));
    res.headers.set('Access-Control-Allow-Origin', '*');
    res.headers.set('Access-Control-Expose-Headers', 'X-Proxied, X-GH-Auth, X-GH-Tok, X-RateLimit-Remaining, X-RateLimit-Limit, X-RateLimit-Reset');
    if (upstream.ok) context.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return res;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Proxied': '1' },
  });
}
