# Capability: OpenRouter Admin Console

## ADDED Requirements

### Requirement: Admin Console Test Coverage

GhostTyper SHALL maintain automated UI tests for the OpenRouter admin
console proving capability-tab switching, model search/filtering, allowlist
management, default-model-must-be-allowlisted enforcement, unavailable-model
indication, and activation-control gating all behave as specified.

#### Scenario: Admin console test suite runs

- **WHEN** the UI test suite runs
- **THEN** it renders the OpenRouter admin panel and asserts capability
  tabs, search/filter, allowlist add/remove, default-model allowlist
  enforcement, unavailable-model display, and the activation control's
  disabled/enabled state.

### Requirement: Component Test Tooling

GhostTyper SHALL provide a component-testing setup capable of rendering and
interacting with React admin-console components without a real browser.

#### Scenario: Developer runs a component test

- **WHEN** a developer runs the UI test suite locally or in CI
- **THEN** components render in a DOM-like environment and support
  user-event interaction (click, type, select) without requiring a real
  browser.
