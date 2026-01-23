/**
 * Utility functions for parsing JWT tokens
 * No external dependencies - uses only Node.js Buffer
 */

export interface JwtPayload {
    // Standard claims
    sub?: string;           // Subject
    iss?: string;           // Issuer
    aud?: string | string[];// Audience
    exp?: number;           // Expiration time
    iat?: number;           // Issued at

    // StreamNative-specific claims
    'https://streamnative.io/username'?: string;
    'https://streamnative.io/scope'?: string[];

    // Generic claims
    [key: string]: unknown;
}

export interface ExtractedTenantInfo {
    possibleTenants: string[];
    username?: string;
    organization?: string;
}

/**
 * Decode a JWT token payload (without verification)
 * @param token The JWT token string
 * @returns The decoded payload or undefined if decoding fails
 */
export function decodeJwtPayload(token: string): JwtPayload | undefined {
    try {
        // JWT format: header.payload.signature
        const parts = token.split('.');
        if (parts.length !== 3) {
            return undefined;
        }

        // Decode the payload (second part)
        // JWT uses base64url encoding, need to convert to standard base64
        const payload = parts[1];
        const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');

        // Add padding if needed
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);

        const decoded = Buffer.from(padded, 'base64').toString('utf-8');
        return JSON.parse(decoded) as JwtPayload;
    } catch {
        return undefined;
    }
}

/**
 * Extract potential tenant names from a JWT token
 * Useful when LIST_TENANTS fails due to permissions
 *
 * @param token The JWT token string
 * @returns Information about possible tenants extracted from the token
 */
export function extractTenantInfo(token: string): ExtractedTenantInfo {
    const result: ExtractedTenantInfo = {
        possibleTenants: []
    };

    const payload = decodeJwtPayload(token);
    if (!payload) {
        return result;
    }

    const tenantCandidates = new Set<string>();

    // 1. Check StreamNative username claim
    // Format: "gcd-engineer@o-xcutv.auth.streamnative.cloud"
    const snUsername = payload['https://streamnative.io/username'];
    if (snUsername && typeof snUsername === 'string') {
        result.username = snUsername;

        // Extract username part (before @) as potential tenant
        const atIndex = snUsername.indexOf('@');
        if (atIndex > 0) {
            const username = snUsername.substring(0, atIndex);
            tenantCandidates.add(username);

            // Extract organization ID from domain (e.g., o-xcutv from o-xcutv.auth.streamnative.cloud)
            const domain = snUsername.substring(atIndex + 1);
            const orgMatch = domain.match(/^(o-[a-z0-9]+)\./i);
            if (orgMatch) {
                result.organization = orgMatch[1];
                tenantCandidates.add(orgMatch[1]);
            }
        }
    }

    // 2. Check subject claim
    // Could be a client ID like "5SNZ10rr6qQbzgFLP7r8g6HAjtWJiin@clients"
    if (payload.sub && typeof payload.sub === 'string') {
        // If it looks like username@domain, extract the username part
        const atIndex = payload.sub.indexOf('@');
        if (atIndex > 0) {
            const subUsername = payload.sub.substring(0, atIndex);
            // Only add if it looks like a reasonable tenant name (not a random ID)
            if (subUsername.length < 30 && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(subUsername)) {
                tenantCandidates.add(subUsername);
            }
        }
    }

    // 3. Check audience claim for tenant/namespace patterns
    // Format: "urn:sn:pulsar:o-xcutv:flutter-gcd-instance-global-dev-1"
    const aud = Array.isArray(payload.aud) ? payload.aud : (payload.aud ? [payload.aud] : []);
    for (const audience of aud) {
        if (typeof audience === 'string') {
            // StreamNative audience format: urn:sn:pulsar:org-id:instance-name
            const snMatch = audience.match(/^urn:sn:pulsar:(o-[a-z0-9]+):/i);
            if (snMatch) {
                result.organization = result.organization || snMatch[1];
                tenantCandidates.add(snMatch[1]);
            }
        }
    }

    result.possibleTenants = Array.from(tenantCandidates);
    return result;
}

/**
 * Check if a JWT token is expired
 * @param token The JWT token string
 * @returns true if expired, false if valid, undefined if can't determine
 */
export function isTokenExpired(token: string): boolean | undefined {
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== 'number') {
        return undefined;
    }

    // exp is in seconds, Date.now() is in milliseconds
    return payload.exp * 1000 < Date.now();
}
