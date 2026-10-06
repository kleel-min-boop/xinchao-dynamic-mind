// Persist an attempt on an already recorded dream before remote writing.
// No replay of pending/uncertain outcomes; no migration of historical dreams.
export async function archiveRecordedDream(dreamId, update, write, now = new Date()) {
  let claimed = false;
  let state = await update('dream_archive_pending', (latest) => {
    const dream = latest.recentDreams.find((item) => item.id === dreamId);
    if (!dream || dream.ombreBucketId || dream.ombreArchive) return latest;
    dream.ombreArchive = { status: 'pending', attemptedAt: now.toISOString() };
    claimed = true;
    return latest;
  });
  if (!claimed) return { state, reused: true };
  const dream = state.recentDreams.find((item) => item.id === dreamId);
  let bucketId;
  try {
    bucketId = await write(dream);
    if (!/^[a-f0-9]{12}$/.test(bucketId ?? '')) throw new Error('missing_verified_bucket_id');
  } catch {
    state = await update('dream_archive_uncertain', (latest) => {
      const item = latest.recentDreams.find((item) => item.id === dreamId);
      if (item) item.ombreArchive.status = 'uncertain';
      return latest;
    });
    return { state, status: 'uncertain', reused: false };
  }
  state = await update('dream_archive_completed', (latest) => {
    const item = latest.recentDreams.find((item) => item.id === dreamId);
    if (item) {
      item.ombreBucketId = bucketId;
      item.ombreArchive.status = 'completed';
    }
    return latest;
  });
  return { state, status: 'completed', reused: false };
}
