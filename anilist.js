const fetch = require('node-fetch');

const ANILIST_API = 'https://graphql.anilist.co';

function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  if (month >= 1 && month <= 3) return 'WINTER';
  if (month >= 4 && month <= 6) return 'SPRING';
  if (month >= 7 && month <= 9) return 'SUMMER';
  return 'FALL';
}

function getNextSeason() {
  const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
  const current = getCurrentSeason();
  const idx = seasons.indexOf(current);
  return seasons[(idx + 1) % 4];
}

function getNextSeasonYear() {
  const season = getCurrentSeason();
  const year = new Date().getFullYear();
  return season === 'FALL' ? year + 1 : year;
}

async function queryAniList(query, variables) {
  const res = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error('AniList error:', json.errors);
    return null;
  }
  return json.data;
}

// Cache for MAL→Kitsu ID mapping
const kitsuIdCache = new Map();

async function getKitsuIdFromMal(malId) {
  if (!malId) return null;
  if (kitsuIdCache.has(malId)) return kitsuIdCache.get(malId);

  try {
    const res = await fetch(
      `https://kitsu.io/api/edge/mappings?filter[externalSite]=myanimelist/anime&filter[externalId]=${malId}&include=item`,
      { headers: { Accept: 'application/vnd.api+json' } }
    );
    const json = await res.json();
    const kitsuId = json?.included?.[0]?.id;
    if (kitsuId) {
      kitsuIdCache.set(malId, kitsuId);
      return kitsuId;
    }
  } catch (e) {
    // silent fail, use anilist id
  }
  return null;
}

function mapToStremioMeta(media, kitsuId) {
  const title = media.title.english || media.title.romaji || media.title.native;
  // Use kitsu: ID if available (compatible with Torrentio etc), fallback to anilist:
  const id = kitsuId ? `kitsu:${kitsuId}` : `anilist:${media.id}`;

  return {
    id,
    type: media.format === 'MOVIE' ? 'movie' : 'series',
    name: title,
    poster: media.coverImage.extraLarge || media.coverImage.large,
    background: media.bannerImage || media.coverImage.extraLarge,
    description: (media.description || '').replace(/<[^>]*>/g, '').slice(0, 500),
    releaseInfo: media.seasonYear ? `${media.seasonYear}` : media.startDate?.year ? `${media.startDate.year}` : '',
    imdbRating: media.averageScore ? (media.averageScore / 10).toFixed(1) : undefined,
    genres: media.genres || [],
    links: [
      { name: 'AniList', category: 'Links', url: media.siteUrl },
    ],
    runtime: media.duration ? `${media.duration} min` : undefined,
    logo: undefined,
    posterShape: 'poster',
  };
}

async function mapMediaList(mediaList) {
  // Resolve Kitsu IDs in parallel for all media with MAL IDs
  const kitsuIds = await Promise.all(
    mediaList.map(m => getKitsuIdFromMal(m.idMal))
  );
  return mediaList.map((m, i) => mapToStremioMeta(m, kitsuIds[i]));
}

const MEDIA_FRAGMENT = `
  id
  idMal
  title { romaji english native }
  coverImage { extraLarge large }
  bannerImage
  description
  seasonYear
  startDate { year month day }
  averageScore
  popularity
  genres
  format
  episodes
  duration
  status
  siteUrl
  nextAiringEpisode { airingAt episode }
`;

// 1. Currently Airing This Season
async function getAiringThisSeason(page = 1) {
  const query = `
    query ($season: MediaSeason, $year: Int, $page: Int) {
      Page(page: $page, perPage: 30) {
        media(season: $season, seasonYear: $year, type: ANIME, status: RELEASING, sort: POPULARITY_DESC) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await queryAniList(query, {
    season: getCurrentSeason(),
    year: new Date().getFullYear(),
    page,
  });
  return mapMediaList(data?.Page?.media || []);
}

// 2. Trending Right Now
async function getTrendingNow(page = 1) {
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 30) {
        media(type: ANIME, sort: TRENDING_DESC) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await queryAniList(query, { page });
  return mapMediaList(data?.Page?.media || []);
}

// 3. New Episodes This Week (airing shows sorted by next episode)
async function getNewEpisodesThisWeek(page = 1) {
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 30) {
        media(type: ANIME, status: RELEASING, sort: UPDATED_AT_DESC) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await queryAniList(query, { page });
  return mapMediaList(data?.Page?.media || []);
}

// 4. Upcoming Next Season
async function getUpcomingNextSeason(page = 1) {
  const query = `
    query ($season: MediaSeason, $year: Int, $page: Int) {
      Page(page: $page, perPage: 30) {
        media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await queryAniList(query, {
    season: getNextSeason(),
    year: getNextSeasonYear(),
    page,
  });
  return mapMediaList(data?.Page?.media || []);
}

// 5. Hidden Gems (high score, lower popularity)
async function getHiddenGems(page = 1) {
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 30) {
        media(type: ANIME, averageScore_greater: 75, popularity_lesser: 50000, sort: SCORE_DESC, status_in: [FINISHED, RELEASING]) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await queryAniList(query, { page });
  return mapMediaList(data?.Page?.media || []);
}

// 6. Top by Genre
async function getTopByGenre(genre, page = 1) {
  const query = `
    query ($genre: String, $page: Int) {
      Page(page: $page, perPage: 30) {
        media(type: ANIME, genre: $genre, sort: SCORE_DESC, status_in: [FINISHED, RELEASING]) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await queryAniList(query, { genre, page });
  return mapMediaList(data?.Page?.media || []);
}

// 7. All Time Popular (but actually good - score > 70)
async function getAllTimePopular(page = 1) {
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 30) {
        media(type: ANIME, sort: POPULARITY_DESC, averageScore_greater: 70) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await queryAniList(query, { page });
  return mapMediaList(data?.Page?.media || []);
}

// 8. Recently Completed (finished airing recently)
async function getRecentlyCompleted(page = 1) {
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 30) {
        media(type: ANIME, status: FINISHED, sort: END_DATE_DESC) {
          ${MEDIA_FRAGMENT}
        }
      }
    }
  `;
  const data = await queryAniList(query, { page });
  return mapMediaList(data?.Page?.media || []);
}

// Get single anime meta by AniList ID
async function getAnimeMeta(anilistId) {
  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        ${MEDIA_FRAGMENT}
        relations {
          edges {
            relationType
            node {
              id
              title { romaji english }
              coverImage { large }
              format
              type
            }
          }
        }
      }
    }
  `;
  const data = await queryAniList(query, { id: parseInt(anilistId) });
  if (!data?.Media) return null;
  const kitsuId = await getKitsuIdFromMal(data.Media.idMal);
  return mapToStremioMeta(data.Media, kitsuId);
}

module.exports = {
  getAiringThisSeason,
  getTrendingNow,
  getNewEpisodesThisWeek,
  getUpcomingNextSeason,
  getHiddenGems,
  getTopByGenre,
  getAllTimePopular,
  getRecentlyCompleted,
  getAnimeMeta,
  getCurrentSeason,
  getNextSeason,
};
