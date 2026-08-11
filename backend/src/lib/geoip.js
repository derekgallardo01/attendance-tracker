// GeoIP lookup for signup IP → country. Uses geoip-lite (offline MaxMind DB).
// Extracts the real client IP from x-forwarded-for (Cloud Run / load balancer)
// and falls back to req.socket.remoteAddress.

const geoip = require('geoip-lite');

function getClientIp(req) {
  // Cloud Run and most load balancers set x-forwarded-for.
  // Format: "client, proxy1, proxy2" — the leftmost is the original client.
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || null;
}

function lookupGeo(ip) {
  if (!ip) return null;
  try {
    const geo = geoip.lookup(ip);
    if (!geo) return null;
    return {
      country: geo.country || null,
      region: geo.region || null,
      city: geo.city || null,
      ll: geo.ll || null,
    };
  } catch (err) {
    return null;
  }
}

function ipInfoUrl(ip) {
  if (!ip) return null;
  return `https://ipinfo.io/${encodeURIComponent(ip)}`;
}

module.exports = { getClientIp, lookupGeo, ipInfoUrl };
