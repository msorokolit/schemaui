/* SchemaForm Library (Vanilla JS)
   - Create unlimited instances bound to a container
   - Features: JSON Schema + UI Schema rendering, oneOf/anyOf, allOf merge, arrays (reorder/min/max), enum labels, widgets, rules, AJV validation, i18n, event bus, programmatic API
   - Usage: const form = SchemaFormLib.create(containerEl, { liveValidate: true, locale: 'en' }); form.load(schema, uiSchema);
*/
(function (global) {
  'use strict';

  // Global custom renderer registry
  // Each renderer: { name?: string, tester?: (ctx) => number, render: (ctx) => HTMLElement }
  // ctx: { element, uiSchema, controlSchema, rootSchema, path, label, required, instance, utils:{ createDefault }, emit, setValue, getValue, validate }
  const globalRenderers = [];

  class SchemaForm {
    constructor(rootEl, options = {}) {
      if (!rootEl) throw new Error('SchemaForm requires a root element');
      this.rootEl = rootEl;
      // Create inner form element if root is not a form
      this.formEl = rootEl.tagName === 'FORM' ? rootEl : this._createForm(rootEl);

      this.options = options;
      this.schema = null;
      this.uiSchema = null;
      this.liveValidate = Boolean(options.liveValidate);
      this.locale = options.locale || 'en';

      this.ajvInstance = null;
      this.ajvValidate = null;

      // Event bus per instance
      this._bus = new Map();

      // Per-instance renderer registry (copy from global + any provided in options)
      this._renderers = Array.isArray(options.renderers) ? [...globalRenderers, ...options.renderers] : [...globalRenderers];

      // Pre-bind
      this._onInputValidate = this._onInputValidate.bind(this);
    }

    // Public API
    async load(schema, uiSchema) {
      this.schema = schema || {};
      this.uiSchema = uiSchema || null;
      this._render();
      await this._initAjv(this.schema);
      this.validate();
      this._emit('form:change', { data: this.getData() });
    }

    regenerate() {
      if (!this.schema) return;
      this._render();
      this.validate();
    }

    setLiveValidate(enabled) {
      this.liveValidate = Boolean(enabled);
      this.validate();
    }

    setLocale(locale) {
      this.locale = locale || 'en';
      this.validate();
    }

    on(event, handler) {
      if (!this._bus.has(event)) this._bus.set(event, new Set());
      this._bus.get(event).add(handler);
    }

    off(event, handler) {
      const set = this._bus.get(event);
      if (set) set.delete(handler);
    }

    // Renderer registry (instance)
    registerRenderer(def) {
      if (def && typeof def.render === 'function') this._renderers.push(def);
    }
    clearRenderers() { this._renderers = [...globalRenderers]; }

    getData() {
      return this._collectDataFromForm(this.schema) || {};
    }

    setData(data) {
      if (!this.schema) return;
      this._setValuesByPath(this.formEl, this.schema, '', data);
      this._emit('form:change', { data: this.getData() });
      this.validate();
    }

    getValue(path) {
      const data = this.getData();
      const tokens = this._tokenizePath(path);
      let node = data;
      for (const t of tokens) {
        if (node == null) return undefined;
        node = typeof t === 'number' ? node[t] : node[t];
      }
      return node;
    }

    setValue(path, value) {
      const subSchema = this._findSchemaForPath(this.schema, path);
      const activeName = (this.formEl.contains(document.activeElement) && document.activeElement.name) ? document.activeElement.name : null;
      this._setValuesByPath(this.formEl, subSchema, path, value);
      if (activeName) {
        const refocus = this.formEl.querySelector(`[name="${CSS.escape(activeName)}"]`);
        if (refocus) refocus.focus();
      }
      this._emit('field:change', { path, value });
      this._emit('form:change', { data: this.getData() });
      this.validate();
    }

    focus(path) {
      const input = this.formEl.querySelector(`[name="${CSS.escape(path)}"]`);
      if (input) input.focus();
    }

    show(path) { const el = this._findContainerByPath(path); if (el) el.classList.remove('d-none'); }
    hide(path) { const el = this._findContainerByPath(path); if (el) el.classList.add('d-none'); }
    enable(path) { const el = this._findContainerByPath(path); if (el) el.querySelectorAll('input,select,textarea,button').forEach((e) => e.disabled = false); }
    disable(path) { const el = this._findContainerByPath(path); if (el) el.querySelectorAll('input,select,textarea,button').forEach((e) => e.disabled = true); }

    addRule(rule) { if (!this._dynamicRules) this._dynamicRules = []; this._dynamicRules.push(rule); this._applyUiRules(); }
    clearRules() { this._dynamicRules = []; this._applyUiRules(); }

    validate() {
      if (!this.schema) return { valid: false, errors: [{ message: 'No schema loaded' }] };
      const data = this.getData();
      this._clearAllFieldErrors();
      // HTML5 validity pass (non-blocking UI feedback)
      const controls = this.formEl.querySelectorAll('input,select,textarea');
      let htmlValid = true;
      controls.forEach((el) => {
        if (!el.checkValidity()) {
          htmlValid = false;
          el.classList.add('is-invalid');
        }
      });
      // AJV validity pass
      let ajvValid = true;
      let ajvErrors = [];
      if (this.ajvValidate) {
        ajvValid = this.ajvValidate(data);
        if (!ajvValid && Array.isArray(this.ajvValidate.errors)) {
          ajvErrors = this.ajvValidate.errors;
          ajvErrors.forEach((err) => {
            const name = this._namePathFromAjvError(err);
            this._setFieldError(name, err);
          });
        }
      }
      const overall = htmlValid && ajvValid;
      this._applyUiRules();
      this._emit('form:validate', { valid: overall, errors: ajvErrors });
      return { valid: overall, errors: ajvErrors };
    }

    // Private internals
    _emit(event, detail) {
      const payload = { event, detail };
      const set = this._bus.get(event);
      if (set) set.forEach((fn) => { try { fn(payload); } catch (_) {} });
      if (event === 'field:change' && detail && detail.path) {
        const ns = `field:change:${detail.path}`;
        const setNs = this._bus.get(ns);
        if (setNs) setNs.forEach((fn) => { try { fn(payload); } catch (_) {} });
      }
    }

    _createForm(root) {
      const form = document.createElement('form');
      form.noValidate = true;
      root.innerHTML = '';
      root.appendChild(form);
      return form;
    }

    _render() {
      this.formEl.innerHTML = '';
      const element = this.uiSchema ? this._renderUiElement(this.uiSchema, this.schema) : this._createControlBySchema('', this.schema, '', false);
      this.formEl.appendChild(element);
      this.formEl.querySelectorAll('input,select,textarea').forEach((el) => {
        el.addEventListener('blur', this._onInputValidate);
        el.addEventListener('input', () => {
          // Lightweight: update rules and emit change without re-rendering
          this._applyUiRules();
          this._emit('form:change', { data: this.getData() });
        });
        el.addEventListener('change', () => {
          this._emit('field:change', { path: el.name, value: el.value });
          this._emit('form:change', { data: this.getData() });
        });
      });
    }

    _onInputValidate(e) {
      if (this.liveValidate) {
        // Only mark the blurred field invalid to avoid jumping focus globally
        e.target.classList.toggle('is-invalid', !e.target.checkValidity());
        this.validate();
      }
    }

    async _initAjv(schema) {
      try {
        const AjvCtor = global.ajv || global.Ajv;
        if (!AjvCtor) return;
        this.ajvInstance = new AjvCtor({ allErrors: true, strict: false, messages: true });
        if (global.ajvFormats) {
          try { global.ajvFormats(this.ajvInstance); } catch (_) {}
          try { global.ajvFormats.default && global.ajvFormats.default(this.ajvInstance); } catch (_) {}
        }
        this.ajvValidate = this.ajvInstance.compile(schema);
      } catch (e) { console.warn('AJV init failed', e); }
    }

    // Rendering helpers (adapted from the original app)
    _getTitle(name, schema) { return schema.title || (name || ''); }

    _createHelpText(text) {
      if (!text) return null;
      const small = document.createElement('div');
      small.className = 'form-text';
      small.textContent = text;
      return small;
    }

    _withInvalidFeedback(input) {
      const feedback = document.createElement('div');
      feedback.className = 'invalid-feedback';
      feedback.textContent = 'Please provide a valid value.';
      input.addEventListener('input', () => {
        if (this.liveValidate) {
          input.classList.toggle('is-invalid', !input.checkValidity());
          this.validate();
        }
        this._emit('field:change', { path: input.name, value: input.value });
        this._emit('form:change', { data: this.getData() });
      });
      input.addEventListener('change', () => {
        this._emit('field:change', { path: input.name, value: input.value });
        this._emit('form:change', { data: this.getData() });
      });
      return feedback;
    }

    _setConstraints(input, schema) {
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

    _applyDefault(input, schema) {
      if (schema && schema.default != null) {
        if (input.type === 'checkbox') input.checked = Boolean(schema.default);
        else input.value = String(schema.default);
      }
    }

    _formatToInputType(format) {
      switch (format) {
        case 'email': return 'email';
        case 'uri': case 'url': return 'url';
        case 'date': return 'date';
        case 'date-time': return 'datetime-local';
        case 'time': return 'time';
        default: return 'text';
      }
    }

    _createFileControl(name, schema, path, isRequired) {
      const wrapper = document.createElement('div');
      wrapper.className = 'mb-3';
      wrapper.dataset.path = path;
      const id = this._safeId(path);
      const label = document.createElement('label');
      label.className = 'form-label';
      label.setAttribute('for', id);
      label.textContent = this._getTitle(name, schema) + (isRequired ? ' *' : '');

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
        if (!file) { hidden.value = ''; return; }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result;
          hidden.value = String(dataUrl);
          if (this.liveValidate) this.validate();
          this._emit('field:change', { path, value: hidden.value });
          this._emit('form:change', { data: this.getData() });
        };
        reader.readAsDataURL(file);
      });

      wrapper.appendChild(label);
      wrapper.appendChild(input);
      wrapper.appendChild(hidden);
      wrapper.appendChild(this._withInvalidFeedback(input));
      if (schema.description) wrapper.appendChild(this._createHelpText(schema.description));
      return wrapper;
    }

    _createInputControl(name, schema, path, isRequired) {
      const wrapper = document.createElement('div');
      wrapper.className = 'mb-3';
      wrapper.dataset.path = path;

      const id = this._safeId(path);
      const label = document.createElement('label');
      label.className = 'form-label';
      label.setAttribute('for', id);
      label.textContent = this._getTitle(name, schema) + (isRequired ? ' *' : '');

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
        this._applyDefault(control, schema);
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
          this._setConstraints(ta, schema);
          this._applyDefault(ta, schema);
          if (isRequired) ta.required = true;
          wrapper.appendChild(label);
          wrapper.appendChild(ta);
          wrapper.appendChild(this._withInvalidFeedback(ta));
          if (schema.description) wrapper.appendChild(this._createHelpText(schema.description));
          return wrapper;
        }
        if (widget === 'file' || schema.contentEncoding === 'base64' || schema.contentMediaType) {
          return this._createFileControl(name, schema, path, isRequired);
        }
        input.type = widget === 'password' || schema.format === 'password' ? 'password' : (schema.format ? this._formatToInputType(schema.format) : 'text');
        this._setConstraints(input, schema);
        this._applyDefault(input, schema);
        control = input;
      } else if (schema.type === 'number' || schema.type === 'integer') {
        const input = document.createElement('input');
        input.className = 'form-control';
        input.id = id;
        input.name = path;
        const widget = schema['x-ui-widget'];
        input.type = widget === 'range' ? 'range' : 'number';
        if (schema.type === 'integer' && !schema.multipleOf) input.step = '1';
        this._setConstraints(input, schema);
        this._applyDefault(input, schema);
        control = input;
      } else if (schema.type === 'boolean') {
        const div = document.createElement('div');
        div.className = 'form-check';
        const input = document.createElement('input');
        input.className = 'form-check-input';
        input.type = 'checkbox';
        input.id = id;
        input.name = path;
        this._applyDefault(input, schema);
        const checkLabel = document.createElement('label');
        checkLabel.className = 'form-check-label';
        checkLabel.setAttribute('for', id);
        checkLabel.textContent = this._getTitle(name, schema);
        div.appendChild(input);
        div.appendChild(checkLabel);
        if (schema.description) div.appendChild(this._createHelpText(schema.description));
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
      wrapper.appendChild(this._withInvalidFeedback(control));
      if (schema.description) wrapper.appendChild(this._createHelpText(schema.description));

      return wrapper;
    }

    _createOneAnyOfGroup(name, schema, path, isRequired) {
      const isOne = Array.isArray(schema.oneOf);
      const options = isOne ? schema.oneOf : schema.anyOf || [];
      const container = document.createElement('div');
      container.className = 'mb-3';
      container.dataset.path = path;

      const label = document.createElement('label');
      label.className = 'form-label';
      label.textContent = this._getTitle(name, schema) + (isRequired ? ' *' : '');
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

      const renderSelected = () => {
        slot.innerHTML = '';
        const idx = Number(select.value);
        const chosen = options[idx] || {};
        const child = this._createControlBySchema('', chosen, path, false);
        slot.appendChild(child);
      };

      select.addEventListener('change', () => { renderSelected(); this._emit('field:change', { path, value: select.value }); this._emit('form:change', { data: this.getData() }); this.validate(); });
      select.value = '0';
      renderSelected();
      return container;
    }

    _mergeAllOf(schema) {
      if (!Array.isArray(schema.allOf)) return schema;
      const merged = { ...schema };
      delete merged.allOf;
      for (const sub of schema.allOf) {
        if (sub.type === 'object' && sub.properties) {
          merged.type = 'object';
          merged.properties = { ...(merged.properties || {}), ...sub.properties };
          if (sub.required) merged.required = Array.from(new Set([...(merged.required || []), ...sub.required]));
        }
      }
      return merged;
    }

    _createObjectGroup(name, schema, path) {
      schema = this._mergeAllOf(schema);
      const fieldset = document.createElement('fieldset');
      fieldset.className = 'border rounded p-3 mb-3';
      if (path) fieldset.dataset.path = path;

      if (name) {
        const legend = document.createElement('legend');
        legend.className = 'float-none w-auto px-2';
        legend.textContent = this._getTitle(name, schema);
        fieldset.appendChild(legend);
      }

      const properties = schema.properties || {};
      const required = new Set(schema.required || []);

      Object.keys(properties).forEach((propName) => {
        const propSchema = properties[propName];
        const childPath = path ? `${path}.${propName}` : propName;
        const isReq = required.has(propName);
        const element = this._createControlBySchema(propName, propSchema, childPath, isReq);
        fieldset.appendChild(element);
      });

      if (schema.description && !name) fieldset.appendChild(this._createHelpText(schema.description));
      return fieldset;
    }

    _createArrayGroup(name, schema, path, isRequired) {
      const container = document.createElement('div');
      container.className = 'mb-3';
      container.dataset.path = path;

      const label = document.createElement('label');
      label.className = 'form-label';
      label.textContent = this._getTitle(name, schema) + (isRequired ? ' *' : '');
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

      const updateAddState = () => { addBtn.disabled = list.children.length >= maxItems; };
      const updateRemoveState = (itemWrapper) => { const removeBtn = itemWrapper.querySelector('.btn-remove'); if (removeBtn) removeBtn.disabled = list.children.length <= minItems; };

      const addItem = (initialData) => {
        const current = this.getValue(path) || [];
        if (current.length >= maxItems) return;
        const next = current.slice();
        next.push(initialData !== undefined ? initialData : (schema.items && schema.items.type === 'object' ? {} : undefined));
        this.setValue(path, next);
        this._focusFirstInputInItem(path, next.length - 1);
      };

      addBtn.addEventListener('click', () => { addItem(); });

      if (Array.isArray(schema.default)) {
        schema.default.forEach((val, idx) => this._buildArrayItem(list, schema, path, idx, val));
      } else if (minItems > 0) {
        for (let i = 0; i < minItems; i++) {
          this._buildArrayItem(list, schema, path, i, (schema.items && schema.items.type === 'object') ? {} : undefined);
        }
      }
      updateAddState();

      return container;
    }

    _createArrayTable(scopePath, arraySchema) {
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
      cols.forEach((c) => { const th = document.createElement('th'); th.textContent = this._getTitle(c, properties[c]); trh.appendChild(th); });
      const thAct = document.createElement('th'); thAct.textContent = 'Actions'; trh.appendChild(thAct);
      thead.appendChild(trh);

      const addRow = (initialData) => {
        const rowIndex = tbody.children.length;
        const tr = document.createElement('tr');
        cols.forEach((c) => {
          const td = document.createElement('td');
          const cellPath = `${scopePath}[${rowIndex}].${c}`;
          const ctrl = this._createInputControl(c, properties[c], cellPath, false);
          td.appendChild(ctrl);
          tr.appendChild(td);
        });
        const tdAct = document.createElement('td');
        const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'btn btn-sm btn-outline-danger'; rm.textContent = 'Remove';
        rm.addEventListener('click', () => { tr.remove(); this._renumberArrayItemNames(tbody, scopePath); if (this.liveValidate) this.validate(); this._emit('form:change', { data: this.getData() }); });
        tdAct.appendChild(rm); tr.appendChild(tdAct); tbody.appendChild(tr);

        if (initialData) Object.keys(initialData).forEach((k) => { const input = tr.querySelector(`[name="${CSS.escape(`${scopePath}[${rowIndex}].${k}`)}"]`); if (input) input.value = String(initialData[k]); });
      };

      const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn btn-sm btn-outline-primary'; addBtn.textContent = 'Add row';
      addBtn.addEventListener('click', () => { addRow(); if (this.liveValidate) this.validate(); this._emit('form:change', { data: this.getData() }); });

      container.appendChild(table); table.appendChild(thead); table.appendChild(tbody); container.appendChild(addBtn);
      return container;
    }

    _focusFirstInputInItem(basePath, index) {
      const prefix = `${basePath}[${index}]`;
      const target = this.formEl.querySelector(`[name^="${CSS.escape(prefix)}"]`);
      if (target) target.focus();
    }

    _buildArrayItem(list, arraySchema, basePath, index, initialData) {
      const itemWrapper = document.createElement('div');
      itemWrapper.className = 'border rounded p-3 position-relative';
      itemWrapper.dataset.path = `${basePath}[${index}]`;

      const btnGroup = document.createElement('div');
      btnGroup.className = 'position-absolute d-flex gap-2';
      btnGroup.style.top = '8px';
      btnGroup.style.right = '8px';

      const upBtn = document.createElement('button'); upBtn.type = 'button'; upBtn.className = 'btn btn-sm btn-outline-secondary'; upBtn.textContent = '↑';
      const downBtn = document.createElement('button'); downBtn.type = 'button'; downBtn.className = 'btn btn-sm btn-outline-secondary'; downBtn.textContent = '↓';
      const removeBtn = document.createElement('button'); removeBtn.type = 'button'; removeBtn.className = 'btn btn-sm btn-outline-danger btn-remove'; removeBtn.textContent = 'Remove';

      btnGroup.appendChild(upBtn); btnGroup.appendChild(downBtn); btnGroup.appendChild(removeBtn);

      const itemPath = `${basePath}[${index}]`;
      const itemContent = this._createControlBySchema('', arraySchema.items || {}, itemPath, false);

      itemWrapper.appendChild(btnGroup);
      itemWrapper.appendChild(itemContent);
      list.appendChild(itemWrapper);

      if (initialData !== undefined) this._setValuesByPath(itemWrapper, arraySchema.items || {}, itemPath, initialData);

      removeBtn.addEventListener('click', () => {
        const current = this.getValue(basePath) || [];
        if (current.length <= (arraySchema.minItems || 0)) return;
        const next = current.slice();
        next.splice(index, 1);
        this.setValue(basePath, next);
        const newLen = next.length;
        if (newLen > 0) this._focusFirstInputInItem(basePath, Math.min(index, newLen - 1));
      });

      upBtn.addEventListener('click', () => {
        const current = this.getValue(basePath) || [];
        if (index > 0) {
          const next = current.slice();
          const tmp = next[index - 1]; next[index - 1] = next[index]; next[index] = tmp;
          this.setValue(basePath, next);
          this._focusFirstInputInItem(basePath, index - 1);
        }
      });

      downBtn.addEventListener('click', () => {
        const current = this.getValue(basePath) || [];
        if (index < current.length - 1) {
          const next = current.slice();
          const tmp = next[index + 1]; next[index + 1] = next[index]; next[index] = tmp;
          this.setValue(basePath, next);
          this._focusFirstInputInItem(basePath, index + 1);
        }
      });

      return itemWrapper;
    }

    _renumberArrayItemNames(listElement, basePath) {
      Array.from(listElement.children).forEach((itemWrapper, newIndex) => {
        const inputs = itemWrapper.querySelectorAll('[name]');
        inputs.forEach((input) => {
          input.name = input.name.replace(new RegExp(`^${this._escapeRegExp(basePath)}\\[\\d+\\]`), `${basePath}[${newIndex}]`);
          if (input.id) input.id = this._safeId(input.name);
        });
      });
    }

    _escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    _safeId(path) { return path.replace(/[^a-zA-Z0-9_-]/g, '_'); }

    _createControlBySchema(name, schema, path, isRequired) {
      if (!schema || typeof schema !== 'object') return this._createInputControl(name, { type: 'string' }, path, isRequired);
      if (schema.allOf) schema = this._mergeAllOf(schema);
      if (schema.oneOf || schema.anyOf) return this._createOneAnyOfGroup(name, schema, path, isRequired);
      const type = schema.type;
      if (type === 'object' || (schema.properties && !type)) return this._createObjectGroup(name, schema, path, isRequired);
      if (type === 'array') return this._createArrayGroup(name, schema, path, isRequired);
      return this._createInputControl(name, schema, path, isRequired);
    }

    _pointerToPath(pointer) {
      if (!pointer) return '';
      const noHash = pointer.startsWith('#') ? pointer.slice(1) : pointer;
      const parts = noHash.split('/').filter(Boolean);
      const pathParts = [];
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'properties') { i++; if (i < parts.length) pathParts.push(parts[i]); }
        else if (parts[i] === 'items') { /* skip */ }
      }
      return pathParts.join('.');
    }

    _isPathRequired(schema, path) {
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

    _pickCustomRenderer(element, controlSchema, path, name, required) {
      // Name-based
      const rName = typeof element.renderer === 'string' ? element.renderer : null;
      if (rName && rName !== 'Table' && rName !== 'ListWithDetail') {
        const foundByName = this._renderers.find((r) => r.name === rName);
        if (foundByName) return foundByName;
      }
      // Tester-based: choose highest rank > 0
      let best = null; let bestRank = 0;
      const ctx = { element, uiSchema: this.uiSchema, controlSchema, rootSchema: this.schema, path, label: name, required, instance: this };
      this._renderers.forEach((r) => {
        if (typeof r.tester === 'function') {
          const rank = Number(r.tester(ctx)) || 0;
          if (rank > bestRank) { bestRank = rank; best = r; }
        }
      });
      return bestRank > 0 ? best : null;
    }

    _renderCategorization(element, schema) {
      const tabsId = 'tabs_' + Math.random().toString(36).slice(2);
      const nav = document.createElement('ul'); nav.className = 'nav nav-tabs mb-3'; nav.role = 'tablist';
      const content = document.createElement('div'); content.className = 'tab-content';
      (element.elements || []).forEach((cat, idx) => {
        if (!cat || cat.type !== 'Category') return;
        const tabId = `${tabsId}_tab_${idx}`; const paneId = `${tabsId}_pane_${idx}`;
        const li = document.createElement('li'); li.className = 'nav-item';
        const a = document.createElement('button'); a.className = `nav-link${idx === 0 ? ' active' : ''}`; a.id = tabId; a.dataset.bsToggle = 'tab'; a.dataset.bsTarget = `#${paneId}`; a.type = 'button'; a.role = 'tab'; a.textContent = cat.label || `Category ${idx + 1}`; li.appendChild(a); nav.appendChild(li);
        const pane = document.createElement('div'); pane.className = `tab-pane fade${idx === 0 ? ' show active' : ''}`; pane.id = paneId; pane.role = 'tabpanel'; (cat.elements || []).forEach((el) => pane.appendChild(this._renderUiElement(el, schema))); content.appendChild(pane);
      });
      const wrapper = document.createElement('div'); wrapper.appendChild(nav); wrapper.appendChild(content); return wrapper;
    }

    _renderListWithDetail(element, schema) {
      const arrayPath = this._pointerToPath(element.scope || '');
      const arraySchema = this._findSchemaForPath(schema, arrayPath);
      const wrapper = document.createElement('div'); wrapper.className = 'row g-3';
      const listCol = document.createElement('div'); listCol.className = 'col-4';
      const detailCol = document.createElement('div'); detailCol.className = 'col-8';
      const listGroup = document.createElement('div'); listGroup.className = 'list-group';
      const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'btn btn-sm btn-outline-primary mb-2'; addBtn.textContent = 'Add item';
      let selectedIndex = 0;

      const renderList = () => {
        listGroup.innerHTML = '';
        const regex = new RegExp(`^${this._escapeRegExp(arrayPath)}\\\[(\\d+)\\]`);
        const names = new Set();
        this.formEl.querySelectorAll('[name]').forEach((el) => { const m = el.name.match(regex); if (m) names.add(Number(m[1])); });
        const length = names.size || 0;
        for (let i = 0; i < length; i++) {
          const a = document.createElement('button'); a.type = 'button'; a.className = `list-group-item list-group-item-action${i === selectedIndex ? ' active' : ''}`; a.textContent = `Item ${i + 1}`;
          a.addEventListener('click', () => { selectedIndex = i; renderList(); renderDetail(); });
          listGroup.appendChild(a);
        }
      };

      const renderDetail = () => {
        detailCol.innerHTML = '';
        const itemPath = `${arrayPath}[${selectedIndex}]`;
        if (element.detail) {
          const adapted = this._renderUiElementWithBase(element.detail, schema, itemPath);
          detailCol.appendChild(adapted);
        } else {
          const child = this._createControlBySchema('', arraySchema.items || {}, itemPath, false);
          detailCol.appendChild(child);
        }
      };

      addBtn.addEventListener('click', () => {
        const current = this.getValue(arrayPath) || [];
        const next = current.slice();
        next.push({});
        this.setValue(arrayPath, next);
        renderList(); renderDetail();
      });

      listCol.appendChild(addBtn); listCol.appendChild(listGroup); wrapper.appendChild(listCol); wrapper.appendChild(detailCol);
      renderList(); renderDetail();
      return wrapper;
    }

    _renderUiElementWithBase(element, schema, basePath) {
      if (!element || typeof element !== 'object') return document.createElement('div');
      switch (element.type) {
        case 'Control': {
          const path = `${basePath}${basePath ? '.' : ''}${this._pointerToPath(element.scope || '')}`;
          const subSchema = this._findSchemaForPath(schema, path);
          const name = element.label || (path.split('.').slice(-1)[0] || '');
          const required = this._isPathRequired(schema, path);
          const effective = this._applyUiOptionsToSchema(subSchema, element.options);

          const custom = this._pickCustomRenderer(element, effective, path, name, required);
          if (custom) {
            const ctx = {
              element, uiSchema: this.uiSchema, controlSchema: effective, rootSchema: this.schema,
              path, label: name, required, instance: this,
              utils: { createDefault: () => this._createControlBySchema(name, effective, path, required) },
              emit: (ev, detail) => this._emit(ev, detail),
              setValue: (v) => this.setValue(path, v),
              getValue: () => this.getValue(path),
              validate: () => this.validate(),
            };
            const rendered = custom.render(ctx);
            if (rendered && !rendered.dataset.path) rendered.dataset.path = path;
            return rendered || document.createElement('div');
          }

          const el = this._createControlBySchema(name, effective, path, required);
          return el;
        }
        default: return this._renderUiElement(element, schema);
      }
    }

    _applyUiOptionsToSchema(schema, options) {
      if (!options) return schema;
      const copy = { ...schema };
      if (options.widget) copy['x-ui-widget'] = options.widget;
      if (options.placeholder) copy.placeholder = options.placeholder;
      if (options.description) copy.description = options.description;
      return copy;
    }

    _renderUiElement(element, schema) {
      if (!element || typeof element !== 'object') return document.createElement('div');

      const container = document.createElement('div'); container.className = 'mb-0';
      if (element.rule) { container.dataset.rule = JSON.stringify(element.rule); container.dataset.ruleScope = element.rule.condition?.scope || ''; }

      let rendered;
      switch (element.type) {
        case 'VerticalLayout': { const c = document.createElement('div'); (element.elements || []).forEach((el) => c.appendChild(this._renderUiElement(el, schema))); rendered = c; break; }
        case 'HorizontalLayout': {
          const row = document.createElement('div'); row.className = 'row g-3';
          const children = element.elements || [];
          children.forEach((el) => { const col = document.createElement('div'); col.className = `col-${Math.floor(12 / Math.min(children.length, 4))}`; col.appendChild(this._renderUiElement(el, schema)); row.appendChild(col); });
          rendered = row; break;
        }
        case 'Group': {
          const fs = document.createElement('fieldset'); fs.className = 'border rounded p-3 mb-3';
          if (element.label) { const lg = document.createElement('legend'); lg.className = 'float-none w-auto px-2'; lg.textContent = element.label; fs.appendChild(lg); }
          (element.elements || []).forEach((el) => fs.appendChild(this._renderUiElement(el, schema)));
          rendered = fs; break;
        }
        case 'Control': {
          const scope = element.scope; const path = this._pointerToPath(scope);
          if (element.renderer === 'Table') { const arrSchema = this._findSchemaForPath(schema, path); rendered = this._createArrayTable(path, arrSchema); break; }
          if (element.renderer === 'ListWithDetail') { rendered = this._renderListWithDetail(element, schema); break; }
          const subSchema = this._findSchemaForPath(schema, path); const name = (element.label || (path.split('.').slice(-1)[0] || ''));
          const required = this._isPathRequired(schema, path); const effective = this._applyUiOptionsToSchema(subSchema, element.options);

          const custom = this._pickCustomRenderer(element, effective, path, name, required);
          if (custom) {
            const ctx = {
              element, uiSchema: this.uiSchema, controlSchema: effective, rootSchema: this.schema,
              path, label: name, required, instance: this,
              utils: { createDefault: () => this._createControlBySchema(name, effective, path, required) },
              emit: (ev, detail) => this._emit(ev, detail),
              setValue: (v) => this.setValue(path, v),
              getValue: () => this.getValue(path),
              validate: () => this.validate(),
            };
            rendered = custom.render(ctx) || document.createElement('div');
            if (rendered && !rendered.dataset.path) rendered.dataset.path = path;
            break;
          }

          rendered = this._createControlBySchema(name, effective, path, required); break;
        }
        case 'Categorization': { rendered = this._renderCategorization(element, schema); break; }
        case 'ListWithDetail': { rendered = this._renderListWithDetail(element, schema); break; }
        case 'Table': { const path = this._pointerToPath(element.scope || ''); const arrSchema = this._findSchemaForPath(schema, path); rendered = this._createArrayTable(path, arrSchema); break; }
        default: rendered = document.createElement('div');
      }

      if (element.rule) { rendered.dataset.rule = JSON.stringify(element.rule); rendered.dataset.ruleScope = element.rule.condition?.scope || ''; }
      container.appendChild(rendered); return container;
    }

    // Data helpers
    _setNestedValue(root, path, value) {
      if (!path) return value;
      const tokens = this._tokenizePath(path);
      let node = root;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]; const isLast = i === tokens.length - 1;
        if (typeof t === 'number') {
          if (!Array.isArray(node)) throw new Error('Path expects array at: ' + tokens.slice(0, i).join('.'));
          if (isLast) node[t] = value;
          else { if (node[t] == null) node[t] = typeof tokens[i + 1] === 'number' ? [] : {}; node = node[t]; }
        } else {
          if (isLast) node[t] = value;
          else { if (node[t] == null) node[t] = typeof tokens[i + 1] === 'number' ? [] : {}; node = node[t]; }
        }
      }
      return root;
    }

    _tokenizePath(path) {
      const tokens = []; let i = 0;
      while (i < path.length) {
        if (path[i] === '.') { i++; continue; }
        if (path[i] === '[') { const close = path.indexOf(']', i); const idx = Number(path.slice(i + 1, close)); tokens.push(idx); i = close + 1; continue; }
        let j = i; while (j < path.length && /[a-zA-Z0-9_-]/.test(path[j])) j++; tokens.push(path.slice(i, j)); i = j;
      }
      return tokens.filter((t) => t !== '');
    }

    _coerceValue(schema, raw) {
      if (raw === '' || raw == null) return undefined;
      if (!schema || !schema.type) return raw;
      switch (schema.type) { case 'integer': return Number.parseInt(raw, 10); case 'number': return Number(raw); case 'boolean': return Boolean(raw); default: return raw; }
    }

    _collectDataFromForm(schema) {
      const formData = {};
      // Do not call reportValidity here to avoid focus jumps during typing
      const allControls = this.formEl.querySelectorAll('[name]');
      allControls.forEach((el) => {
        const name = el.name; if (!name) return;
        let value; const subSchema = this._findSchemaForPath(schema, name);
        if (el.type === 'checkbox') value = el.checked;
        else if (el.tagName === 'SELECT') value = el.value === '' ? undefined : el.value;
        else if (el.type === 'number' || el.type === 'range') value = el.value === '' ? undefined : el.value;
        else if (el.type === 'file') return; else value = el.value;
        const coerced = this._coerceValue(subSchema, value); if (coerced !== undefined) this._setNestedValue(formData, name, coerced);
      });
      return formData;
    }

    _findSchemaForPath(schema, path) {
      const tokens = this._tokenizePath(path); let node = schema;
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i]; if (typeof t === 'number') node = node.items || {};
        else { if (node && node.type === 'object') node = (node.properties && node.properties[t]) || {}; else if (node && node.properties && !node.type) node = node.properties[t] || {}; }
      }
      return node;
    }

    _setValuesByPath(rootElement, schema, basePath, value) {
      if (value === undefined) return;
      if (schema.type === 'object' || (schema.properties && !schema.type)) {
        const props = schema.properties || {};
        Object.keys(props).forEach((key) => { this._setValuesByPath(rootElement, props[key], basePath ? `${basePath}.${key}` : key, value[key]); });
      } else if (schema.type === 'array') {
        const list = rootElement.querySelector(`.array-items[data-path="${CSS.escape(basePath)}"]`); if (!list) return; list.innerHTML = '';
        const arr = Array.isArray(value) ? value : [];
        arr.forEach((itemVal, idx) => {
          this._buildArrayItem(list, schema, basePath, idx, itemVal);
        });
        // reflect maxItems on Add button state
        const container = list.parentElement;
        const addBtn = container && container.querySelector('.btn-outline-primary');
        if (addBtn) addBtn.disabled = arr.length >= (schema.maxItems || Infinity);
      } else {
        const input = rootElement.querySelector(`[name="${CSS.escape(basePath)}"]`); if (!input) return;
        if (input.type === 'checkbox') input.checked = Boolean(value); else input.value = value == null ? '' : String(value);
      }
    }

    _download(filename, text) {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }

    _ajvInstancePathToNamePath(instancePath) {
      if (!instancePath) return '';
      const parts = instancePath.split('/').slice(1);
      let name = '';
      parts.forEach((p) => {
        if (p === '') return; const key = p.replace(/~1/g, '/').replace(/~0/g, '~');
        if (/^\d+$/.test(key)) name += `[${Number(key)}]`; else name += name ? `.${key}` : key;
      });
      return name;
    }

    _clearAllFieldErrors() {
      this.formEl.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
      this.formEl.querySelectorAll('.invalid-feedback').forEach((el) => { el.textContent = 'Please provide a valid value.'; });
      this.formEl.querySelectorAll('.sf-array-error').forEach((el) => el.remove());
    }

    _setContainerError(path, message) {
      const container = this._findContainerByPath(path);
      if (!container) return;
      let msg = container.querySelector('.sf-array-error');
      if (!msg) {
        msg = document.createElement('div');
        msg.className = 'sf-array-error text-danger small mt-1';
        container.appendChild(msg);
      }
      msg.textContent = message || 'Invalid value';
    }

    _namePathFromAjvError(err) {
      const base = this._ajvInstancePathToNamePath(err.instancePath || '');
      if (err.keyword === 'required' && err.params && err.params.missingProperty) {
        return base ? `${base}.${err.params.missingProperty}` : String(err.params.missingProperty);
      }
      return base;
    }

    _getLocaleMessage(err) {
      const loc = this.locale || 'en';
      const map = {
        de: { required: 'Pflichtfeld fehlt', minimum: 'Wert ist zu klein', maximum: 'Wert ist zu groß', pattern: 'Ungültiges Format', type: 'Falscher Typ' },
        es: { required: 'Falta un campo obligatorio', minimum: 'Valor demasiado bajo', maximum: 'Valor demasiado alto', pattern: 'Formato inválido', type: 'Tipo incorrecto' },
        fr: { required: 'Champ obligatoire manquant', minimum: 'Valeur trop petite', maximum: 'Valeur trop grande', pattern: 'Format invalide', type: 'Type incorrect' },
        zh: { required: '缺少必填字段', minimum: '值太小', maximum: '值太大', pattern: '格式无效', type: '类型不正确' },
      };
      const dict = map[loc];
      if (dict && dict[err.keyword]) return dict[err.keyword];
      return err.message || 'Invalid value';
    }

    _setFieldError(namePath, messageOrErr) {
      if (!namePath) return;
      const el = this.formEl.querySelector(`[name="${CSS.escape(namePath)}"]`);
      if (el) {
        el.classList.add('is-invalid');
        const feedback = el.parentElement && el.parentElement.querySelector('.invalid-feedback');
        const message = typeof messageOrErr === 'string' ? messageOrErr : this._getLocaleMessage(messageOrErr);
        if (feedback) feedback.textContent = message || 'Invalid value';
        return;
      }
      // Fallback: container-level error (arrays/objects)
      this._setContainerError(namePath, typeof messageOrErr === 'string' ? messageOrErr : this._getLocaleMessage(messageOrErr));
    }

    // Rules
    _evaluateCondition(cond, data) {
      if (!cond) return true;
      const path = this._pointerToPath(cond.scope || '');
      const tokens = this._tokenizePath(path);
      let node = data;
      for (const t of tokens) { if (node == null) break; node = typeof t === 'number' ? (Array.isArray(node) ? node[t] : undefined) : node[t]; }
      if ('equals' in cond) return node === cond.equals;
      if (cond.schema && 'const' in cond.schema) return node === cond.schema.const;
      return Boolean(node);
    }

    _applyRuleToElement(el, rule, data) {
      const pass = this._evaluateCondition(rule.condition, data);
      const effect = rule.effect || 'HIDE';
      if (effect === 'HIDE') el.classList.toggle('d-none', pass);
      else if (effect === 'DISABLE') el.querySelectorAll('input,select,textarea,button').forEach((inp) => inp.disabled = pass);
    }

    _applyUiRules() {
      const data = this.getData();
      this.formEl.querySelectorAll('[data-rule]').forEach((container) => { try { const rule = JSON.parse(container.dataset.rule); this._applyRuleToElement(container, rule, data); } catch (_) {} });
      (this._dynamicRules || []).forEach((rule) => {
        const targetPath = this._pointerToPath(rule.target || rule.condition?.scope || '');
        const targetEl = this._findContainerByPath(targetPath);
        if (targetEl) this._applyRuleToElement(targetEl, rule, data);
      });
    }

    _findContainerByPath(path) {
      if (!path) return null;
      let el = this.formEl.querySelector(`[data-path="${CSS.escape(path)}"]`);
      if (el) return el;
      const input = this.formEl.querySelector(`[name="${CSS.escape(path)}"]`);
      if (!input) return null;
      el = input.closest('[data-path]') || input.closest('.mb-3') || input.closest('fieldset');
      return el;
    }
  }

  function create(rootEl, options) { return new SchemaForm(rootEl, options); }

  function registerRenderer(def) { if (def && typeof def.render === 'function') globalRenderers.push(def); }
  function clearRenderers() { globalRenderers.length = 0; }

  global.SchemaFormLib = { SchemaForm, create, registerRenderer, clearRenderers };
})(typeof window !== 'undefined' ? window : globalThis);