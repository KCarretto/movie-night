// ------------------------- Formatting helpers --------------------------
// Pure, framework-agnostic helpers that turn catalogue entries / numbers into
// the small pieces of data the React presentation components render. The
// original app emitted HTML strings here; in React we return plain data and let
// composable components draw it.

export const normTitle = (s) => String(s || '').trim().toLowerCase();

// Looser key for catalogue matching: case-insensitive, ignores spaces and
// punctuation so "Spider-Man" and "spider man" resolve to the same entry.
export const dbKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// True once a vector (Array or typed Float32Array) of usable length is present.
export const isVector = (v) =>
  (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length > 0;

// Map a primary-language ISO 639-1 code to a representative country flag and
// a human-readable name. Used to badge non-English films in the rankings.
export const LANGUAGE_INFO = {
  en: { name: 'English', flag: '🇬🇧' },
  fr: { name: 'French', flag: '🇫🇷' },
  es: { name: 'Spanish', flag: '🇪🇸' },
  de: { name: 'German', flag: '🇩🇪' },
  it: { name: 'Italian', flag: '🇮🇹' },
  pt: { name: 'Portuguese', flag: '🇵🇹' },
  ru: { name: 'Russian', flag: '🇷🇺' },
  ja: { name: 'Japanese', flag: '🇯🇵' },
  ko: { name: 'Korean', flag: '🇰🇷' },
  zh: { name: 'Chinese', flag: '🇨🇳' },
  cn: { name: 'Chinese', flag: '🇨🇳' },
  hi: { name: 'Hindi', flag: '🇮🇳' },
  ta: { name: 'Tamil', flag: '🇮🇳' },
  te: { name: 'Telugu', flag: '🇮🇳' },
  ml: { name: 'Malayalam', flag: '🇮🇳' },
  bn: { name: 'Bengali', flag: '🇧🇩' },
  pa: { name: 'Punjabi', flag: '🇮🇳' },
  ar: { name: 'Arabic', flag: '🇸🇦' },
  tr: { name: 'Turkish', flag: '🇹🇷' },
  fa: { name: 'Persian', flag: '🇮🇷' },
  th: { name: 'Thai', flag: '🇹🇭' },
  vi: { name: 'Vietnamese', flag: '🇻🇳' },
  id: { name: 'Indonesian', flag: '🇮🇩' },
  nl: { name: 'Dutch', flag: '🇳🇱' },
  sv: { name: 'Swedish', flag: '🇸🇪' },
  no: { name: 'Norwegian', flag: '🇳🇴' },
  da: { name: 'Danish', flag: '🇩🇰' },
  fi: { name: 'Finnish', flag: '🇫🇮' },
  pl: { name: 'Polish', flag: '🇵🇱' },
  cs: { name: 'Czech', flag: '🇨🇿' },
  el: { name: 'Greek', flag: '🇬🇷' },
  he: { name: 'Hebrew', flag: '🇮🇱' },
  hu: { name: 'Hungarian', flag: '🇭🇺' },
  ro: { name: 'Romanian', flag: '🇷🇴' },
  uk: { name: 'Ukrainian', flag: '🇺🇦' },
  is: { name: 'Icelandic', flag: '🇮🇸' },
  ms: { name: 'Malay', flag: '🇲🇾' },
  tl: { name: 'Filipino', flag: '🇵🇭' },
};

// Resolve the flag + name badge for a non-English film, or null for English /
// unrecorded languages so callers can drop the badge unconditionally.
export function languageBadge(m) {
  const code = String((m && m.language) || '').toLowerCase();
  if (!code || code === 'en') return null;
  const info = LANGUAGE_INFO[code];
  return {
    name: info ? info.name : code.toUpperCase(),
    flag: info ? info.flag : '🌐',
  };
}

// Up to three genre chip labels for a catalogue entry.
export function genreTags(m) {
  const genres = (m && m.genres && m.genres.length)
    ? m.genres
    : (m && m.primaryGenre ? [m.primaryGenre] : []);
  return genres.slice(0, 3);
}

export const movieGenres = (m) =>
  (m && m.genres && m.genres.length ? m.genres : (m && m.primaryGenre ? [m.primaryGenre] : []));

// Critic rating chips ({ kind, value }) for whichever ratings exist.
export function ratingBits(m) {
  const r = (m && m.ratings) || {};
  const bits = [];
  if (r.imdb != null) bits.push({ kind: 'imdb', value: r.imdb });
  if (r.rottenTomatoes != null) bits.push({ kind: 'rt', value: r.rottenTomatoes });
  if (r.letterboxd != null) bits.push({ kind: 'tmdb', value: r.letterboxd });
  return bits;
}

// Five-element array of 'full' | 'half' | 'empty' for a 0..5 star rating, with
// the same rounding the original starString() used.
export function starParts(n) {
  const rating = Math.max(0, Math.min(5, Number(n) || 0));
  const full = Math.floor(rating);
  const frac = rating - full;
  const hasHalf = frac >= 0.25 && frac < 0.75;
  const fullCount = full + (frac >= 0.75 ? 1 : 0);
  const out = [];
  for (let i = 1; i <= 5; i++) {
    if (i <= fullCount) out.push('full');
    else if (hasHalf && i === full + 1) out.push('half');
    else out.push('empty');
  }
  return out;
}
