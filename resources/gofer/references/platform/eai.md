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

## Service Command Preference

Prefer named commands before raw PublicAPI calls:

| Need                         | Preferred CLI                                                  |
| ---------------------------- | -------------------------------------------------------------- |
| Scaffold app                 | `eai init <name>`                                              |
| Select tenant                | `eai tenant list --format json`, `eai tenant select <slug>`    |
| Publish Object Types         | `eai types validate`, `eai types seed`, `eai types diff`       |
| Inspect schemas              | `eai resources schema --tenant-id <tenant-id>`                 |
| Work with resources          | `eai resources list/get/create/update/delete/query`            |
| Check storage                | `eai resources storage status`, `eai resources storage doctor` |
| Search projections           | `eai resources search "<query>" --mode hybrid`                 |
| Work with documents          | `eai docs upload`, `eai docs classify`, `eai docs index`       |
| Use chat workflows           | `eai chat send`, `eai chat stream`                             |
| Advanced authorized V4 route | `eai publicapi <method> /v4/...`                               |

Use `eai publicapi` only when there is no named command for the required
authorized V4 surface.
