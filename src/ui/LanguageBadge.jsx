import { languageBadge } from '../lib/format.js';

export default function LanguageBadge({ movie }) {
  const badge = languageBadge(movie);
  if (!badge) return null;
  return (
    <span className="lang-badge" title={badge.name}>
      <span aria-hidden="true">{badge.flag}</span>
      <span>{badge.name}</span>
    </span>
  );
}
