// Travel-time estimates. Coordinates come from a places table the app fills in
// (geocoded once per address and cached); anything without coordinates falls
// back to a flat buffer so the radar still works with messy location strings.

const ROAD_FACTOR = 1.4; // straight line -> typical road distance
const AVG_KMH = 35; // suburban driving incl. lights
const OVERHEAD_MIN = 5; // parking, getting kids in and out

export const normalizePlace = (loc) => (loc || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function haversineKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Returns a function (fromLocation, toLocation) -> whole minutes, rounded up to 5.
// A missing end (null) means "home".
export function makeTravelTime({ places = {}, home = '', fallbackMin = 20 } = {}) {
  const coords = (loc) => places[normalizePlace(loc || home)];
  return (from, to) => {
    const a = coords(from);
    const b = coords(to);
    if (!a || !b) return fallbackMin;
    const km = haversineKm(a, b) * ROAD_FACTOR;
    return Math.max(5, Math.ceil((OVERHEAD_MIN + (km / AVG_KMH) * 60) / 5) * 5);
  };
}

// Look up an address with OpenStreetMap's Nominatim (browser-friendly, no key).
// Their policy is one request per second, so callers must go one at a time.
export async function geocode(query, fetchImpl = fetch) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`geocoder returned ${res.status}`);
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}
