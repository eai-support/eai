{
  "result": "pass",
  "outcomeId": "OUTCOME-001",
  "planHash": "d988a386f2ac0f7fec3144e9a5137ac1076ff1076dfb05f974413642c6154d1f",
  "specHash": "afd7f8ff94ede3606171945713a45e2bf59131068edf902e79d6500ec411015e",
  "target": {"environment": "feature branch", "revision": "pending"},
  "requirements": ["FR-001", "FR-002", "FR-003", "FR-004", "FR-005", "FR-006", "FR-007", "FR-008", "FR-009"],
  "checks": [
    {"result": "pass", "command": "npm run docs:experience-assets:verify", "evidence": "evidence/T007.json", "sha256": "815e1bc0937f321192627778e07495529f7fe30ae30dc54586c489754523b5c2"},
    {"result": "pass", "command": "npm run docs:experience-assets:check", "evidence": "evidence/T008.json", "sha256": "da24ed040f4edcd9123c00533b1ff35ed32c33a6474807c8d7c43f712b6c5df3"},
    {"result": "pass", "command": "npm run docs:release-assets:check && npm run test:eai-cli:ci", "evidence": "evidence/T009.json", "sha256": "a61817b890405a95dbbbf63e2ee461f7f99eadd26538ed6c85b5bec7def7c0c7"},
    {"result": "pass", "command": "cd docs-site && npm run build", "evidence": "evidence/T010.json", "sha256": "8614737ed19b9c8b3e58fcfa57ef1337c2b6d740cb7995f9d90b89cbbe1dd96f"},
    {"result": "pass", "command": "npm run docs:release-assets:check && npm run docs:experience-assets:check && npm run docs:experience-assets:verify && cd docs-site && npm run build", "evidence": "evidence/T011.json", "sha256": "0711d813c6d8ffdccadfe866560a6a8e6425ceb9d15b1063d191b75c082c47eb"},
    {"result": "pass", "command": "local Apple Silicon Chromium check of /eai/docs/installer-setup", "evidence": "evidence/T012.json", "sha256": "e3f0c94e6eb439707aa0cbcd7016e609fc4a4b11dcd8df984b6e78cc9b75f69e"}
  ]
}
