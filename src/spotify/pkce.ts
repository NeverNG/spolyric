// src/spotify/pkce.ts
// PKCE for a public client: a random verifier and the SHA-256 challenge Spotify's consent page is given.

import crypto from 'node:crypto';

export type PkcePair = {
    verifier: string;
    challenge: string;
};

export const base64Url = (buffer: Buffer): string => (
    buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
);

/** A verifier of 64 random bytes (86 characters) and the S256 challenge made from it. */
export function createPkcePair(randomBytes: (size: number) => Buffer = crypto.randomBytes): PkcePair {
    const verifier = base64Url(randomBytes(64));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

export const randomState = (randomBytes: (size: number) => Buffer = crypto.randomBytes): string => (
    base64Url(randomBytes(16))
);
