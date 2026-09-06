// companyLogos.ts
//
// Where a client's logo comes from, and how a new one gets there.
//
// HISTORY. `clients.logo_path` holds a repo-relative path — "../CompanyLogo/
// LogoOnly/Genesis.png" — into `public/logo`. Two consequences followed: a new
// client could not be onboarded without a deploy, and the full lockup could only
// be GUESSED at, by rewriting "/LogoOnly/" to "/FullLogo/" and letting the
// <img>'s onError catch the clients who have no full variant.
//
// NOW. `clients.logo_full_path` and `clients.logo_mark_path` hold object paths
// in the public 'CompanyLogo' Supabase bucket, uploaded from the site details
// editor. Each variant is stored explicitly, so nothing has to be guessed.
//
// The legacy path stays as the fallback, and every existing client keeps
// rendering exactly as before until someone uploads a replacement. That is the
// whole migration strategy: no backfill of images, no broken mastheads.
//
// URL building is deliberately SYNCHRONOUS and free of the Supabase client.
// Report headers render inline, and a bucket that is public has a URL that is a
// pure function of its path — reaching for `storage.getPublicUrl` would make
// every masthead an async render for no extra information.

import type { SupabaseClient } from '@supabase/supabase-js';

export const LOGO_BUCKET = 'CompanyLogo';

/** Which lockup is wanted. */
export type LogoVariant = 'full' | 'mark';

export interface ClientLogoSource {
    id?: number | string | null;
    /** Legacy repo-relative path into public/logo. */
    logo_path?: string | null;
    /** Object path in the CompanyLogo bucket — the full lockup. */
    logo_full_path?: string | null;
    /** Object path in the CompanyLogo bucket — the compact mark. */
    logo_mark_path?: string | null;
}

const text = (value: unknown): string => String(value ?? '').trim();

/** Already a URL or an absolute site path — leave it alone. */
const isResolved = (value: string): boolean =>
    /^(https?:|data:|blob:|\/)/i.test(value);

// ---------------------------------------------------------------------------
// Storage URLs
// ---------------------------------------------------------------------------

/**
 * The project's storage origin.
 *
 * Read at call time rather than module scope so a test can set the variable and
 * so a build that inlines it late still sees a value.
 */
const storageBase = (): string =>
    text(process.env.NEXT_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');

/**
 * The public URL of an object in the logo bucket.
 *
 * Returns '' rather than a half-formed URL when the environment has no Supabase
 * URL, so callers fall through to their legacy path instead of rendering a
 * broken image against a relative "/storage/v1/…".
 */
export const publicLogoUrl = (objectPath: string | null | undefined): string => {
    const path = text(objectPath);
    if (!path) return '';
    if (isResolved(path)) return path; // a full URL was stored; honour it

    const base = storageBase();
    if (!base) return '';

    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${base}/storage/v1/object/public/${LOGO_BUCKET}/${encoded}`;
};

// ---------------------------------------------------------------------------
// Legacy public/logo paths
// ---------------------------------------------------------------------------

/**
 * "../CompanyLogo/LogoOnly/Genesis.png" -> "/logo/CompanyLogo/LogoOnly/Genesis.png".
 *
 * The same rewrite the report modal and the post-blast report each grew their
 * own copy of. Both now call this one.
 */
export const normalizeLegacyLogoPath = (value: string | null | undefined): string => {
    const path = text(value);
    if (!path) return '';
    if (isResolved(path)) return path;
    return path.replace(/^\.\./, '/logo');
};

/**
 * The full-lockup GUESS for a legacy path.
 *
 * public/logo/CompanyLogo/FullLogo is a subset of LogoOnly, so this is only ever
 * a candidate: the caller still needs the <img> onError fallback it has always
 * had. Clients with an uploaded `logo_full_path` never reach this.
 */
export const legacyFullLogoPath = (value: string | null | undefined): string => {
    const path = normalizeLegacyLogoPath(value);
    return path ? path.replace('/LogoOnly/', '/FullLogo/') : '';
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedLogos {
    /** Compact mark — dashboard header, tight spaces. '' when the client has none. */
    mark: string;
    /** Full lockup — report mastheads. '' when the client has none. */
    full: string;
    /**
     * True when `full` is a guess at a legacy asset that may not exist, so the
     * caller must keep its onError fallback. False when it came from storage,
     * or when there is no full logo at all.
     */
    fullIsGuess: boolean;
}

/**
 * Both variants for a client, storage first.
 *
 * Resolution order per variant:
 *   1. the uploaded object in the CompanyLogo bucket
 *   2. the legacy public/logo asset
 *   3. '' — the caller supplies DTG's own mark as the last resort
 *
 * The two variants resolve independently: a client who has uploaded only a full
 * lockup keeps its legacy mark on the dashboard, and vice versa. Falling back
 * from one variant to the other is left to the caller, which is the only place
 * that knows whether a squeezed-in wordmark is better than none.
 */
export const resolveCompanyLogos = (client: ClientLogoSource | null | undefined): ResolvedLogos => {
    const storedMark = publicLogoUrl(client?.logo_mark_path);
    const storedFull = publicLogoUrl(client?.logo_full_path);
    const legacyMark = normalizeLegacyLogoPath(client?.logo_path);

    if (storedFull) {
        return { mark: storedMark || legacyMark, full: storedFull, fullIsGuess: false };
    }

    return {
        mark: storedMark || legacyMark,
        full: legacyFullLogoPath(client?.logo_path),
        fullIsGuess: Boolean(legacyFullLogoPath(client?.logo_path))
    };
};

/** One variant, with the other standing in when it is missing. */
export const companyLogo = (
    client: ClientLogoSource | null | undefined,
    variant: LogoVariant
): string => {
    const { mark, full } = resolveCompanyLogos(client);
    return variant === 'full' ? full || mark : mark || full;
};

// ---------------------------------------------------------------------------
// Uploading
// ---------------------------------------------------------------------------

const EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/gif': 'gif'
};

export const ACCEPTED_LOGO_TYPES = Object.keys(EXTENSIONS);

/** 2 MB. A masthead asset that exceeds this is a photograph, not a logo. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Why this file cannot be used as a logo, or null when it can.
 */
export const validateLogoFile = (file: { type?: string; size?: number } | null | undefined): string | null => {
    if (!file) return 'No file selected.';
    if (!ACCEPTED_LOGO_TYPES.includes(text(file.type))) {
        return 'Logo must be a PNG, JPEG, WebP, SVG or GIF image.';
    }
    if ((file.size ?? 0) > MAX_LOGO_BYTES) {
        return `Logo must be under ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB.`;
    }
    return null;
};

/**
 * Where a client's logo lives in the bucket.
 *
 * Keyed by site id and variant, with a timestamp so a replacement lands on a NEW
 * object rather than overwriting the old one. Overwriting would be tidier, but
 * the CDN in front of a public bucket serves the previous bytes for as long as
 * its cache says to — a client who replaced their logo would keep seeing the old
 * one on every report for the rest of the day.
 */
export const logoObjectPath = (
    siteId: number | string,
    variant: LogoVariant,
    file: { type?: string; name?: string }
): string => {
    const ext =
        EXTENSIONS[text(file?.type)] ||
        text(file?.name).split('.').pop()?.toLowerCase() ||
        'png';
    return `${siteId}/${variant}-${Date.now()}.${ext}`;
};

/** The column each variant is stored in. */
export const LOGO_COLUMN: Record<LogoVariant, 'logo_full_path' | 'logo_mark_path'> = {
    full: 'logo_full_path',
    mark: 'logo_mark_path'
};

/**
 * Just the storage half of a Supabase client.
 *
 * Narrowed with `Pick` rather than re-declared: hand-writing the `upload`
 * signature made the real client fail to type-check against it, and a helper the
 * app cannot pass its own client to is no help at all.
 */
type StorageLike = Pick<SupabaseClient, 'storage'>;

/**
 * Put a logo in the bucket and hand back its object path.
 *
 * Throws on failure. The caller writes the path to `clients` itself, in the same
 * update as the rest of the site details, so a failed save leaves no row
 * pointing at an object that is not there.
 */
export const uploadCompanyLogo = async (
    client: StorageLike,
    siteId: number | string,
    variant: LogoVariant,
    file: File
): Promise<string> => {
    const problem = validateLogoFile(file);
    if (problem) throw new Error(problem);

    const path = logoObjectPath(siteId, variant, file);
    const { error } = await client.storage.from(LOGO_BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
    });

    if (error) throw new Error(error.message || 'Logo upload failed.');
    return path;
};

/**
 * Delete a superseded object, best effort.
 *
 * Never throws: the row already points at the new logo by the time this runs,
 * and failing the whole save because the old file could not be tidied up would
 * be the wrong trade. A leftover object costs nothing but bytes.
 */
export const removeCompanyLogo = async (
    client: StorageLike,
    objectPath: string | null | undefined
): Promise<void> => {
    const path = text(objectPath);
    if (!path || isResolved(path)) return;
    try {
        await client.storage.from(LOGO_BUCKET).remove([path]);
    } catch (err) {
        console.warn('[companyLogos] could not remove superseded logo', path, err);
    }
};
