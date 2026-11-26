// src/chart.mjs
// Turns the lyric lines into a vertical note chart: one note per non-space
// character, a side of the rail (left / right) and a distance along the track.
// Gaps longer than REST_SEC are rests: no key, only the slide rail.

const REST_SEC = 0.85;
const MIN_GAP_SEC = 0.09;

const timingsOf = (line) => {
    const chars = Array.from(String(line.fullText ?? ''));
    const words = Array.isArray(line.words) && line.words.length > 0 ? line.words : null;
    const lineStart = Math.max(0, Number(line.startTime) || 0);
    const lineEnd = Math.max(lineStart + 0.4, Number(line.endTime) || lineStart + 3);
    const timings = new Array(chars.length);

    if (words) {
        let cursor = 0;
        for (const word of words) {
            const text = Array.from(String(word.text ?? ''));
            if (text.length === 0) continue;
            let startAt = cursor;
            if (chars.slice(cursor, cursor + text.length).join('') !== text.join('')) {
                startAt = chars.indexOf(text[0], cursor);
                if (startAt < 0) continue;
            }
            const start = Number.isFinite(word.startTime) ? Number(word.startTime) : lineStart;
            const end = Math.max(start + 0.02, Number.isFinite(word.endTime) ? Number(word.endTime) : start + 0.2);
            const per = (end - start) / text.length;
            for (let index = 0; index < text.length && startAt + index < chars.length; index += 1) {
                timings[startAt + index] = { start: start + per * index, end: start + per * (index + 1) };
            }
            cursor = startAt + text.length;
        }
    }

    const per = Math.max(0.03, (lineEnd - lineStart) / Math.max(1, chars.length));
    for (let index = 0; index < chars.length; index += 1) {
        if (!timings[index]) timings[index] = { start: lineStart + per * index, end: lineStart + per * (index + 1) };
    }
    return { chars, timings };
};

/**
 * @param {readonly object[]} lines
 * @param {{ speed?: number }} options  world units per second along the rail
 */
export const buildChart = (lines, { speed = 1.45 } = {}) => {
    const raw = [];
    (lines ?? []).forEach((line, lineIndex) => {
        const { chars, timings } = timingsOf(line);
        chars.forEach((char, index) => {
            if (!char.trim()) return;
            const timing = timings[index];
            raw.push({
                char,
                time: timing.start,
                endTime: timing.end,
                lineIndex,
                chorus: Boolean(line.isChorus),
                side: -1,
                y: 0,
                index: raw.length,
            });
        });
    });

    raw.sort((a, b) => a.time - b.time);
    const notes = [];
    for (const note of raw) {
        if (notes.length === 0 || note.time - notes[notes.length - 1].time >= MIN_GAP_SEC) {
            notes.push(note);
        }
    }

    notes.forEach((note, index) => {
        note.index = index;
        const previous = notes[index - 1];
        if (!previous) {
            note.side = -1;
        } else if (note.time - previous.time > 0.14) {
            note.side = -previous.side;
        } else {
            note.side = previous.side;
        }
    });

    const startTime = notes[0]?.time ?? 0;
    notes.forEach((note) => {
        note.y = (note.time - startTime) * speed;
    });

    const rests = [];
    for (let index = 1; index < notes.length; index += 1) {
        const gap = notes[index].time - notes[index - 1].time;
        if (gap > REST_SEC) {
            rests.push({
                start: notes[index - 1].time,
                end: notes[index].time,
                y0: notes[index - 1].y,
                y1: notes[index].y,
            });
        }
    }

    return {
        notes,
        rests,
        speed,
        startTime,
        endTime: notes.length > 0 ? notes[notes.length - 1].time : startTime,
    };
};
