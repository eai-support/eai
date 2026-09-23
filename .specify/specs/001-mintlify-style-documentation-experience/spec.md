# Feature Specification: Mintlify-Style Documentation Experience

**Feature Branch**: `codex/mintlify-style-docs-experience`
**Created**: 2026-09-21
**Status**: In progress

## Executive Summary

- Give EAI customers a polished, task-led documentation experience without moving the source of truth from Git and Docusaurus.
- Keep generated release evidence, AI-readable documentation, API drift checks, and the existing GitHub Pages deployment path.
- Add search, guided routes, a safe local documentation assistant, an API request builder, feedback capture, and improved mobile design.
- Do not add a paid service, external AI inference, customer tracking, or a production deployment in this feature.

## Goal Ledger Alignment

| Goal ID | Outcome | Metric / Target | Linked stories | Linked requirements |
| --- | --- | --- | --- | --- |
| G1 | Help a new builder find and complete the right next action | A first-time user can reach a relevant guide in two actions | US1 | FR-001, FR-002 |
| G2 | Make public documentation easy to search and consume | Search and AI-readable indexes are generated in every build | US2 | FR-003, FR-004 |
| G3 | Improve API and support journeys safely | A user can build a non-secret CLI request and give page feedback | US3 | FR-005, FR-006 |

## User Scenarios & Testing

### User Story 1 - Find the right path (Priority: P1)

A new builder chooses a goal, such as creating an app or resolving an error, and reaches the relevant guide quickly.

**Independent Test**: Open the home page and use each journey card. Each card links to a working guide.

### User Story 2 - Search documentation (Priority: P1)

A builder searches for a command, platform term, or error and sees matching public pages without leaving the site.

**Independent Test**: Build the site, open search, and search for `tenant`, `error`, and `gofer`.

### User Story 3 - Get safe implementation help (Priority: P2)

A builder uses the documentation assistant and request builder without exposing a token or sending a production request.

**Independent Test**: Search the assistant, open a result, and generate a redacted curl command.

## Requirements

- **FR-001**: The home page MUST present task-led customer journeys.
- **FR-002**: The site MUST provide responsive, accessible navigation and a consistent Enterprise AI design system.
- **FR-003**: The release build MUST generate a searchable public index from approved documentation.
- **FR-004**: The site MUST retain `llms.txt`, `llms-full.txt`, CLI help, and error guidance output.
- **FR-005**: The site MUST provide a browser-only request builder that never sends credentials or requests.
- **FR-006**: The site MUST allow optional, privacy-preserving page feedback through a configurable URL only.
- **FR-007**: CI MUST build and verify all experience assets.
- **FR-008**: Desktop users MUST see EAI Setup as the recommended first-run path, with manual CLI installation retained for automation and advanced users.
- **FR-009**: The default onboarding route MUST separate new-computer setup, existing-project connection, and manual or managed setup.

## Application Classification & Journey

- **Mode**: non-app documentation work.
- **Authentication**: not applicable.
- **Deployment**: planned. This feature creates a branch only. It does not publish production changes.

## Success Criteria

- The docs build completes with no broken links.
- Search finds generated documentation content.
- The assistant gives only source-linked, static-index answers.
- The request builder never accepts or sends a token.
- The rubric records the implemented, blocked, and future Mintlify-equivalent capabilities honestly.
