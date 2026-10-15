// GeoIP lookup for signup IP → country. Uses geoip-lite (offline MaxMind DB)
// with live enrichment and client timezone/domain fallbacks for multinational
// carriers (e.g. Cogent 38.x.x.x, Starlink) that default to generic US centroids.
// Extracts the real client IP from x-forwarded-for (Cloud Run / load balancer)
// and falls back to req.socket.remoteAddress.

const geoip = require('geoip-lite');

const TIMEZONE_TO_COUNTRY = {
  // India
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',

  // Philippines
  'Asia/Manila': 'PH',

  // Indonesia
  'Asia/Jakarta': 'ID',
  'Asia/Pontianak': 'ID',
  'Asia/Makassar': 'ID',
  'Asia/Jayapura': 'ID',

  // Malaysia
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Kuching': 'MY',

  // Mexico
  'America/Mexico_City': 'MX',
  'America/Cancun': 'MX',
  'America/Merida': 'MX',
  'America/Monterrey': 'MX',
  'America/Mazatlan': 'MX',
  'America/Chihuahua': 'MX',
  'America/Hermosillo': 'MX',
  'America/Tijuana': 'MX',
  'America/Matamoros': 'MX',
  'America/Ojinaga': 'MX',
  'America/Bahia_Banderas': 'MX',

  // Brazil
  'America/Sao_Paulo': 'BR',
  'America/Fortaleza': 'BR',
  'America/Belem': 'BR',
  'America/Manaus': 'BR',
  'America/Cuiaba': 'BR',
  'America/Rio_Branco': 'BR',
  'America/Bahia': 'BR',
  'America/Recife': 'BR',
  'America/Campo_Grande': 'BR',
  'America/Maceio': 'BR',
  'America/Porto_Velho': 'BR',
  'America/Boa_Vista': 'BR',
  'America/Araguaina': 'BR',
  'America/Santarem': 'BR',
  'America/Noronha': 'BR',

  // Colombia
  'America/Bogota': 'CO',

  // Peru
  'America/Lima': 'PE',

  // Chile
  'America/Santiago': 'CL',
  'America/Punta_Arenas': 'CL',

  // Argentina
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Argentina/Cordoba': 'AR',
  'America/Argentina/Mendoza': 'AR',
  'America/Argentina/Salta': 'AR',
  'America/Argentina/Tucuman': 'AR',
  'America/Argentina/Ushuaia': 'AR',
  'America/Buenos_Aires': 'AR',

  // Ecuador
  'America/Guayaquil': 'EC',
  'America/Galapagos': 'EC',

  // Venezuela
  'America/Caracas': 'VE',

  // Uruguay / Paraguay / Bolivia
  'America/Montevideo': 'UY',
  'America/Asuncion': 'PY',
  'America/La_Paz': 'BO',

  // Central America & Caribbean
  'America/Guatemala': 'GT',
  'America/Tegucigalpa': 'HN',
  'America/El_Salvador': 'SV',
  'America/Managua': 'NI',
  'America/Costa_Rica': 'CR',
  'America/Panama': 'PA',
  'America/Santo_Domingo': 'DO',
  'America/Puerto_Rico': 'PR',
  'America/Jamaica': 'JM',
  'America/Port-au-Prince': 'HT',
  'America/Havana': 'CU',

  // Africa
  'Africa/Lagos': 'NG',
  'Africa/Cairo': 'EG',
  'Africa/Nairobi': 'KE',
  'Africa/Johannesburg': 'ZA',
  'Africa/Accra': 'GH',
  'Africa/Casablanca': 'MA',
  'Africa/Addis_Ababa': 'ET',
  'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ',
  'Africa/Tunis': 'TN',
  'Africa/Algiers': 'DZ',
  'Africa/Lusaka': 'ZM',
  'Africa/Harare': 'ZW',
  'Africa/Kigali': 'RW',

  // Europe
  'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/London': 'GB',
  'Europe/Athens': 'GR',
  'Europe/Warsaw': 'PL',
  'Europe/Bucharest': 'RO',
  'Europe/Lisbon': 'PT',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Helsinki': 'FI',
  'Europe/Copenhagen': 'DK',
  'Europe/Dublin': 'IE',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Kyiv': 'UA',
  'Europe/Kiev': 'UA',
  'Europe/Istanbul': 'TR',

  // Asia / Middle East
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Colombo': 'LK',
  'Asia/Kathmandu': 'NP',
  'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Saigon': 'VN',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Taipei': 'TW',
  'Asia/Singapore': 'SG',
  'Asia/Hong_Kong': 'HK',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Qatar': 'QA',
  'Asia/Kuwait': 'KW',
  'Asia/Bahrain': 'BH',
  'Asia/Muscat': 'OM',
  'Asia/Amman': 'JO',
  'Asia/Beirut': 'LB',
  'Asia/Jerusalem': 'IL',
  'Asia/Almaty': 'KZ',
  'Asia/Tashkent': 'UZ',

  // Oceania
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',

  // Canada
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Montreal': 'CA',
  'America/Edmonton': 'CA',
  'America/Calgary': 'CA',
  'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',

  // US
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Anchorage': 'US',
  'Pacific/Honolulu': 'US',
  'America/Detroit': 'US',
  'America/Indiana/Indianapolis': 'US',
  'America/Boise': 'US',
};

const CCTLD_TO_COUNTRY = {
  in: 'IN',
  ph: 'PH',
  id: 'ID',
  my: 'MY',
  mx: 'MX',
  br: 'BR',
  ng: 'NG',
  it: 'IT',
  es: 'ES',
  pe: 'PE',
  ar: 'AR',
  cl: 'CL',
  eg: 'EG',
  pk: 'PK',
  bd: 'BD',
  vn: 'VN',
  th: 'TH',
  tr: 'TR',
  za: 'ZA',
  do: 'DO',
  ec: 'EC',
  ve: 'VE',
  uy: 'UY',
  py: 'PY',
  bo: 'BO',
  gt: 'GT',
  hn: 'HN',
  sv: 'SV',
  ni: 'NI',
  cr: 'CR',
  pa: 'PA',
  uk: 'GB',
  ca: 'CA',
  au: 'AU',
  nz: 'NZ',
  de: 'DE',
  fr: 'FR',
  pl: 'PL',
  ro: 'RO',
  nl: 'NL',
  jp: 'JP',
  kr: 'KR',
  tw: 'TW',
  sg: 'SG',
  ua: 'UA',
};

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
      timezone: geo.timezone || null,
    };
  } catch (err) {
    return null;
  }
}

function isGenericUsPlaceholder(geo) {
  if (!geo || typeof geo !== 'object') return false;
  if (geo.country !== 'US') return false;
  const hasCity = typeof geo.city === 'string' && geo.city.trim().length > 0;
  const hasRegion = typeof geo.region === 'string' && geo.region.trim().length > 0;
  if (!hasCity && !hasRegion) return true;

  // MaxMind default coordinates for generic US center: [37.751, -97.822]
  if (Array.isArray(geo.ll) && geo.ll.length >= 2) {
    const latDiff = Math.abs(geo.ll[0] - 37.751);
    const lonDiff = Math.abs(geo.ll[1] - -97.822);
    if (latDiff < 0.05 && lonDiff < 0.05 && !hasCity) return true;
  }
  return false;
}

function countryFromTimezone(timezone) {
  if (!timezone || typeof timezone !== 'string') return null;
  return TIMEZONE_TO_COUNTRY[timezone.trim()] || null;
}

function countryFromDomain(domainOrEmail) {
  if (!domainOrEmail || typeof domainOrEmail !== 'string') return null;
  const str = domainOrEmail.trim().toLowerCase();
  const domain = str.includes('@') ? str.split('@')[1] : str;
  const parts = domain.split('.').filter(Boolean);
  if (parts.length < 2) return null;

  const tld = parts[parts.length - 1];
  // Colombia uses .co, but .co is also a common commercial domain. Only treat as CO if educational/gov/com subdomains.
  if (tld === 'co') {
    const sld = parts[parts.length - 2];
    if (['edu', 'gov', 'org', 'mil', 'com', 'net'].includes(sld)) {
      return 'CO';
    }
    return null;
  }

  return CCTLD_TO_COUNTRY[tld] || null;
}

async function fetchLiveGeo(ip, timeoutMs = 2000) {
  if (!ip || typeof ip !== 'string') return null;
  const cleanIp = ip.trim();
  if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('10.') || cleanIp.startsWith('192.168.') || cleanIp.startsWith('172.16.')) {
    return null;
  }
  try {
    const url = `https://ipinfo.io/${encodeURIComponent(cleanIp)}/json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.country !== 'string' || data.country.trim().length !== 2) return null;

    let ll = null;
    if (typeof data.loc === 'string' && data.loc.includes(',')) {
      const parts = data.loc.split(',').map(Number);
      if (!isNaN(parts[0]) && !isNaN(parts[1])) {
        ll = parts;
      }
    }

    return {
      country: data.country.trim().toUpperCase(),
      region: data.region || null,
      city: data.city || null,
      ll,
      timezone: data.timezone || null,
      org: data.org || null,
      source: 'live_ipinfo',
    };
  } catch (_) {
    return null;
  }
}

async function resolveGeo(ip, hints = {}) {
  const syncGeo = lookupGeo(ip);
  const clientTz = hints.clientTz || hints.timezone;
  const tzCountry = countryFromTimezone(clientTz);
  const domainCountry = countryFromDomain(hints.domain || hints.email);

  const isPlaceholder = !syncGeo || isGenericUsPlaceholder(syncGeo);
  const hasConflict = syncGeo?.country === 'US' && (
    (tzCountry && tzCountry !== 'US') ||
    (domainCountry && domainCountry !== 'US')
  );

  // If sync lookup gave a confident non-placeholder result and does not contradict client signals, return immediately
  if (syncGeo && !isPlaceholder && !hasConflict) {
    return syncGeo;
  }

  // Live lookup fallback for placeholder / conflict / unmapped IPs
  if (ip) {
    const live = await fetchLiveGeo(ip, hints.timeoutMs || 2000);
    if (live && live.country) {
      return live;
    }
  }

  // Graceful fallback to client timezone
  if (tzCountry) {
    return {
      country: tzCountry,
      region: syncGeo?.region || null,
      city: syncGeo?.city || null,
      ll: syncGeo?.ll || null,
      timezone: clientTz,
      source: 'client_timezone',
    };
  }

  // Fallback to domain ccTLD
  if (domainCountry) {
    return {
      country: domainCountry,
      region: null,
      city: null,
      ll: null,
      timezone: syncGeo?.timezone || null,
      source: 'domain_cctld',
    };
  }

  return syncGeo;
}

function ipInfoUrl(ip) {
  if (!ip) return null;
  return `https://ipinfo.io/${encodeURIComponent(ip)}`;
}

module.exports = {
  getClientIp,
  lookupGeo,
  resolveGeo,
  fetchLiveGeo,
  countryFromTimezone,
  countryFromDomain,
  isGenericUsPlaceholder,
  ipInfoUrl,
};
