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
    this.attributes = new Map();
    this.classList = {
      add: (className) => {
        this.className = sortedClassName(`${this.className} ${className}`);
      },
      remove: (className) => {
        this.className = sortedClassName(this.className.split(/\s+/).filter((name) => name && name !== className).join(' '));
      }
    };
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
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

function sortedClassName(value) {
  return [...new Set(String(value).split(/\s+/).filter(Boolean))].sort().join(' ');
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

test('static city fallback keeps default cities when generated data is partial', async () => {
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
    fetch(url) {
      if (String(url) === 'api/cities') {
        return Promise.resolve({
          ok: false,
          async json() {
            return { error: 'Not found' };
          }
        });
      }

      if (String(url) === 'data/index.json') {
        return Promise.resolve({
          ok: true,
          async json() {
            return { dates: [{ city: 'ottawa', date: '2026-05-24' }] };
          }
        });
      }

      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    }
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(city.options.some((option) => option.value === 'ottawa'));
  assert.ok(city.options.some((option) => option.value === 'toronto'));
  assert.ok(city.options.some((option) => option.value === 'london'));
});

test('changing city loads screenings for the selected city', async () => {
  const requestedUrls = [];
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
    fetch(url) {
      requestedUrls.push(String(url));
      if (String(url) === 'api/cities') {
        return Promise.resolve({
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
      }

      return Promise.resolve({
        ok: true,
        async json() {
          return { showings: [] };
        }
      });
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  city.value = 'toronto';
  city.dispatch('change');
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(requestedUrls.some((url) => url.startsWith('api/showings?city=toronto&')));
});

test('auditorium labels use a short AUD prefix', async () => {
  const form = new FakeElement();
  const city = new FakeSelect();
  const date = new FakeElement();
  const threshold = new FakeElement();
  const cineplex = new FakeSelect();
  const movie = new FakeSelect();
  form.elements = { city, date, threshold, cineplex, movie };
  const context = {
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
      return new Promise(() => {});
    }
  };

  vm.runInNewContext(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'), context);

  assert.equal(context.formatAuditorium('7'), 'AUD 7');
  assert.equal(context.formatAuditorium('Auditorium 12'), 'AUD 12');
  assert.equal(context.formatAuditorium('Aud 4'), 'AUD 4');
});
