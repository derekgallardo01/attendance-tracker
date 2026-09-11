// Team signpost — the institutional wedge. When several teachers from the SAME
// workspace domain already use the product on the free plan, the domain admin is
// the real buyer (a department/institution plan), not each teacher individually.
// This builds the gated payload that lets the product quietly say "your school is
// already here — put the domain on a plan". Kept in one place so every surface
// that shows it (history page AND the in-Meet panel via /oauth/me) stays
// consistent: same threshold, same eligibility, same dismissal.
//
// Returns null unless GENUINELY eligible:
//   • workspace domain (never a shared personal tenant — the count is meaningless)
//   • not already on a domain Pro plan
//   • the user hasn't dismissed it (once dismissed, gone for good)
//   • at least TEAM_SIGNPOST_MIN distinct teachers on the domain (a cluster, not
//     a coincidence)
const log = require('./logger');
const { PERSONAL_EMAIL_DOMAINS } = require('../services/firestore/_core');
const { getUser, getTenantPlan, getTenantConfig, getDomainTeacherCount } = require('../services/firestore');

const TEAM_SIGNPOST_MIN = 3; // a cluster, not a coincidence

async function buildTeamSignpost(domain, email) {
  try {
    const domainLower = (domain || '').toLowerCase();
    if (PERSONAL_EMAIL_DOMAINS.has(domainLower)) return null; // shared tenant — count is meaningless
    const [user, tenantPlan, count] = await Promise.all([
      getUser(domain, email),
      getTenantPlan(domain).catch(() => ({ plan: 'free' })),
      getDomainTeacherCount(domain),
    ]);
    if (user?.teamSignpostDismissedAt) return null;   // dismissed → gone for good
    if (tenantPlan?.plan === 'pro') return null;       // domain already on the plan
    if (count < TEAM_SIGNPOST_MIN) return null;        // not a cluster yet
    // teamAdmin flag drives the "your school / set up" phrasing vs "N teachers / see".
    let isTeamAdmin = false;
    try {
      const cfg = await getTenantConfig(domain);
      isTeamAdmin = (cfg?.adminEmail || '').toLowerCase() === email.toLowerCase();
    } catch { /* default: non-admin phrasing */ }
    return { domain: domainLower, teacherCount: count, isTeamAdmin };
  } catch (err) {
    log.warn('teamSignpost: build failed', { domain, error: err.message });
    return null;
  }
}

module.exports = { buildTeamSignpost, TEAM_SIGNPOST_MIN };
