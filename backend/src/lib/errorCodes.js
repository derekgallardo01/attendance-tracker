// Stable, translatable codes for user-reachable API errors.
//
// Routes keep writing plain English `{ error: '…' }` (readable logs, tests);
// the errorCodes middleware attaches `code` (and `params` for templated
// messages) so the frontend can show `t('error.<CODE>')` in the user's
// language instead of the raw English message. Order matters: the first
// matching rule wins, so specific rules come before the generic catch-alls.

const RULES = [
  // ── Session / auth ──
  [/^(Authentication required|Not authenticated|Unauthorized)$/, 'AUTH_REQUIRED'],
  [/^(Session expired|Invalid token|Authentication failed|Your session has expired — please sign in again to export\.)$/, 'SESSION_EXPIRED'],
  [/^(Google session expired — please sign in again\.|Your Google session expired\. Please sign in again\.|Google access expired — please sign in again to export\.|Google Meet authorization required|Meet API permission required\. Please re-authorize\.)$/, 'GOOGLE_REAUTH'],
  [/^This account was deleted\.$/, 'ACCOUNT_DELETED'],
  [/^This session only supports meeting check-in\.$/, 'ATTENDEE_SESSION_ONLY'],
  [/^(Forbidden|You do not have access to this meeting)$/, 'FORBIDDEN'],
  [/^Account deletion did not fully complete\. Please try again\.$/, 'ACCOUNT_DELETION_INCOMPLETE'],

  // ── Google Meet ──
  [/^Your organization is not authorized to use this service\.$/, 'ORG_NOT_AUTHORIZED'],
  [/^No authentication available for Meet API\./, 'MEET_AUTH_UNAVAILABLE'],
  [/^This meeting has a lot of participants and Google is briefly rate-limiting/, 'MEET_RATE_LIMITED'],
  [/^Temporary connection issue with Google Meet API/, 'MEET_TEMPORARY'],
  [/^Google Drive permission is required to export/, 'DRIVE_PERMISSION'],

  // ── Plans, quota, paywall ──
  [/^You have reached your limit of (\d+) free exports this month/, 'EXPORT_QUOTA', (m) => ({ limit: Number(m[1]) })],
  [/^Monthly export quota reached/, 'EXPORT_QUOTA'],
  [/^You have re-exported this meeting the maximum number of times/, 'REEXPORT_LIMIT'],
  [/^Tracking attendance for large classes \(>(\d+) attendees\)/, 'LARGE_CLASS', (m) => ({ limit: Number(m[1]) })],
  [/^Free tier supports (?:exporting )?up to (\d+) attendees/, 'LARGE_CLASS', (m) => ({ limit: Number(m[1]) })],
  [/(a Pro feature\.|require Pro\.)$/, 'PRO_REQUIRED'],

  // ── Billing ──
  [/^Could not start checkout\.$/, 'CHECKOUT_FAILED'],
  [/^Could not send upgrade email right now\.$/, 'UPGRADE_EMAIL_FAILED'],
  [/^(Billing is not configured yet\.|Selected plan price is not configured\.|The educator plan is temporarily unavailable\.|Billing webhook not configured\.)$/, 'BILLING_UNAVAILABLE'],
  [/^Unknown plan\.$/, 'PLAN_UNKNOWN'],
  [/^That plan isn't available/, 'PLAN_NOT_AVAILABLE'],
  [/^Single-meeting pass must be purchased from within an active meeting session\.$/, 'SINGLE_MEETING_IN_MEETING_ONLY'],
  [/^A work email is required for the domain license/, 'DOMAIN_EMAIL_REQUIRED'],
  [/^The domain license covers a Google Workspace domain\./, 'DOMAIN_PLAN_PERSONAL_ACCOUNT'],
  [/^Only the domain team admin can manage institutional subscriptions\.$/, 'BILLING_TEAM_ADMIN_ONLY'],
  [/^(No active subscription\.|No active recurring subscription found to cancel\.|No subscription found to resume\.)$/, 'NO_SUBSCRIPTION'],
  [/^Could not open the billing portal\.$/, 'PORTAL_FAILED'],
  [/^Could not cancel subscription right now\./, 'CANCEL_FAILED'],
  [/^Could not resume subscription right now\.$/, 'RESUME_FAILED'],

  // ── Canvas / Classroom ──
  [/^(Invalid Canvas instance URL\.|canvasInstanceUrl must be a valid http or https URL\.)/, 'CANVAS_INVALID_URL'],
  [/^(Canvas instance URL and access token are required\.|Canvas credentials required\.)/, 'CANVAS_CREDENTIALS_REQUIRED'],
  [/^Canvas API token (is )?invalid or expired\.$/, 'CANVAS_TOKEN_INVALID'],
  [/^Canvas permissions insufficient/, 'CANVAS_FORBIDDEN'],
  [/^Could not connect to Canvas instance/, 'CANVAS_UNREACHABLE'],
  [/^(Canvas course not found\.|Canvas course or students not found\.|Course not found\.|Course or assignment not found in Classroom\.)$/, 'LMS_NOT_FOUND'],
  [/^(Canvas error|Failed to communicate with Canvas|Failed to create Canvas assignment|Failed to create assignment in Canvas|Failed to push grades to Canvas)/, 'CANVAS_ERROR'],
  [/^(Assignment name is required\.|Assignment title is required\.|assignmentId is required \(or provide title|courseWorkId is required \(or provide title)/, 'ASSIGNMENT_NAME_REQUIRED'],
  [/^No attendance records provided to sync\.$/, 'NO_RECORDS_TO_SYNC'],
  [/^classroom_scope_missing$/, 'CLASSROOM_SCOPE_MISSING'],
  [/^(Failed to list Classroom courses|Failed to list course students|Failed to list course assignments|Failed to create coursework assignment|Failed to sync grades to Google Classroom)/, 'CLASSROOM_ERROR'],

  // ── Sharing, check-in, verification, PDFs ──
  [/^You can only share a (meeting|recurring series) you tracked yourself\.$/, 'SHARE_NOT_OWNER'],
  [/^(Link not found, expired, or revoked|Series no longer available|Meeting no longer available)$/, 'SHARE_LINK_UNAVAILABLE'],
  [/^Invalid meeting code$/, 'INVALID_MEETING_CODE'],
  [/^You can only export attestation records for meetings you hosted\.$/, 'ATTESTATION_NOT_HOST'],
  [/^Invalid verification code format\.$/, 'VERIFY_CODE_INVALID'],
  [/^Could not generate the (quote )?PDF\.$/, 'PDF_FAILED'],
  [/^No present attendees to certify\.$/, 'NO_PRESENT_ATTENDEES'],

  // ── Settings / webhooks ──
  [/^No (.+) webhook URL provided or saved\.$/, 'WEBHOOK_MISSING', (m) => ({ provider: m[1] })],
  [/^Invalid (.+) webhook URL\.$/, 'WEBHOOK_INVALID', (m) => ({ provider: m[1] })],
  [/^(Slack|Google Chat|Discord) webhook URL must /, 'WEBHOOK_INVALID', (m) => ({ provider: m[1] })],
  [/^(.+) rejected the test ping\.$/, 'WEBHOOK_REJECTED', (m) => ({ provider: m[1] })],
  [/^timezone must be a valid IANA timezone/, 'TIMEZONE_INVALID'],
  [/^digestExtraEmails must be up to (\d+) valid email addresses/, 'EXTRA_EMAILS_INVALID', (m) => ({ limit: Number(m[1]) })],

  // ── Domain-wide delegation setup wizard (customer Workspace admins) ──
  [/^Domain-wide delegation is not configured correctly\./, 'DELEGATION_NOT_CONFIGURED'],
  [/^adminEmail must belong to the given domain$/, 'DELEGATION_EMAIL_DOMAIN'],
  [/^domain and adminEmail required$/, 'BAD_REQUEST'],

  // ── Team admin ──
  [/^Team admin is only available for Google Workspace domains/, 'TEAM_PERSONAL_ACCOUNT'],
  [/^This domain already has a team admin\./, 'TEAM_ADMIN_EXISTS'],
  [/^Your account was not found for this domain\.$/, 'TEAM_ACCOUNT_NOT_FOUND'],
  [/^Only the current team admin can transfer the role\.$/, 'TEAM_TRANSFER_NOT_ADMIN'],
  [/^That person has not signed in to Attendance Tracker on this domain yet\.$/, 'TEAM_TRANSFER_TARGET_UNKNOWN'],
  [/^Pick a different teammate to transfer the role to\.$/, 'TEAM_TRANSFER_SELF'],
  [/^Team admin role required$/, 'TEAM_ADMIN_REQUIRED'],

  // ── Generic buckets (keep last) ──
  [/^(A work email is required\.|Email required\.|A valid email address is required\.|Valid email is required\.)$/, 'EMAIL_REQUIRED'],
  [/^Too many /, 'RATE_LIMITED'],
  [/^Request body too large\.$/, 'REQUEST_TOO_LARGE'],
  [/^(Not found\.?|Meeting not found\.?|Series not found)$/, 'NOT_FOUND'],
  [/( is required\.?$|^Authorization code required$| must be |^provider must be one of|^Unsupported |^Invalid (event type|JSON|webhook signature)|^No supported settings)/, 'BAD_REQUEST'],
  [/^(Failed to |Could not |Something went wrong|Internal server error|Webhook handling failed|Check-in failed|Sign out failed|Authorization check failed|Verification lookup failed|Account deletion failed)/, 'SERVER_ERROR'],
];

// The code (and params) for an English error message, or null.
function errorCodeFor(message) {
  if (typeof message !== 'string') return null;
  for (const [re, code, params] of RULES) {
    const m = message.match(re);
    if (m) return params ? { code, params: params(m) } : { code };
  }
  return null;
}

// Express middleware: decorate `{ error }` JSON bodies with `code`/`params`.
// Bodies that already carry a code (e.g. AUTH_EXPIRED, CANVAS_*) are left alone.
function errorCodes(_req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && typeof body.error === 'string' && body.code == null) {
      const found = errorCodeFor(body.error);
      if (found) return json({ ...body, ...found });
    }
    return json(body);
  };
  next();
}

module.exports = { errorCodes, errorCodeFor, RULES };
