import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createServer } from '../src/server.js';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => resolve(server.address().port));
    server.once('error', reject);
  });
}

test('GET /api/showings returns normalized empty reserved screenings', async () => {
  const cineplex = {
    async getTheatres() {
      return [{ id: '7247', name: 'Cineplex Odeon South Keys Cinemas' }];
    },
    async getShowtimes() {
      return {
        movies: [
          {
            name: 'Quiet Movie',
            presentationUrl: '/movie/quiet-movie',
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: '1001',
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    seatsRemaining: 200,
                    auditorium: '7',
                    ticketingUrl: '/tickets/1001',
                    seatMapUrl: '/seatmap/1001'
                  }
                ]
              }
            ]
          },
          {
            name: 'Busy Movie',
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: '1002',
                    showStartDateTime: '2026-05-23T22:00:00',
                    showStartDateTimeUtc: '2026-05-24T02:00:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    seatsRemaining: 198,
                    auditorium: '8'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability(_theatreId, showtimeId) {
      if (showtimeId === '1001') {
        return { seatAvailabilities: { A1: 'Available', A2: 'Available' } };
      }
      return { seatAvailabilities: { A1: 'Available', A2: 'Occupied' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.showings, [
      {
        id: '7247:1001',
        theatreId: '7247',
        showtimeId: '1001',
        city: 'Ottawa',
        theatreName: 'Cineplex Odeon South Keys Cinemas',
        movieTitle: 'Quiet Movie',
        filmUrl: '/movie/quiet-movie',
        startLocal: '2026-05-23T21:50:00',
        startUtc: '2026-05-24T01:50:00Z',
        auditorium: '7',
        experienceTypes: ['Regular'],
        occupiedCount: 0,
        totalSeats: 2,
        availableCount: 2,
        occupancyPct: 0,
        ticketingUrl: '/tickets/1001',
        seatMapUrl: '/seatmap/1001'
      }
    ]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/cities returns selectable Ontario cities', async () => {
  const server = createServer({ cineplex: {} });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/cities`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.defaultCity, 'ottawa');
    assert.equal(body.cities.some((city) => city.slug === 'barrhaven'), false);
    assert.ok(body.cities.some((city) => city.slug === 'toronto'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings passes the selected city to theatre discovery', async () => {
  let requestedLocation;
  const cineplex = {
    async getTheatres(_date, location) {
      requestedLocation = location;
      return [{ id: '9999', name: 'Cineplex Outside Ottawa', city: 'Toronto', regionCode: 'ON' }];
    },
    async getShowtimes() {
      return {
        movies: [
          {
            name: 'Toronto Movie',
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: '3001',
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: '1'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?city=toronto&date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(requestedLocation.city, 'Toronto');
    assert.equal(body.city, 'toronto');
    assert.equal(body.showings[0].city, 'Toronto');
    assert.equal(body.showings[0].theatreId, '9999');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings includes Barrhaven theatre in Ottawa results', async () => {
  let requestedLocation;
  const cineplex = {
    async getTheatres(_date, location) {
      requestedLocation = location;
      return [
        { id: '7286', name: 'Cineplex Odeon Barrhaven Cinemas' },
        { id: '9172', name: 'Cinéma Cineplex Odeon Quartier Latin' }
      ];
    },
    async getShowtimes(theatreId) {
      return {
        movies: [
          {
            name: `Movie ${theatreId}`,
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: theatreId,
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: 'Aud 4'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?city=ottawa&date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(requestedLocation.slug, 'ottawa');
    assert.equal(requestedLocation.city, 'Ottawa');
    assert.equal(body.city, 'ottawa');
    assert.deepEqual(body.showings.map((showing) => showing.theatreName), ['Cineplex Odeon Barrhaven Cinemas']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings filters theatres outside the selected province when metadata is available', async () => {
  const cineplex = {
    async getTheatres() {
      return [
        { id: '1000', name: 'Ontario Theatre', city: 'Toronto', province: 'Ontario' },
        { id: '2000', name: 'Galaxy Cinemas Prince Albert', city: 'Prince Albert', provinceCode: 'SK' }
      ];
    },
    async getShowtimes(theatreId) {
      return {
        movies: [
          {
            name: `Movie ${theatreId}`,
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: theatreId,
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: 'Aud 4'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?city=toronto&date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.showings.map((showing) => showing.theatreName), ['Ontario Theatre']);
    assert.equal(body.showings[0].city, 'Toronto');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings filters known out-of-province theatres when metadata is missing', async () => {
  const cineplex = {
    async getTheatres() {
      return [
        { id: '7428', name: 'Scotiabank Theatre Ottawa' },
        { id: '9268', name: 'Cinéma Starcité Gatineau' },
        { id: '9172', name: 'Cinéma Cineplex Odeon Quartier Latin' },
        { id: '9406', name: 'Cinéma Banque Scotia Montréal' }
      ];
    },
    async getShowtimes(theatreId) {
      return {
        movies: [
          {
            name: `Movie ${theatreId}`,
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: theatreId,
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: 'Aud 4'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?city=ottawa&date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.showings.map((showing) => showing.theatreName), ['Scotiabank Theatre Ottawa']);
    assert.equal(body.showings[0].city, 'Ottawa');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings filters known theatres outside the selected city even with bad metadata', async () => {
  const cineplex = {
    async getTheatres() {
      return [
        { id: '7428', name: 'Scotiabank Theatre Ottawa' },
        { id: '7262', name: 'Galaxy Cinemas Cornwall', city: 'Ottawa', regionCode: 'ON' }
      ];
    },
    async getShowtimes(theatreId) {
      return {
        movies: [
          {
            name: `Movie ${theatreId}`,
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: theatreId,
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: 'Aud 4'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?city=ottawa&date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.showings.map((showing) => showing.theatreName), ['Scotiabank Theatre Ottawa']);
    assert.equal(body.showings[0].city, 'Ottawa');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings rejects unsupported cities', async () => {
  const server = createServer({ cineplex: {} });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?city=not-real&date=2026-05-23`);
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings flattens Cineplex theatre-date-movie payloads', async () => {
  const cineplex = {
    async getTheatres() {
      return [{ theatreId: 7247, theatreName: 'Cineplex Odeon South Keys Cinemas' }];
    },
    async getShowtimes() {
      return [
        {
          theatre: 'Cineplex Odeon South Keys Cinemas',
          theatreId: 7247,
          dates: [
            {
              startDate: '2026-05-23T00:00:00',
              movies: [
                {
                  name: 'I Love Boosters',
                  filmUrl: 'i-love-boosters',
                  experiences: [
                    {
                      experienceTypes: ['Regular'],
                      sessions: [
                        {
                          vistaSessionId: 406453,
                          showStartDateTime: '2026-05-23T22:00:00',
                          showStartDateTimeUtc: '2026-05-24T02:00:00Z',
                          isReservedSeating: true,
                          isShowtimeEnabledOnline: true,
                          isInThePast: false,
                          auditorium: 'Aud 5'
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ];
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { '1_1_1': 'Available', '1_1_2': 'Available' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.showings.length, 1);
    assert.equal(body.showings[0].movieTitle, 'I Love Boosters');
    assert.deepEqual(body.showings[0].experienceTypes, ['Regular']);
    assert.equal(body.showings[0].showtimeId, '406453');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings only reports showings with known seats', async () => {
  const cineplex = {
    async getTheatres() {
      return [
        { theatreId: 7247, theatreName: 'Cineplex Odeon South Keys Cinemas' },
        { theatreId: 7424, theatreName: 'Cineplex Cinemas Ottawa' },
        { theatreId: 9153, theatreName: 'Cinéma Cineplex Odeon Carrefour Dorion' }
      ];
    },
    async getShowtimes(theatreId) {
      return {
        movies: [
          {
            name: `Movie ${theatreId}`,
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: theatreId,
                    showStartDateTime: '2026-05-23T22:00:00',
                    showStartDateTimeUtc: '2026-05-24T02:00:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: 'Aud 1'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability(_theatreId, showtimeId) {
      if (showtimeId === '7247') {
        return { seatAvailabilities: { A1: 'Available', A2: 'Available' } };
      }

      return { seatAvailabilities: {} };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.showings.map((showing) => showing.theatreId), ['7247']);
    assert.equal(body.showings[0].totalSeats, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings keeps working when one theatre endpoint fails', async () => {
  const cineplex = {
    async getTheatres() {
      return [
        { id: '7247', name: 'South Keys' },
        { id: '7424', name: 'Cineplex Cinemas Ottawa' }
      ];
    },
    async getShowtimes(theatreId) {
      if (theatreId === '7247') {
        throw new Error('Cineplex returned invalid JSON');
      }

      return {
        movies: [
          {
            name: 'Quiet Movie',
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: '2001',
                    showStartDateTime: '2026-05-23T22:00:00',
                    showStartDateTimeUtc: '2026-05-24T02:00:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: 'Aud 1'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body.showings.map((showing) => showing.theatreId), ['7424']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/seatmap merges layout rows with seat availability', async () => {
  const cineplex = {
    async getSeatLayout() {
      return {
        standardSeats: {
          totalColumns: 4,
          rows: [
            {
              label: 'A',
              seats: [
                { id: 'A1', label: '1', column: 1, type: 'Standard' },
                { id: 'A3', label: '3', column: 3, type: 'Standard' }
              ]
            }
          ]
        },
        dboxSeats: { totalColumns: 0, rows: [] },
        balconySeats: { totalColumns: 0, rows: [] }
      };
    },
    async getSeatAvailability() {
      return { seatAvailabilities: { A1: 'Available', A3: 'Occupied' } };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/seatmap/7247/1001`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.deepEqual(body, {
      theatreId: '7247',
      showtimeId: '1001',
      areas: [
        {
          name: 'standardSeats',
          totalColumns: 4,
          rows: [
            {
              label: 'A',
              seats: [
                { id: 'A1', label: '1', column: 1, type: 'Standard', status: 'Available' },
                { id: 'A3', label: '3', column: 3, type: 'Standard', status: 'Occupied' }
              ]
            }
          ]
        }
      ]
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/seatmap caches repeated seatmap loads briefly', async () => {
  let layoutCalls = 0;
  let availabilityCalls = 0;
  const cineplex = {
    async getSeatLayout() {
      layoutCalls += 1;
      return {
        standardSeats: {
          totalColumns: 1,
          rows: [{ label: 'A', seats: [{ id: 'A1', label: '1', column: 1, type: 'Standard' }] }]
        }
      };
    },
    async getSeatAvailability() {
      availabilityCalls += 1;
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex, cacheTtlMs: 60_000 });
  const port = await listen(server);

  try {
    const url = `http://127.0.0.1:${port}/api/seatmap/7247/1001`;
    const first = await fetch(url);
    const second = await fetch(url);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(layoutCalls, 1);
    assert.equal(availabilityCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings limits concurrent Cineplex seat availability calls', async () => {
  let activeAvailabilityCalls = 0;
  let maxActiveAvailabilityCalls = 0;
  const cineplex = {
    async getTheatres() {
      return [{ id: '7247', name: 'South Keys' }];
    },
    async getShowtimes() {
      return {
        movies: [
          {
            name: 'Quiet Movie',
            experiences: [
              {
                name: 'Regular',
                sessions: Array.from({ length: 5 }, (_unused, index) => ({
                  vistaSessionId: `100${index}`,
                  showStartDateTime: `2026-05-23T2${index}:00:00`,
                  showStartDateTimeUtc: `2026-05-24T0${index}:00:00Z`,
                  isReservedSeating: true,
                  isShowtimeEnabledOnline: true,
                  isInThePast: false,
                  auditorium: String(index + 1)
                }))
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      activeAvailabilityCalls += 1;
      maxActiveAvailabilityCalls = Math.max(maxActiveAvailabilityCalls, activeAvailabilityCalls);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeAvailabilityCalls -= 1;
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex, scanConcurrency: 2 });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=0`);
    assert.equal(response.status, 200);
    assert.equal(maxActiveAvailabilityCalls, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings caches repeated scans briefly', async () => {
  let availabilityCalls = 0;
  const cineplex = {
    async getTheatres() {
      return [{ id: '7247', name: 'South Keys' }];
    },
    async getShowtimes() {
      return {
        movies: [
          {
            name: 'Quiet Movie',
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: '1001',
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: '7'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      availabilityCalls += 1;
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex, cacheTtlMs: 60_000 });
  const port = await listen(server);

  try {
    const url = `http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=0`;
    const first = await fetch(url);
    const second = await fetch(url);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(availabilityCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings shares an in-flight scan between concurrent requests', async () => {
  let availabilityCalls = 0;
  let resolveAvailability;
  const availabilityReady = new Promise((resolve) => {
    resolveAvailability = resolve;
  });
  const cineplex = {
    async getTheatres() {
      return [{ id: '7247', name: 'South Keys' }];
    },
    async getShowtimes() {
      return {
        movies: [
          {
            name: 'Quiet Movie',
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: '1001',
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: '7'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      availabilityCalls += 1;
      await availabilityReady;
      return { seatAvailabilities: { A1: 'Available' } };
    }
  };

  const server = createServer({ cineplex, cacheTtlMs: 60_000 });
  const port = await listen(server);

  try {
    const url = `http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=0`;
    const first = fetch(url);
    const second = fetch(url);

    await new Promise((resolve) => setTimeout(resolve, 5));
    resolveAvailability();

    const responses = await Promise.all([first, second]);

    assert.equal(responses[0].status, 200);
    assert.equal(responses[1].status, 200);
    assert.equal(availabilityCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/showings counts array-based seat availability payloads', async () => {
  const cineplex = {
    async getTheatres() {
      return [{ id: '7247', name: 'South Keys' }];
    },
    async getShowtimes() {
      return {
        movies: [
          {
            name: 'Quiet Movie',
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: '1001',
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: '7'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      return {
        seatAvailabilities: [
          { id: 'A1', status: 'Available' },
          { id: 'A2', status: 'Occupied' },
          { id: 'A3', status: 'Available' }
        ]
      };
    }
  };

  const server = createServer({ cineplex });
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=1`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.showings.length, 1);
    assert.equal(body.showings[0].occupiedCount, 1);
    assert.equal(body.showings[0].availableCount, 2);
    assert.equal(body.showings[0].totalSeats, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('GET /api/seatmap reuses seat availability loaded during showings scan', async () => {
  let availabilityCalls = 0;
  const cineplex = {
    async getTheatres() {
      return [{ id: '7247', name: 'South Keys' }];
    },
    async getShowtimes() {
      return {
        movies: [
          {
            name: 'Quiet Movie',
            experiences: [
              {
                name: 'Regular',
                sessions: [
                  {
                    vistaSessionId: '1001',
                    showStartDateTime: '2026-05-23T21:50:00',
                    showStartDateTimeUtc: '2026-05-24T01:50:00Z',
                    isReservedSeating: true,
                    isShowtimeEnabledOnline: true,
                    isInThePast: false,
                    auditorium: '7'
                  }
                ]
              }
            ]
          }
        ]
      };
    },
    async getSeatAvailability() {
      availabilityCalls += 1;
      return { seatAvailabilities: { A1: 'Available', A2: 'Occupied' } };
    },
    async getSeatLayout() {
      return {
        standardSeats: {
          totalColumns: 2,
          rows: [{ label: 'A', seats: [{ id: 'A1', label: '1' }, { id: 'A2', label: '2' }] }]
        }
      };
    }
  };

  const server = createServer({ cineplex, cacheTtlMs: 60_000 });
  const port = await listen(server);

  try {
    const showings = await fetch(`http://127.0.0.1:${port}/api/showings?date=2026-05-23&threshold=1`);
    const seatmap = await fetch(`http://127.0.0.1:${port}/api/seatmap/7247/1001`);

    assert.equal(showings.status, 200);
    assert.equal(seatmap.status, 200);
    assert.equal(availabilityCalls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
