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
const firestore = require('../services/firestore');

const TEAM_SIGNPOST_MIN = 2; // a cluster, not a coincidence

async function buildTeamSignpost(domain, email) {
  try {
    const domainLower = (domain || '').toLowerCase();
    if (PERSONAL_EMAIL_DOMAINS.has(domainLower)) return null; // shared tenant — count is meaningless
    const [user, tenantPlan, count] = await Promise.all([
      firestore.getUser(domain, email),
      firestore.getTenantPlan(domain).catch(() => ({ plan: 'free' })),
      firestore.getDomainTeacherCount(domain),
    ]);
    if (user?.teamSignpostDismissedAt) return null;   // dismissed → gone for good
    if (tenantPlan?.plan === 'pro') return null;       // domain already on the plan
    if (count < TEAM_SIGNPOST_MIN) return null;        // not a cluster yet
    // teamAdmin flag drives the "your school / set up" phrasing vs "N teachers / see".
    let isTeamAdmin = false;
    try {
      const cfg = await firestore.getTenantConfig(domain);
      isTeamAdmin = (cfg?.adminEmail || '').toLowerCase() === email.toLowerCase();
    } catch { /* default: non-admin phrasing */ }

    let payingColleagues = 0;
    let largeClassCount = 0;
    if (typeof firestore.getDomainClusterStats === 'function') {
      try {
        const stats = await firestore.getDomainClusterStats(domain);
        payingColleagues = Number(stats?.payingColleagues) || 0;
        largeClassCount = Number(stats?.largeClassCount) || 0;
      } catch { /* fallback to 0 */ }
    }

    const recommendedPlan = count >= 50 ? 'quote' : (count >= 10 ? 'institution' : 'department');
    return {
      domain: domainLower,
      teacherCount: count,
      isTeamAdmin,
      payingColleagues,
      largeClassCount,
      recommendedPlan,
    };
  } catch (err) {
    log.warn('teamSignpost: build failed', { domain, error: err.message });
    return null;
  }
}

module.exports = { buildTeamSignpost, TEAM_SIGNPOST_MIN };

