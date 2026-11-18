# 3625 CLI scaffold assignee

Issue: https://github.com/enterpriseaigroup/Issues2025/issues/3672

The genuine DEV child-path scaffold creates an `assignedTo` resource relationship
without a target Object Type. The CLI and Configurator correctly reject new
relationships without declared targets, preventing native schema publication.

- AC-1. Stock init definitions compile and validate with documents enabled or
  disabled. The optional assignee stores the caller's identity as text, and the
  existing submit action still assigns the verified current user.
- AC-2. Declared resource relationships retain exact target-slug validation;
  missing and unresolved resource targets continue to fail. No guessed user
  Object Type, new role, schema-validation bypass or existing-data migration.
- AC-3. Keep original fixture receipts and template provenance. Verify the
  fresh DEV child provisioning, manifest publication and actual record calls.
  Public CLI publication and TEST/PROD execution remain user-owned.

## Config keys added

None.
