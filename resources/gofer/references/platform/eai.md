# Platform CLI Reference

Use this fallback when external CLI documentation is unavailable.

## Version Pinning Rule

- Detect the installed CLI version.
- Record the `major.minor` version in generated plan and task artifacts.
- Avoid pinning implementation guidance to patch-specific behavior.

## Command Guidance Contract

- Include scaffolding or setup commands only when they are supported by the
  target project.
- Include deployment commands only when the target repository documents a
  deployment path.
- Add a user-visible notice when fallback references were used.
