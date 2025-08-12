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
  const localeSelect = document.getElementById('locale');

  let currentSchema = null;
  let currentUiSchema = null;
  let ajvInstance = null;
  let ajvValidate = null;

  // Simple event bus
  const bus = new Map();
  function on(event, handler) {
    if (!bus.has(event)) bus.set(event, new Set());
    bus.get(event).add(handler);
  }
  function off(event, handler) {
    const set = bus.get(event);
    if (set) set.delete(handler);
  }
  function emit(event, detail) {
    const payload = { event, detail };
    const set = bus.get(event);
    if (set) set.forEach((fn) => { try { fn(payload); } catch (_) {} });
    // namespaced field change events: field:change:path
    if (event === 'field:change' && detail && detail.path) {
      const ns = `field:change:${detail.path}`;
      const setNs = bus.get(ns);
      if (setNs) setNs.forEach((fn) => { try { fn(payload); } catch (_) {} });
    }
  }

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
    const feedback = document.createElement('div');
    feedback.className = 'invalid-feedback';
    feedback.textContent = input.getAttribute('data-invalid-message') || 'Please provide a valid value.';
    input.addEventListener('input', () => {
      if (liveValidateToggle && liveValidateToggle.checked) {
        input.classList.toggle('is-invalid', !input.checkValidity());
        validateAndShowAjvErrors();
      }
      const path = input.name;
      emit('field:change', { path, value: input.value });
      emit('form:change', { data: getCurrentData() });
    });
    input.addEventListener('change', () => {
      const path = input.name;
      emit('field:change', { path, value: input.value });
      emit('form:change', { data: getCurrentData() });
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
      } else if (input.type === 'number' || input.type === 'range') {
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

  function createFileControl(name, schema, path, isRequired) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';
    wrapper.dataset.path = path;
    const id = safeIdFromPath(path);
    const label = document.createElement('label');
    label.className = 'form-label';
    label.setAttribute('for', id);
    label.textContent = getTitle(name, schema) + (isRequired ? ' *' : '');

    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'form-control';
    input.id = id;
    input.name = path;
    if (schema.contentMediaType) input.accept = schema.contentMediaType;

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = path;

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) {
        hidden.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        hidden.value = String(dataUrl);
        if (liveValidateToggle && liveValidateToggle.checked) validateAndShowAjvErrors();
        emit('field:change', { path, value: hidden.value });
        emit('form:change', { data: getCurrentData() });
      };
      reader.readAsDataURL(file);
    });

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    wrapper.appendChild(hidden);
    wrapper.appendChild(withInvalidFeedback(input));
    if (schema.description) wrapper.appendChild(createHelpText(schema.description));
    return wrapper;
  }

  function createInputControl(name, schema, path, isRequired) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';
    wrapper.dataset.path = path;

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
        wrapper.appendChild(withInvalidFeedback(ta));
        if (schema.description) wrapper.appendChild(createHelpText(schema.description));
        return wrapper;
      }
      if (widget === 'file' || schema.contentEncoding === 'base64' || schema.contentMediaType) {
        return createFileControl(name, schema, path, isRequired);
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
    container.dataset.path = path;

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

    select.addEventListener('change', () => {
      renderSelected();
      emit('field:change', { path, value: select.value });
      emit('form:change', { data: getCurrentData() });
    });
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
    if (path) fieldset.dataset.path = path;

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
    container.dataset.path = path;

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
        if (liveValidateToggle && liveValidateToggle.checked) validateAndShowAjvErrors();
        emit('form:change', { data: getCurrentData() });
      });

      upBtn.addEventListener('click', () => {
        const prev = itemWrapper.previousElementSibling;
        if (prev) {
          list.insertBefore(itemWrapper, prev);
          renumberArrayItemNames(list, path);
          if (liveValidateToggle && liveValidateToggle.checked) validateAndShowAjvErrors();
          emit('form:change', { data: getCurrentData() });
        }
      });

      downBtn.addEventListener('click', () => {
        const next = itemWrapper.nextElementSibling;
        if (next) {
          list.insertBefore(next, itemWrapper);
          renumberArrayItemNames(list, path);
          if (liveValidateToggle && liveValidateToggle.checked) validateAndShowAjvErrors();
          emit('form:change', { data: getCurrentData() });
        }
      });

      updateRemoveState(itemWrapper);
      updateAddState();
      emit('form:change', { data: getCurrentData() });
    }

    addBtn.addEventListener('click', () => {
      addItem();
      if (liveValidateToggle && liveValidateToggle.checked) validateAndShowAjvErrors();
      emit('form:change', { data: getCurrentData() });
    });

    if (Array.isArray(schema.default)) {
      schema.default.forEach((val) => addItem(val));
    } else if (minItems > 0) {
      for (let i = 0; i < minItems; i++) addItem();
    }

    return container;
  }

  function createArrayTable(scopePath, arraySchema) {
    const container = document.createElement('div');
    container.className = 'mb-3';
    container.dataset.path = scopePath;
    const table = document.createElement('table');
    table.className = 'table table-sm table-striped align-middle';
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    const properties = (arraySchema.items && arraySchema.items.properties) || {};
    const cols = Object.keys(properties);

    const trh = document.createElement('tr');
    cols.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = getTitle(c, properties[c]);
      trh.appendChild(th);
    });
    const thAct = document.createElement('th');
    thAct.textContent = 'Actions';
    trh.appendChild(thAct);
    thead.appendChild(trh);

    function addRow(initialData) {
      const rowIndex = tbody.children.length;
      const tr = document.createElement('tr');
      cols.forEach((c) => {
        const td = document.createElement('td');
        const cellPath = `${scopePath}[${rowIndex}].${c}`;
        const ctrl = createInputControl(c, properties[c], cellPath, false);
        td.appendChild(ctrl);
        tr.appendChild(td);
      });
      const tdAct = document.createElement('td');
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn btn-sm btn-outline-danger';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        tr.remove();
        renumberArrayItemNames(tbody, scopePath);
        if (liveValidateToggle && liveValidateToggle.checked) validateAndShowAjvErrors();
        emit('form:change', { data: getCurrentData() });
      });
      tdAct.appendChild(rm);
      tr.appendChild(tdAct);
      tbody.appendChild(tr);

      if (initialData) {
        Object.keys(initialData).forEach((k) => {
          const input = tr.querySelector(`[name="${CSS.escape(`${scopePath}[${rowIndex}].${k}`)}"]`);
          if (input) input.value = String(initialData[k]);
        });
      }
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-primary';
    addBtn.textContent = 'Add row';
    addBtn.addEventListener('click', () => {
      addRow();
      if (liveValidateToggle && liveValidateToggle.checked) validateAndShowAjvErrors();
      emit('form:change', { data: getCurrentData() });
    });

    container.appendChild(table);
    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(addBtn);

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
    if (!pointer) return '';
    const noHash = pointer.startsWith('#') ? pointer.slice(1) : pointer;
    const parts = noHash.split('/').filter(Boolean);
    const pathParts = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === 'properties') {
        i++;
        if (i < parts.length) pathParts.push(parts[i]);
      } else if (parts[i] === 'items') {
        // arrays: no segment added here
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

  function renderCategorization(element, schema) {
    const tabsId = 'tabs_' + Math.random().toString(36).slice(2);
    const nav = document.createElement('ul');
    nav.className = 'nav nav-tabs mb-3';
    nav.role = 'tablist';

    const content = document.createElement('div');
    content.className = 'tab-content';

    (element.elements || []).forEach((cat, idx) => {
      if (!cat || cat.type !== 'Category') return;
      const tabId = `${tabsId}_tab_${idx}`;
      const paneId = `${tabsId}_pane_${idx}`;
      const li = document.createElement('li');
      li.className = 'nav-item';
      const a = document.createElement('button');
      a.className = `nav-link${idx === 0 ? ' active' : ''}`;
      a.id = tabId;
      a.dataset.bsToggle = 'tab';
      a.dataset.bsTarget = `#${paneId}`;
      a.type = 'button';
      a.role = 'tab';
      a.textContent = cat.label || `Category ${idx + 1}`;
      li.appendChild(a);
      nav.appendChild(li);

      const pane = document.createElement('div');
      pane.className = `tab-pane fade${idx === 0 ? ' show active' : ''}`;
      pane.id = paneId;
      pane.role = 'tabpanel';
      (cat.elements || []).forEach((el) => pane.appendChild(renderUiElement(el, schema)));
      content.appendChild(pane);
    });

    const wrapper = document.createElement('div');
    wrapper.appendChild(nav);
    wrapper.appendChild(content);
    return wrapper;
  }

  function renderListWithDetail(element, schema) {
    const arrayPath = pointerToPath(element.scope || '');
    const arraySchema = findSchemaForPath(schema, arrayPath);
    const wrapper = document.createElement('div');
    wrapper.className = 'row g-3';

    const listCol = document.createElement('div');
    listCol.className = 'col-4';
    const detailCol = document.createElement('div');
    detailCol.className = 'col-8';
    const listGroup = document.createElement('div');
    listGroup.className = 'list-group';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-sm btn-outline-primary mb-2';
    addBtn.textContent = 'Add item';

    let selectedIndex = 0;

    function renderList() {
      listGroup.innerHTML = '';
      const regex = new RegExp(`^${escapeRegExp(arrayPath)}\\\[(\\d+)\\]`);
      const names = new Set();
      formContainer.querySelectorAll('[name]').forEach((el) => {
        const m = el.name.match(regex);
        if (m) names.add(Number(m[1]));
      });
      const length = names.size || 0;
      for (let i = 0; i < length; i++) {
        const a = document.createElement('button');
        a.type = 'button';
        a.className = `list-group-item list-group-item-action${i === selectedIndex ? ' active' : ''}`;
        a.textContent = `Item ${i + 1}`;
        a.addEventListener('click', () => {
          selectedIndex = i;
          renderList();
          renderDetail();
        });
        listGroup.appendChild(a);
      }
    }

    function renderDetail() {
      detailCol.innerHTML = '';
      const itemPath = `${arrayPath}[${selectedIndex}]`;
      if (element.detail) {
        const adapted = renderUiElementWithBase(element.detail, schema, itemPath);
        detailCol.appendChild(adapted);
      } else {
        const child = createControlBySchema('', arraySchema.items || {}, itemPath, false);
        detailCol.appendChild(child);
      }
    }

    addBtn.addEventListener('click', () => {
      const arrContainer = createArrayGroup('', arraySchema, arrayPath, false);
      const addBtnInner = arrContainer.querySelector('button.btn-outline-primary');
      if (addBtnInner) addBtnInner.click();
      renderList();
      renderDetail();
      emit('form:change', { data: getCurrentData() });
    });

    listCol.appendChild(addBtn);
    listCol.appendChild(listGroup);
    wrapper.appendChild(listCol);
    wrapper.appendChild(detailCol);

    renderList();
    renderDetail();

    return wrapper;
  }

  function renderUiElementWithBase(element, schema, basePath) {
    if (!element || typeof element !== 'object') return document.createElement('div');
    switch (element.type) {
      case 'Control': {
        const path = `${basePath}${basePath ? '.' : ''}${pointerToPath(element.scope || '')}`;
        const subSchema = findSchemaForPath(schema, path);
        const name = element.label || (path.split('.').slice(-1)[0] || '');
        const required = isPathRequired(schema, path);
        const effective = applyUiOptionsToSchema(subSchema, element.options);
        const el = createControlBySchema(name, effective, path, required);
        return el;
      }
      default: {
        return renderUiElement(element, schema);
      }
    }
  }

  function applyUiOptionsToSchema(schema, options) {
    if (!options) return schema;
    const copy = { ...schema };
    if (options.widget) copy['x-ui-widget'] = options.widget;
    if (options.placeholder) copy.placeholder = options.placeholder;
    if (options.description) copy.description = options.description;
    return copy;
  }

  function renderUiElement(element, schema) {
    if (!element || typeof element !== 'object') return document.createElement('div');

    const container = document.createElement('div');
    container.className = 'mb-0';
    if (element.rule) {
      container.dataset.rule = JSON.stringify(element.rule);
      container.dataset.ruleScope = element.rule.condition?.scope || '';
    }

    let rendered;
    switch (element.type) {
      case 'VerticalLayout': {
        const c = document.createElement('div');
        (element.elements || []).forEach((el) => c.appendChild(renderUiElement(el, schema)));
        rendered = c;
        break;
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
        rendered = row;
        break;
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
        rendered = fs;
        break;
      }
      case 'Control': {
        const scope = element.scope;
        const path = pointerToPath(scope);
        if (element.renderer === 'Table') {
          const arrSchema = findSchemaForPath(schema, path);
          rendered = createArrayTable(path, arrSchema);
          break;
        }
        if (element.renderer === 'ListWithDetail') {
          rendered = renderListWithDetail(element, schema);
          break;
        }
        const subSchema = findSchemaForPath(schema, path);
        const name = (element.label || (path.split('.').slice(-1)[0] || ''));
        const required = isPathRequired(schema, path);
        const effective = applyUiOptionsToSchema(subSchema, element.options);
        rendered = createControlBySchema(name, effective, path, required);
        break;
      }
      case 'Categorization': {
        rendered = renderCategorization(element, schema);
        break;
      }
      case 'ListWithDetail': {
        rendered = renderListWithDetail(element, schema);
        break;
      }
      case 'Table': {
        const path = pointerToPath(element.scope || '');
        const arrSchema = findSchemaForPath(schema, path);
        rendered = createArrayTable(path, arrSchema);
        break;
      }
      default:
        rendered = document.createElement('div');
    }

    if (element.rule) {
      rendered.dataset.rule = JSON.stringify(element.rule);
      rendered.dataset.ruleScope = element.rule.condition?.scope || '';
    }

    container.appendChild(rendered);
    return container;
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
        el.addEventListener('input', () => {
          applyUiRules();
        });
      });
    }
    initAjv(schema).then(() => validateAndShowAjvErrors());
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

    if (!formContainer.checkValidity()) {
      formContainer.reportValidity();
    }

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
      } else if (el.type === 'number' || el.type === 'range') {
        value = el.value === '' ? undefined : el.value;
      } else if (el.type === 'file') {
        return;
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

  async function initAjv(schema) {
    try {
      const AjvCtor = window.ajv || window.Ajv;
      if (!AjvCtor) return;
      ajvInstance = new AjvCtor({ allErrors: true, strict: false, messages: true });
      if (window.ajvFormats) {
        try { window.ajvFormats(ajvInstance); } catch (_) {}
        try { window.ajvFormats.default && window.ajvFormats.default(ajvInstance); } catch (_) {}
      }
      ajvValidate = ajvInstance.compile(schema);
    } catch (e) {
      console.warn('AJV init failed', e);
    }
  }

  function ajvInstancePathToNamePath(instancePath) {
    if (!instancePath) return '';
    const parts = instancePath.split('/').slice(1);
    let name = '';
    parts.forEach((p) => {
      if (p === '') return;
      const key = p.replace(/~1/g, '/').replace(/~0/g, '~');
      if (/^\d+$/.test(key)) {
        name += `[${Number(key)}]`;
      } else {
        name += name ? `.${key}` : key;
      }
    });
    return name;
  }

  function clearAllFieldErrors() {
    formContainer.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    formContainer.querySelectorAll('.invalid-feedback').forEach((el) => { el.textContent = 'Please provide a valid value.'; });
  }

  const i18n = {
    en: (err) => err.message || 'Invalid value',
    de: (err) => {
      const map = { required: 'Pflichtfeld fehlt', minimum: 'Wert ist zu klein', maximum: 'Wert ist zu groß', pattern: 'Ungültiges Format', type: 'Falscher Typ' };
      return map[err.keyword] || err.message || 'Ungültiger Wert';
    },
    es: (err) => {
      const map = { required: 'Falta un campo obligatorio', minimum: 'Valor demasiado bajo', maximum: 'Valor demasiado alto', pattern: 'Formato inválido', type: 'Tipo incorrecto' };
      return map[err.keyword] || err.message || 'Valor inválido';
    },
    fr: (err) => {
      const map = { required: 'Champ obligatoire manquant', minimum: 'Valeur trop petite', maximum: 'Valeur trop grande', pattern: 'Format invalide', type: 'Type incorrect' };
      return map[err.keyword] || err.message || 'Valeur invalide';
    },
    zh: (err) => {
      const map = { required: '缺少必填字段', minimum: '值太小', maximum: '值太大', pattern: '格式无效', type: '类型不正确' };
      return map[err.keyword] || err.message || '无效的值';
    },
  };
  function getLocaleMessage(err) {
    const loc = (localeSelect && localeSelect.value) || 'en';
    const fn = i18n[loc] || i18n.en;
    return fn(err);
  }

  function setFieldError(namePath, messageOrErr) {
    if (!namePath) return;
    const el = formContainer.querySelector(`[name="${CSS.escape(namePath)}"]`);
    if (!el) return;
    el.classList.add('is-invalid');
    const feedback = el.parentElement && el.parentElement.querySelector('.invalid-feedback');
    const message = typeof messageOrErr === 'string' ? messageOrErr : getLocaleMessage(messageOrErr);
    if (feedback) feedback.textContent = message || 'Invalid value';
  }

  function validateAndShowAjvErrors() {
    if (!ajvValidate || !currentSchema) return true;
    const data = collectDataFromForm(currentSchema);
    if (!data) return false;
    clearAllFieldErrors();
    const valid = ajvValidate(data);
    if (!valid && Array.isArray(ajvValidate.errors)) {
      ajvValidate.errors.forEach((err) => {
        const name = ajvInstancePathToNamePath(err.instancePath || '');
        if (name) setFieldError(name, err);
      });
    }
    applyUiRules();
    emit('form:validate', { valid, errors: ajvValidate.errors || [] });
    return valid;
  }

  function getCurrentData() {
    if (!currentSchema) return {};
    return collectDataFromForm(currentSchema) || {};
  }

  function evaluateCondition(cond, data) {
    if (!cond) return true;
    const path = pointerToPath(cond.scope || '');
    const tokens = tokenizePath(path);
    let node = data;
    for (const t of tokens) {
      if (node == null) break;
      if (typeof t === 'number') node = Array.isArray(node) ? node[t] : undefined;
      else node = node[t];
    }
    if ('equals' in cond) return node === cond.equals;
    if (cond.schema && 'const' in cond.schema) return node === cond.schema.const;
    return Boolean(node);
  }

  function applyRuleToElement(el, rule, data) {
    const pass = evaluateCondition(rule.condition, data);
    const effect = rule.effect || 'HIDE';
    if (effect === 'HIDE') {
      el.classList.toggle('d-none', !pass);
    } else if (effect === 'DISABLE') {
      const inputs = el.querySelectorAll('input,select,textarea,button');
      inputs.forEach((inp) => inp.disabled = !pass);
    }
  }

  const dynamicRules = [];
  function applyUiRules() {
    const data = getCurrentData();
    formContainer.querySelectorAll('[data-rule]').forEach((container) => {
      try {
        const rule = JSON.parse(container.dataset.rule);
        applyRuleToElement(container, rule, data);
      } catch (_) {}
    });
    dynamicRules.forEach((rule) => {
      const targetPath = pointerToPath(rule.target || rule.condition?.scope || '');
      const targetEl = findContainerByPath(targetPath);
      if (targetEl) applyRuleToElement(targetEl, rule, data);
    });
  }

  function findContainerByPath(path) {
    if (!path) return null;
    let el = formContainer.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (el) return el;
    const input = formContainer.querySelector(`[name="${CSS.escape(path)}"]`);
    if (!input) return null;
    el = input.closest('[data-path]') || input.closest('.mb-3') || input.closest('fieldset');
    return el;
  }

  function getValue(path) {
    const data = getCurrentData();
    const tokens = tokenizePath(path);
    let node = data;
    for (const t of tokens) {
      if (node == null) return undefined;
      node = typeof t === 'number' ? node[t] : node[t];
    }
    return node;
  }

  function setValue(path, value) {
    const subSchema = findSchemaForPath(currentSchema, path);
    setValuesByPath(formContainer, subSchema, path, value);
    emit('field:change', { path, value });
    emit('form:change', { data: getCurrentData() });
    validateAndShowAjvErrors();
  }

  function setData(data) {
    if (!currentSchema) return;
    setValuesByPath(formContainer, currentSchema, '', data);
    emit('form:change', { data: getCurrentData() });
    validateAndShowAjvErrors();
  }

  function show(path) {
    const el = findContainerByPath(path);
    if (el) el.classList.remove('d-none');
  }
  function hide(path) {
    const el = findContainerByPath(path);
    if (el) el.classList.add('d-none');
  }
  function enable(path) {
    const el = findContainerByPath(path);
    if (el) el.querySelectorAll('input,select,textarea,button').forEach((e) => e.disabled = false);
  }
  function disable(path) {
    const el = findContainerByPath(path);
    if (el) el.querySelectorAll('input,select,textarea,button').forEach((e) => e.disabled = true);
  }
  function focus(path) {
    const input = formContainer.querySelector(`[name="${CSS.escape(path)}"]`);
    if (input) input.focus();
  }

  if (localeSelect) {
    localeSelect.addEventListener('change', () => validateAndShowAjvErrors());
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

  generateBtn.addEventListener('click', async () => {
    const schema = parseSchemaText(schemaInput.value.trim());
    if (!schema) return;
    const uiSchema = uiSchemaInput.value.trim() ? parseJson(uiSchemaInput.value.trim(), 'UI Schema') : null;
    if (uiSchemaInput.value.trim() && !uiSchema) return;
    generateFormFromSchema(schema, uiSchema || null);
    await initAjv(schema);
    validateAndShowAjvErrors();
    outputPre.textContent = '';
    emit('form:change', { data: getCurrentData() });
  });

  resetFormBtn.addEventListener('click', () => {
    if (!currentSchema) return;
    generateFormFromSchema(currentSchema, currentUiSchema);
    validateAndShowAjvErrors();
    outputPre.textContent = '';
    emit('form:change', { data: getCurrentData() });
  });

  clearFormBtn.addEventListener('click', () => {
    clearForm();
    outputPre.textContent = '';
    emit('form:change', { data: {} });
  });

  submitBtn.addEventListener('click', () => {
    if (!currentSchema) {
      alert('Please generate a form from a schema first.');
      return;
    }
    const ok = validateAndShowAjvErrors();
    if (!ok) {
      alert('Please fix validation errors.');
      return;
    }
    const data = collectDataFromForm(currentSchema);
    if (!data) return;
    outputPre.textContent = JSON.stringify(data, null, 2);
    emit('form:submit', { data });
  });

  exportBtn.addEventListener('click', () => {
    const content = outputPre.textContent.trim();
    if (!content) {
      alert('No data to download. Click Submit first.');
      return;
    }
    download('form-data.json', content);
  });

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
          await initAjv(schema);
          validateAndShowAjvErrors();
          emit('form:change', { data: getCurrentData() });
          return;
        }
        if (schema) {
          generateFormFromSchema(schema);
          await initAjv(schema);
          validateAndShowAjvErrors();
          emit('form:change', { data: getCurrentData() });
        }
      }
    } catch (_) {}
  })();

  // Expose minimal API
  window.SchemaForm = {
    on, off,
    getData: () => getCurrentData(),
    setData,
    getValue,
    setValue,
    show, hide, enable, disable, focus,
    addRule: (rule) => { dynamicRules.push(rule); applyUiRules(); },
    clearRules: () => { dynamicRules.length = 0; applyUiRules(); },
    validate: () => ({ valid: validateAndShowAjvErrors(), errors: (ajvValidate && ajvValidate.errors) || [] }),
    regenerate: () => { if (currentSchema) generateFormFromSchema(currentSchema, currentUiSchema); },
    load: (schema, uiSchema) => { generateFormFromSchema(schema, uiSchema || null); initAjv(schema).then(validateAndShowAjvErrors); }
  };
})();