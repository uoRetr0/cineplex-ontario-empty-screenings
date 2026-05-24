import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { DEFAULT_CITY_SLUG, createCineplexClient, getCityLocation, getSupportedCities } from './cineplex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SEATMAP_PATH_RE = /^\/api\/seatmap\/([^/]+)\/([^/]+)$/;
const DATA_PATH_RE = /^\/data\/showings-(?:[a-z0-9-]+-)?\d{4}-\d{2}-\d{2}\.json$/;
const STATIC_ROUTES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);
const SEAT_AREA_NAMES = ['standardSeats', 'dboxSeats', 'balconySeats'];

export function createServer({
  cineplex = createCineplexClient(),
  cacheTtlMs = 90_000,
  now = () => Date.now(),
  scanConcurrency = 3,
  showtimeConcurrency = scanConcurrency
} = {}) {
  const showingsCache = new Map();
  const seatmapCache = new Map();
  const seatAvailabilityCache = new Map();
  const staticCache = new Map();
  const cachedCineplex = {
    getTheatres: (date, location) => cineplex.getTheatres(date, location),
    getShowtimes: (theatreId, date) => cineplex.getShowtimes(theatreId, date),
    getSeatLayout: (theatreId, showtimeId) => cineplex.getSeatLayout(theatreId, showtimeId),
    getSeatAvailability: (theatreId, showtimeId) => {
      return cached(seatAvailabilityCache, `${theatreId}:${showtimeId}`, cacheTtlMs, now, () => {
        return cineplex.getSeatAvailability(theatreId, showtimeId);
      });
    }
  };

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const { pathname } = url;

      if (request.method === 'GET' && pathname === '/api/cities') {
        sendJson(response, 200, { cities: getSupportedCities(), defaultCity: DEFAULT_CITY_SLUG });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/showings') {
        const date = url.searchParams.get('date') || todayLocal();
        const location = getCityLocation(url.searchParams.get('city') || DEFAULT_CITY_SLUG);
        if (!location) {
          sendJson(response, 400, { error: 'Unsupported city' });
          return;
        }

        const threshold = parseThreshold(url.searchParams.get('threshold'), url.searchParams.get('all'));
        const showings = await cached(showingsCache, `${location.slug}:${date}:${threshold}`, cacheTtlMs, now, () => {
          return loadShowings(cachedCineplex, { date, location, threshold, scanConcurrency, showtimeConcurrency });
        });
        sendJson(response, 200, { city: location.slug, showings });
        return;
      }

      const seatmapMatch = request.method === 'GET' ? pathname.match(SEATMAP_PATH_RE) : null;
      if (request.method === 'GET' && seatmapMatch) {
        const [, theatreId, showtimeId] = seatmapMatch;
        const decodedTheatreId = decodeURIComponent(theatreId);
        const decodedShowtimeId = decodeURIComponent(showtimeId);
        const seatmap = await cached(seatmapCache, `${decodedTheatreId}:${decodedShowtimeId}`, cacheTtlMs, now, () => {
          return loadSeatmap(cachedCineplex, {
            theatreId: decodedTheatreId,
            showtimeId: decodedShowtimeId
          });
        });
        sendJson(response, 200, seatmap);
        return;
      }

      const staticRoute = request.method === 'GET' ? STATIC_ROUTES.get(pathname) : null;
      if (staticRoute) {
        await sendStatic(staticCache, response, staticRoute[0], staticRoute[1]);
        return;
      }

      if (request.method === 'GET' && DATA_PATH_RE.test(pathname)) {
        await sendStatic(staticCache, response, pathname.slice(1), 'application/json; charset=utf-8');
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(response, 502, { error: publicErrorMessage(error) });
    }
  });
}

async function cached(cache, key, ttlMs, now, load) {
  const currentTime = now();
  const entry = cache.get(key);
  if (entry && (entry.pending || entry.expiresAt > currentTime)) {
    return entry.value;
  }

  const pending = Promise.resolve().then(load);
  cache.set(key, { value: pending, expiresAt: 0, pending: true });

  let value;
  try {
    value = await pending;
  } catch (error) {
    if (cache.get(key)?.value === pending) {
      cache.delete(key);
    }
    throw error;
  }

  cache.set(key, { value, expiresAt: now() + ttlMs, pending: false });
  return value;
}

export async function loadShowings(cineplex, {
  date,
  location = getCityLocation(),
  threshold = 0,
  scanConcurrency = 3,
  showtimeConcurrency = scanConcurrency
}) {
  const theatres = normalizeTheatres(await cineplex.getTheatres(date, location), location);
  const byId = new Map();
  const theatreShowtimes = await mapWithConcurrency(theatres, showtimeConcurrency, async (theatre) => {
    try {
      return { theatre, showtimes: await cineplex.getShowtimes(theatre.id, date) };
    } catch {
      return null;
    }
  });

  for (const result of theatreShowtimes) {
    if (!result) {
      continue;
    }

    const { theatre, showtimes } = result;

    for (const movie of listMovies(showtimes)) {
      for (const experience of movie.experiences || []) {
        for (const session of experience.sessions || []) {
          if (!isSupportedSession(session)) {
            continue;
          }

          const showtimeId = String(session.vistaSessionId || session.showtimeId || session.id || '');
          if (!showtimeId) {
            continue;
          }

          const id = `${theatre.id}:${showtimeId}`;
          const existing = byId.get(id);
          const experienceTypes = normalizeExperienceTypes(experience);

          if (existing) {
            for (const experienceType of experienceTypes) {
              if (!existing.experienceTypes.includes(experienceType)) {
                existing.experienceTypes.push(experienceType);
              }
            }
            continue;
          }

          byId.set(id, {
            id,
            theatreId: theatre.id,
            showtimeId,
            city: theatre.city,
            theatreName: theatre.name,
            movieTitle: movie.name || movie.title,
            filmUrl: movie.presentationUrl || movie.filmUrl || movie.url || null,
            startLocal: session.showStartDateTime || null,
            startUtc: session.showStartDateTimeUtc || null,
            auditorium: session.auditorium || null,
            experienceTypes,
            ticketingUrl: session.ticketingUrl || null,
            seatMapUrl: session.seatMapUrl || null
          });
        }
      }
    }
  }

  const showingsToScan = new Array(byId.size);
  let showingIndex = 0;
  for (const showing of byId.values()) {
    showingsToScan[showingIndex] = showing;
    showingIndex += 1;
  }

  const showings = await mapWithConcurrency(showingsToScan, scanConcurrency, async (showing) => {
    const counts = countAvailability(await cineplex.getSeatAvailability(showing.theatreId, showing.showtimeId));
    if (counts.totalSeats === 0) {
      return null;
    }

    if (counts.occupiedCount <= threshold) {
      return { ...showing, ...counts };
    }

    return null;
  });

  const matchingShowings = [];
  for (const showing of showings) {
    if (showing) {
      matchingShowings.push(showing);
    }
  }

  return matchingShowings.sort((a, b) => {
    return a.occupiedCount - b.occupiedCount
      || String(a.startLocal).localeCompare(String(b.startLocal))
      || a.theatreName.localeCompare(b.theatreName);
  });
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = new Array(workerCount);

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  for (let index = 0; index < workerCount; index += 1) {
    workers[index] = worker();
  }

  await Promise.all(workers);
  return results;
}

export async function loadSeatmap(cineplex, { theatreId, showtimeId }) {
  const [layout, availability] = await Promise.all([
    cineplex.getSeatLayout(theatreId, showtimeId),
    cineplex.getSeatAvailability(theatreId, showtimeId)
  ]);
  const statuses = availabilityMap(availability);

  return {
    theatreId,
    showtimeId,
    areas: normalizeAreas(layout, statuses)
  };
}

function normalizeTheatres(value, location) {
  const theatres = Array.isArray(value) ? value : value?.theatres || value?.locations || [];
  const normalized = [];

  for (const theatre of theatres) {
    const id = String(theatre.id || theatre.theatreId || theatre.locationId || theatre.cineplexTheatreId);
    const name = theatre.name || theatre.theatreName || theatre.locationName;
    const regionCode = normalizeRegionCode(theatre);
    if (regionCode && regionCode !== location.regionCode) {
      continue;
    }

    if (id && name) {
      normalized.push({ id, name, city: normalizeTheatreCity(theatre) });
    }
  }

  return normalized;
}

function normalizeRegionCode(theatre) {
  const value = theatre.regionCode
    || theatre.provinceCode
    || theatre.stateCode
    || theatre.address?.regionCode
    || theatre.address?.provinceCode
    || theatre.address?.stateCode
    || theatre.region
    || theatre.province
    || theatre.state
    || theatre.address?.region
    || theatre.address?.province
    || theatre.address?.state;
  const normalized = String(value || '').trim().toUpperCase();

  if (normalized === 'ONTARIO') {
    return 'ON';
  }

  return normalized || null;
}

function normalizeTheatreCity(theatre) {
  const city = theatre.city
    || theatre.theatreCity
    || theatre.locationCity
    || theatre.municipality
    || theatre.address?.city
    || theatre.address?.municipality;

  return city ? String(city) : null;
}

function listMovies(showtimes) {
  const movies = [];

  if (Array.isArray(showtimes)) {
    for (const item of showtimes) {
      if (Array.isArray(item?.dates)) {
        for (const date of item.dates) {
          if (Array.isArray(date.movies)) {
            movies.push(...date.movies);
          }
        }
      } else if (item?.experiences) {
        movies.push(item);
      }
    }
    return movies;
  }

  return showtimes?.movies || showtimes?.films || [];
}

function normalizeExperienceTypes(experience) {
  if (Array.isArray(experience.experienceTypes)) {
    return experience.experienceTypes.map(String);
  }

  const experienceType = experience.name || experience.type || experience.experienceType;
  return experienceType ? [String(experienceType)] : [];
}

function isSupportedSession(session) {
  return session.isReservedSeating === true
    && session.isShowtimeEnabledOnline === true
    && session.isInThePast !== true;
}

function countAvailability(value) {
  const raw = value?.seatAvailabilities || value || {};
  let totalSeats = 0;
  let occupiedCount = 0;
  let availableCount = 0;

  function count(status) {
    totalSeats += 1;
    if (status === 'Occupied') {
      occupiedCount += 1;
    } else if (status === 'Available') {
      availableCount += 1;
    }
  }

  if (Array.isArray(raw)) {
    for (const seat of raw) {
      count(seat.status || seat.availability || seat.state || 'Unknown');
    }
  } else {
    for (const id in raw) {
      count(String(raw[id]));
    }
  }

  const occupancyPct = totalSeats === 0 ? 0 : Number(((occupiedCount / totalSeats) * 100).toFixed(1));

  return { occupiedCount, totalSeats, availableCount, occupancyPct };
}

function normalizeAreas(layout, statuses) {
  const areas = [];

  for (const name of SEAT_AREA_NAMES) {
    const area = normalizeArea(name, layout?.[name], statuses);
    if (area.rows.length > 0) {
      areas.push(area);
    }
  }

  return areas;
}

function normalizeArea(name, area, statuses) {
  const rows = [];

  for (const row of area?.rows || []) {
    const seats = [];
    for (const seat of row.seats || []) {
      const id = String(seat.id);
      seats.push({
        id,
        label: seat.label || seat.seatLabel || '',
        column: seat.column,
        type: seat.type || seat.seatType || null,
        status: statuses.get(id) || 'Unknown'
      });
    }

    rows.push({
      label: row.label || row.rowLabel || '',
      seats
    });
  }

  return { name, totalColumns: area?.totalColumns || 0, rows };
}

function availabilityMap(value) {
  const raw = value?.seatAvailabilities || value || {};

  if (Array.isArray(raw)) {
    const statuses = new Map();
    for (const seat of raw) {
      statuses.set(String(seat.id || seat.seatId), seat.status || seat.availability || seat.state || 'Unknown');
    }

    return statuses;
  }

  const statuses = new Map();
  for (const id in raw) {
    statuses.set(String(id), String(raw[id]));
  }

  return statuses;
}

function parseThreshold(thresholdValue, allValue) {
  if (allValue === '1' || allValue === 'true') {
    return Number.MAX_SAFE_INTEGER;
  }

  const threshold = Number(thresholdValue ?? 0);
  return Number.isFinite(threshold) && threshold >= 0 ? threshold : 0;
}

function todayLocal() {
  return new Date().toISOString().slice(0, 10);
}

function publicErrorMessage(error) {
  if (String(error?.message || '').includes('Cineplex')) {
    return 'Cineplex changed or temporarily rejected its public website API. Try again later, or set CINEPLEX_SUBSCRIPTION_KEY if automatic key discovery has stopped working.';
  }

  return error.message || 'Unexpected server error';
}

async function sendStatic(cache, response, filename, contentType) {
  let body = cache.get(filename);
  if (!body) {
    body = await readFile(path.join(PUBLIC_DIR, filename));
    cache.set(filename, body);
  }

  response.writeHead(200, { 'content-type': contentType });
  response.end(body);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(`Cineplex empty screenings listening on http://localhost:${port}`);
  });
}
