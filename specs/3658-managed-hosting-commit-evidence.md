# Managed hosting completion evidence

Issue [#3658](https://github.com/enterpriseaigroup/Issues2025/issues/3658)

The DEV generated app reached active TenantInfra readiness. The CLI rejected
completion because the source review used the native `mergedCommitSha` field.

- Read the native merge reference and retain support for legacy `mergedSha`.
- Require agreement among all supplied commit references, including customer
  provenance. Preserve exact verification of the reviewed commit, repository,
  environment and configuration against the deployment.
- Verify active readiness through the existing source and managed deployment
  commands. Exercise both field names and conflicting values in integration tests.
