const DEFAULT_BASE_URL = 'https://apis.cineplex.com/prod';
const DEFAULT_WEBSITE_URL = 'https://www.cineplex.com/';
export const DEFAULT_CITY_SLUG = 'ottawa';

const LOCATION_DEFAULTS = { language: 'en', region: 'Ontario', regionCode: 'ON', country: 'Canada' };
const SUPPORTED_CITY_DATA = [
  ['ottawa', 'Ottawa', 'Ottawa', '45.4215', '-75.6972', 'K1P', '25'],
  ['toronto', 'Toronto', 'Toronto', '43.6532', '-79.3832', 'M5H', '25'],
  ['scarborough', 'Scarborough', 'Scarborough', '43.7764', '-79.2318', 'M1P', '18'],
  ['mississauga', 'Mississauga', 'Mississauga', '43.5890', '-79.6441', 'L5B', '18'],
  ['brampton', 'Brampton', 'Brampton', '43.7315', '-79.7624', 'L6Y', '18'],
  ['vaughan', 'Vaughan', 'Vaughan', '43.8563', '-79.5085', 'L4K', '18'],
  ['markham', 'Markham', 'Markham', '43.8561', '-79.3370', 'L3R', '18'],
  ['richmond-hill', 'Richmond Hill', 'Richmond Hill', '43.8828', '-79.4403', 'L4B', '18'],
  ['oakville', 'Oakville', 'Oakville', '43.4675', '-79.6877', 'L6H', '18'],
  ['burlington', 'Burlington', 'Burlington', '43.3255', '-79.7990', 'L7R', '18'],
  ['hamilton', 'Hamilton', 'Hamilton', '43.2557', '-79.8711', 'L8P', '22'],
  ['waterloo', 'Waterloo', 'Waterloo', '43.4643', '-80.5204', 'N2L', '18'],
  ['kitchener', 'Kitchener', 'Kitchener', '43.4516', '-80.4925', 'N2G', '18'],
  ['guelph', 'Guelph', 'Guelph', '43.5448', '-80.2482', 'N1H', '18'],
  ['london', 'London', 'London', '42.9849', '-81.2453', 'N6A', '22'],
  ['windsor', 'Windsor', 'Windsor', '42.3149', '-83.0364', 'N9A', '18'],
  ['barrie', 'Barrie', 'Barrie', '44.3894', '-79.6903', 'L4M', '18'],
  ['oshawa', 'Oshawa', 'Oshawa', '43.8971', '-78.8658', 'L1G', '18'],
  ['kingston', 'Kingston', 'Kingston', '44.2312', '-76.4860', 'K7L', '18'],
  ['niagara-falls', 'Niagara Falls', 'Niagara Falls', '43.0896', '-79.0849', 'L2E', '18'],
  ['sudbury', 'Sudbury', 'Sudbury', '46.4917', '-80.9930', 'P3E', '25'],
  ['thunder-bay', 'Thunder Bay', 'Thunder Bay', '48.3809', '-89.2477', 'P7B', '25']
];
const SUPPORTED_CITIES = SUPPORTED_CITY_DATA.map(([slug, label, city, latitude, longitude, postalCode, accuracyKm, cityAliases = []]) => ({
  slug,
  city,
  label,
  latitude,
  longitude,
  postalCode,
  accuracyKm,
  cityAliases: [city, ...cityAliases],
  ...LOCATION_DEFAULTS
}));
const SUPPORTED_CITIES_BY_SLUG = new Map(SUPPORTED_CITIES.map((city) => [city.slug, city]));

export function getSupportedCities() {
  return SUPPORTED_CITIES.map(({ slug, label, city, regionCode }) => ({ slug, label, city, regionCode }));
}

export function getCityLocation(slug = DEFAULT_CITY_SLUG) {
  return SUPPORTED_CITIES_BY_SLUG.get(String(slug || DEFAULT_CITY_SLUG).toLowerCase()) || null;
}

export function createCineplexClient({
  fetchImpl = globalThis.fetch,
  apiKey = process.env.CINEPLEX_SUBSCRIPTION_KEY,
  baseUrl = DEFAULT_BASE_URL,
  websiteUrl = DEFAULT_WEBSITE_URL
} = {}) {
  if (!fetchImpl) {
    throw new Error('A fetch implementation is required');
  }

  let apiKeyPromise;

  async function request(path) {
    const subscriptionKey = await resolveApiKey();

    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: {
        accept: 'application/json',
        'accept-language': 'en',
        'ocp-apim-subscription-key': subscriptionKey
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cineplex API ${response.status}: ${text.slice(0, 200)}`);
    }

    return response.json();
  }

  function resolveApiKey() {
    if (apiKey) {
      return Promise.resolve(apiKey);
    }

    apiKeyPromise ||= discoverCineplexSubscriptionKey({ fetchImpl, websiteUrl });
    return apiKeyPromise;
  }

  return {
    getTheatres(date, location = getCityLocation()) {
      const params = new URLSearchParams({ ...toCineplexLocationParams(location), date: formatCineplexDate(date) });
      return request(`/cpx/theatrical/api/v1/theatres/playingnearby?${params}`);
    },
    getShowtimes(theatreId, date) {
      const params = new URLSearchParams({ language: 'en', locationId: theatreId, date: formatCineplexDate(date) });
      return request(`/cpx/theatrical/api/v1/showtimes?${params}`);
    },
    getSeatAvailability(theatreId, showtimeId) {
      return request(`/ticketing/api/v1/theatre/${encodeURIComponent(theatreId)}/showtime/${encodeURIComponent(showtimeId)}/seat-availability?`);
    },
    getSeatLayout(theatreId, showtimeId) {
      return request(`/ticketing/api/v1/theatre/${encodeURIComponent(theatreId)}/showtime/${encodeURIComponent(showtimeId)}/seat-layout`);
    }
  };
}

function toCineplexLocationParams(location) {
  return {
    language: location.language,
    city: location.city,
    region: location.region,
    regionCode: location.regionCode,
    country: location.country,
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyKm: location.accuracyKm,
    postalCode: location.postalCode
  };
}

export async function discoverCineplexSubscriptionKey({
  fetchImpl = globalThis.fetch,
  websiteUrl = DEFAULT_WEBSITE_URL
} = {}) {
  const html = await fetchText(fetchImpl, websiteUrl);
  const keyFromHtml = extractSubscriptionKey(html);
  if (keyFromHtml) {
    return keyFromHtml;
  }

  const scriptUrls = extractScriptUrls(html, websiteUrl);
  for (const scriptUrl of scriptUrls) {
    const script = await fetchText(fetchImpl, scriptUrl);
    const key = extractSubscriptionKey(script);
    if (key) {
      return key;
    }
  }

  throw new Error('Unable to discover Cineplex public API key from website assets');
}

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/javascript,text/javascript,*/*',
      'accept-language': 'en',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
    }
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch Cineplex asset ${url}: ${response.status}`);
  }

  return response.text();
}

function extractScriptUrls(html, websiteUrl) {
  const scriptUrls = [];
  for (const match of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi)) {
    const scriptUrl = new URL(match[1], websiteUrl);
    if (scriptUrl.hostname.endsWith('cineplex.com')) {
      scriptUrls.push(scriptUrl.href);
    }
  }

  return scriptUrls;
}

function extractSubscriptionKey(text) {
  const patterns = [
    /["']ocp-apim-subscription-key["']\s*:\s*["']([^"']+)["']/i,
    /ocp-apim-subscription-key.{0,160}?["']([a-z0-9]{24,64})["']/i,
    /["']([a-z0-9]{24,64})["'].{0,160}?ocp-apim-subscription-key/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

function formatCineplexDate(date) {
  const [year, month, day] = String(date).split('-');
  if (!year || !month || !day) {
    return String(date);
  }

  return `${Number(month)}/${Number(day)}/${year}`;
}
