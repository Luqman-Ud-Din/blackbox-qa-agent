/**
 * argus-schema.cjs — single source of truth for the Issue object schema.
 *
 * Every permanent script (file-bugs.cjs, annotate-cell-prepare.cjs, annotate-cell-finalize.cjs, etc.) imports
 * this module to validate findings before doing anything with them.
 *
 * If a finding fails validation, the writer THROWS. This prevents malformed
 * issues from silently flowing into ADO tickets or annotation pipelines.
 *
 * Required fields (must be present and non-empty):
 *   runId, cellId, skill, issueType, severity, route, viewport, viewportClass
 *
 * Required-with-fallback (may be empty/null but must exist):
 *   browser, selector, description, bbox
 *
 * Optional output paths (added by the pipeline after capture):
 *   screenshotPath, annotatedScreenshotPath
 *
 * Optional ADO fields (added by file-bugs.cjs after filing):
 *   adoBugId, adoTitle, attachStatus
 */

const REQUIRED_FIELDS = [
  'runId', 'cellId', 'skill', 'issueType',
  'severity', 'route', 'viewport', 'viewportClass'
];

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const VALID_VIEWPORT_CLASSES = new Set(['mobile', 'tablet', 'laptop', 'desktop']);

class IssueValidationError extends Error {
  constructor(message, issue, field) {
    super(message);
    this.name = 'IssueValidationError';
    this.issue = issue;
    this.field = field;
  }
}

/**
 * Validates a finding. Throws IssueValidationError on the first failure.
 * Returns the (unchanged) issue on success.
 */
function validate(issue) {
  if (!issue || typeof issue !== 'object') {
    throw new IssueValidationError('Issue must be a non-null object', issue, null);
  }
  for (const field of REQUIRED_FIELDS) {
    const v = issue[field];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      throw new IssueValidationError(
        `Issue is missing required field "${field}". Got: ${JSON.stringify(v)}.`,
        issue, field
      );
    }
  }
  if (!VALID_SEVERITIES.has(issue.severity)) {
    throw new IssueValidationError(
      `Invalid severity "${issue.severity}". Must be one of: ${[...VALID_SEVERITIES].join(', ')}.`,
      issue, 'severity'
    );
  }
  if (!VALID_VIEWPORT_CLASSES.has(issue.viewportClass)) {
    throw new IssueValidationError(
      `Invalid viewportClass "${issue.viewportClass}". Must be one of: ${[...VALID_VIEWPORT_CLASSES].join(', ')}.`,
      issue, 'viewportClass'
    );
  }
  if (issue.bbox != null) {
    const b = issue.bbox;
    if (typeof b !== 'object' ||
        typeof b.x !== 'number' || typeof b.y !== 'number' ||
        typeof b.w !== 'number' || typeof b.h !== 'number') {
      throw new IssueValidationError(
        'Issue bbox must be {x:number, y:number, w:number, h:number} or omitted entirely.',
        issue, 'bbox'
      );
    }
  }
  return issue;
}

/**
 * Validates many issues. Returns { valid, invalid } arrays. Does NOT throw.
 * Use this when you want to surface all failures rather than fail-fast.
 */
function validateMany(issues) {
  const valid = [], invalid = [];
  for (const issue of issues) {
    try { validate(issue); valid.push(issue); }
    catch (e) { invalid.push({ issue, error: e.message, field: e.field }); }
  }
  return { valid, invalid };
}

/**
 * Reads a JSONL file path. Returns array of parsed objects. Skips empty lines.
 * Does NOT validate — call validateMany() on the result.
 */
function readJsonl(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch (_) { /* skip malformed line */ }
  }
  return out;
}

/**
 * Reads ALL .jsonl files in a directory recursively. Returns flat array.
 */
function readAllJsonl(dirPath) {
  const fs = require('fs');
  const path = require('path');
  if (!fs.existsSync(dirPath)) return [];
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) out.push(...readJsonl(full));
    }
  };
  walk(dirPath);
  return out;
}

module.exports = {
  REQUIRED_FIELDS,
  VALID_SEVERITIES,
  VALID_VIEWPORT_CLASSES,
  IssueValidationError,
  validate,
  validateMany,
  readJsonl,
  readAllJsonl
};
