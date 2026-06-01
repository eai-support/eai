This project uses Gofer for spec-driven development. Run `/0_business_scenario`
to start the core pipeline: business scenario -> research -> specify -> plan ->
tasks -> implement -> validate.

Key commands: `/1_gofer_research`, `/2_gofer_specify`, `/3_gofer_plan`,
`/4_gofer_tasks`, `/5_gofer_implement`, `/6_gofer_validate`. `/6_gofer_validate`
is the terminal quality gate and includes the final engineering review loop. Use
`/7_gofer_save` and `/8_gofer_resume` for session continuity. Artifacts in
`.specify/specs/{feature}/`.
