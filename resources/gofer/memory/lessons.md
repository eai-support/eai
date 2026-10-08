# Gofer Lessons Learned

Cross-cutting lessons captured from incidents, corrections, and
post-implementation reviews. Review at session start; update after any
correction.

---

## 2026-04-25: Codex skill-budget hygiene

**Incident**: Codex CLI logged `Exceeded skills context budget of 2%` and
dropped descriptions of all installed skills. Investigation revealed 11
duplicate Gofer skill bundles (one per Anthropic-tenant) plus 5 system skills,
totaling ~30KB of skill descriptions across 181 SKILL.md files.

**Root cause**: Codex preloads ~2% of context for skill name+description text.
Over-budget triggers a global drop, not per-bundle eviction. Multiple tenanted
copies multiplied the description footprint.

**Fix**:

1. Disabled 176 redundant `[[skills.config]] enabled = false` entries in
   `~/.codex/config.toml` (backup: `.bak.2026-04-25`).
2. Shipped `gofer codex doctor` (read-only) to detect this proactively.
3. Source-of-truth generator enforces ≤140-char descriptions per stage and ≤2KB
   cumulative budget.
4. Flat non-tenanted layout: `.agents/skills/gofer/<stage>/SKILL.md` (one bundle
   per stage, no per-tenant duplication).

**Lessons**:

- The official Codex disable knob is per-skill
  `[[skills.config]] enabled = false`, NOT a budget percentage. The fictional
  `skills_context_budget_percent` key DOES NOT EXIST.
- Codex discovers `.agents/skills/`, not `.claude/skills/`. They are separate
  distribution paths.
- Read-only diagnostics (`gofer codex doctor`) are safer than auto-remediation:
  never silently mutate user config.
- Description discipline matters: 16 stages × 128 bytes/desc = 2KB headroom; one
  verbose description blows the entire budget for everyone.

**References**:

- Spec FR-006, FR-008, FR-009, FR-011 (negative)
- ADR-001 (Codex skill discovery path)
- `.specify/scripts/node/codex-doctor.mjs`
