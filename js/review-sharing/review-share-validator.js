// review-share-validator.js - Shared Review Package validator
import { normalizeTag } from './review-share-model.js';

// Constants for Validation Limits (DoS prevention, CPU/memory load mitigation, and input size constraints)
export const LIMITS = {
  MAX_ITEMS: 1000,
  MAX_TAGS_PER_REVIEW: 100,
  MAX_TIMELINE_COMMENTS_PER_REVIEW: 500,
  MAX_STRING_LENGTH: 10000,
  MAX_TAG_LENGTH: 100,
  MAX_NAME_LENGTH: 200
};

// Prototype Pollution keys to ban
const BANNED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Checks for Prototype Pollution keys in any object.
 * @param {*} val
 * @returns {boolean} True if clean, false if prototype pollution key is detected.
 */
function isSafeFromPrototypePollution(val) {
  if (val === null || typeof val !== 'object') return true;
  for (const key of Object.keys(val)) {
    if (BANNED_KEYS.has(key)) return false;
    if (!isSafeFromPrototypePollution(val[key])) return false;
  }
  return true;
}

/**
 * Validates a shared review JSON package against schema, safety, and business rules.
 * @param {Object} data - The parsed JSON data.
 * @returns {Object} { isValid: boolean, errors: Array<string> }
 */
export function validateSharedReviewPackage(data) {
  const errors = [];

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    errors.push('Root must be a JSON object');
    return { isValid: false, errors };
  }

  // 1. Prototype Pollution check
  if (!isSafeFromPrototypePollution(data)) {
    errors.push('Prototype pollution vector detected (banned keys: __proto__, constructor, prototype)');
    return { isValid: false, errors };
  }

  // 2. Top-level property checks (strict allowed keys)
  const allowedTopLevel = new Set(['schema', 'version', 'packageId', 'exportedAt', 'exporter', 'items']);
  for (const key of Object.keys(data)) {
    if (!allowedTopLevel.has(key)) {
      errors.push(`Unknown top-level property: "${key}"`);
    }
  }

  // Mandatory fields
  if (data.schema === undefined) errors.push('Missing top-level property: "schema"');
  else if (data.schema !== 'video-review-share') errors.push(`Invalid schema: "${data.schema}" (expected "video-review-share")`);

  if (data.version === undefined) errors.push('Missing top-level property: "version"');
  else if (data.version !== 1) errors.push(`Invalid version: ${data.version} (expected 1)`);

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (data.packageId === undefined) errors.push('Missing top-level property: "packageId"');
  else if (typeof data.packageId !== 'string' || !uuidPattern.test(data.packageId)) {
    errors.push(`Invalid packageId format: "${data.packageId}" (expected lowercase UUIDv4 format)`);
  }

  if (data.exportedAt === undefined) errors.push('Missing top-level property: "exportedAt"');
  else if (typeof data.exportedAt !== 'string' || isNaN(Date.parse(data.exportedAt))) {
    errors.push(`Invalid exportedAt date-time: "${data.exportedAt}"`);
  }

  // Exporter check
  if (data.exporter === undefined) {
    errors.push('Missing top-level property: "exporter"');
  } else {
    validateExporter(data.exporter, errors);
  }

  // Items check
  if (data.items === undefined) {
    errors.push('Missing top-level property: "items"');
  } else if (!Array.isArray(data.items)) {
    errors.push('Property "items" must be an array');
  } else {
    validateItems(data.items, errors);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

function validateExporter(exporter, errors) {
  if (exporter === null || typeof exporter !== 'object' || Array.isArray(exporter)) {
    errors.push('Property "exporter" must be a JSON object');
    return;
  }

  const allowedExporter = new Set(['reviewerId', 'displayName']);
  for (const key of Object.keys(exporter)) {
    if (!allowedExporter.has(key)) {
      errors.push(`Unknown exporter property: "${key}"`);
    }
  }

  const reviewerIdPattern = /^reviewer-[a-zA-Z0-9-]{8,64}$/;
  if (exporter.reviewerId === undefined) {
    errors.push('Missing exporter property: "reviewerId"');
  } else if (typeof exporter.reviewerId !== 'string' || !reviewerIdPattern.test(exporter.reviewerId)) {
    errors.push(`Invalid exporter.reviewerId format: "${exporter.reviewerId}"`);
  }

  if (exporter.displayName === undefined) {
    errors.push('Missing exporter property: "displayName"');
  } else if (typeof exporter.displayName !== 'string' || exporter.displayName.trim() === '') {
    errors.push('exporter.displayName must be a non-empty string');
  } else if (exporter.displayName.length > LIMITS.MAX_NAME_LENGTH) {
    errors.push(`exporter.displayName exceeds maximum length of ${LIMITS.MAX_NAME_LENGTH} chars`);
  }
}

function validateItems(items, errors) {
  if (items.length > LIMITS.MAX_ITEMS) {
    errors.push(`Package items count (${items.length}) exceeds maximum limit of ${LIMITS.MAX_ITEMS}`);
    return;
  }

  const hashPattern = /^[0-9a-f]{64}$/;
  const seenHashes = new Set();
  const seenReviewIdentities = new Set(); // reviewId + reviewerId
  const seenCommentIdentities = new Set();

  items.forEach((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`items[${index}] must be a JSON object`);
      return;
    }

    const allowedItem = new Set(['videoHash', 'review']);
    for (const key of Object.keys(item)) {
      if (!allowedItem.has(key)) {
        errors.push(`Unknown property in items[${index}]: "${key}"`);
      }
    }

    if (item.videoHash === undefined) {
      errors.push(`Missing videoHash in items[${index}]`);
    } else if (typeof item.videoHash !== 'string' || !hashPattern.test(item.videoHash)) {
      errors.push(`Invalid videoHash format in items[${index}]: "${item.videoHash}" (expected 64 lowercase hex chars)`);
    } else {
      if (seenHashes.has(item.videoHash)) {
        errors.push(`Duplicate videoHash detected in package: "${item.videoHash}"`);
      }
      seenHashes.add(item.videoHash);
    }

    if (item.review === undefined) {
      errors.push(`Missing review in items[${index}]`);
    } else {
      validateReview(item.review, index, errors, seenReviewIdentities, seenCommentIdentities);
    }
  });
}

function validateReview(review, index, errors, seenReviewIdentities, seenCommentIdentities) {
  if (review === null || typeof review !== 'object' || Array.isArray(review)) {
    errors.push(`items[${index}].review must be a JSON object`);
    return;
  }

  const allowedReview = new Set(['reviewId', 'reviewerId', 'overallRating', 'tags', 'timelineComments']);
  for (const key of Object.keys(review)) {
    if (!allowedReview.has(key)) {
      errors.push(`Unknown property in items[${index}].review: "${key}"`);
    }
  }

  const reviewIdPattern = /^rev-[a-zA-Z0-9-]{8,64}$/;
  const reviewerIdPattern = /^reviewer-[a-zA-Z0-9-]{8,64}$/;

  if (review.reviewId === undefined) {
    errors.push(`Missing reviewId in items[${index}].review`);
  } else if (typeof review.reviewId !== 'string' || !reviewIdPattern.test(review.reviewId)) {
    errors.push(`Invalid reviewId format in items[${index}].review: "${review.reviewId}"`);
  }

  if (review.reviewerId === undefined) {
    errors.push(`Missing reviewerId in items[${index}].review`);
  } else if (typeof review.reviewerId !== 'string' || !reviewerIdPattern.test(review.reviewerId)) {
    errors.push(`Invalid reviewerId format in items[${index}].review: "${review.reviewerId}"`);
  }

  // Duplicate Review Identity Check
  if (typeof review.reviewId === 'string' && typeof review.reviewerId === 'string') {
    const identity = `${review.reviewId}::${review.reviewerId}`;
    if (seenReviewIdentities.has(identity)) {
      errors.push(`Duplicate review identity detected: reviewId="${review.reviewId}", reviewerId="${review.reviewerId}"`);
    }
    seenReviewIdentities.add(identity);
  }

  if (review.overallRating === undefined) {
    errors.push(`Missing overallRating in items[${index}].review`);
  } else if (review.overallRating !== null) {
    const r = review.overallRating;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) {
      errors.push(`Invalid overallRating in items[${index}].review: ${r} (must be null or integer 1-5)`);
    }
  }

  // Tags checks
  if (review.tags === undefined) {
    errors.push(`Missing tags in items[${index}].review`);
  } else if (!Array.isArray(review.tags)) {
    errors.push(`tags in items[${index}].review must be an array`);
  } else {
    validateTags(review.tags, index, errors);
  }

  // Timeline comments checks
  if (review.timelineComments === undefined) {
    errors.push(`Missing timelineComments in items[${index}].review`);
  } else if (!Array.isArray(review.timelineComments)) {
    errors.push(`timelineComments in items[${index}].review must be an array`);
  } else {
    const revId = typeof review.reviewId === 'string' ? review.reviewId : '';
    const rvrId = typeof review.reviewerId === 'string' ? review.reviewerId : '';
    validateTimelineComments(review.timelineComments, index, errors, seenCommentIdentities, rvrId, revId);
  }
}

function validateTags(tags, itemIndex, errors) {
  if (tags.length > LIMITS.MAX_TAGS_PER_REVIEW) {
    errors.push(`tags count (${tags.length}) in items[${itemIndex}].review exceeds maximum limit of ${LIMITS.MAX_TAGS_PER_REVIEW}`);
    return;
  }

  const seenTagsInReview = new Set();

  tags.forEach((tagObj, tagIndex) => {
    if (tagObj === null || typeof tagObj !== 'object' || Array.isArray(tagObj)) {
      errors.push(`tags[${tagIndex}] in items[${itemIndex}].review must be a JSON object`);
      return;
    }

    const allowedTag = new Set(['tag']);
    for (const key of Object.keys(tagObj)) {
      if (!allowedTag.has(key)) {
        errors.push(`Unknown property in tags[${tagIndex}] in items[${itemIndex}].review: "${key}"`);
      }
    }

    if (tagObj.tag === undefined) {
      errors.push(`Missing property "tag" in tags[${tagIndex}] in items[${itemIndex}].review`);
    } else if (typeof tagObj.tag !== 'string' || tagObj.tag.trim() === '') {
      errors.push(`tag in tags[${tagIndex}] in items[${itemIndex}].review must be a non-empty string`);
    } else if (tagObj.tag.length > LIMITS.MAX_TAG_LENGTH) {
      errors.push(`tag in tags[${tagIndex}] in items[${itemIndex}].review exceeds maximum length of ${LIMITS.MAX_TAG_LENGTH} chars`);
    } else {
      const normalized = normalizeTag(tagObj.tag);
      if (seenTagsInReview.has(normalized)) {
        errors.push(`Duplicate tag "${tagObj.tag.trim()}" (normalized: "${normalized}") within review tags list in items[${itemIndex}]`);
      }
      seenTagsInReview.add(normalized);
    }
  });
}

function validateTimelineComments(comments, itemIndex, errors, seenCommentIdentities, reviewerId, reviewId) {
  if (comments.length > LIMITS.MAX_TIMELINE_COMMENTS_PER_REVIEW) {
    errors.push(`timelineComments count (${comments.length}) in items[${itemIndex}].review exceeds maximum limit of ${LIMITS.MAX_TIMELINE_COMMENTS_PER_REVIEW}`);
    return;
  }

  const commentIdPattern = /^(note|comm)-[a-zA-Z0-9-]{8,64}$/;

  comments.forEach((c, cIndex) => {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) {
      errors.push(`timelineComments[${cIndex}] in items[${itemIndex}].review must be a JSON object`);
      return;
    }

    const allowedComment = new Set(['id', 'time', 'comment']);
    for (const key of Object.keys(c)) {
      if (!allowedComment.has(key)) {
        errors.push(`Unknown property in timelineComments[${cIndex}] in items[${itemIndex}].review: "${key}"`);
      }
    }

    if (c.id === undefined) {
      errors.push(`Missing id in timelineComments[${cIndex}] in items[${itemIndex}].review`);
    } else if (typeof c.id !== 'string' || !commentIdPattern.test(c.id)) {
      errors.push(`Invalid timelineComment id format: "${c.id}"`);
    } else {
      const commentIdentity = `${reviewerId}::${reviewId}::${c.id}`;
      if (seenCommentIdentities.has(commentIdentity)) {
        errors.push(`Duplicate timeline comment identity detected: "${commentIdentity}"`);
      }
      seenCommentIdentities.add(commentIdentity);
    }

    if (c.time === undefined) {
      errors.push(`Missing time in timelineComments[${cIndex}] in items[${itemIndex}].review`);
    } else if (typeof c.time !== 'number' || !Number.isFinite(c.time) || c.time < 0) {
      errors.push(`Invalid time in timelineComments[${cIndex}] in items[${itemIndex}].review: ${c.time} (must be non-negative finite number)`);
    }

    if (c.comment === undefined) {
      errors.push(`Missing comment in timelineComments[${cIndex}] in items[${itemIndex}].review`);
    } else if (typeof c.comment !== 'string' || c.comment.trim() === '') {
      errors.push(`comment in timelineComments[${cIndex}] in items[${itemIndex}].review must be a non-empty string`);
    } else if (c.comment.length > LIMITS.MAX_STRING_LENGTH) {
      errors.push(`comment in timelineComments[${cIndex}] in items[${itemIndex}].review exceeds maximum length of ${LIMITS.MAX_STRING_LENGTH} chars`);
    }
  });
}
