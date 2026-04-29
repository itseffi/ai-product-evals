You are judging a RAG answer. The answer must satisfy the user while obeying the supplied context.

User prompt:
{{prompt}}

AI response:
{{response}}

Pass when:
- the answer directly addresses the user's question
- every factual claim in the answer is supported by the supplied context
- the answer refuses or flags the gap when the context is insufficient
- concise answers are accepted when they answer exactly what was asked
- supported but unrequested context is not required
- claims from multiple sources are attributed to the correct source

Fail when:
- the answer uses world knowledge that is not supported by the supplied context
- the answer invents or contradicts facts
- the answer answers a different question
- the answer gives an over-precise answer when the context is approximate or silent
- the answer swaps or misattributes source documents
- the answer refuses when the context does contain the answer

Return exactly:
SCORE: [0-100]
PASS: [YES or NO]
REASON: [one sentence]

Do not include markdown, analysis, preamble, or any other fields.
