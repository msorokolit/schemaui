# JSON Schema Form Generator (Vanilla JS + Bootstrap)

A lightweight, framework-free web app that generates Bootstrap forms from JSON Schema.

## Features
- Object, array, string, number, integer, boolean support
- `properties`, `required`, `enum`, `items`, `default`, `format`, and constraints
- Recursively nested forms, dynamic arrays (add/remove items)
- Client-side HTML5 validation, JSON output and download

## Getting Started
1. Open `index.html` in your browser (no server required).
2. Paste a JSON Schema into the Schema panel or click "Load example".
3. Click "Generate form" to render the form.
4. Fill the form and click "Submit" to see the JSON output.
5. Click "Download JSON" to save the output.

## Notes
- Uses Bootstrap 5 via CDN. No other frameworks/libraries.
- Supported JSON Schema formats mapped to HTML inputs: `email`, `url`, `date`, `date-time`, `time`.
- Arrays support both primitives and objects. Use the Add/Remove buttons to manage items.

## File Structure
- `index.html`: Main UI
- `js/app.js`: Schema parsing, form generation, data collection
- `css/styles.css`: Minor UI polishing
- `schemas/example.json`: Sample schema