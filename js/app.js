(function () {
  const schemaInput = document.getElementById('schema-input');
  const schemaFile = document.getElementById('schema-file');
  const loadExampleBtn = document.getElementById('load-example');
  const generateBtn = document.getElementById('generate-form');
  const clearSchemaBtn = document.getElementById('clear-schema');
  const resetFormBtn = document.getElementById('reset-form');
  const clearFormBtn = document.getElementById('clear-form');
  const submitBtn = document.getElementById('submit-form');
  const exportBtn = document.getElementById('export-json');
  const formContainer = document.getElementById('generated-form');
  const outputPre = document.getElementById('output');
  const uiSchemaInput = document.getElementById('uischema-input');
  const uiSchemaFile = document.getElementById('uischema-file');
  const loadUiExampleBtn = document.getElementById('load-ui-example');
  const clearUiSchemaBtn = document.getElementById('clear-uischema');
  const liveValidateToggle = document.getElementById('live-validate');
  const localeSelect = document.getElementById('locale');

  if (!window.SchemaFormLib) {
    console.error('SchemaFormLib not loaded');
    return;
  }

  let form = SchemaFormLib.create(formContainer, { liveValidate: false, locale: 'en' });

  function parseJsonOrAlert(text, label) {
    try { return JSON.parse(text); } catch (e) { alert(`Invalid ${label}: ${e.message}`); return null; }
  }

  loadExampleBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('schemas/example.json');
      schemaInput.value = await res.text();
    } catch (_) { alert('Failed to load example schema.'); }
  });

  loadUiExampleBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('schemas/example.uischema.json');
      uiSchemaInput.value = await res.text();
    } catch (_) { alert('Failed to load example UI schema.'); }
  });

  schemaFile.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return; schemaInput.value = await file.text();
  });
  uiSchemaFile.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return; uiSchemaInput.value = await file.text();
  });

  clearSchemaBtn.addEventListener('click', () => { schemaInput.value = ''; });
  clearUiSchemaBtn.addEventListener('click', () => { uiSchemaInput.value = ''; });

  generateBtn.addEventListener('click', async () => {
    const schema = parseJsonOrAlert(schemaInput.value.trim(), 'JSON Schema'); if (!schema) return;
    const uiSchema = uiSchemaInput.value.trim() ? parseJsonOrAlert(uiSchemaInput.value.trim(), 'UI Schema') : null;
    await form.load(schema, uiSchema || null);
    outputPre.textContent = '';
  });

  resetFormBtn.addEventListener('click', () => { form.regenerate(); outputPre.textContent = ''; });
  clearFormBtn.addEventListener('click', () => { form.setData({}); outputPre.textContent = ''; });

  submitBtn.addEventListener('click', () => {
    const { valid } = form.validate();
    if (!valid) { alert('Please fix validation errors.'); return; }
    outputPre.textContent = JSON.stringify(form.getData(), null, 2);
  });

  exportBtn.addEventListener('click', () => {
    const content = outputPre.textContent.trim(); if (!content) { alert('No data to download. Click Submit first.'); return; }
    const blob = new Blob([content], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'form-data.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  liveValidateToggle.addEventListener('change', () => { form.setLiveValidate(liveValidateToggle.checked); });
  localeSelect.addEventListener('change', () => { form.setLocale(localeSelect.value); });

  // Demo: events
  form.on('form:change', ({ detail: { data } }) => { /* could sync elsewhere */ });
  form.on('form:validate', ({ detail }) => { /* use detail.valid, detail.errors */ });

  // Autoload example on start
  (async function init() {
    try {
      const res = await fetch('schemas/example.json');
      const uiRes = await fetch('schemas/example.uischema.json');
      if (res.ok) {
        const schema = parseJsonOrAlert(await res.text(), 'JSON Schema');
        const uiSchema = uiRes.ok ? parseJsonOrAlert(await uiRes.text(), 'UI Schema') : null;
        schemaInput.value = JSON.stringify(schema, null, 2);
        if (uiSchema) uiSchemaInput.value = JSON.stringify(uiSchema, null, 2);
        await form.load(schema, uiSchema || null);
      }
    } catch (_) {}
  })();
})();