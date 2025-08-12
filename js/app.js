/*
  JSON Schema Form Generator (Vanilla JS + Bootstrap)
  - Supports types: object, array, string, number, integer, boolean
  - Handles: properties, required, enum, items, default, format, constraints
*/

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
  // UISchema elements
  const uiSchemaInput = document.getElementById('uischema-input');
  const uiSchemaFile = document.getElementById('uischema-file');
  const loadUiExampleBtn = document.getElementById('load-ui-example');
  const clearUiSchemaBtn = document.getElementById('clear-uischema');
  const liveValidateToggle = document.getElementById('live-validate');

  let currentSchema = null;
  let currentUiSchema = null;

  // Utilities
  function safeIdFromPath(path) {
    return path.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function getTitle(name, schema) {
    return schema.title || (name || '');
  }

  function createHelpText(text) {
    if (!text) return null;
    const small = document.createElement('div');
    small.className = 'form-text';
    small.textContent = text;
    return small;
  }

  function withInvalidFeedback(input) {
    // attach bootstrap invalid feedback container
    const feedback = document.createElement('div');
    feedback.className = 'invalid-feedback';
    feedback.textContent = input.getAttribute('data-invalid-message') || 'Please provide a valid value.';
    input.addEventListener('input', () => {
      if (liveValidateToggle && liveValidateToggle.checked) {
        input.classList.toggle('is-invalid', !input.checkValidity());
      }
    });
    return feedback;
  }

  function setConstraints(input, schema) {
    if (!schema) return;
    if (schema.readOnly) input.readOnly = true;
    if (schema.minLength != null) input.minLength = schema.minLength;
    if (schema.maxLength != null) input.maxLength = schema.maxLength;
    if (schema.minimum != null) input.min = schema.minimum;
    if (schema.maximum != null) input.max = schema.maximum;
    if (schema.exclusiveMinimum != null) input.min = schema.exclusiveMinimum + 1;
    if (schema.exclusiveMaximum != null) input.max = schema.exclusiveMaximum - 1;
    if (schema.multipleOf != null) input.step = schema.multipleOf;
    if (schema.pattern) input.pattern = schema.pattern;
    if (schema.placeholder) input.placeholder = schema.placeholder;
  }

  function applyDefault(input, schema) {
    if (schema && schema.default != null) {
      if (input.type === 'checkbox') {
        input.checked = Boolean(schema.default);
      } else if (input.tagName === 'SELECT') {
        input.value = String(schema.default);
      } else if (input.type === 'number') {
        input.value = String(schema.default);
      } else {
        input.value = String(schema.default);
      }
    }
  }

  function formatToInputType(format) {
    switch (format) {
      case 'email':
        return 'email';
      case 'uri':
      case 'url':
        return 'url';
      case 'date':
        return 'date';
      case 'date-time':
        return 'datetime-local';
      case 'time':
        return 'time';
      default:
        return 'text';
    }
  }

  function createInputControl(name, schema, path, isRequired) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    const id = safeIdFromPath(path);
    const label = document.createElement('label');
    label.className = 'form-label';
    label.setAttribute('for', id);
    label.textContent = getTitle(name, schema) + (isRequired ? ' *' : '');

    let control;

    if (schema.enum) {
      control = document.createElement('select');
      control.className = 'form-select';
      control.id = id;
      control.name = path;
      const hasEmpty = !isRequired && schema.default == null;
      if (hasEmpty) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '-- select --';
        control.appendChild(opt);
      }
      schema.enum.forEach((val, idx) => {
        const opt = document.createElement('option');
        opt.value = String(val);
        const labels = schema.enumNames || schema['x-enumNames'];
        opt.textContent = labels && labels[idx] ? String(labels[idx]) : String(val);
        control.appendChild(opt);
      });
      applyDefault(control, schema);
    } else if (schema.type === 'string') {
      const input = document.createElement('input');
      input.className = 'form-control';
      input.id = id;
      input.name = path;
      const widget = schema['x-ui-widget'];
      if (widget === 'textarea' || schema.format === 'textarea') {
        const ta = document.createElement('textarea');
        ta.className = 'form-control';
        ta.id = id;
        ta.name = path;
        setConstraints(ta, schema);
        applyDefault(ta, schema);
        if (isRequired) ta.required = true;
        wrapper.appendChild(label);
        wrapper.appendChild(ta);
        if (schema.description) wrapper.appendChild(createHelpText(schema.description));
        return wrapper;
      }
      input.type = widget === 'password' || schema.format === 'password' ? 'password' : (schema.format ? formatToInputType(schema.format) : 'text');
      setConstraints(input, schema);
      applyDefault(input, schema);
      control = input;
    } else if (schema.type === 'number' || schema.type === 'integer') {
      const input = document.createElement('input');
      input.className = 'form-control';
      input.id = id;
      input.name = path;
      const widget = schema['x-ui-widget'];
      input.type = widget === 'range' ? 'range' : 'number';
      if (schema.type === 'integer' && !schema.multipleOf) input.step = '1';
      setConstraints(input, schema);
      applyDefault(input, schema);
      control = input;
    } else if (schema.type === 'boolean') {
      const div = document.createElement('div');
      div.className = 'form-check';
      const input = document.createElement('input');
      input.className = 'form-check-input';
      input.type = 'checkbox';
      input.id = id;
      input.name = path;
      applyDefault(input, schema);
      const checkLabel = document.createElement('label');
      checkLabel.className = 'form-check-label';
      checkLabel.setAttribute('for', id);
      checkLabel.textContent = getTitle(name, schema);
      div.appendChild(input);
      div.appendChild(checkLabel);
      if (schema.description) div.appendChild(createHelpText(schema.description));
      if (isRequired) input.required = true;
      return div;
    } else {
      const input = document.createElement('input');
      input.className = 'form-control';
      input.id = id;
      input.name = path;
      input.type = 'text';
      control = input;
    }

    if (isRequired) control.required = true;

    wrapper.appendChild(label);
    wrapper.appendChild(control);
    wrapper.appendChild(withInvalidFeedback(control));
    if (schema.description) wrapper.appendChild(createHelpText(schema.description));

    return wrapper;
  }

  function createOneAnyOfGroup(name, schema, path, isRequired) {
    const isOne = Array.isArray(schema.oneOf);
    const options = isOne ? schema.oneOf : schema.anyOf || [];
    const container = document.createElement('div');
    container.className = 'mb-3';

    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = getTitle(name, schema) + (isRequired ? ' *' : '');
    container.appendChild(label);

    const select = document.createElement('select');
    select.className = 'form-select mb-2';
    options.forEach((opt, idx) => {
      const o = document.createElement('option');
      o.value = String(idx);
      o.textContent = opt.title || (isOne ? `oneOf #${idx + 1}` : `anyOf #${idx + 1}`);
      select.appendChild(o);
    });
    container.appendChild(select);

    const slot = document.createElement('div');
    container.appendChild(slot);

    function renderSelected() {
      slot.innerHTML = '';
      const idx = Number(select.value);
      const chosen = options[idx] || {};
      const child = createControlBySchema('', chosen, path, false);
      slot.appendChild(child);
    }

    select.addEventListener('change', renderSelected);
    select.value = '0';
    renderSelected();
    return container;
  }

  function mergeAllOf(schema) {
    if (!Array.isArray(schema.allOf)) return schema;
    const merged = { ...schema };
    delete merged.allOf;
    for (const sub of schema.allOf) {
      if (sub.type === 'object' && sub.properties) {
        merged.type = 'object';
        merged.properties = { ...(merged.properties || {}), ...sub.properties };
        if (sub.required) {
          merged.required = Array.from(new Set([...(merged.required || []), ...sub.required]));
        }
      }
    }
    return merged;
  }

  function createObjectGroup(name, schema, path, requiredSet) {
    schema = mergeAllOf(schema);
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'border rounded p-3 mb-3';

    if (name) {
      const legend = document.createElement('legend');
      legend.className = 'float-none w-auto px-2';
      legend.textContent = getTitle(name, schema);
      fieldset.appendChild(legend);
    }

    const properties = schema.properties || {};
    const required = new Set(schema.required || []);

    Object.keys(properties).forEach((propName) => {
      const propSchema = properties[propName];
      const childPath = path ? `${path}.${propName}` : propName;
      const isReq = required.has(propName);
      const element = createControlBySchema(propName, propSchema, childPath, isReq);
      fieldset.appendChild(element);
    });

    if (schema.description && !name) {
      fieldset.appendChild(createHelpText(schema.description));
    }

    return fieldset;
  }

  function createArrayGroup(name, schema, path, isRequired) {
    const container = document.createElement('div');
    container.className = 'mb-3';

    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = getTitle(name, schema) + (isRequired ? ' *' : '');
    container.appendChild(label);

    const list = document.createElement('div');
    list.className = 'array-items d-flex flex-column gap-3';
    list.dataset.path = path;
    container.appendChild(list);

    const controls = document.createElement('div');
    controls.className = 'd-flex gap-2';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-primary';
    addBtn.textContent = 'Add item';

    controls.appendChild(addBtn);
    container.appendChild(controls);

    const minItems = typeof schema.minItems === 'number' ? schema.minItems : 0;
    const maxItems = typeof schema.maxItems === 'number' ? schema.maxItems : Infinity;

    function updateAddState() {
      addBtn.disabled = list.children.length >= maxItems;
    }

    function updateRemoveState(itemWrapper) {
      const removeBtn = itemWrapper.querySelector('.btn-remove');
      if (!removeBtn) return;
      removeBtn.disabled = list.children.length <= minItems;
    }

    function addItem(initialData) {
      const index = list.children.length;
      const itemWrapper = document.createElement('div');
      itemWrapper.className = 'border rounded p-3 position-relative';

      const btnGroup = document.createElement('div');
      btnGroup.className = 'position-absolute d-flex gap-2';
      btnGroup.style.top = '8px';
      btnGroup.style.right = '8px';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'btn btn-sm btn-outline-secondary';
      upBtn.textContent = '↑';

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'btn btn-sm btn-outline-secondary';
      downBtn.textContent = '↓';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-sm btn-outline-danger btn-remove';
      removeBtn.textContent = 'Remove';

      btnGroup.appendChild(upBtn);
      btnGroup.appendChild(downBtn);
      btnGroup.appendChild(removeBtn);

      const itemPath = `${path}[${index}]`;
      const itemContent = createControlBySchema('', schema.items || {}, itemPath, false);

      itemWrapper.appendChild(btnGroup);
      itemWrapper.appendChild(itemContent);
      list.appendChild(itemWrapper);

      if (initialData !== undefined) {
        setValuesByPath(itemWrapper, schema.items || {}, itemPath, initialData);
      }

      removeBtn.addEventListener('click', () => {
        if (list.children.length <= minItems) return;
        itemWrapper.remove();
        renumberArrayItemNames(list, path);
        Array.from(list.children).forEach(updateRemoveState);
        updateAddState();
      });

      upBtn.addEventListener('click', () => {
        const prev = itemWrapper.previousElementSibling;
        if (prev) {
          list.insertBefore(itemWrapper, prev);
          renumberArrayItemNames(list, path);
        }
      });

      downBtn.addEventListener('click', () => {
        const next = itemWrapper.nextElementSibling;
        if (next) {
          list.insertBefore(next, itemWrapper);
          renumberArrayItemNames(list, path);
        }
      });

      updateRemoveState(itemWrapper);
      updateAddState();
    }

    addBtn.addEventListener('click', () => addItem());

    if (Array.isArray(schema.default)) {
      schema.default.forEach((val) => addItem(val));
    } else if (minItems > 0) {
      for (let i = 0; i < minItems; i++) addItem();
    }

    return container;
  }

  function renumberArrayItemNames(listElement, basePath) {
    Array.from(listElement.children).forEach((itemWrapper, newIndex) => {
      const inputs = itemWrapper.querySelectorAll('[name]');
      inputs.forEach((input) => {
        input.name = input.name.replace(new RegExp(`^${escapeRegExp(basePath)}\\[\\d+\\]`), `${basePath}[${newIndex}]`);
        if (input.id) {
          input.id = safeIdFromPath(input.name);
        }
      });
    });
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function createControlBySchema(name, schema, path, isRequired) {
    if (!schema || typeof schema !== 'object') {
      return createInputControl(name, { type: 'string' }, path, isRequired);
    }
    if (schema.allOf) {
      schema = mergeAllOf(schema);
    }
    if (schema.oneOf || schema.anyOf) {
      return createOneAnyOfGroup(name, schema, path, isRequired);
    }
    const type = schema.type;
    if (type === 'object' || (schema.properties && !type)) {
      return createObjectGroup(name, schema, path, isRequired);
    }
    if (type === 'array') {
      return createArrayGroup(name, schema, path, isRequired);
    }
    return createInputControl(name, schema, path, isRequired);
  }

  function clearForm() {
    formContainer.innerHTML = '';
  }

  function pointerToPath(pointer) {
    // e.g. #/properties/address/properties/city -> address.city
    if (!pointer) return '';
    const noHash = pointer.startsWith('#') ? pointer.slice(1) : pointer;
    const parts = noHash.split('/').filter(Boolean);
    const pathParts = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'properties') {
        i++;
        if (i < parts.length) pathParts.push(parts[i]);
      } else if (parts[i] === 'items') {
        // arrays: keep property path; items indicates array items
        // no push needed here
      }
    }
    return pathParts.join('.');
  }

  function isPathRequired(schema, path) {
    if (!path) return false;
    const segments = path.split('.');
    let node = schema;
    for (let i = 0; i < segments.length; i++) {
      const prop = segments[i];
      if (!node || !node.properties) return false;
      const req = node.required || [];
      if (i === segments.length - 1) return req.includes(prop);
      node = node.properties[prop];
    }
    return false;
  }

  function renderUiElement(element, schema) {
    if (!element || typeof element !== 'object') return document.createElement('div');
    switch (element.type) {
      case 'VerticalLayout': {
        const c = document.createElement('div');
        (element.elements || []).forEach((el) => c.appendChild(renderUiElement(el, schema)));
        return c;
      }
      case 'HorizontalLayout': {
        const row = document.createElement('div');
        row.className = 'row g-3';
        const children = element.elements || [];
        children.forEach((el) => {
          const col = document.createElement('div');
          col.className = `col-${Math.floor(12 / Math.min(children.length, 4))}`;
          col.appendChild(renderUiElement(el, schema));
          row.appendChild(col);
        });
        return row;
      }
      case 'Group': {
        const fs = document.createElement('fieldset');
        fs.className = 'border rounded p-3 mb-3';
        if (element.label) {
          const lg = document.createElement('legend');
          lg.className = 'float-none w-auto px-2';
          lg.textContent = element.label;
          fs.appendChild(lg);
        }
        (element.elements || []).forEach((el) => fs.appendChild(renderUiElement(el, schema)));
        return fs;
      }
      case 'Control': {
        const scope = element.scope;
        const path = pointerToPath(scope);
        const subSchema = findSchemaForPath(schema, path);
        const name = (element.label || (path.split('.').slice(-1)[0] || ''));
        const required = isPathRequired(schema, path);
        return createControlBySchema(name, subSchema, path, required);
      }
      default:
        return document.createElement('div');
    }
  }

  function generateFormFromSchema(schema, uiSchema) {
    clearForm();
    currentSchema = schema;
    currentUiSchema = uiSchema || null;
    let element;
    if (uiSchema) {
      element = renderUiElement(uiSchema, schema);
    } else {
      element = createControlBySchema('', schema, '', false);
    }
    formContainer.appendChild(element);
    if (liveValidateToggle) {
      formContainer.querySelectorAll('input,select,textarea').forEach((el) => {
        el.addEventListener('blur', () => {
          if (liveValidateToggle.checked) el.classList.toggle('is-invalid', !el.checkValidity());
        });
      });
    }
  }

  function parseSchemaText(text) {
    try {
      const obj = JSON.parse(text);
      if (!isObject(obj)) throw new Error('Schema must be a JSON object');
      return obj;
    } catch (err) {
      alert('Invalid JSON Schema: ' + err.message);
      return null;
    }
  }

  function parseJson(text, label) {
    try {
      const obj = JSON.parse(text);
      return obj;
    } catch (err) {
      alert(`Invalid ${label}: ` + err.message);
      return null;
    }
  }

  // Data collection
  function setNestedValue(root, path, value) {
    if (!path) return value;
    const tokens = tokenizePath(path);
    let node = root;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const isLast = i === tokens.length - 1;
      if (typeof t === 'number') {
        if (!Array.isArray(node)) {
          throw new Error('Path expects array at: ' + tokens.slice(0, i).join('.'));
        }
        if (isLast) {
          node[t] = value;
        } else {
          if (node[t] == null) {
            node[t] = typeof tokens[i + 1] === 'number' ? [] : {};
          }
          node = node[t];
        }
      } else {
        if (isLast) {
          node[t] = value;
        } else {
          if (node[t] == null) {
            node[t] = typeof tokens[i + 1] === 'number' ? [] : {};
          }
          node = node[t];
        }
      }
    }
    return root;
  }

  function tokenizePath(path) {
    // Convert a.b[0].c -> ['a', 'b', 0, 'c']
    const tokens = [];
    let i = 0;
    while (i < path.length) {
      if (path[i] === '.') {
        i++;
        continue;
      }
      if (path[i] === '[') {
        const close = path.indexOf(']', i);
        const idx = Number(path.slice(i + 1, close));
        tokens.push(idx);
        i = close + 1;
        continue;
      }
      let j = i;
      while (j < path.length && /[a-zA-Z0-9_-]/.test(path[j])) j++;
      tokens.push(path.slice(i, j));
      i = j;
    }
    return tokens.filter((t) => t !== '');
  }

  function coerceValue(schema, raw) {
    if (raw === '' || raw == null) return undefined;
    if (!schema || !schema.type) return raw;
    switch (schema.type) {
      case 'integer':
        return Number.parseInt(raw, 10);
      case 'number':
        return Number(raw);
      case 'boolean':
        return Boolean(raw);
      case 'string':
      default:
        return raw;
    }
  }

  function collectDataFromForm(schema) {
    const formData = {};

    // Check validity first
    if (!formContainer.checkValidity()) {
      formContainer.reportValidity();
      return null;
    }

    // Handle checkboxes separately (they don't appear in FormData when unchecked)
    const allControls = formContainer.querySelectorAll('[name]');

    allControls.forEach((el) => {
      const name = el.name;
      if (!name) return;

      let value;
      const subSchema = findSchemaForPath(schema, name);

      if (el.type === 'checkbox') {
        value = el.checked;
      } else if (el.tagName === 'SELECT') {
        value = el.value === '' ? undefined : el.value;
      } else if (el.type === 'number') {
        value = el.value === '' ? undefined : el.value;
      } else {
        value = el.value;
      }

      const coerced = coerceValue(subSchema, value);
      if (coerced !== undefined) setNestedValue(formData, name, coerced);
    });

    return formData;
  }

  function findSchemaForPath(schema, path) {
    const tokens = tokenizePath(path);
    let node = schema;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (typeof t === 'number') {
        node = node.items || {};
      } else {
        if (node && node.type === 'object') {
          node = (node.properties && node.properties[t]) || {};
        } else if (node && node.properties && !node.type) {
          node = node.properties[t] || {};
        }
      }
    }
    return node;
  }

  function setValuesByPath(rootElement, schema, basePath, value) {
    if (value === undefined) return;
    if (schema.type === 'object' || (schema.properties && !schema.type)) {
      const props = schema.properties || {};
      Object.keys(props).forEach((key) => {
        setValuesByPath(rootElement, props[key], basePath ? `${basePath}.${key}` : key, value[key]);
      });
    } else if (schema.type === 'array') {
      const list = rootElement.querySelector(`.array-items[data-path="${CSS.escape(basePath)}"]`);
      if (!list) return;
      list.innerHTML = '';
      const arr = Array.isArray(value) ? value : [];
      arr.forEach((itemVal, idx) => {
        const itemPath = `${basePath}[${idx}]`;
        const itemWrapper = document.createElement('div');
        itemWrapper.className = 'border rounded p-3 position-relative';
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-sm btn-outline-danger position-absolute';
        removeBtn.style.top = '8px';
        removeBtn.style.right = '8px';
        removeBtn.textContent = 'Remove';
        const itemContent = createControlBySchema('', schema.items || {}, itemPath, false);
        itemWrapper.appendChild(removeBtn);
        itemWrapper.appendChild(itemContent);
        list.appendChild(itemWrapper);
        setValuesByPath(itemWrapper, schema.items || {}, itemPath, itemVal);
        removeBtn.addEventListener('click', () => {
          itemWrapper.remove();
          renumberArrayItemNames(list, basePath);
        });
      });
    } else {
      const input = rootElement.querySelector(`[name="${CSS.escape(basePath)}"]`);
      if (!input) return;
      if (input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else {
        input.value = value == null ? '' : String(value);
      }
    }
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Event handlers
  loadExampleBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('schemas/example.json');
      const text = await res.text();
      schemaInput.value = text;
    } catch (e) {
      alert('Failed to load example schema.');
    }
  });

  schemaFile.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    schemaInput.value = text;
  });

  loadUiExampleBtn.addEventListener('click', async () => {
    try {
      const res = await fetch('schemas/example.uischema.json');
      const text = await res.text();
      uiSchemaInput.value = text;
    } catch (e) {
      alert('Failed to load example UI schema.');
    }
  });

  uiSchemaFile.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const text = await file.text();
    uiSchemaInput.value = text;
  });

  clearSchemaBtn.addEventListener('click', () => {
    schemaInput.value = '';
  });

  clearUiSchemaBtn.addEventListener('click', () => {
    uiSchemaInput.value = '';
  });

  generateBtn.addEventListener('click', () => {
    const schema = parseSchemaText(schemaInput.value.trim());
    if (!schema) return;
    const uiSchema = uiSchemaInput.value.trim() ? parseJson(uiSchemaInput.value.trim(), 'UI Schema') : null;
    if (uiSchemaInput.value.trim() && !uiSchema) return; // parse failed
    generateFormFromSchema(schema, uiSchema || null);
    outputPre.textContent = '';
  });

  resetFormBtn.addEventListener('click', () => {
    if (!currentSchema) return;
    generateFormFromSchema(currentSchema, currentUiSchema);
    outputPre.textContent = '';
  });

  clearFormBtn.addEventListener('click', () => {
    clearForm();
    outputPre.textContent = '';
  });

  submitBtn.addEventListener('click', () => {
    if (!currentSchema) {
      alert('Please generate a form from a schema first.');
      return;
    }
    const data = collectDataFromForm(currentSchema);
    if (!data) return;
    outputPre.textContent = JSON.stringify(data, null, 2);
  });

  exportBtn.addEventListener('click', () => {
    const content = outputPre.textContent.trim();
    if (!content) {
      alert('No data to download. Click Submit first.');
      return;
    }
    download('form-data.json', content);
  });

  // Autoload example on first load for convenience
  (async function init() {
    try {
      const res = await fetch('schemas/example.json');
      if (res.ok) {
        const text = await res.text();
        schemaInput.value = text;
        const schema = parseSchemaText(text);
        const uiRes = await fetch('schemas/example.uischema.json');
        if (uiRes.ok) {
          const uiText = await uiRes.text();
          uiSchemaInput.value = uiText;
          const uiSchema = parseJson(uiText, 'UI Schema');
          generateFormFromSchema(schema, uiSchema);
          return;
        }
        if (schema) generateFormFromSchema(schema);
      }
    } catch (_) {}
  })();
})();