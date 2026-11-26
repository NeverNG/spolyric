// src/spotify/pkce.ts
// PKCE for a public client: a random verifier and the SHA-256 challenge Spotify's consent page is given.
import crypto from 'node:crypto';
export const base64Url = (buffer) => (buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
/** A verifier of 64 random bytes (86 characters) and the S256 challenge made from it. */
export function createPkcePair(randomBytes = crypto.randomBytes) {
    const verifier = base64Url(randomBytes(64));
    const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}
export const randomState = (randomBytes = crypto.randomBytes) => (base64Url(randomBytes(16)));
//# sourceMappingURL=pkce.js.map