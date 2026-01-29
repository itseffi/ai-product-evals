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
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV must have header row and at least one data row');
  }
  
  // Parse header
  const header = parseCsvLine(lines[0]);
  const requiredColumns = ['prompt'];
  const hasRequired = requiredColumns.every(col => 
    header.some(h => h.toLowerCase() === col.toLowerCase())
  );
  
  if (!hasRequired) {
    throw new Error(`CSV must have columns: ${requiredColumns.join(', ')}`);
  }
  
  // Parse rows
  const testCases = lines.slice(1)
    .filter(line => line.trim())
    .map((line, idx) => {
      const values = parseCsvLine(line);
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
        system_prompt: row.system_prompt,
        criteria: row.criteria ? row.criteria.split('|') : undefined,
        max_tokens: row.max_tokens ? parseInt(row.max_tokens) : undefined,
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

/**
 * Normalize test case to standard format
 */
function normalizeTestCase(tc) {
  return {
    name: tc.name || tc.title || tc.id || 'Unnamed',
    prompt: tc.prompt || tc.input || tc.question || tc.text || '',
    system_prompt: tc.system_prompt || tc.system || tc.context || undefined,
    expected: tc.expected || tc.answer || tc.output || undefined,
    expected_contains: tc.expected_contains || tc.contains || undefined,
    expected_regex: tc.expected_regex || tc.regex || tc.pattern || undefined,
    expected_tool: tc.expected_tool || tc.tool || undefined,
    expected_args: tc.expected_args || tc.args || undefined,
    expected_json: tc.expected_json || tc.json || undefined,
    criteria: tc.criteria || tc.rubric || undefined,
    eval_type: tc.eval_type || tc.type || undefined,
    max_tokens: tc.max_tokens || tc.maxTokens || 512,
    temperature: tc.temperature ?? undefined,
    metadata: tc.metadata || {},
  };
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
