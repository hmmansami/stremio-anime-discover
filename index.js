const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const anilist = require('./anilist');

const GENRES = ['Action', 'Romance', 'Fantasy', 'Comedy', 'Drama', 'Thriller', 'Sci-Fi', 'Slice of Life', 'Horror', 'Mecha', 'Sports', 'Music', 'Supernatural'];

const season = anilist.getCurrentSeason();
const nextSeason = anilist.getNextSeason();
const year = new Date().getFullYear();

const manifest = {
  id: 'community.anime.discover',
  version: '1.0.0',
  name: 'Anime Discover',
  description: `Seasonal anime, trending, hidden gems, and genre discovery via AniList. Currently: ${season} ${year}`,
  logo: 'https://anilist.co/img/icons/android-chrome-512x512.png',
  resources: ['catalog', 'meta'],
  types: ['series', 'movie'],
  idPrefixes: ['anilist:'],
  catalogs: [
    {
      id: 'airing-this-season',
      type: 'series',
      name: `🔴 Airing Now - ${season} ${year}`,
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      id: 'trending-now',
      type: 'series',
      name: '🔥 Trending Right Now',
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      id: 'new-episodes',
      type: 'series',
      name: '📺 Recently Updated',
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      id: 'upcoming-next-season',
      type: 'series',
      name: `⏳ Upcoming - ${nextSeason} ${year}`,
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      id: 'hidden-gems',
      type: 'series',
      name: '💎 Hidden Gems',
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      id: 'recently-completed',
      type: 'series',
      name: '✅ Recently Completed',
      extra: [{ name: 'skip', isRequired: false }],
    },
    {
      id: 'all-time-popular',
      type: 'series',
      name: '👑 All Time Popular',
      extra: [{ name: 'skip', isRequired: false }],
    },
    // Genre catalogs
    ...GENRES.map(genre => ({
      id: `genre-${genre.toLowerCase().replace(/[^a-z]/g, '')}`,
      type: 'series',
      name: `🎯 Top ${genre} Anime`,
      extra: [{ name: 'skip', isRequired: false }],
    })),
  ],
};

const builder = new addonBuilder(manifest);

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const skip = extra?.skip ? Math.floor(parseInt(extra.skip) / 30) + 1 : 1;

  try {
    let metas = [];

    if (id === 'airing-this-season') {
      metas = await anilist.getAiringThisSeason(skip);
    } else if (id === 'trending-now') {
      metas = await anilist.getTrendingNow(skip);
    } else if (id === 'new-episodes') {
      metas = await anilist.getNewEpisodesThisWeek(skip);
    } else if (id === 'upcoming-next-season') {
      metas = await anilist.getUpcomingNextSeason(skip);
    } else if (id === 'hidden-gems') {
      metas = await anilist.getHiddenGems(skip);
    } else if (id === 'recently-completed') {
      metas = await anilist.getRecentlyCompleted(skip);
    } else if (id === 'all-time-popular') {
      metas = await anilist.getAllTimePopular(skip);
    } else if (id.startsWith('genre-')) {
      const genreSlug = id.replace('genre-', '');
      const genre = GENRES.find(g => g.toLowerCase().replace(/[^a-z]/g, '') === genreSlug);
      if (genre) {
        metas = await anilist.getTopByGenre(genre, skip);
      }
    }

    // Force all metas to be 'series' type for catalog consistency
    metas = metas.map(m => ({ ...m, type: 'series' }));

    return { metas };
  } catch (err) {
    console.error(`Catalog error [${id}]:`, err.message);
    return { metas: [] };
  }
});

// Meta handler
builder.defineMetaHandler(async ({ type, id }) => {
  if (!id.startsWith('anilist:')) return { meta: null };

  const anilistId = id.replace('anilist:', '');
  try {
    const meta = await anilist.getAnimeMeta(anilistId);
    if (meta) {
      meta.type = type;
      return { meta };
    }
  } catch (err) {
    console.error(`Meta error [${id}]:`, err.message);
  }
  return { meta: null };
});

const PORT = process.env.PORT || 7000;

serveHTTP(builder.getInterface(), { port: PORT });
console.log(`\n🎯 Anime Discover addon running at: http://localhost:${PORT}`);
console.log(`📦 Install in Stremio: http://localhost:${PORT}/manifest.json`);
console.log(`\nCatalogs available:`);
console.log(`  - 🔴 Airing Now (${season} ${year})`);
console.log(`  - 🔥 Trending Right Now`);
console.log(`  - 📺 Recently Updated`);
console.log(`  - ⏳ Upcoming (${nextSeason})`);
console.log(`  - 💎 Hidden Gems`);
console.log(`  - ✅ Recently Completed`);
console.log(`  - 👑 All Time Popular`);
console.log(`  - 🎯 ${GENRES.length} Genre catalogs`);
