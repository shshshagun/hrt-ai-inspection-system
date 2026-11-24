'use strict';
/**
 * Server copy of the "counts as a crack" rule (frontend/src/utils/crackVerdict.js). A detection counts when an engineer confirmed
 * it, or when it is unreviewed and its automatic verdict is "crack". Rejected detections never count.
 */
const REJECT_REASONS = ['shadow', 'stain', 'ring_joint', 'debris', 'texture', 'other'];
const REVIEW_STATUSES = ['pending', 'confirmed', 'rejected'];
const VIEWS = ['counted', 'not_rejected', 'pending', 'rejected', 'all'];

const UNREVIEWED = { $or: [{ review_status: { $exists: false } }, { review_status: null }, { review_status: 'pending' }] };

/** MongoDB query for each view of the detections list. */
function viewQuery(view) {
  switch (view) {
    case 'counted': return { $or: [{ review_status: 'confirmed' }, { $and: [UNREVIEWED, { auto_verdict: 'crack' }] }] };
    case 'not_rejected': return { review_status: { $ne: 'rejected' } };
    case 'pending': return { $and: [UNREVIEWED, { auto_verdict: { $ne: 'crack' } }] };
    case 'rejected': return { review_status: 'rejected' };
    default: return {};
  }
}

const reviewState = (d) => (d.review_status === 'confirmed' || d.review_status === 'rejected' ? d.review_status : 'pending');

function countsAsCrack(d) {
  const s = reviewState(d);
  if (s === 'rejected') return false;
  if (s === 'confirmed') return true;
  return d.auto_verdict === 'crack';
}

/** Combines a view with another filter object. */
function withView(filter, view) {
  const v = viewQuery(view);
  return Object.keys(v).length ? { $and: [filter, v] } : filter;
}

module.exports = { REJECT_REASONS, REVIEW_STATUSES, VIEWS, viewQuery, withView, countsAsCrack, reviewState };
