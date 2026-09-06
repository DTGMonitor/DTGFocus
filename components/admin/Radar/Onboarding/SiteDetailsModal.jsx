"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader, Upload, Trash2, ImageOff } from 'lucide-react';
import toast from 'react-hot-toast';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabaseClient';
import {
    ACCEPTED_LOGO_TYPES,
    LOGO_COLUMN,
    removeCompanyLogo,
    resolveCompanyLogos,
    uploadCompanyLogo,
    validateLogoFile
} from '@/utils/companyLogos';

const FIELDS = [
    { key: 'site_name', label: 'Site Name', required: true, placeholder: 'Leonora' },
    { key: 'company', label: 'Company', required: true, placeholder: 'Genesis Minerals' },
    { key: 'location', label: 'Location', required: true, placeholder: 'WA, Australia' },
    { key: 'timezone', label: 'Timezone', required: true, placeholder: 'Australia/Perth' },
    { key: 'stock_code', label: 'Stock Code', placeholder: 'GMD' },
    { key: 'place_id', label: 'Place ID (Meteostat)', placeholder: 'leonora' },
    { key: 'latitude', label: 'Latitude', placeholder: '-28.88' },
    { key: 'longitude', label: 'Longitude', placeholder: '121.33' }
];

const LOGO_SLOTS = [
    {
        variant: 'full',
        label: 'Full logo',
        hint: 'Mark and wordmark together. Used on report mastheads.'
    },
    {
        variant: 'mark',
        label: 'Logo only',
        hint: 'The compact mark on its own. Used in the dashboard header and tight spaces.'
    }
];

/**
 * SiteDetailsModal
 *
 * Edit a site's own record — the name, the company, where it is, and the two
 * logo variants — without a deploy.
 *
 * Logos used to live in `public/logo/CompanyLogo`, which meant a new client's
 * masthead was a code change. They now go to the public 'CompanyLogo' Supabase
 * bucket and the object paths are stored on `clients`; see utils/companyLogos.ts
 * for how the legacy path stays as the fallback.
 *
 * The order of operations matters. Files upload FIRST, and the row is written
 * once with everything in it. A failed row update therefore leaves an unused
 * object in the bucket — cheap — rather than a client row pointing at a file
 * that was never stored, which is a broken masthead on every report until
 * somebody notices.
 *
 * Props:
 *   isOpen, onClose
 *   siteId     the clients.id to edit
 *   onSaved    (updatedClientRow) => void
 */
export default function SiteDetailsModal({ isOpen, onClose, siteId, onSaved }) {
    const [client, setClient] = useState(null);
    const [form, setForm] = useState({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    // { full: File|null, mark: File|null } — chosen but not yet uploaded.
    const [picked, setPicked] = useState({ full: null, mark: null });
    // Variants the operator has explicitly cleared.
    const [cleared, setCleared] = useState({ full: false, mark: false });
    const inputs = { full: useRef(null), mark: useRef(null) };

    const load = useCallback(async () => {
        if (!siteId) return;
        setLoading(true);
        const { data, error } = await supabase
            .from('clients')
            .select(
                'id, site_name, company, location, timezone, stock_code, place_id, latitude, longitude, logo_path, logo_full_path, logo_mark_path'
            )
            .eq('id', siteId)
            .maybeSingle();

        if (error) {
            console.error('[SiteDetailsModal] load failed', error);
            toast.error('Could not load the site record.');
        } else if (data) {
            setClient(data);
            setForm(
                FIELDS.reduce((acc, f) => {
                    acc[f.key] = data[f.key] ?? '';
                    return acc;
                }, {})
            );
        }
        setLoading(false);
    }, [siteId]);

    useEffect(() => {
        if (!isOpen) return;
        setPicked({ full: null, mark: null });
        setCleared({ full: false, mark: false });
        load();
    }, [isOpen, load]);

    /** What each slot should show right now: the pick, the stored logo, or nothing. */
    const previewFor = (variant) => {
        if (picked[variant]) return URL.createObjectURL(picked[variant]);
        if (cleared[variant]) return '';
        const { full, mark } = resolveCompanyLogos(client);
        return variant === 'full' ? full : mark;
    };

    const choose = (variant, file) => {
        if (!file) return;
        const problem = validateLogoFile(file);
        if (problem) {
            toast.error(problem);
            return;
        }
        setPicked((prev) => ({ ...prev, [variant]: file }));
        setCleared((prev) => ({ ...prev, [variant]: false }));
    };

    const clear = (variant) => {
        setPicked((prev) => ({ ...prev, [variant]: null }));
        setCleared((prev) => ({ ...prev, [variant]: true }));
        if (inputs[variant].current) inputs[variant].current.value = '';
    };

    const validate = () => {
        for (const field of FIELDS) {
            if (field.required && !String(form[field.key] ?? '').trim()) {
                return `${field.label} is required.`;
            }
        }
        for (const key of ['latitude', 'longitude']) {
            const value = String(form[key] ?? '').trim();
            if (value !== '' && Number.isNaN(Number(value))) {
                return `${key === 'latitude' ? 'Latitude' : 'Longitude'} must be a number.`;
            }
        }
        return null;
    };

    const handleSave = async () => {
        const problem = validate();
        if (problem) {
            toast.error(problem);
            return;
        }

        setSaving(true);
        // Objects uploaded during this save, so a failed row update can take them
        // back out rather than leaving the bucket littered.
        const uploaded = [];

        try {
            const update = {
                site_name: form.site_name.trim(),
                company: form.company.trim(),
                location: form.location.trim(),
                timezone: form.timezone.trim(),
                stock_code: String(form.stock_code ?? '').trim() || null,
                place_id: String(form.place_id ?? '').trim() || null,
                latitude:
                    String(form.latitude ?? '').trim() === '' ? null : Number(form.latitude),
                longitude:
                    String(form.longitude ?? '').trim() === '' ? null : Number(form.longitude)
            };

            for (const { variant } of LOGO_SLOTS) {
                const column = LOGO_COLUMN[variant];
                if (picked[variant]) {
                    const path = await uploadCompanyLogo(supabase, siteId, variant, picked[variant]);
                    uploaded.push(path);
                    update[column] = path;
                } else if (cleared[variant]) {
                    update[column] = null;
                }
            }

            const { data, error } = await supabase
                .from('clients')
                .update(update)
                .eq('id', siteId)
                .select(
                    'id, site_name, company, location, timezone, stock_code, place_id, latitude, longitude, logo_path, logo_full_path, logo_mark_path'
                )
                .single();

            if (error) throw error;

            // The superseded objects only go once the row no longer points at them.
            for (const { variant } of LOGO_SLOTS) {
                const column = LOGO_COLUMN[variant];
                const previous = client?.[column];
                if (previous && previous !== data[column]) {
                    await removeCompanyLogo(supabase, previous);
                }
            }

            setClient(data);
            setPicked({ full: null, mark: null });
            setCleared({ full: false, mark: false });
            toast.success('Site details updated.');
            onSaved?.(data);
            onClose();
        } catch (err) {
            console.error('[SiteDetailsModal] save failed', err);
            toast.error(`Could not save: ${err?.message || 'unknown error'}`);
            for (const path of uploaded) await removeCompanyLogo(supabase, path);
        } finally {
            setSaving(false);
        }
    };

    const hint = 'text-xs text-[var(--dtg-gray-700)]';

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto bg-[var(--dtg-bg-card)] text-[var(--dtg-text-primary)] border-[var(--dtg-border-medium)]">
                <DialogHeader>
                    <DialogTitle>Site &amp; Company Details</DialogTitle>
                    <p className={hint}>
                        What the reports print in their masthead and metadata. Logos are stored in
                        Supabase, so a new client no longer needs a deploy.
                    </p>
                </DialogHeader>

                {loading ? (
                    <div className="flex items-center justify-center py-10 text-[var(--dtg-gray-700)]">
                        <Loader size={18} className="mr-2 animate-spin" />
                        Loading site…
                    </div>
                ) : (
                    <div className="grid gap-4 py-2">
                        <div className="grid grid-cols-2 gap-3">
                            {FIELDS.map((field) => (
                                <div key={field.key} className="space-y-1.5">
                                    <label className={hint}>
                                        {field.label}
                                        {field.required ? ' *' : ''}
                                    </label>
                                    <Input
                                        value={form[field.key] ?? ''}
                                        placeholder={field.placeholder}
                                        onChange={(e) =>
                                            setForm({ ...form, [field.key]: e.target.value })
                                        }
                                        list={field.key === 'timezone' ? 'dtg-site-timezones' : undefined}
                                    />
                                </div>
                            ))}
                            <datalist id="dtg-site-timezones">
                                <option value="Australia/Perth" />
                                <option value="Australia/Brisbane" />
                                <option value="Australia/Sydney" />
                                <option value="Asia/Jakarta" />
                                <option value="Asia/Makassar" />
                                <option value="Asia/Jayapura" />
                            </datalist>
                        </div>

                        {/* --- Logos ------------------------------------------- */}
                        <div className="grid gap-3 rounded-md border border-[var(--dtg-border-medium)] p-3 sm:grid-cols-2">
                            {LOGO_SLOTS.map(({ variant, label, hint: slotHint }) => {
                                const preview = previewFor(variant);
                                return (
                                    <div key={variant} className="space-y-2">
                                        <p className="text-sm">{label}</p>
                                        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--dtg-border-medium)] bg-white p-2">
                                            {preview ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={preview}
                                                    alt={`${label} preview`}
                                                    className="max-h-full max-w-full object-contain"
                                                />
                                            ) : (
                                                <span className="flex items-center gap-2 text-xs text-gray-400">
                                                    <ImageOff size={14} />
                                                    No logo
                                                </span>
                                            )}
                                        </div>
                                        <p className={hint}>{slotHint}</p>
                                        <div className="flex gap-2">
                                            <input
                                                ref={inputs[variant]}
                                                type="file"
                                                accept={ACCEPTED_LOGO_TYPES.join(',')}
                                                className="hidden"
                                                onChange={(e) => choose(variant, e.target.files?.[0])}
                                            />
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => inputs[variant].current?.click()}
                                                disabled={saving}
                                            >
                                                <Upload size={14} />
                                                {preview ? 'Replace' : 'Upload'}
                                            </Button>
                                            {preview && (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => clear(variant)}
                                                    disabled={saving}
                                                >
                                                    <Trash2 size={14} />
                                                </Button>
                                            )}
                                        </div>
                                        {picked[variant] && (
                                            <p className="text-xs text-[var(--dtg-brand-orange)]">
                                                {picked[variant].name} — uploads on save
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button variant="brand" onClick={handleSave} disabled={saving || loading}>
                        {saving && <Loader size={16} className="mr-2 animate-spin" />}
                        {saving ? 'Saving…' : 'Save details'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
