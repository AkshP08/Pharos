interface Env {
  ASSETS: Fetcher
}

/**
 * Static-only host for the SignalBridge prototype. The health route is used by
 * DeepSpace's deploy check; every other request is served from the built site.
 * No demo backend, user data store, message sender, or call handler is exposed.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/auth/ok') {
      return new Response('ok', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    return env.ASSETS.fetch(request)
  },
}
