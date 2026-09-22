{
  "result": "pass",
  "outcomeId": "OUTCOME-001",
  "planHash": "74c4609625af5c5878e6337fe9f61677cc01013dbba2f790064210f62ef5be7c",
  "specHash": "b8f3e54e726f9af8398472446e97173c807bed07e9d5a7a5c298f9ffde4a36d9",
  "target": {"environment": "feature branch", "revision": "pending"},
  "requirements": ["FR-001", "FR-002", "FR-003", "FR-004", "FR-005", "FR-006", "FR-007"],
  "checks": [
    {"result": "pass", "command": "npm run docs:experience-assets:verify", "evidence": "evidence/T007.json", "sha256": "e7051839060f815f7e742c021502225cb765d9f16740cb97be1aec1cb70af437"},
    {"result": "pass", "command": "npm run docs:experience-assets:check", "evidence": "evidence/T008.json", "sha256": "92dc6f03863bd4586194cc6904cfadaea192cc3ebb72cd29b8589f28610a88b4"},
    {"result": "pass", "command": "npm run docs:release-assets:check && npm run test:eai-cli:ci", "evidence": "evidence/T009.json", "sha256": "471493cabaef8441ef838d3a83b4e163584c8fcdb24f50606369a799daf32d9f"}
  ]
}
