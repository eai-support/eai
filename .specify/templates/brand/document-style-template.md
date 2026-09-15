---
GeneratedAt: '{{iso_timestamp}}'
SourceCommandId: '/8_gofer_branding'
SourceInputs:
  - '.specify/memory/brand-profile.json'
OverwriteNoticeWhenApplicable:
  'Replace this scaffold with repo-specific brand guidance.'
---

# Document Style Guide

## Executive Summary

- This file records how Gofer documents should look and feel for this repo.
- It keeps brand choices explicit so generated summaries, PR/FAQs, diagrams, and
  decks stay consistent.
- It should reference approved brand assets without embedding private logos,
  credentials, tenant IDs, or customer-confidential data.

## Brand Sources

| Source        | Path or URL                          | Status  | Notes                                     |
| ------------- | ------------------------------------ | ------- | ----------------------------------------- |
| Brand profile | `.specify/memory/brand-profile.json` | Pending | Created or updated by `/8_gofer_branding` |
| Logo          | `{{logo_path}}`                      | Pending | Use only after approval                   |
| Brand guide   | `{{brand_guide_path}}`               | Pending | Optional                                  |

## Document Defaults

| Element               | Default                     |
| --------------------- | --------------------------- |
| Heading font          | `{{heading_font}}`          |
| Body font             | `{{body_font}}`             |
| Primary color         | `{{primary_color}}`         |
| Accent color          | `{{accent_color}}`          |
| Header text           | `{{header_text}}`           |
| Footer text           | `{{footer_text}}`           |
| Confidentiality label | `{{confidentiality_label}}` |

## Presentation Rules

- Keep the executive summary first and write it in plain language.
- Use the brand accent color sparingly for calls to action, risks, and decision
  points.
- Mermaid diagrams must remain readable in monochrome and include a table or
  prose fallback where the visual is important.
- Marp decks should reference `.specify/templates/brand/marp-theme-template.css`
  unless a repo-specific theme has been approved.
- Never include private logos, screenshots, client names, or tenant-specific
  information in a public release artifact.
