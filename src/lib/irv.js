// ======================================================================
//  RANKED-CHOICE (INSTANT-RUNOFF) ALGORITHM
// ======================================================================
// Pure ranked-choice tabulation. Ported verbatim from the original app.
/**
 * @param {Object} votes  peerId -> [movieId ranked best→worst]
 * @param {Array}  movies [{ id, title }]
 * @returns {{ winnerId, winnerTitle, rounds: [...], totalBallots }}
 */
export function instantRunoff(votes, movies) {
  const titleOf = (id) => (movies.find((m) => m.id === id) || {}).title || '—';
  // Keep voter ids alongside each ballot so we can show who backs each choice.
  const ballots = Object.entries(votes)
    .filter(([, b]) => Array.isArray(b) && b.length)
    .map(([voterId, ranking]) => ({ voterId, ranking }));
  const totalBallots = ballots.length;

  let remaining = new Set(movies.map((m) => m.id));
  const rounds = [];
  let winnerId = null;

  if (totalBallots === 0) {
    return { winnerId: null, winnerTitle: null, rounds: [], totalBallots: 0 };
  }

  // Pre-calculate static tie-breaker metrics by iterating the ballots once:
  //  - firstRoundTally: genuine 1st-place votes each movie received, used as
  //    the first tie-breaker so ties are settled by first-round support.
  //  - weightedScore: a Borda-style score awarding points by ballot position
  //    (reverse index), used as the second tie-breaker.
  const firstRoundTally = {};
  const weightedScore = {};
  movies.forEach((m) => { firstRoundTally[m.id] = 0; weightedScore[m.id] = 0; });
  ballots.forEach((b) => {
    const first = b.ranking[0];
    if (first !== undefined && firstRoundTally[first] !== undefined) {
      firstRoundTally[first]++;
    }
    b.ranking.forEach((id, index) => {
      if (weightedScore[id] !== undefined) {
        weightedScore[id] += b.ranking.length - index;
      }
    });
  });

  // Safety bound: at most one elimination per candidate.
  for (let guard = 0; guard < movies.length + 1 && remaining.size > 0; guard++) {
    // Tally each ballot's top choice that is still in the running, and record
    // which voters are currently backing each candidate (the redistribution).
    const tally = {};
    const backers = {};
    remaining.forEach((id) => { tally[id] = 0; backers[id] = []; });
    let counted = 0;
    let exhausted = 0;
    ballots.forEach((b) => {
      const pick = b.ranking.find((id) => remaining.has(id));
      if (pick !== undefined) { tally[pick]++; backers[pick].push(b.voterId); counted++; }
      else exhausted++;
    });

    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const majority = counted / 2;
    const needToWin = Math.floor(counted / 2) + 1;

    const roundInfo = {
      tally: entries.map(([id, n]) => ({ id, title: titleOf(id), votes: n, backers: backers[id].slice() })),
      counted,
      exhausted,
      needToWin,
      eliminated: null,
      eliminationReason: null,
      winner: null,
      winReason: null,
    };

    // Win condition: strictly more than 50% of counted ballots.
    const [topId, topVotes] = entries[0] || [null, 0];
    if (topId && (topVotes > majority || remaining.size === 1)) {
      winnerId = topId;
      roundInfo.winner = { id: topId, title: titleOf(topId), votes: topVotes };
      roundInfo.winReason = remaining.size === 1
        ? 'Last choice standing — wins by default.'
        : `Has ${topVotes} of ${counted} active ballot${counted === 1 ? '' : 's'} — a majority (needed ${needToWin}).`;
      rounds.push(roundInfo);
      break;
    }

    // Otherwise eliminate exactly one candidate: the lowest scorer. If several
    // candidates tie for last, apply a multi-tiered tie-breaker (falling back
    // to a coin flip) and remove only the single worst performer so the next
    // round can redistribute that candidate's ballots correctly.
    const lowest = entries[entries.length - 1][1];
    let losers = entries.filter(([, n]) => n === lowest).map(([id]) => id);
    const tiedForLast = losers.length;   // how many shared the lowest tally
    let tieBreak = null;                  // which tie-breaker settled the tie
    if (losers.length > 1) {
      // Tiebreaker 1 (Look-Back): keep only candidates with the lowest
      // genuine first-preference tally.
      const minTally = Math.min(...losers.map((id) => firstRoundTally[id]));
      const filtered = losers.filter((id) => firstRoundTally[id] === minTally);
      if (filtered.length < losers.length) {
        tieBreak = `Tie-breaker 1 (fewest genuine 1st-choice votes, ${minTally}) decided it.`;
      }
      losers = filtered;
    }
    if (losers.length > 1) {
      // Tiebreaker 2 (Weighted Score): keep only candidates with the lowest
      // Borda-style weighted score.
      const minScore = Math.min(...losers.map((id) => weightedScore[id]));
      const filtered = losers.filter((id) => weightedScore[id] === minScore);
      if (filtered.length < losers.length) {
        tieBreak = `Tie-breaker 2 (lowest overall ranking score, ${minScore}) decided it.`;
      }
      losers = filtered;
    }
    if (losers.length > 1) {
      // Tiebreaker 3 (Coin Flip): break any remaining perfect tie randomly.
      losers.sort(() => Math.random() - 0.5);
      tieBreak = 'Tie-breaker 3 (coin flip) decided the remaining exact tie.';
    }
    // Enforce single elimination: only the single worst-performing candidate.
    losers = [losers[0]];
    losers.forEach((id) => remaining.delete(id));
    roundInfo.eliminated = losers.map((id) => ({ id, title: titleOf(id) }));
    roundInfo.tieBreak = tieBreak;   // null when there was no tie to break
    const loserTitles = losers.map((id) => titleOf(id)).join(', ');
    roundInfo.eliminationReason =
      `No choice reached a majority (${needToWin} of ${counted} needed). ` +
      `Eliminated ${loserTitles} with the fewest votes (${lowest}); ` +
      `those ballots now transfer to their next still-standing pick.` +
      (tiedForLast > 1
        ? ` ${tiedForLast} choices were tied on ${lowest} vote${lowest === 1 ? '' : 's'} for last — ${tieBreak}`
        : '');
    rounds.push(roundInfo);
  }

  return {
    winnerId,
    winnerTitle: winnerId ? titleOf(winnerId) : null,
    rounds,
    totalBallots,
  };
}
