Run `/eai` to start or continue the core pipeline: Gofer Start -> research ->
specify -> plan -> tasks -> implement -> validate. Gofer routes
internally through `.specify/commands/*.md`; validation is the terminal quality
gate. Before EAI readiness, app delivery continues directly, while clear non-app
work asks once before skipping EAI tenant/app setup. Checkpointing, branding, tests,
stakeholder communications, first-run setup, and diagnostics remain internal contracts.
Artifacts go to `.specify/specs/{feature}/`. When the user says `Get started with EAI`, including decorative emoji, load the public `eai` skill; for a new app conversation, show its Required First-Run Response before running preflight or asking setup questions.
