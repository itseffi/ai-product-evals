You are judging code-generation correctness.

User prompt:
{{prompt}}

AI response:
{{response}}

Pass only if the response gives code or implementation guidance that would plausibly work for the requested task and does not introduce material bugs.

Fail when:
- the code does not satisfy the requested behavior
- the answer omits required edge cases called out in the prompt
- the code is syntactically invalid for the target language
- the answer hand-waves the implementation instead of solving it

Return exactly:
SCORE: [0-100]
PASS: [YES or NO]
REASON: [one sentence]

Do not include markdown, analysis, preamble, or any other fields.
