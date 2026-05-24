import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCineplexClient, getCityLocation, getSupportedCities } from '../src/cineplex.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('Cineplex client discovers the public browser API key when no override is provided', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), headers: options.headers || {} });

    if (String(url) === 'https://www.cineplex.com/') {
      return new Response('<script src="/next-static-files/_next/static/chunks/pages/_app.js" defer></script>', {
        headers: { 'content-type': 'text/html' }
      });
    }

    if (String(url) === 'https://www.cineplex.com/next-static-files/_next/static/chunks/pages/_app.js') {
      return new Response('headers:{"ocp-apim-subscription-key":"public-browser-key"}', {
        headers: { 'content-type': 'text/javascript' }
      });
    }

    if (String(url).startsWith('https://apis.cineplex.com/prod/ticketing/api/v1/theatre/7247/showtime/1001/seat-availability')) {
      return jsonResponse({ seatAvailabilities: { A1: 'Available' } });
    }

    return new Response('not found', { status: 404 });
  };

  const client = createCineplexClient({ fetchImpl, apiKey: undefined });
  const availability = await client.getSeatAvailability('7247', '1001');

  assert.deepEqual(availability, { seatAvailabilities: { A1: 'Available' } });
  assert.equal(requests.at(-1).headers['ocp-apim-subscription-key'], 'public-browser-key');
});

test('Cineplex client sends selected city location to theatre discovery', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(String(url));
    return jsonResponse({ theatres: [] });
  };
  const client = createCineplexClient({ fetchImpl, apiKey: 'test-key' });

  await client.getTheatres('2026-05-23', getCityLocation('toronto'));

  const url = new URL(requests[0]);
  assert.equal(url.searchParams.get('city'), 'Toronto');
  assert.equal(url.searchParams.get('regionCode'), 'ON');
  assert.equal(url.searchParams.get('date'), '5/23/2026');
  assert.equal(url.searchParams.has('slug'), false);
  assert.equal(url.searchParams.has('label'), false);
});

test('supported city registry exposes Ontario choices', () => {
  const cities = getSupportedCities();

  assert.ok(cities.some((city) => city.slug === 'ottawa'));
  assert.ok(cities.some((city) => city.slug === 'toronto'));
  assert.deepEqual(getCityLocation('missing-city'), null);
});
