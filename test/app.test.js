import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

class FakeElement {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.checked = false;
    this.disabled = false;
    this.children = [];
    this.style = {};
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
  assert.equal(city.options.some((option) => option.value === 'barrhaven'), false);
  assert.ok(city.options.some((option) => option.value === 'toronto'));
  assert.ok(city.options.some((option) => option.value === 'london'));
});

test('initial city loading does not scan screenings automatically', async () => {
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
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(requestedUrls, ['api/cities']);
  assert.ok(cineplex.options.some((option) => option.value === 'Cineplex Odeon Barrhaven Cinemas'));
  assert.ok(cineplex.options.some((option) => option.value === 'Cineplex Cinemas Ottawa'));
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
  assert.ok(cineplex.options.some((option) => option.value === 'Scotiabank Theatre Toronto'));
  assert.equal(cineplex.options.some((option) => option.value === 'Cineplex Odeon Barrhaven Cinemas'), false);
  assert.equal(cineplex.disabled, false);
});

test('any occupied toggle shows screenings above the max occupied value', async () => {
  const form = new FakeElement();
  const city = new FakeSelect();
  const date = new FakeElement();
  const threshold = new FakeElement();
  const anyOccupied = new FakeElement();
  const cineplex = new FakeSelect();
  const movie = new FakeSelect();
  const status = new FakeElement();
  const showings = new FakeElement();
  threshold.value = '0';
  form.elements = { city, date, threshold, anyOccupied, cineplex, movie };

  vm.runInNewContext(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'), {
    document: new FakeDocument(form, status, showings),
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
          ok: true,
          async json() {
            return {
              defaultCity: 'ottawa',
              cities: [{ slug: 'ottawa', label: 'Ottawa' }]
            };
          }
        });
      }

      return Promise.resolve({
        ok: true,
        async json() {
          return {
            showings: [
              {
                theatreName: 'Cineplex Cinemas Ottawa',
                city: 'Ottawa',
                movieTitle: 'Empty Movie',
                startLocal: '2026-05-23T19:00:00',
                auditorium: '1',
                experienceTypes: ['Regular'],
                occupiedCount: 0,
                totalSeats: 100
              },
              {
                theatreName: 'Cineplex Cinemas Ottawa',
                city: 'Ottawa',
                movieTitle: 'Busy Movie',
                startLocal: '2026-05-23T21:00:00',
                auditorium: '2',
                experienceTypes: ['Regular'],
                occupiedCount: 8,
                totalSeats: 100
              }
            ]
          };
        }
      });
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  city.dispatch('change');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.textContent, '1 found across 1 Cineplex theatres');

  anyOccupied.checked = true;
  anyOccupied.dispatch('change');
  assert.equal(status.textContent, '2 found across 1 Cineplex theatres');
});

test('choose a scan message is rendered without the empty-state card chrome', async () => {
  const form = new FakeElement();
  const city = new FakeSelect();
  const date = new FakeElement();
  const threshold = new FakeElement();
  const cineplex = new FakeSelect();
  const movie = new FakeSelect();
  const showings = new FakeElement();
  form.elements = { city, date, threshold, cineplex, movie };

  vm.runInNewContext(await readFile(new URL('../public/app.js', import.meta.url), 'utf8'), {
    document: new FakeDocument(form, new FakeElement(), showings),
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
      return Promise.resolve({
        ok: true,
        async json() {
          return { defaultCity: 'ottawa', cities: [{ slug: 'ottawa', label: 'Ottawa' }] };
        }
      });
    }
  });

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(showings.children[0].className, 'empty-state empty-state--plain');
});

test('repeated city scans reuse the browser cache briefly', async () => {
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
  city.dispatch('change');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(requestedUrls.filter((url) => url.startsWith('api/showings?city=toronto&')).length, 1);
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
