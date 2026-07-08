# Security Policy

## Supported Versions

Security updates are provided for the latest released major version of the EAI
CLI. Older versions may receive fixes at the maintainers' discretion when a
safe backport is practical.

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes       |
| < 2.0   | No        |

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Use GitHub private vulnerability reporting:

https://github.com/eai-tools/eai/security/advisories/new

Include as much detail as possible:

- affected command, package version, branch, or commit
- steps to reproduce
- expected and actual behavior
- impact and any known workaround
- whether credentials, tenant data, or customer data may be exposed

Maintainers will acknowledge valid reports as quickly as possible, coordinate a
fix privately, and publish release notes after users have had a reasonable
opportunity to update.

## Public Repository Hygiene

Do not include secrets, tenant data, customer data, private URLs, local `.env`
files, or generated Gofer runtime/spec artifacts in issues, pull requests,
commits, screenshots, or logs. If you accidentally disclose a secret, rotate it
immediately even if the commit is later removed.

## Public Issue Attachment Policy

Do not attach ZIP files, scripts, installers, binaries, or "fix archives" to
public issues, pull requests, or comments. Paste commands, sanitized logs, and
text snippets directly instead.

Maintainers will remove unsolicited executable/archive attachments from public
issue conversations. If a file is required for a security report, use GitHub
private vulnerability reporting rather than a public issue.

The repository includes an issue/comment moderation workflow that checks new
issues and issue comments for unsafe GitHub attachment links. For comments from
unknown or unaffiliated users, unsafe archive/script/binary attachment links are
removed from the visible conversation. GitHub-hosted attachment blobs may still
require GitHub Trust & Safety removal if their direct URL has already been
shared elsewhere.
