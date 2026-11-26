# Bundle the template v1.0.27 deployment workflow

Issue [#3764](https://github.com/enterpriseaigroup/Issues2025/issues/3764)

## Problem

The bundled template v1.0.25 workflow fails its own "Assert evidence accepted"
step for customer-owned deployments: its collector writes the image artifact id
as a string and the check requires a number. The run ends as failed and
TenantInfra then refuses the deployment. Template v1.0.27 at
`d47698fdf95cae057badef5c14a0f7de5c266852` repairs that check.

## Acceptance criteria

- AC-1. The CLI bundles the v1.0.27 workflow and evidence test, and its producer pin verifies at that exact commit. The collector is unchanged.
- AC-2. The checked-in platform expectation records v1.0.27 for DEV and TEST at the Infra2025 commit that selects it, and keeps PROD on v1.0.23.

## Out of scope

Publishing a CLI release, which stays held until the PROD pins carry the
bundled template. Moving to v1.0.28, which the services do not admit yet.

## Config keys added

None.
