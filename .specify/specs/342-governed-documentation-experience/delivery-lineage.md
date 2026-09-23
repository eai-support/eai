---
feature: "342-governed-documentation-experience"
source: "delivery-lineage.json"
schema: eai.delivery_lineage.v1
plane: customer
---

# Delivery Lineage: 342-governed-documentation-experience

> Customer-safe graph. EAI dependencies stop at published PublicAPI capabilities.

```mermaid
flowchart LR
  subgraph stage_requirements["Requirements"]
    direction TB
    n4["Feature Artifact · Public Contracts<br/>Documentation File"]:::current
    n5["Feature Artifact · Evaluation Contract<br/>Documentation File"]:::current
    n7["P2 Specify · Governed Documentation Experience<br/>Requirement"]:::current
    n8["P2 Decision · Selected Approach<br/>Decision"]:::current
    n10["Feature Artifact · Threat Model<br/>Documentation File"]:::current
  end
  subgraph stage_architecture["Architecture"]
    direction TB
    n1["Use the published scoped Docs capability<br/>Decision<br/>FINAL SELECTED DECISION"]:::final_selected
    n6["P3 Plan · Delivery Plan<br/>Architecture"]:::current
  end
  subgraph stage_delivery["Delivery"]
    direction TB
    n2["Docusaurus Search and Ask experience<br/>Delivery Item"]:::current
    n3["Published public Docs capability<br/>Public Api Capability"]:::current
    n9["P4 Tasks · Tasks<br/>Work Order"]:::current
    n11["P4 Tasks · Traceability<br/>Work Order"]:::current
  end
  subgraph stage_validation["Validation"]
    direction TB
    n12["P6 Validate · Validation Evidence Required<br/>Test"]:::current
  end
  subgraph stage_outcome["Outcome"]
    direction TB
    n0["Governed cited documentation assistance<br/>Outcome"]:::current
  end
  n0 -->|"Guided by"| n1
  n1 -->|"Delivered by"| n2
  n2 -->|"Uses"| n3
  n7 -->|"Records Decision"| n8
  n7 -->|"Informs"| n6
  n6 -->|"Informs"| n9
  n9 -->|"Supports"| n11
  n9 -->|"Informs"| n12
  n12 -->|"Informs"| n4
  n4 -->|"Supports"| n5
  n4 -->|"Supports"| n10
  linkStyle 0 stroke:#1565c0,stroke-width:2px
  linkStyle 1 stroke:#1565c0,stroke-width:2px
  linkStyle 2 stroke:#1565c0,stroke-width:2px
  linkStyle 3 stroke:#1565c0,stroke-width:2px
  linkStyle 4 stroke:#1565c0,stroke-width:2px
  linkStyle 5 stroke:#1565c0,stroke-width:2px
  linkStyle 6 stroke:#1565c0,stroke-width:2px
  linkStyle 7 stroke:#1565c0,stroke-width:2px
  linkStyle 8 stroke:#1565c0,stroke-width:2px
  linkStyle 9 stroke:#1565c0,stroke-width:2px
  linkStyle 10 stroke:#1565c0,stroke-width:2px
  classDef current fill:#e8f5e9,stroke:#2e7d32,color:#102a13
  classDef suspect fill:#fff4ce,stroke:#f59e0b,color:#3d2800
  classDef anchor_lost fill:#ffebee,stroke:#e53935,color:#3f1010
  classDef broken fill:#ffcdd2,stroke:#c62828,color:#3f1010
  classDef superseded fill:#eceff1,stroke:#8b949e,color:#30363d
  classDef final_selected fill:#e3f2fd,stroke:#1565c0,stroke-width:4px,color:#0d2440
  classDef rejected_decision fill:#eceff1,stroke:#8b949e,stroke-dasharray:5 4,color:#30363d
```

Generated from `delivery-lineage.json`. Open **Gofer: Show Delivery Lineage** for the interactive viewer.
