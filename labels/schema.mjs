import { readFileSync, readdirSync, existsSync } from 'fs';
import { extname, join } from 'path';

export const LABEL_FIELDS = [
  'id',
  'source_trace_id',
  'suite',
  'prompt',
  'response',
  'human_pass',
  'critique',
  'reference_answer',
  'failure_mode',
  'feature',
  'scenario',
  'persona',
  'reviewer',
  'reviewed_at',
  'reviewer_labels',
];

function normalizeReviewerLabel(raw = {}) {
  return {
    reviewer: raw.reviewer || raw.name || '',
    human_pass: parseBoolean(raw.human_pass ?? raw.humanPass ?? raw.outcome ?? raw.label),
    critique: raw.critique || raw.reason || '',
    reviewed_at: raw.reviewed_at || raw.reviewedAt || raw.timestamp || '',
  };
}

export function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === null || value === undefined || value === '') return null;

  const normalized = String(value).trim().toLowerCase();
  if (['true', 'yes', 'pass', 'passed', 'good', '1'].includes(normalized)) return true;
  if (['false', 'no', 'fail', 'failed', 'bad', '0'].includes(normalized)) return false;
  return null;
}

export function normalizeLabel(raw = {}, index = 0) {
  const rawReviewerLabels = parseReviewerLabels(raw.reviewer_labels ?? raw.reviewerLabels);
  const reviewerLabels = Array.isArray(rawReviewerLabels)
    ? rawReviewerLabels.map(normalizeReviewerLabel)
    : [];
  const humanPass = parseBoolean(
    raw.human_pass
      ?? raw.humanPass
      ?? raw.human_outcome
      ?? raw.humanOutcome
      ?? raw.pass
      ?? raw.label
  );
  const reviewerVotes = reviewerLabels
    .map(label => label.human_pass)
    .filter(value => value !== null);
  const positiveReviewerVotes = reviewerVotes.filter(Boolean).length;
  const negativeReviewerVotes = reviewerVotes.length - positiveReviewerVotes;
  const aggregateHumanPass = humanPass !== null
    ? humanPass
    : positiveReviewerVotes > negativeReviewerVotes
      ? true
      : negativeReviewerVotes > positiveReviewerVotes
        ? false
        : null;

  const prompt = raw.prompt
    ?? raw.input
    ?? raw.question
    ?? raw.user
    ?? raw.request?.prompt
    ?? '';

  const rawResponse = raw.response?.text
    ?? raw.response?.content
    ?? raw.output?.text
    ?? raw.output
    ?? raw.answer
    ?? raw.model_response
    ?? raw.modelResponse
    ?? raw.response
    ?? '';
  const response = typeof rawResponse === 'string'
    ? rawResponse
    : rawResponse === null || rawResponse === undefined
      ? ''
      : JSON.stringify(rawResponse);

  return {
    id: raw.id || raw.record_id || raw.recordId || `label-${index + 1}`,
    source_trace_id: raw.source_trace_id || raw.sourceTraceId || raw.trace_id || raw.traceId || '',
    suite: raw.suite || raw.evalName || raw.eval_name || raw.source || '',
    prompt,
    response,
    human_pass: aggregateHumanPass,
    critique: raw.critique || raw.human_critique || raw.humanCritique || raw.reason || '',
    reference_answer: raw.reference_answer || raw.referenceAnswer || raw.reference || raw.gold || '',
    failure_mode: raw.failure_mode || raw.failureMode || raw.category || '',
    feature: raw.feature || '',
    scenario: raw.scenario || '',
    persona: raw.persona || '',
    reviewer: raw.reviewer || '',
    reviewed_at: raw.reviewed_at || raw.reviewedAt || raw.timestamp || new Date().toISOString(),
    reviewer_labels: reviewerLabels,
    metadata: {
      ...(raw.metadata || {}),
      ...(raw.model_critique ? { model_critique: raw.model_critique } : {}),
      ...(raw.model_outcome ? { model_outcome: raw.model_outcome } : {}),
      ...(raw.human_revised_response ? { human_revised_response: raw.human_revised_response } : {}),
      ...(raw.agreement ? { agreement: raw.agreement } : {}),
      ...(raw.iteration ? { iteration: raw.iteration } : {}),
    },
  };
}

function parseReviewerLabels(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function validateLabel(label) {
  const errors = [];
  if (!label.id) errors.push('Missing id');
  if (!label.prompt) errors.push('Missing prompt');
  if (!label.response) errors.push('Missing response');
  if (typeof label.prompt !== 'string') errors.push('Prompt must be a string');
  if (typeof label.response !== 'string') errors.push('Response must be a string');
  if (label.human_pass === null) errors.push('Missing or invalid human_pass');
  if (!label.critique) errors.push('Missing critique');
  if (Array.isArray(label.reviewer_labels)) {
    for (const [index, reviewerLabel] of label.reviewer_labels.entries()) {
      if (reviewerLabel.human_pass === null) errors.push(`Reviewer label ${index + 1} missing or invalid human_pass`);
    }
  }
  return errors;
}

export function parseCsv(content) {
  const rows = parseCsvRows(content);
  if (rows.length === 0) return [];

  const header = rows[0].map(normalizeCsvHeader);
  return rows.slice(1).map(values => {
    const row = {};
    header.forEach((key, i) => {
      row[key] = values[i] || '';
    });
    return row;
  });
}

function normalizeCsvHeader(header) {
  return String(header || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let current = '';
  let inQuotes = false;
  const input = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === '"') {
      if (inQuotes && input[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if (char === '\n' && !inQuotes) {
      row.push(current.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

export function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function labelsToCsv(labels) {
  const lines = [LABEL_FIELDS.join(',')];
  for (const label of labels) {
    lines.push(LABEL_FIELDS.map(field => escapeCsv(label[field] ?? '')).join(','));
  }
  return lines.join('\n');
}

export function loadLabels(path) {
  const content = readFileSync(path, 'utf8');
  const ext = extname(path).toLowerCase();

  let rows;
  let defaults = {};
  if (ext === '.json') {
    const data = JSON.parse(content);
    defaults = {
      suite: data.suite,
      judge_template: data.judge_template || data.judgeTemplate,
      metadata: data.metadata || {},
    };
    rows = Array.isArray(data) ? data : data.labels || data.examples || [];
  } else if (ext === '.jsonl') {
    rows = content.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } else if (ext === '.csv') {
    rows = parseCsv(content);
  } else {
    throw new Error(`Unsupported label file format: ${ext}`);
  }

  return rows.map((row, index) => normalizeLabel({
    ...row,
    suite: row.suite || defaults.suite,
    metadata: {
      ...defaults.metadata,
      ...(defaults.judge_template ? { judge_template: defaults.judge_template } : {}),
      ...(row.metadata || {}),
    },
  }, index));
}

export function loadLabelsFromDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => ['.json', '.jsonl', '.csv'].includes(extname(name).toLowerCase()))
    .flatMap(name => loadLabels(join(dir, name)));
}

export function labelToEvalCase(label, options = {}) {
  return {
    name: label.id,
    prompt: label.prompt,
    static_response: label.response,
    reference_answer: label.reference_answer,
    expected_pass: label.human_pass,
    eval_type: 'llm_judge',
    criteria: options.criteria || ['matches_human_judgment'],
    judge_template: options.judgeTemplate || label.metadata?.judge_template || 'general-product-quality',
    metadata: {
      source_trace_id: label.source_trace_id,
      human_pass: label.human_pass,
      critique: label.critique,
      reference_answer: label.reference_answer,
      reviewer_labels: label.reviewer_labels,
      failure_mode: label.failure_mode,
      feature: label.feature,
      scenario: label.scenario,
      persona: label.persona,
      reviewed_at: label.reviewed_at,
    },
  };
}
