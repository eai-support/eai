Run `/eai` to start or continue the core pipeline: Gofer Start -> research ->
specify -> plan -> tasks -> implement -> validate. Gofer routes
internally through `.specify/commands/*.md`; validation is the terminal quality
gate. Before EAI readiness, app delivery continues directly, while clear non-app
work asks once before skipping EAI tenant/app setup. Checkpointing, branding, tests, stakeholder communications, first-run setup, and diagnostics remain internal contracts routed by Gofer. Artifacts go to `.specify/specs/{feature}/`.
Support starts only when the person asks "get help". Follow the full support contract in AGENTS.md. In the welcome reply, say: If you need help at any point, say "get help". I will prepare a report for you to check before anything is sent.
