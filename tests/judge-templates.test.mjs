import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

// Judges reason before they rule: a verdict emitted before the reasoning
// makes the model commit early and reason worse. Every template must place
// REASON ahead of SCORE / PASS / WINNER.
test('every judge template asks for REASON before the verdict', () => {
  const files = readdirSync('judges').filter(name => name.endsWith('.md'));
  assert.ok(files.length > 0, 'no judge templates found');
  for (const file of files) {
    const text = readFileSync(`judges/${file}`, 'utf8');
    const reasonAt = text.indexOf('REASON:');
    assert.ok(reasonAt >= 0, `${file} has no REASON field`);
    for (const verdict of ['SCORE:', 'PASS:', 'WINNER:']) {
      const at = text.indexOf(verdict);
      if (at >= 0) {
        assert.ok(reasonAt < at, `${file}: REASON must come before ${verdict}`);
      }
    }
  }
});

test('write-judge-prompt skill copies teach reason-first to match the templates', () => {
  const copies = [
    'skills/write-judge-prompt.md',
    'skills/write-judge-prompt/SKILL.md',
    'plugins/ai-product-evals/skills/write-judge-prompt.md',
  ].filter(existsSync);
  assert.ok(copies.length >= 1, 'no write-judge-prompt skill found');
  for (const file of copies) {
    const text = readFileSync(file, 'utf8');
    const reasonAt = text.indexOf('REASON: [');
    const scoreAt = text.indexOf('SCORE: [');
    assert.ok(reasonAt >= 0 && scoreAt >= 0, `${file}: missing example format block`);
    assert.ok(reasonAt < scoreAt, `${file}: skill must teach REASON before SCORE`);
  }
});
