/**
 * ELO rating calculation.
 * K-factor: 32, standard chess formula.
 * Guests are treated as ELO 1000.
 */

const K = 32;
const DEFAULT_GUEST_ELO = 1000;

/** Calculate expected score for player A against player B. */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export interface EloResult {
  newRatingA: number;
  newRatingB: number;
  deltaA: number;
  deltaB: number;
}

/**
 * Calculate new ELO ratings after a match.
 * @param ratingA - Player A's current ELO (or null for guest = 1000)
 * @param ratingB - Player B's current ELO (or null for guest = 1000)
 * @param aWon - Whether player A won
 */
export function calculateElo(
  ratingA: number | null,
  ratingB: number | null,
  aWon: boolean,
): EloResult {
  const ra = ratingA ?? DEFAULT_GUEST_ELO;
  const rb = ratingB ?? DEFAULT_GUEST_ELO;

  const ea = expectedScore(ra, rb);
  const eb = expectedScore(rb, ra);

  const sa = aWon ? 1 : 0;
  const sb = aWon ? 0 : 1;

  const deltaA = Math.round(K * (sa - ea));
  const deltaB = Math.round(K * (sb - eb));

  return {
    newRatingA: ra + deltaA,
    newRatingB: rb + deltaB,
    deltaA,
    deltaB,
  };
}
