export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = { "/api/web": "https://mon.davidwang.space/api/web", "/mcp": "https://mcp.davidwang.space/mcp" }[url.pathname];
    if (!upstream) return env.ASSETS.fetch(request);
    const headers = new Headers();
    for (const key of ["accept", "authorization", "content-type", "mcp-session-id", "mcp-protocol-version"]) {
      if (request.headers.has(key)) headers.set(key, request.headers.get(key));
    }
    return fetch(upstream + url.search, { method: request.method, headers, body: request.body, redirect: "manual" });
  }
};
