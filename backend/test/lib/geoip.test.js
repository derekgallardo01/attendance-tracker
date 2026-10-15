const {
  getClientIp,
  lookupGeo,
  resolveGeo,
  fetchLiveGeo,
  countryFromTimezone,
  countryFromDomain,
  isGenericUsPlaceholder,
  ipInfoUrl,
} = require('../../src/lib/geoip');

describe('geoip library', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('getClientIp', () => {
    test('extracts leftmost client IP from x-forwarded-for header', () => {
      const req = { headers: { 'x-forwarded-for': '148.101.32.70, 10.0.0.1, 169.254.1.1' } };
      expect(getClientIp(req)).toBe('148.101.32.70');
    });

    test('trims single IP in x-forwarded-for', () => {
      const req = { headers: { 'x-forwarded-for': ' 203.0.113.19 ' } };
      expect(getClientIp(req)).toBe('203.0.113.19');
    });

    test('falls back to req.socket.remoteAddress', () => {
      const req = { headers: {}, socket: { remoteAddress: '198.51.100.25' } };
      expect(getClientIp(req)).toBe('198.51.100.25');
    });

    test('falls back to req.connection.remoteAddress', () => {
      const req = { headers: {}, connection: { remoteAddress: '198.51.100.30' } };
      expect(getClientIp(req)).toBe('198.51.100.30');
    });

    test('returns null when no IP available', () => {
      expect(getClientIp({ headers: {} })).toBeNull();
    });
  });

  describe('lookupGeo', () => {
    test('returns null for empty or null IP', () => {
      expect(lookupGeo(null)).toBeNull();
      expect(lookupGeo('')).toBeNull();
    });

    test('looks up known IP and returns normalized structure', () => {
      // 8.8.8.8 is Google DNS in the US
      const res = lookupGeo('8.8.8.8');
      expect(res).toBeDefined();
      expect(res.country).toBe('US');
      expect(Array.isArray(res.ll)).toBe(true);
    });
  });

  describe('isGenericUsPlaceholder', () => {
    test('returns false for non-object or non-US geo', () => {
      expect(isGenericUsPlaceholder(null)).toBe(false);
      expect(isGenericUsPlaceholder({ country: 'PH' })).toBe(false);
      expect(isGenericUsPlaceholder({ country: 'MX', city: '' })).toBe(false);
    });

    test('returns false for genuine US with city and region', () => {
      expect(isGenericUsPlaceholder({ country: 'US', city: 'San Francisco', region: 'CA' })).toBe(false);
    });

    test('returns true for US with empty city and region', () => {
      expect(isGenericUsPlaceholder({ country: 'US', city: '', region: '' })).toBe(true);
      expect(isGenericUsPlaceholder({ country: 'US', city: null, region: null })).toBe(true);
    });

    test('returns true for US Kansas center coordinates [37.751, -97.822]', () => {
      expect(isGenericUsPlaceholder({ country: 'US', city: '', ll: [37.751, -97.822] })).toBe(true);
    });
  });

  describe('countryFromTimezone', () => {
    test('resolves key educator markets from IANA timezones', () => {
      expect(countryFromTimezone('Asia/Kolkata')).toBe('IN');
      expect(countryFromTimezone('Asia/Calcutta')).toBe('IN');
      expect(countryFromTimezone('America/Mexico_City')).toBe('MX');
      expect(countryFromTimezone('America/Chihuahua')).toBe('MX');
      expect(countryFromTimezone('Asia/Jakarta')).toBe('ID');
      expect(countryFromTimezone('Asia/Manila')).toBe('PH');
      expect(countryFromTimezone('Asia/Kuala_Lumpur')).toBe('MY');
      expect(countryFromTimezone('America/Sao_Paulo')).toBe('BR');
      expect(countryFromTimezone('America/Bogota')).toBe('CO');
      expect(countryFromTimezone('Africa/Lagos')).toBe('NG');
      expect(countryFromTimezone('Europe/Rome')).toBe('IT');
      expect(countryFromTimezone('Europe/Madrid')).toBe('ES');
      expect(countryFromTimezone('America/Santo_Domingo')).toBe('DO');
    });

    test('returns null for invalid or unmapped timezone', () => {
      expect(countryFromTimezone(null)).toBeNull();
      expect(countryFromTimezone('Invalid/Timezone')).toBeNull();
    });
  });

  describe('countryFromDomain', () => {
    test('extracts 2-letter country from educational email domain', () => {
      expect(countryFromDomain('teacher@school.edu.in')).toBe('IN');
      expect(countryFromDomain('juan.delara@cobachih.edu.mx')).toBe('MX');
      expect(countryFromDomain('anaheriyani@smk-informatika-srg.sch.id')).toBe('ID');
      expect(countryFromDomain('grecogiuseppe@istitutocapialbi.edu.it')).toBe('IT');
      expect(countryFromDomain('teacher@deped.gov.ph')).toBe('PH');
      expect(countryFromDomain('prof@escola.edu.br')).toBe('BR');
    });

    test('special case: .co is only CO when paired with educational/gov subdomain', () => {
      expect(countryFromDomain('user@universidad.edu.co')).toBe('CO');
      expect(countryFromDomain('user@startup.co')).toBeNull();
    });

    test('returns null for generic domains or missing values', () => {
      expect(countryFromDomain('teacher@gmail.com')).toBeNull();
      expect(countryFromDomain('user@school.org')).toBeNull();
      expect(countryFromDomain(null)).toBeNull();
    });
  });

  describe('fetchLiveGeo', () => {
    test('skips private and loopback addresses', async () => {
      expect(await fetchLiveGeo('127.0.0.1')).toBeNull();
      expect(await fetchLiveGeo('10.0.0.5')).toBeNull();
      expect(await fetchLiveGeo('192.168.1.100')).toBeNull();
      expect(await fetchLiveGeo('::1')).toBeNull();
    });

    test('parses live JSON response from ipinfo.io', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          country: 'IN',
          region: 'Tamil Nadu',
          city: 'Chennai',
          loc: '13.0878,80.2785',
          timezone: 'Asia/Kolkata',
          org: 'AS136336 Thamizhaga Telecom',
        }),
      });

      const res = await fetchLiveGeo('38.134.138.254');
      expect(res).toEqual({
        country: 'IN',
        region: 'Tamil Nadu',
        city: 'Chennai',
        ll: [13.0878, 80.2785],
        timezone: 'Asia/Kolkata',
        org: 'AS136336 Thamizhaga Telecom',
        source: 'live_ipinfo',
      });
    });

    test('returns null when fetch fails or times out', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
      expect(await fetchLiveGeo('38.134.138.254')).toBeNull();
    });
  });

  describe('resolveGeo', () => {
    test('returns confident non-US lookup immediately without live fetch', async () => {
      global.fetch = jest.fn();
      // 148.101.32.70 is Claro Dominicana (DO)
      const res = await resolveGeo('148.101.32.70');
      expect(res?.country).toBe('DO');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('enriches generic US placeholder via live fetch', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          country: 'IN',
          city: 'Chennai',
          region: 'Tamil Nadu',
          timezone: 'Asia/Kolkata',
        }),
      });

      // 38.134.138.254 is Cogent subnet routed to Chennai, India
      const res = await resolveGeo('38.134.138.254', { clientTz: 'Asia/Kolkata' });
      expect(res?.country).toBe('IN');
      expect(res?.city).toBe('Chennai');
      expect(res?.source).toBe('live_ipinfo');
    });

    test('falls back to client timezone when live fetch fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));
      const res = await resolveGeo('38.134.138.254', { clientTz: 'Asia/Kolkata' });
      expect(res?.country).toBe('IN');
      expect(res?.source).toBe('client_timezone');
    });

    test('falls back to school domain ccTLD when live fetch fails and no timezone', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Timeout'));
      const res = await resolveGeo('38.211.51.58', { domain: 'cobachih.edu.mx' });
      expect(res?.country).toBe('MX');
      expect(res?.source).toBe('domain_cctld');
    });
  });

  describe('ipInfoUrl', () => {
    test('generates valid ipinfo.io URL', () => {
      expect(ipInfoUrl('1.2.3.4')).toBe('https://ipinfo.io/1.2.3.4');
      expect(ipInfoUrl(null)).toBeNull();
    });
  });
});
