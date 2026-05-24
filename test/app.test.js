import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

class FakeElement {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.children = [];
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    this.listeners.get(type)?.({ preventDefault() {} });
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }
}

class FakeSelect extends FakeElement {
  constructor() {
    super();
    this.options = [];
  }

  replaceChildren(...options) {
    this.options = options;
    if (!this.options.some((option) => option.value === this.value)) {
      this.value = this.options[0]?.value || '';
    }
  }
}

class FakeDocument {
  constructor(form, status, showings) {
    this.form = form;
    this.status = status;
    this.showings = showings;
  }

  querySelector(selector) {
    if (selector === '#filters') return this.form;
    if (selector === '#status') return this.status;
    if (selector === '#showings') return this.showings;
    return null;
  }

  createElement() {
    return new FakeElement();
  }

  createDocumentFragment() {
    return new FakeElement();
  }
}

test('city selection is not reset when async city options finish loading', async () => {
  let resolveFetch;
  const fetchPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const form = new FakeElement();
  const city = new FakeSelect();
  const date = new FakeElement();
  const threshold = new FakeElement();
  const cineplex = new FakeSelect();
  const movie = new FakeSelect();
  form.elements = { city, date, threshold, cineplex, movie };

  vm.runInNewContext(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'), {
    document: new FakeDocument(form, new FakeElement(), new FakeElement()),
    Intl,
    Date,
    AbortController,
    URLSearchParams,
    Option: class {
      constructor(label, value) {
        this.label = label;
        this.text = label;
        this.value = value;
      }
    },
    fetch() {
      return fetchPromise;
    }
  });

  city.value = 'toronto';
  city.dispatch('change');

  resolveFetch({
    ok: true,
    async json() {
      return {
        defaultCity: 'ottawa',
        cities: [
          { slug: 'ottawa', label: 'Ottawa' },
          { slug: 'toronto', label: 'Toronto' }
        ]
      };
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(city.value, 'toronto');
});
