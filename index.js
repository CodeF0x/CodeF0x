const fetch = require("node-fetch");
const fs = require("fs");

const {
  SPOTIFY_CLIENT_SECRET: spotifyClientSecret,
  SPOTIFY_CLIENT_ID: spotifyClientId,
  SPOTIFY_CODE: spotifyCode,
} = process.env;

const API_BASE = "https://api.spotify.com/v1";
const AUTH_CACHE_FILE = "spotify-auth.json";
let token;

async function main() {
  token = await getSpotifyToken();
  const spotifyData = await getSpotifyData();
  await updateGist(spotifyData);
}

/**
 * Updates cached spotify authentication tokens when necessary (1 hr expiriy)
 */
async function getSpotifyToken() {
  // default env vars go in here (temp cache)
  let cache = {};
  let formData = {
    grant_type: "authorization_code",
    code: spotifyCode,
    redirect_uri: "http://localhost/",
  };

  // try to read cache from disk if already exists
  try {
    const jsonStr = fs.readFileSync(AUTH_CACHE_FILE);
    const c = JSON.parse(jsonStr);
    Object.keys(c).forEach((key) => {
      cache[key] = c[key];
    });
  } catch (error) {
    console.log(error);
  }

  if (cache.spotifyRefreshToken) {
    formData = {
      grant_type: "refresh_token",
      refresh_token: cache.spotifyRefreshToken,
    };
  }

  // get new tokens
  const data = await fetch("https://accounts.spotify.com/api/token", {
    method: "post",
    body: encodeFormData(formData),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        new Buffer.from(spotifyClientId + ":" + spotifyClientSecret).toString(
          "base64"
        ),
    },
  })
    .then((data) => data.json())
    .catch((error) => console.debug(error));
  cache.spotifyAccessToken = data.access_token;
  if (data.refresh_token) {
    cache.spotifyRefreshToken = data.refresh_token;
  }

  // save to disk
  fs.writeFileSync(AUTH_CACHE_FILE, JSON.stringify(cache));

  return cache.spotifyAccessToken;
}

const encodeFormData = (data) => {
  return Object.keys(data)
    .map((key) => encodeURIComponent(key) + "=" + encodeURIComponent(data[key]))
    .join("&");
};

/**
 * Fetches your data from the spotify API
 */
async function getSpotifyData() {
  let genres;

  // recently most listend song
  let data = await fetch(
    `${API_BASE}/me/top/tracks?time_range=short_term&limit=1`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  )
    .then((data) => data.json())
    .catch((error) => console.error(error));

  const recentSongData = {
    artistName: data.items[0].album.artists[0].name,
    artistLink: data.items[0].album.artists[0].external_urls.spotify,
    songName: data.items[0].name,
    songLink: data.items[0].external_urls.spotify,
  };

  // most listened genre long term
  data = await fetch(
    `${API_BASE}/me/top/tracks/?time_range=long_term&limit=50`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  )
    .then((data) => data.json())
    .catch((error) => console.error(error));

  genres = await collectGenres(data);

  const mostListenedGenre = {
    genreName: mode(genres).pop(),
  };

  // most listened genre short term
  data = await fetch(`${API_BASE}/me/player/recently-played?limit=50`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
    .then((data) => data.json())
    .catch((error) => console.error(error));

  genres = await collectGenres(data);

  const shortTermGenre = {
    genreName: mode(genres).pop(),
  };

  return {
    recentSongData,
    mostListenedGenre,
    shortTermGenre,
  };
}

async function updateGist(data) {
  const content = `
  Currently, I can't get enough of the song <a href="${
    data.recentSongData.songLink
  }">${data.recentSongData.songName}</a> by <a href="${
    data.recentSongData.artistLink
  }">${
    data.recentSongData.artistName
  }</a> on <a href="https://open.spotify.com/user/9qz2xtkur2fengfsdcq8dd907?si=kq2SVrUkSNe0z1NJjpt7kg">Spotify</a>.

  My most listened genre is <a href="https://duckduckgo.com/?q=${
    data.mostListenedGenre.genreName + " music"
  }">${data.mostListenedGenre.genreName}</a>.
  Still, I've been listening to a lot of <a href="https://duckduckgo.com/?q=${
    data.shortTermGenre.genreName + " music"
  }">${data.shortTermGenre.genreName}</a> lately.

  This file is generated automatically. Read more <a href="https://github.com/CodeF0x/CodeF0x/blob/master/IMPORTANT.md">here</a>.
  <br>
  <sub>Last modified at ${new Date()
    .toISOString()
    .replace(/T/, " ")
    .replace(/\..+/, "")}.</sub>
  `;

  fs.writeFileSync("readme.md", content);
}

/**
 * @param {Array<String>} arr
 * Returns unique array of most listened genres.
 * Sorted in ascending order.
 */
function mode(arr) {
  return arr
    .sort(
      (a, b) =>
        arr.filter((v) => v === a).length - arr.filter((v) => v === b).length
    )
    .filter((elem, i, self) => self.indexOf(elem) === i);
}

/**
 * Put all genres of each artist in an array
 * @param {JSON} data
 */
async function collectGenres(data) {
  let genres = [];
  for (const item of data.items) {
    /**
     * "data" is different for each call, because the api returns slightly different results.
     * check is needed because the nesting to get the id is a little different.
     */
    const id =
      item.album === undefined
        ? item.track.album.artists[0].id
        : item.album.artists[0].id;
    const artistGenres = await getGenresFromArtist(id);
    genres = [...genres, ...artistGenres];
  }
  return genres;
}

/**
 * Gets all genres from an artist by their artist id.
 * @param {String} id
 */
async function getGenresFromArtist(id) {
  const data = await fetch(`${API_BASE}/artists/${id}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
    .then((data) => data.json())
    .catch((error) => console.error(error));

  if (!data.genres) {
    return [];
  }
  return data.genres;
}

(async () => {
  await main();
})();
