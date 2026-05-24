import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCineplexClient, getCityLocation, getSupportedCities } from '../src/cineplex.js';
import { loadShowings } from '../src/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, '..', 'public', 'data');
const days = Math.max(1, Number(process.env.STATIC_DAYS || 1));
const scanConcurrency = Math.max(1, Number(process.env.SCAN_CONCURRENCY || 3));
const defaultCitySlugs = getSupportedCities().map((city) => city.slug).join(',');
const citySlugs = String(process.env.STATIC_CITIES || defaultCitySlugs).split(',').map((city) => city.trim()).filter(Boolean);
const cineplex = createCineplexClient();
const torontoFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Toronto',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});
const index = [];

await mkdir(outputDir, { recursive: true });

for (const citySlug of citySlugs) {
  const location = getCityLocation(citySlug);
  if (!location) {
    throw new Error(`Unsupported STATIC_CITIES entry: ${citySlug}`);
  }

  for (let offset = 0; offset < days; offset += 1) {
    const date = torontoDate(offset);
    console.log(`Building static screenings data for ${location.city} on ${date}`);

    const showings = await loadShowings(cineplex, {
      date,
      location,
      threshold: Number.MAX_SAFE_INTEGER,
      scanConcurrency
    });
    const generatedAt = new Date().toISOString();
    const filename = `showings-${location.slug}-${date}.json`;

    await writeFile(
      path.join(outputDir, filename),
      JSON.stringify({ city: location.slug, date, generatedAt, showings }, null, 2)
    );

    index.push({ city: location.slug, date, generatedAt, showings: showings.length, path: `data/${filename}` });
  }
}

await writeFile(path.join(outputDir, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), dates: index }, null, 2));

function torontoDate(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return torontoFormatter.format(date);
}
