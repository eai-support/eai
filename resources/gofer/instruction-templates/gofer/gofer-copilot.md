This project uses Gofer for spec-driven development. In GitHub Copilot Chat, run
`#eai` to start or continue the core pipeline: Gofer Start -> research ->
specify -> plan -> tasks -> implement -> validate.

When the user says `Get started with EAI`, activate the `eai` skill and send
its Required First-Run Response before preflight, setup questions, or routing.

Gofer routes internally through `.specify/commands/*.md` contracts; validation
is the terminal quality gate and includes the final engineering review loop.
Before EAI readiness, classify the request: app delivery continues directly,
while clear non-app work asks once before skipping EAI tenant/app setup.
Checkpointing, branding, tests, stakeholder communications, first-run setup, and
workspace diagnostics remain available as internal contracts routed by Gofer
when needed. Artifacts in `.specify/specs/{feature}/`.
