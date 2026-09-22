# Decisions

| ID | Decision | Reason | Effect |
| --- | --- | --- | --- |
| D001 | Retain Docusaurus | Existing release automation and public AI-readable assets are valuable | No migration or paid platform dependency |
| D002 | Use a generated local search index | It works on GitHub Pages with no paid provider | Search is fast and private, but not semantic AI search |
| D003 | Use a static assistant | Public static hosting cannot safely operate a model-backed assistant without a backend | Results are source-linked and safe; generative answers remain future work |
| D004 | Use Gofer checkbox tasks and traceability evidence | The feature validator requires machine-checkable task state and requirement traceability | Delivery can be checked before the PR is created |
| D005 | Reject invalid generated curl continuations in verification | The initial review found literal `+` prefixes in copied commands | The safe request builder now produces terminal-valid commands and protects against regression |
| D006 | Fix all validation findings and make the PR merge-ready | User direction on 2026-09-23 | Correct the request builder, update from main, and rerun all checks |
| D007 | Regenerate derived documentation assets after the main rebase | The rebase updated source documentation metadata | Keep public search and capability assets release-aligned |
| D008 | Regenerate release documentation assets after the main rebase | Release validation identified stale public output | Keep release documentation checks green on the merge candidate |
