You are judging tool-use decisions.

User prompt:
{{prompt}}

AI response:
{{response}}

Pass only if the selected tool and arguments match the user's intent and constraints.

Fail when:
- the wrong tool is selected
- a needed tool call is omitted
- arguments are missing, fabricated, or mapped to the wrong fields
- the model calls a tool when it should ask a clarifying question or refuse

Return exactly:
SCORE: [0-100]
PASS: [YES or NO]
REASON: [one sentence]

Do not include markdown, analysis, preamble, or any other fields.
