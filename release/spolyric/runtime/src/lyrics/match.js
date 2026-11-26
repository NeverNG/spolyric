// src/lyrics/match.ts
// The one rule for "is this catalogue hit the same song": exact title, matching artist, close duration.
// Folia's own lyric matcher is not available outside its renderer, so the sources it searches are asked
// here with this rule instead.
import { toSimplified } from './zh.js';
export const normalizeForMatch = (value) => toSimplified(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\bfeat\.?.*$/i, '')
    .replace(/[\s\-_/\\'".,!?:;·・&+]/g, '');
/** 0 when this is not the same song, larger when it is. */
export function scoreCandidate(candidate, track) {
    const wantTitle = normalizeForMatch(track.title);
    const gotTitle = normalizeForMatch(candidate.title);
    const titleScore = gotTitle === wantTitle ? 4 : gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle) ? 2 : 0;
    const artists = track.artists.map(normalizeForMatch).filter(Boolean);
    const gotArtist = normalizeForMatch(candidate.artist);
    const artistScore = artists.some(artist => artist === gotArtist || gotArtist.includes(artist) || artist.includes(gotArtist)) ? 2 : 0;
    const diff = Math.abs(candidate.durationMs - track.durationMs);
    const durationScore = track.durationMs <= 0 ? 0 : diff <= 3000 ? 2 : diff <= 8000 ? 1 : 0;
    // Catalogues often romanise artists ("JJ Lin" for 林俊傑); an exact title and an exact duration are
    // strong enough on their own, but a title match with neither the artist nor the duration is not.
    const matchedTitleAndDuration = titleScore === 4 && durationScore === 2;
    if (artists.length > 0 && artistScore === 0 && !matchedTitleAndDuration)
        return 0;
    return titleScore + artistScore + durationScore;
}
/** The best candidate at or above the confidence floor, or null. */
export function pickBest(candidates, track, toCandidate) {
    let best = null;
    for (const item of candidates) {
        const score = scoreCandidate(toCandidate(item), track);
        if (!best || score > best.score)
            best = { item, score };
    }
    return best && best.score >= 4 ? best.item : null;
}
//# sourceMappingURL=match.js.map