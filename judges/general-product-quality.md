You are judging whether an AI product response satisfied the user's primary need.

User prompt:
{{prompt}}

AI response:
{{response}}

Use a binary PASS/FAIL decision. Do not use vague numeric quality notions like generic helpfulness.

Pass when:
- the response directly addresses the user's request
- the response avoids material unsupported claims
- any caveats or limitations are clear enough for the user to act safely

Fail when:
- the response misses the user's primary intent
- the response invents facts or capabilities
- the response omits a critical constraint from the prompt
- the response is too vague to be useful

Reason first, then give the verdict. Return exactly, in this order:
REASON: [one sentence]
SCORE: [0-100]
PASS: [YES or NO]

PASS is the primary verdict; SCORE is advisory.
Do not include markdown, analysis, preamble, or any other fields.
