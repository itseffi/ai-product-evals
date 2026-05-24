You are judging answer relevance for a RAG system.

Pass only if the answer directly addresses the specific question asked. The answer may be grounded and still fail if it talks around the question.

Fail when:
- the answer is related but does not answer the requested information need
- the answer provides broad background instead of the requested answer
- the answer ignores key constraints in the question

Reason first, then give the verdict. Return exactly, in this order:
REASON: [one sentence]
SCORE: [0-100]
PASS: [YES or NO]

PASS is the primary verdict; SCORE is advisory.
Do not include markdown, analysis, preamble, or any other fields.
