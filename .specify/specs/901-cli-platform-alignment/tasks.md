# Tasks: CLI Platform Alignment

- [x] Align tenant membership resolution with the AdminAPI memberships route
- [x] Remove obsolete tenant membership fallbacks and rely on the current PublicAPI-exposed contract
- [x] Align existing-user lookup with the AdminAPI email lookup route
- [x] Align existing-user provisioning with the AdminAPI provision route
- [x] Keep self-provisioning on the PublicAPI self-provision route
- [x] Update `eai verify calls` contract expectations to match the new route surface
- [x] Add regression coverage for admin membership payload normalization
- [x] Add regression coverage for admin-backed verify-call contracts
- [x] Archive completed historical feature folders under `.specify/specs/_archive/`
- [x] Leave one merged active feature folder that matches the current codebase
