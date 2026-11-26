// src/audio.mjs
// Turns Folia's analyser into the few numbers the stage wants: a smoothed
// energy, the three bands and a beat flag from low-frequency spectral flux.
// The code is deliberately small and dependency-free; it has to run every frame.

import { clamp } from './util.mjs';

/**
 * A deterministic fake analyser for the browser preview. Beats land on a
 * 0.52 s grid so the stage can be inspected without Folia.
 */
export const createFakeAudio = () => {
    const bands = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 };
    let lastBeat = -1;
    return {
        getPower: () => 0,
        getBands: () => bands,
        getSpectrum: () => null,
        tick(time) {
            const pulse = Math.exp(-((time % 0.52) / 0.10)) * 0.55;
            const swell = 0.35 + 0.20 * Math.sin(time * 0.37);
            bands.bass = clamp(swell * 0.8 + pulse, 0, 1);
            bands.lowMid = clamp(swell * 0.65 + pulse * 0.5, 0, 1);
            bands.mid = clamp(0.35 + 0.18 * Math.sin(time * 0.9), 0, 1);
            bands.vocal = clamp(0.40 + 0.25 * Math.sin(time * 1.3 + 0.7), 0, 1);
            bands.treble = clamp(0.20 + 0.18 * Math.sin(time * 2.1 + 1.9), 0, 1);
            const beat = lastBeat < 0 ? false : Math.floor(time / 0.52) !== Math.floor(lastBeat / 0.52);
            lastBeat = time;
            return { beat, power: bands.bass };
        },
    };
};

/**
 * @param {object|null} audio - a FoliumAudio (`getPower`, `getBands`, `getSpectrum`)
 * @param {{ enabled?: boolean }} options
 */
export const createAudioReactor = ({ audio = null, enabled = true }) => {
    let active = Boolean(enabled);
    let peak = 0.2;
    let envelope = 0;
    let mean = 0;
    let variance = 0;
    let previousLow = 0;
    let previousBins = null;
    let lastBeat = -Infinity;
    let beat = false;
    let melodyBins = null;
    let melodyMean = 0;
    let melodyVariance = 0;
    let lastOnset = -Infinity;
    let onset = false;

    const reset = () => {
        envelope = 0;
        previousLow = 0;
        previousBins = null;
        mean = 0;
        variance = 0;
        lastBeat = -Infinity;
        beat = false;
        melodyBins = null;
        melodyMean = 0;
        melodyVariance = 0;
        lastOnset = -Infinity;
        onset = false;
    };

    return {
        reset,
        setEnabled(value) {
            active = Boolean(value);
            if (!active) reset();
        },
        update(dt, time) {
            if (!active || !audio) {
                beat = false;
                onset = false;
                const idle = 0.16 + Math.sin(time * 0.55) * 0.02;
                return { energy: idle, bass: idle * 0.6, mid: idle * 0.5, treble: idle * 0.4, beat: false, beatStrength: 0 };
            }
            const power = clamp(Number(audio.getPower()) || 0, 0, 1);
            const bands = audio.getBands() ?? { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 };
            const bass = clamp(Number(bands.bass) || 0, 0, 1);
            const lowMid = clamp(Number(bands.lowMid) || 0, 0, 1);
            const mid = clamp(Number(bands.mid) || 0, 0, 1);
            const treble = clamp(Number(bands.treble) || 0, 0, 1);
            const raw = 0.55 * power + 0.45 * bass;

            peak = Math.max(raw, peak * Math.exp(-dt / 8), 0.08);
            const target = clamp(raw / peak, 0, 1);
            const rate = target > envelope ? 1 - Math.exp(-dt / 0.045) : 1 - Math.exp(-dt / 0.38);
            envelope += (target - envelope) * rate;

            // Low-band spectral flux: a rise is a beat, judged against its own
            // recent mean and deviation. Without a spectrum we fall back to the
            // bass band's own rise.
            let flux = 0;
            const spectrum = audio.getSpectrum?.() ?? null;
            if (spectrum && spectrum.length > 14) {
                if (!previousBins) previousBins = new Float32Array(12);
                for (let index = 0; index < 12; index += 1) {
                    const value = spectrum[index + 1] / 255;
                    flux += Math.max(0, value - previousBins[index]);
                    previousBins[index] = value;
                }
                flux /= 12;
            } else {
                flux = Math.max(0, bass - previousLow);
                previousLow = bass;
            }

            const alpha = 1 - Math.exp(-dt / 1.2);
            const deviation = Math.sqrt(Math.max(variance, 0));
            const threshold = Math.max(0.012, mean + deviation * 1.8);
            const sinceLast = time - lastBeat;
            beat = flux > threshold && sinceLast >= 0.26;
            if (!beat && sinceLast > 2.4 && envelope > 0.12) beat = true;
            if (beat) lastBeat = time;
            mean += alpha * (flux - mean);
            variance += alpha * ((flux - mean) ** 2 - variance);

            // Melody onsets: spectral flux across the mid/high bins, which follows
            // the tune and the plucked keys rather than the kick.
            let melodyFlux = 0;
            if (spectrum && spectrum.length > 70) {
                if (!melodyBins) melodyBins = new Float32Array(58);
                for (let index = 0; index < 58; index += 1) {
                    const value = spectrum[index + 10] / 255;
                    melodyFlux += Math.max(0, value - melodyBins[index]);
                    melodyBins[index] = value;
                }
                melodyFlux /= 58;
            } else {
                melodyFlux = Math.max(0, (mid + treble) * 0.5 - (melodyMean || 0));
            }
            const melodyAlpha = 1 - Math.exp(-dt / 0.9);
            const melodyDeviation = Math.sqrt(Math.max(melodyVariance, 0));
            const melodyThreshold = Math.max(0.006, melodyMean + melodyDeviation * 1.55);
            onset = melodyFlux > melodyThreshold && time - lastOnset >= 0.17 && envelope > 0.10;
            if (onset) lastOnset = time;
            melodyMean += melodyAlpha * (melodyFlux - melodyMean);
            melodyVariance += melodyAlpha * ((melodyFlux - melodyMean) ** 2 - melodyVariance);

            return { energy: envelope, bass, mid, treble, beat, beatStrength: clamp(flux * 18, 0, 1), onset, onsetStrength: clamp(melodyFlux * 22, 0, 1) };
        },
    };
};
