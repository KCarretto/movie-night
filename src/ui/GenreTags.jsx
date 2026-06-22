import { genreTags } from '../lib/format.js';

export default function GenreTags({ movie }) {
  const tags = genreTags(movie);
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((g) => <span key={g} className="genre-tag">{g}</span>)}
    </div>
  );
}
