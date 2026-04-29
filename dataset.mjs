/**
 * Dataset Loader
 * 
 * Load test cases from various formats: JSON, JSONL, CSV
 */

import { readFileSync } from 'fs';
import { extname } from 'path';

/**
 * Load dataset from file
 * Supports: .json, .jsonl, .csv
 */
export function loadDataset(filePath) {
  const ext = extname(filePath).toLowerCase();
  const content = readFileSync(filePath, 'utf8');
  
  switch (ext) {
    case '.json':
      return loadJson(content);
    case '.jsonl':
      return loadJsonl(content);
    case '.csv':
      return loadCsv(content);
    default:
      throw new Error(`Unsupported file format: ${ext}`);
  }
}

/**
 * Load JSON dataset
 */
function loadJson(content) {
  const data = JSON.parse(content);
  
  // Handle both flat array and eval config format
  if (Array.isArray(data)) {
    return {
      name: 'Dataset',
      description: 'Loaded from JSON array',
      test_cases: data.map(normalizeTestCase),
      models: [],
    };
  }
  
  return {
    name: data.name || 'Dataset',
    description: data.description || '',
    test_cases: (data.test_cases || data.tests || data.examples || []).map(normalizeTestCase),
    models: data.models || [],
  };
}

/**
 * Load JSONL dataset (one JSON object per line)
 */
function loadJsonl(content) {
  const lines = content.trim().split('\n').filter(line => line.trim());
  const testCases = lines.map(line => {
    try {
      return normalizeTestCase(JSON.parse(line));
    } catch {
      return null;
    }
  }).filter(Boolean);
  
  return {
    name: 'Dataset',
    description: 'Loaded from JSONL',
    test_cases: testCases,
    models: [],
  };
}

/**
 * Load CSV dataset
 * Expected columns: name, prompt, expected, system_prompt (optional)
 */
function loadCsv(content) {
  const rows = parseCsvRows(content);
  if (rows.length < 2) {
    throw new Error('CSV must have header row and at least one data row');
  }
  
  // Parse header
  const header = rows[0];
  const requiredColumns = ['prompt'];
  const hasRequired = requiredColumns.every(col => 
    header.some(h => h.toLowerCase() === col.toLowerCase())
  );
  
  if (!hasRequired) {
    throw new Error(`CSV must have columns: ${requiredColumns.join(', ')}`);
  }
  
  // Parse rows
  const testCases = rows.slice(1)
    .map((values, idx) => {
      const row = {};
      
      header.forEach((col, i) => {
        row[col.toLowerCase().trim()] = values[i] || '';
      });
      
      return normalizeTestCase({
        name: row.name || `Test ${idx + 1}`,
        prompt: row.prompt,
        expected: row.expected,
        expected_contains: row.expected_contains ? row.expected_contains.split('|') : undefined,
        expected_regex: row.expected_regex,
        expected_tool: row.expected_tool,
        reference_answer: row.reference_answer,
        response_a: row.response_a,
        response_b: row.response_b,
        expected_winner: row.expected_winner,
        system_prompt: row.system_prompt,
        criteria: row.criteria ? row.criteria.split('|') : undefined,
        max_tokens: parseOptionalPositiveInteger(row.max_tokens),
      });
    });
  
  return {
    name: 'Dataset',
    description: 'Loaded from CSV',
    test_cases: testCases,
    models: [],
  };
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCsvLine(line) {
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

function parseCsvRows(content) {
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

/**
 * Normalize test case to standard format
 */
function normalizeTestCase(tc) {
  const prompt = tc.prompt || tc.input || tc.question || tc.text || '';
  const name = tc.name || tc.title || tc.id || 'Unnamed';
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error(`Test case "${name}" is missing a non-empty prompt/input/question/text field`);
  }

  return {
    name,
    prompt,
    system_prompt: tc.system_prompt || tc.system || tc.context || undefined,
    expected: tc.expected || tc.answer || tc.output || undefined,
    expected_contains: tc.expected_contains || tc.contains || undefined,
    expected_regex: tc.expected_regex || tc.regex || tc.pattern || undefined,
    expected_tool: tc.expected_tool || tc.tool || undefined,
    expected_args: tc.expected_args || tc.args || undefined,
    reference_answer: tc.reference_answer || tc.referenceAnswer || tc.reference || undefined,
    response_a: tc.response_a || tc.responseA || tc.candidate_a || tc.candidateA || undefined,
    response_b: tc.response_b || tc.responseB || tc.candidate_b || tc.candidateB || undefined,
    expected_winner: tc.expected_winner || tc.expectedWinner || undefined,
    order: tc.order || undefined,
    require_native_tool_call: tc.require_native_tool_call || tc.requireNativeToolCall || undefined,
    tools: tc.tools || undefined,
    tool_choice: tc.tool_choice || tc.toolChoice || undefined,
    expected_json: tc.expected_json || tc.json || undefined,
    expected_relevant_context_ids: tc.expected_relevant_context_ids || tc.expectedRelevantContextIds || undefined,
    retrieved_context_ids: tc.retrieved_context_ids || tc.retrievedContextIds || undefined,
    contexts: tc.contexts || tc.retrieved_contexts || undefined,
    context: tc.context || undefined,
    question: tc.question || undefined,
    answer: tc.answer || undefined,
    criteria: tc.criteria || tc.rubric || undefined,
    judge_template: tc.judge_template || tc.judgeTemplate || undefined,
    eval_type: tc.eval_type || tc.type || undefined,
    max_tokens: parseOptionalPositiveInteger(tc.max_tokens ?? tc.maxTokens) ?? 512,
    temperature: tc.temperature ?? undefined,
    paraphrases: tc.paraphrases || undefined,
    unauthorized_patterns: tc.unauthorized_patterns || tc.unauthorizedPatterns || undefined,
    forbidden_actions: tc.forbidden_actions || tc.forbiddenActions || undefined,
    response_surface: tc.response_surface || tc.responseSurface || undefined,
    context_surface: tc.context_surface || tc.contextSurface || undefined,
    required_response_facts: tc.required_response_facts || tc.requiredResponseFacts || undefined,
    forbidden_response_facts: tc.forbidden_response_facts || tc.forbiddenResponseFacts || undefined,
    salient_response_facts: tc.salient_response_facts || tc.salientResponseFacts || undefined,
    irrelevant_response_facts: tc.irrelevant_response_facts || tc.irrelevantResponseFacts || undefined,
    required_context_facts: tc.required_context_facts || tc.requiredContextFacts || undefined,
    irrelevant_context_facts: tc.irrelevant_context_facts || tc.irrelevantContextFacts || undefined,
    stale_context_patterns: tc.stale_context_patterns || tc.staleContextPatterns || undefined,
    counterfactual_context_facts: tc.counterfactual_context_facts || tc.counterfactualContextFacts || undefined,
    safety_weight: tc.safety_weight ?? tc.safetyWeight,
    failure_weight: tc.failure_weight ?? tc.failureWeight,
    recovery_expected: tc.recovery_expected ?? tc.recoveryExpected,
    expected_confidence: tc.expected_confidence ?? tc.expectedConfidence,
    confidence_tolerance: tc.confidence_tolerance ?? tc.confidenceTolerance,
    metadata: tc.metadata || {},
  };
}

function parseOptionalPositiveInteger(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

/**
 * Export dataset to CSV format
 */
export function exportToCsv(testCases) {
  const header = ['name', 'prompt', 'system_prompt', 'expected', 'expected_contains', 'criteria', 'max_tokens'];
  const lines = [header.join(',')];
  
  for (const tc of testCases) {
    const row = [
      escapeCsv(tc.name),
      escapeCsv(tc.prompt),
      escapeCsv(tc.system_prompt || ''),
      escapeCsv(tc.expected || ''),
      escapeCsv(Array.isArray(tc.expected_contains) ? tc.expected_contains.join('|') : ''),
      escapeCsv(Array.isArray(tc.criteria) ? tc.criteria.join('|') : ''),
      tc.max_tokens || '',
    ];
    lines.push(row.join(','));
  }
  
  return lines.join('\n');
}

/**
 * Escape CSV field
 */
function escapeCsv(value) {
  if (!value) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export results to CSV format
 */
export function exportResultsToCsv(results) {
  const header = [
    'test_case', 'model', 'provider', 'pass', 'score', 
    'eval_type', 'reason', 'latency_ms', 'cost', 'response'
  ];
  const lines = [header.join(',')];
  
  for (const r of results) {
    const row = [
      escapeCsv(r.testCase),
      escapeCsv(r.model),
      escapeCsv(r.provider),
      r.pass ? 'true' : 'false',
      r.score !== null ? r.score : '',
      escapeCsv(r.evalType || ''),
      escapeCsv(r.evalReason || ''),
      r.latencyMs || '',
      r.cost || '',
      escapeCsv(r.text || ''),
    ];
    lines.push(row.join(','));
  }
  
  return lines.join('\n');
}
