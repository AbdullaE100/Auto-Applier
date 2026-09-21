/**
 * JobFlow AI - Core Autofill Engine
 * Provides cross-platform field detection, fuzzy matching, and event dispatching.
 */

window.JobFlowCore = {
  // Dispatches events so modern reactive frameworks (React, Vue, Angular) detect the value change
  setInputValue(element, value) {
    if (!element || value === undefined || value === null) return false;

    // React 16+ controlled input setter using native prototype descriptor
    try {
      const prototype = Object.getPrototypeOf(element);
      const isTextArea = element.tagName === 'TEXTAREA';
      const defaultProto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value') || Object.getOwnPropertyDescriptor(defaultProto, 'value');

      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    } catch (_) {
      element.value = value;
    }

    // React value tracker notification
    const tracker = element._valueTracker;
    if (tracker) {
      tracker.setValue(value);
    }

    // Dispatch full input sequence with input, change, and blur
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));

    this.markFieldFilled(element);
    return true;
  },

  // Select dropdown option by fuzzy text match or value
  setSelectValue(selectElement, targetValue) {
    if (!selectElement || !targetValue) return false;
    const target = String(targetValue).toLowerCase().trim();

    for (let i = 0; i < selectElement.options.length; i++) {
      const opt = selectElement.options[i];
      const text = opt.text.toLowerCase().trim();
      const val = opt.value.toLowerCase().trim();

      if (text.includes(target) || val.includes(target) || 
          (target === 'yes' && (text.startsWith('yes') || text.includes('authorized') || text.includes('eligible'))) ||
          (target === 'no' && (text.startsWith('no') || text.includes('not require') || text.includes('will not')))) {
        selectElement.selectedIndex = i;
        selectElement.dispatchEvent(new Event('change', { bubbles: true }));
        this.markFieldFilled(selectElement);
        return true;
      }
    }
    return false;
  },

  // Check radio button matching label or value
  setRadioValue(radios, targetValue) {
    if (!radios || !radios.length || !targetValue) return false;
    const target = String(targetValue).toLowerCase().trim();

    for (const radio of radios) {
      const val = (radio.value || '').toLowerCase().trim();
      const label = this.getAssociatedLabelText(radio).toLowerCase().trim();

      const isYesOption = val === 'yes' || val === 'true' || val === '1' || label === 'yes' || label.startsWith('yes');
      const isNoOption = val === 'no' || val === 'false' || val === '0' || label === 'no' || label.startsWith('no');

      const matchesYes = target === 'yes' && isYesOption;
      const matchesNo = target === 'no' && isNoOption;
      const matchesGeneral = (target !== 'yes' && target !== 'no') && (val.includes(target) || label.includes(target));

      if (matchesYes || matchesNo || matchesGeneral) {
        radios.forEach(r => { if (r !== radio) r.checked = false; });
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new Event('click', { bubbles: true }));
        this.markFieldFilled(radio);
        return true;
      }
    }
    return false;
  },

  // Highlight filled fields so the user has full transparency
  markFieldFilled(element) {
    if (!element) return;
    element.style.transition = 'all 0.3s ease';
    element.style.borderColor = '#10b981'; // emerald-500
    element.style.boxShadow = '0 0 0 2px rgba(16, 185, 129, 0.2)';
    element.setAttribute('data-jobflow-filled', 'true');
  },

  // Retrieve label text corresponding to an input
  getAssociatedLabelText(element) {
    if (!element) return '';
    let labelText = '';

    // 1. Label with 'for' attribute
    if (element.id && typeof document !== 'undefined') {
      try {
        const safeId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(element.id) : element.id.replace(/["\\]/g, '\\$&');
        const label = document.querySelector(`label[for="${safeId}"]`);
        if (label) labelText += ' ' + label.textContent;
      } catch (_) {}
    }

    // 2. Parent label
    if (element.closest) {
      const parentLabel = element.closest('label');
      if (parentLabel) labelText += ' ' + parentLabel.textContent;
    }

    // 3. Preceding sibling label or text
    const prev = element.previousElementSibling;
    if (prev && (prev.tagName === 'LABEL' || (prev.classList && prev.classList.contains('label')))) {
      labelText += ' ' + prev.textContent;
    }

    // 4. Common container element (LinkedIn Easy Apply, Greenhouse, Lever)
    if (element.closest) {
      const container = element.closest('.jobs-easy-apply-form-element, .fb-dash-form-element, .artdeco-text-input, .jobs-easy-apply-form-section__grouping, .form-group, .field, fieldset');
      if (container) {
        const containerLabel = container.querySelector('label, legend, .artdeco-text-input--label, span.t-14');
        if (containerLabel && containerLabel !== element) {
          labelText += ' ' + containerLabel.textContent;
        }
      }
    }

    // 5. aria-label, placeholder, name, and id
    if (element.getAttribute && element.getAttribute('aria-label')) labelText += ' ' + element.getAttribute('aria-label');
    if (element.placeholder) labelText += ' ' + element.placeholder;
    if (element.name) labelText += ' ' + element.name.replace(/[-_]/g, ' ');
    if (element.id) labelText += ' ' + element.id.replace(/[-_]/g, ' ');

    return labelText.toLowerCase().trim();
  },

  // Check if a field matches a concept
  fieldMatches(element, keywords) {
    const context = (
      (element.id || '') + ' ' +
      (element.name || '') + ' ' +
      (element.placeholder || '') + ' ' +
      (element.getAttribute('autocomplete') || '') + ' ' +
      this.getAssociatedLabelText(element)
    ).toLowerCase();

    return keywords.some(kw => context.includes(kw.toLowerCase()));
  }
};
