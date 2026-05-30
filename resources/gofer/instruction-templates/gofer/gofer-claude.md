Run `/0_business_scenario` to start the core pipeline: business scenario ->
research -> specify -> plan -> tasks -> implement -> validate.
`/6_gofer_validate` is the terminal quality gate and includes the final
engineering review loop. Use `/7_gofer_save` and `/8_gofer_resume` for session
continuity. Artifacts go to `.specify/specs/{feature}/`.
