// Tiny in-memory rate limiter (no extra dependency). Good for one server process.
// For several servers behind a load balancer use a shared store instead.
function rateLimit({ windowMs, max, key }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, Math.min(windowMs, 60000));
  timer.unref();

  return (req, res, next) => {
    const k = key ? key(req) : req.ip;
    const now = Date.now();
    let h = hits.get(k);
    if (!h || h.resetAt <= now) {
      h = { count: 0, resetAt: now + windowMs };
      hits.set(k, h);
    }
    h.count++;
    if (h.count > max) {
      const retry = Math.ceil((h.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again.", code: "RATE_LIMITED", retryAfter: retry });
    }
    next();
  };
}

module.exports = rateLimit;
