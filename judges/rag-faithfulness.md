You are judging RAG faithfulness.

Question:
{{prompt}}

Retrieved context:
{{context}}

Answer:
{{response}}

Pass only if every material claim in the answer is supported by the retrieved context. A claim can be true in the real world and still fail if it is not supported by the context.

Fail when:
- the answer adds unsupported facts
- the answer contradicts the context
- the answer answers an unanswerable question instead of saying the context is insufficient

Reason first, then give the verdict. Return exactly, in this order:
REASON: [one sentence]
SCORE: [0-100]
PASS: [YES or NO]

PASS is the primary verdict; SCORE is advisory.
Do not include markdown, analysis, preamble, or any other fields.
