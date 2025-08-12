# JSON Schema Form Generator (Vanilla JS + Bootstrap)

A lightweight, framework-free web app that generates Bootstrap forms from JSON Schema.

## Features
- Object, array, string, number, integer, boolean
- `properties`, `required`, `enum`, `items`, `default`, `format` and constraints
- `oneOf`/`anyOf` selectors, basic `allOf` merge for objects
- Arrays: add/remove, reorder, `minItems`/`maxItems`
- Optional UI Schema for layout and labels: `VerticalLayout`, `HorizontalLayout`, `Group`, `Control`
- Client-side HTML5 validation with optional live validation
- JSON output preview and download

## Getting Started
1. Open `index.html` in your browser (no server required) or via GitHub Pages.
2. Paste a JSON Schema into the Schema panel, optionally a UI Schema into UI Schema panel, or click "Load example" buttons.
3. Click "Generate form" to render the form.
4. Fill the form and click "Submit" to see the JSON output.
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