# Capability: PDF Redaction And Font Embedding

## ADDED Requirements

### Requirement: Content-Removing Redaction

GhostTyper SHALL remove redacted content from the PDF rather than
visually covering it.

#### Scenario: User redacts a region

- **WHEN** the user redacts a region of a PDF and exports it
- **THEN** the exported file contains no extractable text for that region.

#### Scenario: Text extraction on redacted output

- **WHEN** text is extracted from a redacted PDF
- **THEN** the removed content does not appear in the extracted text.

#### Scenario: Unredacted content preserved

- **GIVEN** only part of a page is redacted
- **THEN** the remaining content is unchanged and still extractable.

### Requirement: Font Coverage For Generated PDFs

GhostTyper SHALL embed fonts covering the scripts it supports so generated
PDFs render correctly.

#### Scenario: Non-Latin content in a PDF

- **WHEN** a PDF is generated from content containing CJK, Arabic or
  Cyrillic script
- **THEN** the glyphs render correctly rather than as replacement boxes.

#### Scenario: Latin-only content

- **WHEN** a PDF is generated from Latin-only content
- **THEN** existing output remains unchanged.
