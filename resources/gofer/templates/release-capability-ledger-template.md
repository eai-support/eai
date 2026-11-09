---
artifact: release-capability-ledger
feature: '{{feature_id}}'
release_branch: '{{branch_or_release_candidate}}'
status: '{{draft|blocked|verified}}'
updated: '{{iso_timestamp}}'
---

# Release Capability Ledger

Use this ledger when the feature claims a release or deployed outcome. Do not
claim complete status until every required row is verified.

| Requirement | Business outcome | Acceptance evidence      | Responsible PR and commit | Required release branch | Release-branch evidence        | Deployed evidence                       | Status    |
| ----------- | ---------------- | ------------------------ | ------------------------- | ----------------------- | ------------------------------ | --------------------------------------- | --------- | ------- | ---------- |
| {{FR-ID}}   | {{outcome}}      | {{test_or_manual_check}} | {{PR_and_commit}}         | {{branch}}              | {{merge-base_or_commit_check}} | {{browser_API_or_operational_evidence}} | {{planned | blocked | verified}} |

## Final Check

- [ ] Every accepted capability has a specification and traceability record.
- [ ] Every required PR is merged.
- [ ] Every required commit is present on the release branch.
- [ ] Browser evidence proves every requested user-facing behaviour.
- [ ] The validation report identifies any deferred capability as deferred.
