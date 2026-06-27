import fs from 'fs';
let code = fs.readFileSync('src/lib/recengine.js', 'utf8');

code = code.replace(
  /export function getRecommendations\(options = \{\}\) \{[\s\S]*?return recCache;\n\}/,
  `export function getRecommendations(options = {}) {
  const forceRefresh = !!options.forceRefresh;
  const sig = recSignature();
  if (forceRefresh || !recCache.list || recCache.list.length === 0) {
    const profile = buildTasteProfile();
    const pc = ensurePrecompute(sig, profile, forceRefresh);
    const list = pc.batches.length ? pc.batches.shift() : nextRecBatch(pc.ranked, profile);
    recCache = {
      sig,
      list,
      personalised: list.length > 0 && list[0].personalised,
      totalAvailable: pc.ranked.length,
    };
    schedulePrecompute();
  } else if (recCache.sig !== sig) {
    recRankingStale = true;
    recCache = { ...recCache, sig };
    schedulePrecompute();
  }
  return recCache;
}`
);

code = code.replace(
  /export function appendRecommendations\(\) \{[\s\S]*?const profile = buildTasteProfile\(\);/,
  `export function appendRecommendations() {
  const sig = recSignature();
  if (!Array.isArray(recCache.list) || recCache.list.length === 0) {
    return getRecommendations({ forceRefresh: true });
  }
  const profile = buildTasteProfile();`
);

fs.writeFileSync('src/lib/recengine.js', code);
console.log('Patched recengine.js');
