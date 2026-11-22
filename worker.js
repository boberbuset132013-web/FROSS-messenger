export default {
  async fetch(request, env) {
    if (!env.ASSETS) {
      return new Response("Static assets binding ASSETS is not configured.", { status: 503 });
    }
    return env.ASSETS.fetch(request);
  }
};
