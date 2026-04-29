You are judging whether an AI response matches the provided reference answer.

User prompt:
{{prompt}}

Reference answer:
{{expected}}

AI response:
{{response}}

Pass when the response captures the same materially correct answer as the reference, even if phrased differently.

Fail when:
- the response contradicts the reference
- the response omits a critical requirement from the reference
- the response adds unsupported or materially wrong claims
- the response answers a different question

Return exactly:
SCORE: [0-100]
PASS: [YES or NO]
REASON: [one sentence]

Do not include markdown, analysis, preamble, or any other fields.
