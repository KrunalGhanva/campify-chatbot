import { config } from './config.js';

/**
 * Simple in-memory cache: key → { at: timestamp, ttl: ms, value: any }
 * Entries expire after `ttl` milliseconds.
 */
const cache = new Map();

const getCached = (key) => {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < hit.ttl ? hit.value : null;
};

const setCached = (key, value, ttl) => cache.set(key, { at: Date.now(), ttl, value });

/**
 * Fetch JSON from the Campify Express API with a generous timeout
 * (Render free-tier can cold-start in ~30-50 s).
 * Returns `null` on 404; throws on other HTTP errors or network failures.
 */
async function apiGet(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.fetchTimeoutMs);
  try {
    const res = await fetch(`${config.campifyApiUrl}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Campify API returned ${res.status} for ${path}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Public helpers ────────────────────────────────────────────

/**
 * Fetch the full campground list (reviews are only ObjectId refs here).
 * Cached for `listCacheMs` (default 5 min).
 *
 * Response shape: { campgrounds: [{_id, title, location, price, description, images, geometry, reviews:[ids]}] }
 */
export async function getAllCampgrounds() {
  const cached = getCached('list');
  if (cached) return cached;

  const data = await apiGet('/campgrounds');
  const list = data?.campgrounds ?? [];
  setCached('list', list, config.listCacheMs);
  return list;
}

/**
 * Fetch one campground by id with fully-populated reviews.
 * Cached for `detailCacheMs` (default 2 min).
 * Returns `null` if not found or id is malformed.
 *
 * Response shape: { campground: {…, reviews:[{rating,body,author:{username},createdAt}]} }
 */
export async function getCampgroundRaw(id) {
  if (!/^[a-f0-9]{24}$/i.test(String(id))) return null;

  const key = `c:${id}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await apiGet(`/campgrounds/${id}`);
  const camp = data?.campground ?? null;
  if (camp) setCached(key, camp, config.detailCacheMs);
  return camp;
}

/** Build the frontend URL for a campground detail page. */
export const campgroundUrl = (id) => `${config.clientUrl}/campgrounds/${id}`;

/**
 * Compute the average rating and review count for a set of reviews.
 * Only reviews that have a numeric `rating` field contribute to the average.
 *
 * @returns {{ avgRating: number|null, reviewCount: number }}
 */
export function summarizeReviews(reviews = []) {
  const rated = reviews.filter((r) => typeof r.rating === 'number');
  const avg = rated.length
    ? Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10
    : null;
  return { avgRating: avg, reviewCount: reviews.length };
}
