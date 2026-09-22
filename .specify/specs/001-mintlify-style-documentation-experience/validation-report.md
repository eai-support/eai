{
  "result": "pass",
  "outcomeId": "OUTCOME-001",
  "planHash": "288f21571a9cd0e9b71c21631abe9d0184b3e2b173b9529a4c95ec0c795e7298",
  "specHash": "e5494857e1009a745948948248929ee9165212ecfccb874f159ea920ab40d399",
  "target": {"environment": "feature branch", "revision": "pending"},
  "requirements": ["FR-001", "FR-002", "FR-003", "FR-004", "FR-005", "FR-006", "FR-007", "FR-008"],
  "checks": [
    {"result": "pass", "command": "npm run docs:experience-assets:verify", "evidence": "evidence/T007.json", "sha256": "979d9d084f505674898b83cde45cedc2a2ac10309327cae4d693ecfbc3905d80"},
    {"result": "pass", "command": "npm run docs:experience-assets:check", "evidence": "evidence/T008.json", "sha256": "274611d53606fd9c8b376e989d28c528b128882f4e722c799bc6d7b3f64573c1"},
    {"result": "pass", "command": "npm run docs:release-assets:check && npm run test:eai-cli:ci", "evidence": "evidence/T009.json", "sha256": "d6b577442bbcc7ba916d7176babd68d2c744757040121df41c96f4f6750cd555"},
    {"result": "pass", "command": "cd docs-site && npm run build", "evidence": "evidence/T010.json", "sha256": "61040b2fbe3f1b63151604635c0769a1410c1a6356e3b4b975bf4f011ac8bc4e"}
  ]
}
