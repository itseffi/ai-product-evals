You are judging answerability (Q|C).

Question:
{{question}}

Retrieved context:
{{context}}

Pass only if the question can be answered satisfactorily from the retrieved context.

Fail when the context is insufficient and the correct system behavior should be to say the answer is not available.

Reason first, then give the verdict. Return exactly, in this order:
REASON: [one sentence]
SCORE: [0-100]
PASS: [YES or NO]

PASS is the primary verdict; SCORE is advisory.
Do not include markdown, analysis, preamble, or any other fields.
