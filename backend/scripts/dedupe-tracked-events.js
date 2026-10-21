// One-time cleanup script to deduplicate redundant poll-tick `tracked` event
// documents in `tenants/{domain}/events`.
//
// Historically, `persistAttendance` called `events.add({ type: 'tracked' })`
// whenever an in-memory debounce cache missed (every Cloud Run cold start,
// multi-instance poll, or 15-min auto-capture re-persist over a 48h window),
// inflating `tenants/{domain}/events` to ~321,000 documents (~308,000 of which
// are duplicate `tracked` events for the same user + meeting session).
//
// Usage:
//   node backend/scripts/dedupe-tracked-events.js --dry-run
//   node backend/scripts/dedupe-tracked-events.js --execute

process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'dedupe-script';
process.env.OAUTH_CLIENT_SECRET_NAME = process.env.OAUTH_CLIENT_SECRET_NAME || 'dedupe-script';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'dedupe-script-secret-32-chars-minimum';
process.env.SECRET_NAME = process.env.SECRET_NAME || 'dedupe-script';

const { getDb, tsMs } = require('../src/services/firestore/_core');

async function main() {
  const execute = process.argv.includes('--execute');
  const dryRun = !execute;
  const db = getDb();

  console.log(`Starting tracked-events deduplication (${dryRun ? 'DRY RUN' : 'EXECUTE MODE'})...`);

  // Collect all tenant domains from both explicit tenant docs and user subcollections
  const tenantRefs = await db.collection('tenants').listDocuments();
  const domains = new Set(tenantRefs.map(r => r.id));

  const usersSnap = await db.collectionGroup('users').select('domain').get();
  for (const d of usersSnap.docs) {
    const parentDomain = d.ref.parent?.parent?.id;
    if (parentDomain) domains.add(parentDomain);
  }

  console.log(`Found ${domains.size} tenant domains to inspect.`);

  let totalTrackedDocs = 0;
  let totalKeptGroups = 0;
  let totalDuplicatesToDelete = 0;
  let totalDeleted = 0;
  let totalKeptUpdated = 0;
  const perTenantStats = [];

  for (const domain of domains) {
    const eventsCol = db.collection('tenants').doc(domain).collection('events');
    const snap = await eventsCol.where('type', '==', 'tracked').get();
    if (snap.empty) continue;

    totalTrackedDocs += snap.size;

    // Group by (emailLower, sessionKey)
    // sessionKey uses conferenceId + optional instanceId, falling back to UTC date
    const groups = new Map();
    for (const doc of snap.docs) {
      const data = doc.data() || {};
      const email = String(data.email || 'unknown').toLowerCase().trim();
      const meta = data.meta || {};
      const cid = String(meta.conferenceId || meta.meetingCode || '').trim();
      const inst = String(meta.instanceId || meta.recordName || '').trim();
      const createdMs = tsMs(data.createdAt) || 0;
      const dayKey = createdMs > 0 ? new Date(createdMs).toISOString().slice(0, 10) : 'nodate';
      const sessionKey = cid
        ? (inst ? `${cid}__${inst}` : `${cid}__${dayKey}`)
        : `nocid__${dayKey}`;
      const key = `${email}::${sessionKey}`;

      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push({
        ref: doc.ref,
        id: doc.id,
        createdMs,
        participantCount: Number(meta.participantCount) || 0,
        distinctAttendees: meta.distinctAttendees != null ? Number(meta.distinctAttendees) : null,
        meta,
      });
    }

    const toDeleteRefs = [];
    const toUpdateKept = [];

    for (const [, list] of groups.entries()) {
      totalKeptGroups++;
      if (list.length <= 1) continue;

      // Sort ascending by createdMs so we keep the earliest event in the session
      list.sort((a, b) => (a.createdMs || Number.MAX_SAFE_INTEGER) - (b.createdMs || Number.MAX_SAFE_INTEGER));
      const kept = list[0];
      let maxParticipants = kept.participantCount;
      let maxDistinct = kept.distinctAttendees ?? kept.participantCount;

      for (let i = 1; i < list.length; i++) {
        const dup = list[i];
        if (dup.participantCount > maxParticipants) maxParticipants = dup.participantCount;
        const dupDistinct = dup.distinctAttendees ?? dup.participantCount;
        if (dupDistinct > maxDistinct) maxDistinct = dupDistinct;
        toDeleteRefs.push(dup.ref);
      }

      if (maxParticipants > kept.participantCount || (kept.distinctAttendees == null || maxDistinct > kept.distinctAttendees)) {
        toUpdateKept.push({
          ref: kept.ref,
          meta: {
            ...kept.meta,
            participantCount: maxParticipants,
            distinctAttendees: maxDistinct,
          },
        });
      }
    }

    if (toDeleteRefs.length > 0) {
      totalDuplicatesToDelete += toDeleteRefs.length;
      perTenantStats.push({
        domain,
        totalTracked: snap.size,
        kept: groups.size,
        duplicates: toDeleteRefs.length,
      });

      if (execute) {
        const CHUNK = 450;
        for (let i = 0; i < toUpdateKept.length; i += CHUNK) {
          const batch = db.batch();
          for (const item of toUpdateKept.slice(i, i + CHUNK)) {
            batch.set(item.ref, { meta: item.meta }, { merge: true });
          }
          await batch.commit();
          totalKeptUpdated += Math.min(CHUNK, toUpdateKept.length - i);
        }

        for (let i = 0; i < toDeleteRefs.length; i += CHUNK) {
          const batch = db.batch();
          for (const ref of toDeleteRefs.slice(i, i + CHUNK)) {
            batch.delete(ref);
          }
          await batch.commit();
          totalDeleted += Math.min(CHUNK, toDeleteRefs.length - i);
          if ((i + CHUNK) % 4500 === 0 || (i + CHUNK) >= toDeleteRefs.length) {
            console.log(`  [${domain}] Deleted ${Math.min(i + CHUNK, toDeleteRefs.length)} / ${toDeleteRefs.length} duplicate tracked events...`);
          }
        }
      }
    }
  }

  perTenantStats.sort((a, b) => b.duplicates - a.duplicates);
  console.log('\nTop tenants by duplicate tracked events:');
  for (const row of perTenantStats.slice(0, 15)) {
    console.log(`  - ${row.domain}: ${row.totalTracked} tracked docs -> keep ${row.kept}, delete ${row.duplicates}`);
  }

  console.log('\nSummary:');
  console.log(`  Mode:                  ${dryRun ? 'DRY RUN (no changes written)' : 'EXECUTE'}`);
  console.log(`  Total tracked docs:    ${totalTrackedDocs}`);
  console.log(`  Unique sessions kept:  ${totalKeptGroups}`);
  console.log(`  Duplicates identified: ${totalDuplicatesToDelete}`);
  if (execute) {
    console.log(`  Kept docs enriched:    ${totalKeptUpdated}`);
    console.log(`  Duplicates deleted:    ${totalDeleted}`);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('dedupe-tracked-events failed:', err);
    process.exit(1);
  });
}

module.exports = { main };
