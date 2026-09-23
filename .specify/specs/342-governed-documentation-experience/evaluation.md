# Evaluation Contract

The evaluation corpus contains approved public questions, expected source
documents, and refusal cases. It must include Docs-only, Website-only, mixed,
unknown-answer, unsafe-request, and unavailable-service examples.

Release thresholds:

- Citation precision: at least 95 percent.
- Cited-answer coverage for answerable questions: at least 95 percent.
- Refusal/no-answer correctness: 100 percent for the approved negative set.
- Test p95 response latency: at most 5 seconds.
- No response includes a secret, internal path, tenant ID, or non-approved URL.
