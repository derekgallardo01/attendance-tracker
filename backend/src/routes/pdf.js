const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { planIsPro } = require('./billing');
const { getMeetingWithParticipants } = require('../services/firestore');
const { buildReportModel, renderReportPdf, buildCertificateModels, renderCertificatesPdf } = require('../lib/certificate');
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

    if (b.conferenceId && !Array.isArray(b.participants)) {
      // History path — pull the persisted attendance for this meeting.
      const m = await getMeetingWithParticipants(req.user.domain, b.conferenceId);
      if (!m) return res.status(404).json({ error: 'Meeting not found.' });
      meeting = {
        title: m.title, conferenceId: m.conferenceId, startTime: m.startTime,
        endTime: m.endTime, host: req.user.displayName || null, timezone: b.timezone || null,
      };
      attendees = m.participants;
    } else {
      // Live path — the panel hands us the same participant array it exports.
      attendees = Array.isArray(b.participants) ? b.participants : [];
      if (!attendees.length) return res.status(400).json({ error: 'participants array is required' });
      meeting = {
        title: b.meetingTitle, conferenceId: b.conferenceId || null,
        startTime: b.meetingStartTime || b.eventStart || null, endTime: b.eventEnd || null,
        host: req.user.displayName || null, timezone: b.timezone || null,
      };
    }

    const pro = await planIsPro(req.user.domain, req.user.email);
    const brand = pro && b.brand && typeof b.brand === 'object' ? b.brand : null;

    let pdf;
    let filename;
    if (type === 'certificates') {
      // Per-attendee certificates are a Pro feature (the credit-granting artifact).
      if (!pro) {
        return res.status(402).json({ error: 'Attendance certificates are a Pro feature.', upgrade: true, feature: 'certificates' });
      }
      const models = buildCertificateModels({
        meeting, attendees,
        options: { brand, creditHours: b.creditHours, courseCode: b.courseCode, issuer: b.issuer },
      });
      if (!models.length) return res.status(400).json({ error: 'No present attendees to certify.' });
      pdf = await renderCertificatesPdf(models);
      filename = `certificates-${slugify(meeting.title)}.pdf`;
    } else {
      // Base report: free. Branding is the only Pro lever (default footer otherwise).
      const model = buildReportModel({ meeting, attendees, options: { brand } });
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

module.exports = router;
