const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { planIsPro } = require('./billing');
const { getMeetingWithParticipants, saveVerifications, getUserSettings, getUser, isMeetingUnlocked, countUserMonthlyExports, persistExport, markUserLargeClassGraceUsed, getExportReexportCount, getUserMeetingHistory, getDomainTeacherCount, logEvent, getDb } = require('../services/firestore');
const PRICING = require('../config/pricing');
const { buildReportModel, renderReportPdf, buildCertificateModels, renderCertificatesPdf, buildQuoteModel, renderQuotePdf } = require('../lib/certificate');
const { sendAdminEmail } = require('../lib/notifications');
const log = require('../lib/logger');

const router = Router();

// Slug a meeting title into a safe, readable filename stem.
function slugify(s) {
  return String(s || 'meeting').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'meeting';
}

// POST /api/export/pdf — generate an attendance PDF for a meeting.
//
// Two input paths (mirrors save-to-sheets):
//   • { conferenceId }            → regenerate from persisted attendance (history)
//   • { participants, meetingTitle, ... } → build from the live client payload
//
// The base Session Report is FREE (a real, shareable deliverable). Branding
// (org logo/name) is Pro — a free caller silently gets the default footer rather
// than a hard block, keeping with the gentle-upsell rule. Per-attendee
// certificates (type:'certificates') are a later stage.
router.post('/export/pdf', requireAuth, async (req, res) => {
  const b = req.body || {};
  const type = b.type || 'report';
  if (type !== 'report' && type !== 'certificates') {
    return res.status(400).json({ error: 'Unsupported type.', feature: type });
  }

  try {
    let meeting;
    let attendees;

    // Resolve user's timezone early with full fallback cascade
    let tz = b.timezone;
    if (!tz && req.user?.email) {
      try {
        const s = await getUserSettings(req.user.domain, req.user.email);
        tz = s?.timezone;
        if (!tz) {
          const u = await getUser(req.user.domain, req.user.email);
          tz = u?.timezone || u?.signupGeo?.timezone;
        }
      } catch {}
    }
    tz = tz || 'America/New_York';

    // Resolve user's locale with fallback cascade
    let locale = b.locale || req.user?.locale;
    if (!locale && req.headers?.['accept-language']) {
      locale = req.headers['accept-language'].split(',')[0].trim();
    }
    locale = locale || 'en';

    let calendarAttendees = [];
    if (b.conferenceId && !Array.isArray(b.participants)) {
      // History path — pull the persisted attendance for this meeting.
      const m = await getMeetingWithParticipants(req.user.domain, b.conferenceId, req.user.email);
      if (!m) return res.status(404).json({ error: 'Meeting not found.' });
      meeting = {
        title: m.title, conferenceId: m.conferenceId, startTime: m.startTime,
        endTime: m.endTime, host: req.user.displayName || null, timezone: tz, locale,
      };
      attendees = m.participants;
      calendarAttendees = Array.isArray(m.calendarAttendees) ? m.calendarAttendees : [];
    } else {
      // Live path — the panel hands us the same participant array it exports.
      attendees = Array.isArray(b.participants) ? b.participants : [];
      if (!attendees.length) return res.status(400).json({ error: 'participants array is required' });
      meeting = {
        title: b.meetingTitle, conferenceId: b.conferenceId || null,
        startTime: b.meetingStartTime || b.eventStart || null, endTime: b.eventEnd || null,
        exportedAt: b.exportedAt || null,
        host: req.user.displayName || null, timezone: tz, locale,
      };
      calendarAttendees = Array.isArray(b.calendarAttendees) ? b.calendarAttendees : [];
    }

    const meetingId = b.meetingId || b.meetingCode || b.conferenceId;
    const confId = meeting.conferenceId || meeting.meetingCode || meetingId;
    const pro = await planIsPro(req.user.domain, req.user.email);
    const unlocked = confId && typeof isMeetingUnlocked === 'function' ? await isMeetingUnlocked(req.user.domain, req.user.email, confId) : false;
    const allowed = pro || unlocked;
    // Length-cap the free-text options: they're drawn into a fixed PDF layout
    // (an uncapped issuer/brand string overruns the certificate frame).
    const capStr = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    const brand = allowed && b.brand && typeof b.brand === 'object' && capStr(b.brand.name, 80)
      ? { name: capStr(b.brand.name, 80) }
      : null;
    const issuer = capStr(b.issuer, 80);
    const courseCode = capStr(b.courseCode, 40);

    let pdf;
    let filename;
    if (type === 'certificates') {
      // Per-attendee certificates are a Pro feature (the credit-granting artifact).
      if (!allowed) {
        return res.status(402).json({ error: 'Attendance certificates are a Pro feature.', upgrade: true, feature: 'certificates' });
      }
      const models = buildCertificateModels({
        meeting, attendees,
        options: { brand, creditHours: b.creditHours, courseCode, issuer, locale, timezone: tz },
      });
      if (!models.length) return res.status(400).json({ error: 'No present attendees to certify.' });
      pdf = await renderCertificatesPdf(models);
      filename = `certificates-${slugify(meeting.title)}.pdf`;
      // Record each certificate so the public /verify page can confirm it later.
      // Best-effort (the helper swallows errors) and fire-and-forget so it never
      // slows the download.
      saveVerifications(models.map((m) => ({
        code: m.verificationCode, type: 'certificate', attendeeName: m.name, session: m.session,
        dateLabel: m.dateLabel, detailLabel: m.creditHoursLabel || m.durationLabel,
        issuer: m.issuer, domain: req.user.domain, conferenceId: meeting.conferenceId || null,
      })));
    } else {
      if (!allowed) {
        const finalConfId = confId || `${meeting.title || 'export'}_${new Date().toISOString().slice(0, 13)}`;
        const maxParticipants = PRICING.FREE_MAX_PARTICIPANTS_PER_EXPORT || 25;
        const attendedEmails = new Set((attendees || []).map(p => (p?.email || '').toLowerCase()).filter(Boolean));
        const uniqueNoShows = (calendarAttendees || []).filter(a => a && a.email && !attendedEmails.has(a.email.toLowerCase()));
        const totalAttendeeCount = attendees.length + uniqueNoShows.length;
        if (totalAttendeeCount > maxParticipants) {
          const userDoc = await getUser(req.user.domain, req.user.email);
          if (userDoc?.hasUsedLargeClassGrace === true) {
            return res.status(402).json({
              error: 'Free tier supports exporting up to 25 attendees per meeting. Upgrade to Pro for unlimited class sizes.',
              feature: 'largeClass',
              participantCount: totalAttendeeCount,
            });
          }
        }

        const limit = PRICING.FREE_MONTHLY_EXPORT_LIMIT || 2;
        const used = await countUserMonthlyExports(req.user.domain, req.user.email);
        if (used >= limit) {
          return res.status(402).json({
            error: 'Monthly export quota reached',
            feature: 'exportQuota',
            used,
            limit,
          });
        }

        const reexports = typeof getExportReexportCount === 'function'
          ? await getExportReexportCount(req.user.domain, req.user.email, finalConfId)
          : null;
        const maxReexports = Number(process.env.FREE_REEXPORTS_PER_MEETING) || PRICING.FREE_REEXPORTS_PER_MEETING || 2;
        if (reexports != null && reexports >= maxReexports) {
          return res.status(402).json({
            error: 'You have re-exported this meeting the maximum number of times on the free plan. Upgrade to Pro for unlimited exports.',
            feature: 'exportQuota',
            used,
            limit,
          });
        }

        if (totalAttendeeCount > maxParticipants) {
          await markUserLargeClassGraceUsed(req.user.domain, req.user.email);
        }

        await persistExport(req.user.domain, {
          domain: req.user.domain,
          email: req.user.email,
          meetingTitle: meeting.title || null,
          tabName: 'PDF Export',
          sheetUrl: null,
          conferenceId: finalConfId,
          participantCount: totalAttendeeCount,
          exportType: 'pdf',
          exportedAt: new Date().toISOString(),
        });
      }

      // Base report: branding is the only Pro lever (default footer otherwise).
      const model = buildReportModel({ meeting, attendees, options: { brand, locale, timezone: tz } });
      pdf = await renderReportPdf(model);
      filename = `attendance-${slugify(meeting.title)}.pdf`;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(pdf);
  } catch (err) {
    log.error('export/pdf failed', { email: req.user?.email, error: err.message });
    return res.status(500).json({ error: 'Could not generate the PDF.' });
  }
});

// POST /api/export/quote-pdf — generate a forwardable school/department quote PDF
// ("Ask my school to pay"), persist a quoteRequests record, and notify Derek.
router.post('/export/quote-pdf', requireAuth, async (req, res) => {
  const b = req.body || {};
  try {
    const email = req.user.email;
    const domain = req.user.domain || (email.includes('@') ? email.split('@')[1] : '');
    let classesTracked = Number(b.classesTracked) || 0;
    let totalStudents = Number(b.totalStudents) || 0;
    let domainTeachers = Number(b.domainTeachers) || 1;

    if (!classesTracked && typeof getUserMeetingHistory === 'function') {
      try {
        const hist = await getUserMeetingHistory(domain, email, { limit: 100 });
        classesTracked = Number(hist?.totalMeetings || hist?.meetings?.length || 0);
        if (!totalStudents && Array.isArray(hist?.people)) {
          totalStudents = hist.people.length;
        }
      } catch (_) {}
    }
    if (domainTeachers <= 1 && typeof getDomainTeacherCount === 'function') {
      try {
        const cnt = await getDomainTeacherCount(domain);
        if (cnt > 1) domainTeachers = cnt;
      } catch (_) {}
    }

    const cap = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    const schoolName = cap(b.schoolName, 120);
    const department = cap(b.department, 80);
    const recommendedPlan = cap(b.plan, 40);
    const notes = cap(b.notes, 500);

    const model = buildQuoteModel({
      teacherName: req.user.displayName || null,
      teacherEmail: email,
      domain,
      schoolName,
      department,
      recommendedPlan,
      usage: { classesTracked, totalStudents, domainTeachers },
    });
    const pdf = await renderQuotePdf(model);
    const filename = `quote-${slugify(model.schoolName || domain || 'school')}-${model.quoteNumber.toLowerCase()}.pdf`;

    try {
      if (typeof getDb === 'function') {
        const db = getDb();
        if (db && typeof db.collection === 'function') {
          await db.collection('quoteRequests').add({
            quoteNumber: model.quoteNumber,
            email,
            domain,
            displayName: req.user.displayName || null,
            schoolName: model.schoolName,
            department: model.department,
            recommendedPlan: model.recommendedPlan,
            usage: model.usage,
            notes,
            createdAt: new Date(),
          });
        }
      }
    } catch (_) {}

    try {
      if (typeof logEvent === 'function') {
        await logEvent(domain, {
          email,
          type: 'school_quote_generated',
          meta: {
            quoteNumber: model.quoteNumber,
            schoolName: model.schoolName,
            recommendedPlan: model.recommendedPlan,
            domainTeachers: model.usage.domainTeachers,
          },
        });
      }
    } catch (_) {}

    if (typeof sendAdminEmail === 'function') {
      Promise.resolve(sendAdminEmail({
        to: 'derek@attendancetracker.dev',
        subject: `📄 School Quote Generated (${model.quoteNumber}): ${email} (${domain})`,
        body: [
          `Teacher: ${req.user.displayName || email} <${email}>`,
          `Domain: ${domain} (${model.usage.domainTeachers} teacher(s) active)`,
          `School: ${model.schoolName}${model.department ? ` — ${model.department}` : ''}`,
          `Quote #: ${model.quoteNumber}`,
          `Recommended Plan: ${model.recommendedPlan}`,
          `Usage: ${model.usage.classesTracked} classes tracked, ${model.usage.totalStudents} students`,
          notes ? `Notes: ${notes}` : '',
        ].filter(Boolean).join('\n'),
      })).catch(() => {});
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(pdf);
  } catch (err) {
    log.error('export/quote-pdf failed', { email: req.user?.email, error: err.message });
    return res.status(500).json({ error: 'Could not generate the quote PDF.' });
  }
});

module.exports = router;

