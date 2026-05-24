import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

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
