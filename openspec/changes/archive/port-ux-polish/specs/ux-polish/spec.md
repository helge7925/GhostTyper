# Capability: Empty States, Onboarding And Error Pages

## ADDED Requirements

### Requirement: Styled Error Pages

GhostTyper SHALL provide styled 404 and 500 pages consistent with the
current design system.

#### Scenario: Unknown route

- **WHEN** the user navigates to a route that does not exist
- **THEN** a styled 404 page is shown with a way back to the app.

#### Scenario: Server error

- **WHEN** a server-side error occurs
- **THEN** a styled 500 page is shown rather than an unstyled fallback.

#### Scenario: Error pages are localized

- **WHEN** the user's locale is German or English
- **THEN** the error pages render in that locale.

### Requirement: Shared Empty State

GhostTyper SHALL show a meaningful empty state where a list has no
content.

#### Scenario: Empty list

- **GIVEN** a list view has no items
- **THEN** an empty state explains the situation instead of rendering a
  blank area.

#### Scenario: Populated list

- **GIVEN** a list view has items
- **THEN** no empty state is shown.

### Requirement: First-Run Introduction

GhostTyper SHALL offer a first-run introduction to new users.

#### Scenario: New user first visit

- **WHEN** a new user opens the app for the first time
- **THEN** an introduction is offered.

#### Scenario: Returning user

- **WHEN** a user who has already seen the introduction returns
- **THEN** it is not shown again.
