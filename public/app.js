const form = document.querySelector('#filters');
const cityInput = form.elements.city;
const dateInput = form.elements.date;
const thresholdInput = form.elements.threshold;
const cineplexInput = form.elements.cineplex;
const movieInput = form.elements.movie;
const statusEl = document.querySelector('#status');
const showingsEl = document.querySelector('#showings');
const timeFormatter = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const defaultCities = [
  ['ottawa', 'Ottawa'],
  ['toronto', 'Toronto'],
  ['scarborough', 'Scarborough'],
  ['mississauga', 'Mississauga'],
  ['brampton', 'Brampton'],
  ['vaughan', 'Vaughan'],
  ['markham', 'Markham'],
  ['richmond-hill', 'Richmond Hill'],
  ['oakville', 'Oakville'],
  ['burlington', 'Burlington'],
  ['hamilton', 'Hamilton'],
  ['waterloo', 'Waterloo'],
  ['kitchener', 'Kitchener'],
  ['guelph', 'Guelph'],
  ['london', 'London'],
  ['windsor', 'Windsor'],
  ['barrie', 'Barrie'],
  ['oshawa', 'Oshawa'],
  ['kingston', 'Kingston'],
  ['niagara-falls', 'Niagara Falls'],
  ['sudbury', 'Sudbury'],
  ['thunder-bay', 'Thunder Bay']
];
const defaultCityLabels = new Map(defaultCities);

let allShowings = [];
let loadController = null;
let dataStale = true;
let primaryFilterChanged = false;

dateInput.value = todayLocal();
replaceOptions(cityInput, '', defaultCities.map(([slug, label]) => ({ value: slug, label })));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  loadShowings();
});

cityInput.addEventListener('change', loadSelectedCity);
dateInput.addEventListener('change', loadSelectedCity);
thresholdInput.addEventListener('input', applyFilters);
cineplexInput.addEventListener('change', applyFilters);
movieInput.addEventListener('change', applyFilters);

loadCities().finally(() => {
  if (!primaryFilterChanged) {
    markNeedsRefresh();
  }
});

async function loadCities() {
  try {
    const body = await fetchJson('api/cities');
    const selectedCity = cityInput.value;
    replaceOptions(cityInput, '', body.cities.map((city) => ({ value: city.slug, label: city.label })));
    cityInput.value = hasOption(cityInput, selectedCity) ? selectedCity : body.defaultCity || 'ottawa';
  } catch {
    await loadStaticCities();
  }
}

async function loadStaticCities() {
  try {
    const body = await fetchJson('data/index.json');
    const citySlugs = sortedValues(new Set((body.dates || []).map((entry) => entry.city).filter(Boolean)));
    if (citySlugs.length > 0) {
      const selectedCity = cityInput.value;
      replaceOptions(cityInput, '', citySlugs.map((slug) => ({ value: slug, label: defaultCityLabels.get(slug) || slug })));
      cityInput.value = hasOption(cityInput, selectedCity) ? selectedCity : 'ottawa';
    }
  } catch {
    // The default city list is already rendered in the HTML/JS fallback.
  }

  cityInput.value = hasOption(cityInput, cityInput.value) ? cityInput.value : hasOption(cityInput, 'ottawa') ? 'ottawa' : cityInput.options[0]?.value || 'ottawa';
}

async function loadShowings() {
  loadController?.abort();
  loadController = new AbortController();
  const { signal } = loadController;

  statusEl.textContent = allShowings.length === 0 ? 'Loading...' : 'Refreshing...';

  try {
    const body = await fetchShowings(cityInput.value, dateInput.value, signal);
    if (signal.aborted) {
      return;
    }

    allShowings = prepareShowings(body.showings || []);
    dataStale = false;
    updateFilterOptions(allShowings);
    applyFilters();
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }

    statusEl.textContent = 'Unable to load screenings';
    if (allShowings.length === 0) {
      showingsEl.replaceChildren(emptyMessage(error.message));
    }
  } finally {
    if (loadController?.signal === signal) {
      loadController = null;
    }
  }
}

function loadSelectedCity() {
  primaryFilterChanged = true;
  loadShowings();
}

function markNeedsRefresh() {
  loadController?.abort();
  dataStale = true;

  if (allShowings.length > 0) {
    applyFilters();
    return;
  }

  statusEl.textContent = 'Press Refresh to load screenings';
  showingsEl.replaceChildren(emptyMessage('Choose a city and date, then press Refresh.'));
}

async function fetchShowings(city, date, signal) {
  const params = new URLSearchParams({ city, date, all: '1' });

  try {
    return await fetchJson(`api/showings?${params}`, signal);
  } catch (apiError) {
    try {
      return await fetchJson(`data/showings-${city}-${date}.json`, signal);
    } catch {
      throw apiError;
    }
  }
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new Error(body?.error || `Unable to load ${url}`);
  }

  return body;
}

function applyFilters() {
  const cineplex = cineplexInput.value;
  const movie = movieInput.value;
  const threshold = parseThreshold(thresholdInput.value);
  const filtered = [];

  for (const showing of allShowings) {
    if (showing.occupiedCount <= threshold
      && (!cineplex || showing.theatreName === cineplex)
      && (!movie || showing.movieTitle === movie)) {
      filtered.push(showing);
    }
  }

  renderShowings(filtered, { filtered: Boolean(cineplex || movie || threshold > 0) });
}

function prepareShowings(showings) {
  for (const showing of showings) {
    showing.displayTime = formatTime(showing.startLocal);
    showing.displayAuditorium = formatAuditorium(showing.auditorium);
    showing.sortStartLocal = String(showing.startLocal || '');
  }

  return showings;
}

function updateFilterOptions(showings) {
  const selectedCineplex = cineplexInput.value;
  const selectedMovie = movieInput.value;
  const theatreNames = new Set();
  const movieTitles = new Set();

  for (const showing of showings) {
    if (showing.theatreName) {
      theatreNames.add(showing.theatreName);
    }
    if (showing.movieTitle) {
      movieTitles.add(showing.movieTitle);
    }
  }

  replaceOptions(cineplexInput, 'All Cineplex theatres', sortedValues(theatreNames));
  replaceOptions(movieInput, 'All movies', sortedValues(movieTitles));

  cineplexInput.value = hasOption(cineplexInput, selectedCineplex) ? selectedCineplex : '';
  movieInput.value = hasOption(movieInput, selectedMovie) ? selectedMovie : '';
}

function renderShowings(showings, { filtered = false } = {}) {
  const theatreGroups = groupByTheatre(showings);
  const groupCount = theatreGroups.length;
  if (dataStale) {
    statusEl.textContent = allShowings.length === 0
      ? 'Press Refresh to load screenings'
      : `${showings.length} shown from previous results. Press Refresh for selected city/date.`;
  } else {
    statusEl.textContent = `${showings.length} found${filtered ? ' after filters' : ` across ${groupCount} Cineplex theatres`}`;
  }

  if (showings.length === 0) {
    showingsEl.replaceChildren(emptyMessage(dataStale
      ? 'Choose a city and date, then press Refresh.'
      : 'No matching screenings found. Try raising the threshold or clearing the filters.'));
    return;
  }

  let rowIndex = 0;
  const fragment = document.createDocumentFragment();

  for (const { theatreName, showings: theatreShowings } of theatreGroups) {
    const section = document.createElement('section');
    section.className = 'theatre-group';

    const city = theatreShowings.find((showing) => showing.city)?.city;
    section.append(theatreHeading(theatreName, city, theatreShowings.length));

    const list = document.createElement('div');
    list.className = 'showing-list';

    for (const showing of theatreShowings) {
      list.append(showingRow(showing, Math.min(rowIndex++, 8) * 45));
    }

    section.append(list);
    fragment.append(section);
  }

  showingsEl.replaceChildren(fragment);
}

function groupByTheatre(showings) {
  const groups = new Map();

  for (const showing of showings) {
    const theatreName = showing.theatreName || 'Unknown Cineplex';
    if (!groups.has(theatreName)) {
      groups.set(theatreName, []);
    }
    groups.get(theatreName).push(showing);
  }

  const theatreGroups = [];
  for (const [theatreName, theatreShowings] of groups) {
    theatreGroups.push({
      theatreName,
      showings: theatreShowings.sort((a, b) => a.sortStartLocal.localeCompare(b.sortStartLocal))
    });
  }

  return theatreGroups.sort((a, b) => a.theatreName.localeCompare(b.theatreName));
}

function theatreHeading(theatreName, city, screeningCount) {
  const heading = document.createElement('div');
  heading.className = 'theatre-heading';

  const title = document.createElement('h3');
  title.textContent = theatreName;

  const details = document.createElement('p');
  details.textContent = city ? `${city} · ${screeningCount} screenings` : `${screeningCount} screenings`;

  heading.append(title, details);
  return heading;
}

function showingRow(showing, animationDelay) {
  const row = document.createElement('article');
  row.className = 'showing-row';
  row.style.animationDelay = `${animationDelay}ms`;

  const time = document.createElement('div');
  const timeValue = document.createElement('strong');
  timeValue.textContent = showing.displayTime;
  const auditorium = document.createElement('span');
  auditorium.textContent = showing.displayAuditorium;
  time.append(timeValue, auditorium);

  const movie = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = showing.movieTitle;
  const experience = document.createElement('span');
  experience.textContent = showing.experienceTypes.join(', ') || 'Standard';
  movie.append(title, experience);

  const seats = document.createElement('div');
  seats.className = 'seat-count';
  const occupied = document.createElement('strong');
  occupied.textContent = showing.occupiedCount;
  const total = document.createElement('span');
  total.textContent = `${showing.totalSeats} seats`;
  seats.append(occupied, total);

  row.append(time, movie, seats);
  return row;
}

function formatTime(value) {
  if (!value) return 'TBD';
  return timeFormatter.format(new Date(value));
}

function formatAuditorium(value) {
  const label = String(value || '').trim();
  if (!label) {
    return 'AUD ?';
  }

  const match = label.match(/^(?:auditorium|aud)\s*(.*)$/i);
  if (match) {
    const number = match[1].trim();
    return number ? `AUD ${number}` : 'AUD';
  }

  return `AUD ${label}`;
}

function emptyMessage(message) {
  const element = document.createElement('p');
  element.className = 'empty';
  element.textContent = message;
  return element;
}

function replaceOptions(select, defaultLabel, values) {
  const offset = defaultLabel ? 1 : 0;
  const options = new Array(values.length + offset);
  if (defaultLabel) {
    options[0] = new Option(defaultLabel, '');
  }

  for (let index = 0; index < values.length; index += 1) {
    const value = typeof values[index] === 'string' ? values[index] : values[index].value;
    const label = typeof values[index] === 'string' ? values[index] : values[index].label;
    options[index + offset] = new Option(label, value);
  }

  select.replaceChildren(...options);
}

function sortedValues(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function hasOption(select, value) {
  for (const option of select.options) {
    if (option.value === value) {
      return true;
    }
  }

  return false;
}

function parseThreshold(value) {
  const threshold = Number(value || 0);
  return Number.isFinite(threshold) && threshold >= 0 ? threshold : 0;
}

function todayLocal() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}
