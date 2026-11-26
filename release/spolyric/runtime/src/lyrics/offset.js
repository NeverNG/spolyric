// src/lyrics/offset.ts
// A global nudge for lyrics whose timestamps sit a little before or after the audio. LRC times are
// `[mm:ss.cc]`; shifting keeps the same shape and never goes below zero.
const TIME_TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const shifted = (minutes, seconds, fraction, offsetMs) => {
    const fracMs = fraction === undefined
        ? 0
        : fraction.length === 1
            ? Number(fraction) * 100
            : fraction.length === 2
                ? Number(fraction) * 10
                : Number(fraction);
    const total = Math.max(0, Number(minutes) * 60_000 + Number(seconds) * 1000 + fracMs + offsetMs);
    const centis = Math.round(total / 10);
    const mm = Math.floor(centis / 6000);
    const ss = Math.floor((centis % 6000) / 100);
    const cc = centis % 100;
    return `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cc).padStart(2, '0')}]`;
};
/** Shifts every timestamp by `offsetMs` (positive = later); returns the input unchanged for 0. */
export function shiftLrc(lrc, offsetMs) {
    if (!offsetMs)
        return lrc;
    return lrc.replace(TIME_TAG, (_match, minutes, seconds, fraction) => (shifted(minutes, seconds, fraction, offsetMs)));
}
//# sourceMappingURL=offset.js.map