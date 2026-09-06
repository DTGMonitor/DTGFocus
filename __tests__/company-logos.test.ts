/**
 * Company logos — Supabase storage first, the legacy public/logo asset second.
 *
 * The rule worth pinning is the fallback, not the happy path. Every existing
 * client's masthead is a legacy `logo_path`, and this module is the only thing
 * standing between them and a broken image on every report.
 */

import {
    ACCEPTED_LOGO_TYPES,
    LOGO_BUCKET,
    LOGO_COLUMN,
    MAX_LOGO_BYTES,
    companyLogo,
    legacyFullLogoPath,
    logoObjectPath,
    normalizeLegacyLogoPath,
    publicLogoUrl,
    resolveCompanyLogos,
    validateLogoFile
} from '@/utils/companyLogos';

const SUPABASE_URL = 'https://project.supabase.co';
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
});

afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
});

const publicUrl = (path: string) =>
    `${SUPABASE_URL}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

describe('publicLogoUrl', () => {
    test('builds the public object URL for a stored path', () => {
        expect(publicLogoUrl('42/full-1712345678901.png')).toBe(
            publicUrl('42/full-1712345678901.png')
        );
    });

    test('empty in, empty out', () => {
        expect(publicLogoUrl(null)).toBe('');
        expect(publicLogoUrl('')).toBe('');
        expect(publicLogoUrl('   ')).toBe('');
    });

    test('an already-resolved URL is honoured rather than re-prefixed', () => {
        const url = 'https://cdn.example.com/logo.png';
        expect(publicLogoUrl(url)).toBe(url);
        expect(publicLogoUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    });

    test('no Supabase URL means no URL at all, so callers fall through', () => {
        // A relative "/storage/v1/…" would render as a broken image against the
        // Next app's own origin, which is worse than the legacy fallback.
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        expect(publicLogoUrl('42/full.png')).toBe('');
    });

    test('a trailing slash on the project URL does not double up', () => {
        process.env.NEXT_PUBLIC_SUPABASE_URL = `${SUPABASE_URL}/`;
        expect(publicLogoUrl('42/full.png')).toBe(publicUrl('42/full.png'));
    });

    test('path segments are encoded but the separators survive', () => {
        expect(publicLogoUrl('42/full logo.png')).toBe(publicUrl('42/full%20logo.png'));
    });
});

// ---------------------------------------------------------------------------
// Legacy paths
// ---------------------------------------------------------------------------

describe('legacy public/logo paths', () => {
    test('"../CompanyLogo/…" is rewritten to the served path', () => {
        expect(normalizeLegacyLogoPath('../CompanyLogo/LogoOnly/Genesis.png')).toBe(
            '/logo/CompanyLogo/LogoOnly/Genesis.png'
        );
    });

    test('the full-lockup guess swaps the folder, not the stem', () => {
        expect(legacyFullLogoPath('../CompanyLogo/LogoOnly/Genesis.png')).toBe(
            '/logo/CompanyLogo/FullLogo/Genesis.png'
        );
    });

    test('nothing in, nothing out', () => {
        expect(normalizeLegacyLogoPath(null)).toBe('');
        expect(legacyFullLogoPath(undefined)).toBe('');
    });
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

describe('resolveCompanyLogos', () => {
    test('a client with nothing at all resolves to nothing', () => {
        expect(resolveCompanyLogos(null)).toEqual({ mark: '', full: '', fullIsGuess: false });
        expect(resolveCompanyLogos({})).toEqual({ mark: '', full: '', fullIsGuess: false });
    });

    test('a legacy-only client resolves exactly as it always did', () => {
        const resolved = resolveCompanyLogos({ logo_path: '../CompanyLogo/LogoOnly/Genesis.png' });
        expect(resolved.mark).toBe('/logo/CompanyLogo/LogoOnly/Genesis.png');
        expect(resolved.full).toBe('/logo/CompanyLogo/FullLogo/Genesis.png');
        // The full lockup is a guess: the FullLogo folder is a subset of
        // LogoOnly, so the caller must keep its onError fallback.
        expect(resolved.fullIsGuess).toBe(true);
    });

    test('an uploaded full logo wins and is not a guess', () => {
        const resolved = resolveCompanyLogos({
            logo_path: '../CompanyLogo/LogoOnly/Genesis.png',
            logo_full_path: '42/full-1.png'
        });
        expect(resolved.full).toBe(publicUrl('42/full-1.png'));
        expect(resolved.fullIsGuess).toBe(false);
        // The mark had no upload, so it keeps the legacy asset.
        expect(resolved.mark).toBe('/logo/CompanyLogo/LogoOnly/Genesis.png');
    });

    test('the two variants resolve independently', () => {
        const resolved = resolveCompanyLogos({
            logo_path: '../CompanyLogo/LogoOnly/Genesis.png',
            logo_mark_path: '42/mark-1.png'
        });
        expect(resolved.mark).toBe(publicUrl('42/mark-1.png'));
        expect(resolved.full).toBe('/logo/CompanyLogo/FullLogo/Genesis.png');
    });

    test('an uploaded mark with no legacy path and no full logo leaves full empty', () => {
        const resolved = resolveCompanyLogos({ logo_mark_path: '42/mark-1.png' });
        expect(resolved.mark).toBe(publicUrl('42/mark-1.png'));
        expect(resolved.full).toBe('');
        expect(resolved.fullIsGuess).toBe(false);
    });
});

describe('companyLogo', () => {
    test('each variant falls back to the other when it is missing', () => {
        const markOnly = { logo_mark_path: '42/mark-1.png' };
        expect(companyLogo(markOnly, 'full')).toBe(publicUrl('42/mark-1.png'));
        expect(companyLogo(markOnly, 'mark')).toBe(publicUrl('42/mark-1.png'));
    });

    test('a client with nothing yields an empty string, never "undefined"', () => {
        expect(companyLogo(null, 'full')).toBe('');
        expect(companyLogo({}, 'mark')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

describe('validateLogoFile', () => {
    test('accepts every declared image type', () => {
        for (const type of ACCEPTED_LOGO_TYPES) {
            expect(validateLogoFile({ type, size: 1024 })).toBeNull();
        }
    });

    test('rejects a non-image', () => {
        expect(validateLogoFile({ type: 'application/pdf', size: 1024 })).toMatch(/PNG/);
    });

    test('rejects an oversized file', () => {
        expect(validateLogoFile({ type: 'image/png', size: MAX_LOGO_BYTES + 1 })).toMatch(/under/);
        expect(validateLogoFile({ type: 'image/png', size: MAX_LOGO_BYTES })).toBeNull();
    });

    test('rejects nothing at all', () => {
        expect(validateLogoFile(null)).toMatch(/No file/);
    });
});

describe('logoObjectPath', () => {
    test('keys by site and variant, with an extension from the mime type', () => {
        const path = logoObjectPath(42, 'full', { type: 'image/png', name: 'genesis.PNG' });
        expect(path).toMatch(/^42\/full-\d+\.png$/);
    });

    test('an unknown mime type falls back to the file name extension', () => {
        const path = logoObjectPath(7, 'mark', { type: '', name: 'mark.SVG' });
        expect(path).toMatch(/^7\/mark-\d+\.svg$/);
    });

    test('a replacement lands on a new object, not over the old one', () => {
        // Overwriting would be tidier, but the CDN in front of a public bucket
        // would keep serving the previous bytes.
        jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(2000);
        const first = logoObjectPath(42, 'full', { type: 'image/png' });
        const second = logoObjectPath(42, 'full', { type: 'image/png' });
        expect(first).not.toBe(second);
        jest.restoreAllMocks();
    });
});

test('each variant maps to its own column', () => {
    expect(LOGO_COLUMN.full).toBe('logo_full_path');
    expect(LOGO_COLUMN.mark).toBe('logo_mark_path');
});
