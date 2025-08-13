# JSON Schema Form Generator (Vanilla JS + Bootstrap)

A lightweight, framework-free web app that generates Bootstrap forms from JSON Schema.

## Features
- Object, array, string, number, integer, boolean
- `properties`, `required`, `enum`, `items`, `default`, `format` and constraints
- `oneOf`/`anyOf` selectors, basic `allOf` merge for objects
- Arrays: add/remove, reorder, `minItems`/`maxItems`
- Optional UI Schema for layout and labels: `VerticalLayout`, `HorizontalLayout`, `Group`, `Control`, `Categorization`, `Table`, `ListWithDetail`
- Custom control renderers (global/instance) with tester/name
- Client-side HTML5 validation + AJV validation (with formats)
- JSON output preview and download

## Validation
- On Submit: both HTML5 (required, min/max, patterns) and AJV run. Submit is blocked if either fails.
- Live validate: on blur, invalid controls get `is-invalid`; arrays/objects show container-level messages.

## QA checklist
- Arrays: add/remove at bounds (minItems/maxItems), Up/Down reorder, focus moves with item, buttons persist.
- oneOf/anyOf: switching branches re-renders only affected area, focus preserved or restored.
- Required: missing fields are highlighted (e.g., `address.street`), container error shown when field not present.
- Custom renderer: register a renderer and verify it renders and updates via `setValue/getValue`.

## Getting Started
1. Open `index.html` or deploy via GitHub Pages.
2. Paste JSON Schema and optional UI Schema, or click "Load example" buttons.
3. Click "Generate form" to render.
4. Fill and click "Submit" to validate and see JSON.
5. Click "Download JSON" to save the output.

## UI Schema
- Example in `schemas/example.uischema.json`.
- Supported types:
  - `VerticalLayout`: stack of elements
  - `HorizontalLayout`: row layout (auto columns)
  - `Group`: fieldset with `label`
  - `Control`: renders a schema control referenced by JSON Pointer `scope` (e.g., `#/properties/name`).

## Customization
- Use `x-ui-widget` for basic custom widgets:
  - String: `textarea`, `password`
  - Number/Integer: `range`
- For enums, you can provide labels via `enumNames` or `x-enumNames`.

## Notes
- No frameworks/libraries besides Bootstrap CDN.
- Formats mapped to HTML inputs: `email`, `url`, `date`, `date-time`, `time`.
- Limitations: No external `$ref` resolution, partial `allOf` support (object merge only), validation relies on HTML5 constraints.

## File Structure
- `index.html`: Main UI
- `js/app.js`: Schema parsing, form generation, data collection
- `css/styles.css`: Minor UI polishing
- `schemas/example.json`: Sample schema