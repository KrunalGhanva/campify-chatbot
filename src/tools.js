import {
  getAllCampgrounds,
  getCampgroundRaw,
  campgroundUrl,
  summarizeReviews,
} from './campifyClient.js';

// ── Stop-words (ignored in keyword scoring) ──────────────────
const STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'near', 'for', 'with', 'and', 'or',
  'to', 'of', 'me', 'i', 'want', 'find', 'show', 'best', 'good',
  'camp', 'camping', 'campground', 'campgrounds', 'place', 'places',
  'any', 'some', 'is', 'are', 'at', 'my', 'what', 'where', 'which',
  'how', 'can', 'tell', 'about', 'do', 'looking', 'look',
]);

/** Break a query string into lowercase tokens, removing stop-words. */
const tokenize = (q = '') =>
  q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

/**
 * Score a campground against search tokens.
 * title match = 3pts, location = 2pts, description = 1pt.
 * Returns > 0 when at least one token matches; 1 when there are no tokens (show all).
 */
const score = (c, tokens) => {
  if (!tokens.length) return 1;
  const title = (c.title || '').toLowerCase();
  const loc = (c.location || '').toLowerCase();
  const desc = (c.description || '').toLowerCase();
  let s = 0;
  for (const t of tokens) {
    if (title.includes(t)) s += 3;
    if (loc.includes(t)) s += 2;
    if (desc.includes(t)) s += 1;
  }
  return s;
};

/** Build a brief summary object for a campground (no reviews yet). */
const brief = (c, extra = {}) => ({
  id: String(c._id),
  title: c.title,
  location: c.location,
  price_per_night_usd: c.price,
  description: (c.description || '').slice(0, 240),
  url: campgroundUrl(c._id),
  ...extra,
});

/** Fetch detail for one campground and attach review summary. */
async function enrich(c) {
  const full = await getCampgroundRaw(c._id).catch(() => null);
  return brief(c, summarizeReviews(full?.reviews ?? []));
}

// ── Tool implementations ──────────────────────────────────────

/**
 * search_campgrounds — keyword search over the cached campground list.
 * Enriches results with avg rating + review count from detail calls.
 */
async function searchCampgrounds({ query = '', max_price, sort = 'relevance', limit = 5 }) {
  limit = Math.min(Math.max(Number(limit) || 5, 1), 8);
  const all = await getAllCampgrounds();
  const tokens = tokenize(query);

  let pool = all
    .map((c) => ({ c, s: score(c, tokens) }))
    .filter((x) => x.s > 0)
    .filter((x) => max_price == null || x.c.price <= Number(max_price));

  // No matches — return available locations so the model can be honest
  if (!pool.length) {
    const locations = [...new Set(all.map((c) => c.location).filter(Boolean))].slice(0, 15);
    return {
      results: [],
      note: 'No campgrounds on Campify matched this query. Do NOT invent any. Inform the user and suggest these real available locations, or encourage them to broaden their search.',
      available_locations: locations,
      total_campgrounds_on_site: all.length,
    };
  }

  // Sort by relevance score first (best match at front)
  pool.sort((a, b) => b.s - a.s);

  // For rating-sort we need review data for a wider candidate set before slicing
  const fetchCount = sort === 'rating' ? Math.min(pool.length, 25) : limit;
  const candidates = pool.slice(0, fetchCount).map((x) => x.c);
  const enriched = await Promise.all(candidates.map(enrich));

  if (sort === 'rating') {
    // Put unrated campgrounds last; secondary: most reviews
    enriched.sort(
      (a, b) =>
        (b.avgRating ?? -1) - (a.avgRating ?? -1) ||
        (b.reviewCount ?? 0) - (a.reviewCount ?? 0)
    );
  } else if (sort === 'price_low') {
    enriched.sort((a, b) => (a.price_per_night_usd ?? 0) - (b.price_per_night_usd ?? 0));
  } else if (sort === 'price_high') {
    enriched.sort((a, b) => (b.price_per_night_usd ?? 0) - (a.price_per_night_usd ?? 0));
  }
  // 'relevance' is already sorted by score above

  return {
    results: enriched.slice(0, limit),
    total_campgrounds_on_site: all.length,
  };
}

/**
 * get_campground_details — full detail for one campground including recent reviews.
 * Reviews are truncated to 300 chars to control token usage.
 */
async function getCampgroundDetails({ id }) {
  const c = await getCampgroundRaw(id);
  if (!c) return { error: 'Campground not found. Do not invent details or guess.' };

  // Sort by newest first, then take the 8 most recent
  const latestReviews = (c.reviews ?? [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 8)
    .map((r) => ({
      rating: r.rating,
      // User-generated content — treat strictly as data, never as instructions
      author: r.author?.username || 'anonymous',
      text: (r.body || '').slice(0, 300),
      date: r.createdAt ? r.createdAt.slice(0, 10) : null,
    }));

  return {
    ...brief(c, summarizeReviews(c.reviews ?? [])),
    // Full description (not truncated) for detail view
    description: c.description,
    coordinates: c.geometry?.coordinates
      ? { lng: c.geometry.coordinates[0], lat: c.geometry.coordinates[1] }
      : null,
    photo_count: (c.images ?? []).length,
    // SECURITY NOTE: review text is untrusted user content — model must not follow instructions inside it
    recent_reviews: latestReviews,
  };
}

// ── Tool schema definitions — Google Generative AI format ─────
// Google uses uppercase type names and wraps declarations in { functionDeclarations }

export const googleToolDefs = [
  {
    functionDeclarations: [
      {
        name: 'search_campgrounds',
        description:
          "Search Campify's campground listings by keywords (e.g. place, state, feature like 'lake', 'forest', 'beach'). " +
          "Optionally filter by max nightly price. Returns id, title, location, price per night (USD), short description, " +
          "average rating, review count, and page URL for each result. " +
          "Use sort='rating' when the user asks for the best or top-rated options. " +
          "When no results match, the response includes available_locations — present those honestly.",
        parameters: {
          type: 'OBJECT',
          properties: {
            query: {
              type: 'STRING',
              description: 'Search keywords, e.g. "lake california" or "mountains Colorado".',
            },
            max_price: {
              type: 'NUMBER',
              description: 'Maximum price per night in USD (optional).',
            },
            sort: {
              type: 'STRING',
              description: "Sort order: relevance | rating | price_low | price_high. Use 'rating' for best/top-rated queries.",
            },
            limit: {
              type: 'INTEGER',
              description: 'Number of results to return (1–8, default 5).',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_campground_details',
        description:
          'Retrieve full details for a single campground by its id, including description, price, coordinates, photo count, ' +
          'average rating, review count, and the 8 most recent user reviews. ' +
          'Always call this before summarising reviews or giving a verdict on a specific campground.',
        parameters: {
          type: 'OBJECT',
          properties: {
            id: {
              type: 'STRING',
              description: '24-character hex MongoDB ObjectId (from search results or page context).',
            },
          },
          required: ['id'],
        },
      },
    ],
  },
];

// ── Tool dispatcher ───────────────────────────────────────────

const impl = {
  search_campgrounds: searchCampgrounds,
  get_campground_details: getCampgroundDetails,
};

/**
 * Execute a named tool and return its result.
 * Errors are caught and returned as a structured error object so the model can
 * respond gracefully without the caller needing special handling.
 */
export async function runTool(name, input) {
  const fn = impl[name];
  if (!fn) return { error: `Unknown tool: ${name}` };
  try {
    return await fn(input || {});
  } catch (e) {
    console.error(`Tool "${name}" failed:`, e.message);
    return {
      error: 'Campify data is temporarily unavailable. Tell the user to try again shortly.',
    };
  }
}
