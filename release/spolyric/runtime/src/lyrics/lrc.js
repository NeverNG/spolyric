// src/lyrics/lrc.ts
// The one normalizer for lyric text that arrives from outside.
/**
 * Keeps only lines that carry a timestamp and some words, so plain text and empty timed lines are
 * dropped. At least two timed lines are needed: a single one is not a lyric.
 */
export function normalizeLrc(text) {
    if (typeof text !== 'string')
        return null;
    const timedWithWords = /^(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+\s*\S/;
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
        .map(line => line.trim())
        .filter(line => timedWithWords.test(line));
    if (lines.length < 2)
        return null;
    return lines.join('\n');
}
//# sourceMappingURL=lrc.js.map