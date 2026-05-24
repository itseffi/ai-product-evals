You are judging RAG context relevance (C|Q).

Question:
{{question}}

Retrieved context:
{{context}}

Pass only if the retrieved context contains information that is useful for answering the question.

Fail when the context is unrelated, too broad to support the answer, or misses the question's key entity or constraint.

Reason first, then give the verdict. Return exactly, in this order:
REASON: [one sentence]
SCORE: [0-100]
PASS: [YES or NO]

PASS is the primary verdict; SCORE is advisory.
Do not include markdown, analysis, preamble, or any other fields.
