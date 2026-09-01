import { useState, useEffect, useMemo, useRef, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { X, FileText, Calendar } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useUserSite } from "../../Reusable/useUserSite";
import { InsarTemplate } from '@/components/admin/Reports/InsarReportTemplates';
import { RadarTemplate } from '@/components/admin/Reports/RadarReportTemplates';
import { ComprehensiveRadarTemplate, resolveAppendixImages, comprehensiveTitle } from '@/components/admin/Reports/ComprehensiveRadarTemplate';
import { buildAppendixItems } from '@/utils/reportDqp';
import { daysForFrequency, windowForFrequency } from '@/utils/reportAvailability';
import { fromUTC, formatFromUTC } from '@/utils/timezoneUtils';
import { useComprehensiveReportData } from '@/components/admin/Reports/useComprehensiveReportData';
import { DailyRadarTemplate, DAILY_TITLE } from '@/components/admin/Reports/DailyRadarTemplate';
import { DailyReportToolbar } from '@/components/admin/Reports/DailyReportToolbar';
import { useDailyReportData } from '@/components/admin/Reports/useDailyReportData';
import { useGeneratorRuntime } from '@/components/admin/Reports/useGeneratorRuntime';
import { applyHtml2CanvasBaselineFix, generatePdfBlob, urlToDataUrl } from '@/components/admin/Radar/report/pdfExport';
import { PAGE_W, FALLBACK_LOGO } from '@/components/admin/Radar/report/constants';
import { useImageAnnotation } from '@/components/admin/Radar/report/useImageAnnotation';
import { useDailyFigures } from '@/components/admin/Radar/report/useDailyFigures';
import { AnnotationToolbar } from '@/components/admin/Radar/report/AnnotatedImage';
import { resolveEmailLocale } from '@/config/emailLocale';
import { hasActiveRisk } from '@/utils/dailyStatusRows';
import { useReportLayout } from '@/components/admin/Reports/useReportLayout';
import { ReportLayoutEditor } from '@/components/admin/Reports/ReportLayoutEditor';
import { useSiteReportDefaults } from '@/components/admin/Reports/useSiteReportDefaults';
import { SiteDefaultControl } from '@/components/admin/Reports/SiteDefaultControl';
import {
    MIN_CUSTOM_DAYS,
    MAX_CUSTOM_DAYS,
    clampCustomDays,
    applyDefaultToForm,
    matchesDefault,
} from '@/utils/reportDefaults';

// Report configuration
const REPORT_CONFIG = {
    Insar: {
        table: 'client_images',
        bucket: 'Insar',
        template: 'InsarTemplate',
        title: 'Monthly Insar Water Body Report',
        description: 'InSAR hydrological - water body monitoring'
    },
    Radar: {
        table: 'client_images',
        bucket: 'Radar',
        template: 'RadarTemplate',
        title: 'Daily Radar Deformation Report',
        description: 'Radar deformation monitoring'
    }
};

/** Radar categories that render their own template rather than the DQ layout. */
const COMPREHENSIVE = 'Comprehensive';
/**
 * The per-area status board. Named for its FORM, not its cadence — the
 * Comprehensive report already has a daily edition, so "Daily" named nothing
 * that distinguished the two.
 */
const TABULATION = 'Tabulation';

/** The granularity that takes its span from the Days field rather than a preset. */
const CUSTOM_FREQUENCY = 'custom';

/**
 * The three selects, at module scope.
 *
 * Hoisted out of the component because the per-site defaults are validated
 * against them (useSiteReportDefaults): a saved value the form no longer offers
 * is dropped rather than forced into a <select> with no such option. Rebuilding
 * these arrays on every render would re-map every site's default on every
 * keystroke.
 */
const REPORT_TYPES = Object.keys(REPORT_CONFIG);
const CATEGORIES = ['Water Body', 'Deformation', 'Data Quality', 'Comprehensive', TABULATION];
const FREQUENCIES = [
    { value: 'daily', label: 'Daily', alt: '24h' },
    { value: 'weekly', label: 'Weekly', alt: '7d' },
    { value: 'monthly', label: 'Monthly', alt: '30d' },
    // Span comes from the Days field below, not from this entry.
    { value: CUSTOM_FREQUENCY, label: 'Custom', alt: null },
];
const FREQUENCY_VALUES = FREQUENCIES.map((f) => f.value);
const FREQUENCY_LABELS = Object.fromEntries(FREQUENCIES.map((f) => [f.value, f.label]));

/** What the per-site defaults are checked against — see utils/reportDefaults.js. */
const SELECTION_CATALOGUES = {
    reportTypes: REPORT_TYPES,
    categories: CATEGORIES,
    frequencies: FREQUENCY_VALUES,
};

/**
 * Today on the SITE's calendar, as 'YYYY-MM-DD'.
 *
 * The End Date is a SITE day, not a viewer day: windowForFrequency decides
 * whether the chosen period is still OPEN (window = now − N×24 h → now) or a
 * CLOSED historical one (window ends at that day's 05:00 site-local boundary) by
 * comparing End Date against today in the site's timezone.
 *
 * Defaulting the field off the BROWSER clock made the two disagree whenever the
 * site was ahead of the viewer. A Jakarta analyst at 23:10 was offered
 * '2026-08-02' for a radar whose site had already rolled over to '2026-08-03',
 * so the window was read as a closed day and ended at 05:00 the previous
 * morning — the report silently lost the ~19 h of records nearest to now, and
 * bumping End Date to "tomorrow" only appeared to fix it because that landed
 * back on the site's today.
 *
 * No timezone (the manual InSAR flow, which has no sensor) keeps the viewer's
 * date, as before — its queries are plain date ranges with no 05:00 boundary.
 */
const siteToday = (timeZone) => {
  const browserToday = new Date().toLocaleDateString('en-CA');
  if (!timeZone) return browserToday;
  try {
    return (fromUTC(new Date().toISOString(), timeZone) || '').slice(0, 10) || browserToday;
  } catch {
    return browserToday;
  }
};

/**
 * Calendar arithmetic on a 'YYYY-MM-DD' string, done in UTC so the result never
 * depends on the runtime timezone (a `new Date(...).setDate()` on a local-midnight
 * date can land on the wrong day either side of a DST change).
 */
const shiftDay = (day, deltaDays) => {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
};


/**
 * `clients.logo_path` holds a repo-relative path like "../CompanyLogo/foo.png";
 * the public asset lives under "/logo/…". Same rewrite the Post-Blast report uses.
 */
const normalizeLogoPath = (p) => (p ? String(p).replace(/^\.\./, '/logo') : '');

/**
 * The FULL client logo — wordmark and all — for the daily report's masthead.
 *
 * `clients.logo_path` points at the LogoOnly variant, which is the compact mark
 * the dashboard needs beside a site name. The printed daily report has a whole
 * header band to fill and takes the full lockup instead.
 *
 * Not every client has one (public/logo/CompanyLogo/FullLogo is a subset, and
 * Greatland's is filed under a different stem), so this is only ever a
 * CANDIDATE — both call sites fall back to the LogoOnly path, the preview via
 * the <img>'s onError and the export via `resolveFullLogo` below.
 */
const fullLogoPath = (p) => (p ? String(p).replace('/LogoOnly/', '/FullLogo/') : '');

/**
 * The export path's logo, inlined as a data URL.
 *
 * `urlToDataUrl` alone is not enough here: a missing FullLogo asset is served
 * as Next's HTML 404 page with a 200-shaped fetch in dev, which would inline as
 * a data URL of HTML and print as a broken image. So the response is checked
 * for an image content type before it is accepted, and anything else falls back
 * to the LogoOnly variant the dashboard already uses.
 */
async function resolveFullLogo(candidate, fallback) {
    if (candidate) {
        try {
            const res = await fetch(candidate);
            if (res.ok && String(res.headers.get('content-type') || '').startsWith('image/')) {
                return await urlToDataUrl(candidate);
            }
        } catch {
            /* fall through */
        }
    }
    return urlToDataUrl(fallback);
}

const ReportTemplateRenderer = ({
    reportType, category, data, reportInfo, sensor, comprehensiveData, logoSrc, annotation, imageRef,
    dailyData, dailyLocale, dailyFigures, dailyFigureRefs, dailyManual, onDailyManualChange,
    dailyGenerator,
    dailyLogo, onDailyLogoError,
    layout, layoutValues,
}) => {
    const config = REPORT_CONFIG[reportType];
    if (config?.template === 'InsarTemplate') return <InsarTemplate data={data} reportInfo={reportInfo} />;
    if (config?.template !== 'RadarTemplate') return <div>Template not found</div>;

    if (category === TABULATION) {
        return (
            <DailyRadarTemplate
                data={dailyData}
                sensor={sensor}
                reportInfo={reportInfo}
                locale={dailyLocale}
                logoSrc={dailyLogo}
                onLogoError={onDailyLogoError}
                annotation={annotation}
                imageRef={imageRef}
                figures={dailyFigures}
                figureRefs={dailyFigureRefs}
                manual={dailyManual}
                onManualChange={onDailyManualChange}
                generator={dailyGenerator}
                layout={layout}
                layoutValues={layoutValues}
            />
        );
    }

    // Selection keys on category as well as report type. It previously keyed on
    // type alone, so every radar category silently rendered the Data Quality
    // layout — which is why only Data Quality appeared to be available.
    if (category === COMPREHENSIVE) {
        return (
            <ComprehensiveRadarTemplate
                data={comprehensiveData}
                sensor={sensor}
                reportInfo={reportInfo}
                logoSrc={logoSrc}
                annotation={annotation}
                imageRef={imageRef}
                layout={layout}
                layoutValues={layoutValues}
            />
        );
    }
    return <RadarTemplate data={data} sensor={sensor} reportInfo={reportInfo} />;
};

// --- 2. THE MODAL COMPONENT ---
export default function ReportGeneratorModal({ onClose, radarData, sensor }) {
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [generatedReport, setGeneratedReport] = useState(null);
    const [showPreview, setShowPreview] = useState(false);
    const { user, userSite, loading: authLoading } = useUserSite();
    const [clientsList, setClientsList] = useState([]);
    const [loadingClients, setLoadingClients] = useState(true);
    const [processedRadarData, setProcessedRadarData] = useState([]);

    const displayName = userSite?.displayname || user?.email;

    //Fetch Client Options
    useEffect(() => {
        const fetchClients = async () => {
            try {
                const { data, error } = await supabase
                    .from('clients')
                    .select('id, site_name, company,location,logo_path')
                    .order('site_name');

                if (error) throw error;
                setClientsList(data || []);
            } catch (error) {
                console.error('Error fetching clients:', error);
            } finally {
                setLoadingClients(false);
            }
        };

        if (user) {
            fetchClients();
        }
    }, [user]);

    // Process Radar Data (Sign Images)
    useEffect(() => {
        const processRadarData = async () => {
            if (!radarData) return;
            // A row carries N figures now, so every one of them gets signed —
            // and all of them concurrently, or a row with four images would
            // serialise four round trips before the preview could render.
            const processed = await Promise.all(radarData.map(async (item) => {
                const images = item.images ?? [];
                if (!images.length) return item;
                return {
                    ...item,
                    images: await Promise.all(images.map(async (img) => {
                        if (!img.image_url) return img;
                        const { data } = await supabase.storage.from('Radar').createSignedUrl(img.image_url, 3600);
                        return { ...img, url: data?.signedUrl };
                    })),
                };
            }));
            setProcessedRadarData(processed);
        };
        if (sensor) processRadarData();
    }, [radarData, sensor]);

    // The calendar the report's dates live on: the SITE's, whenever we know it.
    // Every window bound downstream is resolved against it (see siteToday).
    const reportTimeZone = sensor?.timezone || null;

    // 1. Defaults, on the site's calendar. Default is 'monthly', so the start
    // date goes back 183 days (based on your logic).
    const todayDay = siteToday(reportTimeZone);

    const [formData, setFormData] = useState({
        clientID: sensor?.site_id || '',
        reportType: sensor ? 'Radar' : 'Insar',
        category: sensor ? 'Data Quality' : 'Water Body',
        frequency: '',
        // The custom span, in days — only read when frequency is 'custom'. Two is
        // the default because the two-day report is what the control was added for.
        customDays: 2,
        startDate: shiftDay(todayDay, -183), // "2024-12-26"
        endDate: todayDay,                   // "2025-12-26"
    });

    const isRadar = formData.reportType === 'Radar';
    const isComprehensive = isRadar && formData.category === COMPREHENSIVE;
    const isTabulation = isRadar && formData.category === TABULATION;
    const isCustomFrequency = formData.frequency === CUSTOM_FREQUENCY;

    /**
     * The granularity as the data layer reads it: a named frequency, or the
     * `custom:<days>` form daysForFrequency understands. Everything downstream —
     * the window, the alarm bounds, the timeline horizon — derives from this one
     * string, so a custom span needs no separate plumbing.
     */
    const resolvedFrequency = isCustomFrequency
        ? `${CUSTOM_FREQUENCY}:${clampCustomDays(formData.customDays)}`
        : formData.frequency;

    /** How many days the chosen granularity covers. Names the report and its file. */
    const windowDays = daysForFrequency(resolvedFrequency);

    /**
     * The window the data layer will actually resolve, printed under the dates.
     * The End Date alone does not say where the window ENDS — the site's today
     * means "the latest N × 24 h, ending now", any earlier day means a closed
     * period ending 05:00 that morning — so it is spelled out rather than left
     * to be inferred from a report that came back short.
     */
    const previewWindow = isComprehensive && formData.frequency
        ? windowForFrequency(resolvedFrequency, formData.endDate, reportTimeZone || 'UTC')
        : null;
    const formatWindowBound = (d) => formatFromUTC(d.toISOString(), reportTimeZone || 'UTC');

    // Comprehensive pulls its own data (KPIs, timelines, availability, alarms)
    // rather than reusing the dqpList the Data Quality template renders.
    const { data: comprehensiveData, loading: comprehensiveLoading } = useComprehensiveReportData(
        sensor,
        resolvedFrequency,
        formData.endDate,
        Boolean(sensor) && isComprehensive
    );

    const selectedClient = clientsList.find(s => String(s.id) === String(formData.clientID));
    const siteName = selectedClient?.site_name || 'Unknown';
    const company = selectedClient?.company || 'Unknown';
    const location = selectedClient?.location || 'Unknown';
    const completeSiteName = `${siteName}, ${location}`;

    // The header carries the CLIENT's logo, not DTG's — DTG's mark is the footer.
    const clientLogo = normalizeLogoPath(selectedClient?.logo_path) || FALLBACK_LOGO;

    // The daily report's masthead takes the FULL lockup where the client has
    // one. Whether they do cannot be known from the path — the FullLogo folder
    // is a subset of LogoOnly — so the preview tries it and lets the <img>'s
    // onError tell us, latched here so React does not re-attempt on every
    // render. Reset when the client changes, or a client with no full logo
    // would poison the next one's.
    const fullClientLogo = fullLogoPath(normalizeLogoPath(selectedClient?.logo_path));
    const [fullLogoMissing, setFullLogoMissing] = useState(false);
    useEffect(() => { setFullLogoMissing(false); }, [fullClientLogo]);
    const dailyLogo = !fullLogoMissing && fullClientLogo ? fullClientLogo : clientLogo;

    // Annotation state lives here, not in the template: the export mounts a second
    // copy of the template in a detached container, and component-local state would
    // start empty there — the uploaded image would silently vanish from the PDF.
    const annotation = useImageAnnotation(null);
    const imageRef = useRef(null);

    /**
     * The site's saved section layout, and this report's content for its custom
     * sections. Held here for the same reason as `annotation` above.
     *
     * Only the two block-composed categories have measured blocks to reorder;
     * the Data Quality, InSAR and Handover templates are fixed-page layouts on
     * a different rendering path, so they get no editor rather than a broken
     * one (see config/reportSections.ts).
     */
    const layout = useReportLayout(formData.clientID, formData.category, {
        updatedBy: displayName,
        enabled: isTabulation || isComprehensive,
    });

    /**
     * The report each site USUALLY takes — Telfer's Data Quality assessment,
     * Leonora's Comprehensive, Vale's Tabulation.
     *
     * Every site's row is loaded once, not per site: the modal switches clients
     * freely and a fetch per switch would sit between choosing a site and the
     * form settling on its report. See useSiteReportDefaults.
     */
    const siteDefaults = useSiteReportDefaults(SELECTION_CATALOGUES, { updatedBy: displayName });
    const siteDefault = siteDefaults.forSite(formData.clientID);

    /**
     * Apply a site's default ONCE per site, and never over the analyst.
     *
     * The ref holds the site the defaults were last applied for — including a
     * site that HAS no default, which is why it is set either way. Without that,
     * a site with no row would be retried on every render; and re-applying on
     * every render for a site that has one would undo the analyst's very next
     * correction, which is worse than never applying at all.
     *
     * It deliberately waits for `ready`: the empty map before the rows land
     * looks exactly like "this site has no default", and spending the one
     * application on it would leave the form on the generic selection.
     */
    const appliedDefaultRef = useRef(null);
    useEffect(() => {
        if (!siteDefaults.ready) return;
        const key = String(formData.clientID ?? '');
        if (!key || appliedDefaultRef.current === key) return;
        appliedDefaultRef.current = key;
        if (!siteDefault) return;

        setShowPreview(false);
        setFormData((prev) => {
            const next = applyDefaultToForm(prev, siteDefault);
            // The same two derivations handleInputChange makes: the Tabulation
            // report has no granularity to choose, and the Start Date follows
            // whatever the frequency ended up being.
            if (next.category === TABULATION) next.frequency = 'daily';
            next.startDate = getStartDateForFreq(next.frequency, next.category, next.customDays);
            return next;
        });
        // getStartDateForFreq is redeclared each render and reads only the site
        // timezone, which cannot change without the site changing.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [siteDefaults.ready, siteDefault, formData.clientID]);

    /** Does the form already sit on this site's saved default? */
    const onSiteDefault = matchesDefault(siteDefault, formData, { customFrequency: CUSTOM_FREQUENCY });

    // Seed the figure with the sensor's deformation heatmap once it resolves.
    // Seeds once only: a later refetch must never clobber an analyst's upload.
    // Depends on setImage (a stable setState setter), not the annotation object,
    // which is a fresh reference every render.
    const seededRef = useRef(false);
    const { setImage: setAnnotationImage } = annotation;

    // ── Daily report ──────────────────────────────────────────────────────
    // Its own fetcher: the daily report prints none of the comprehensive
    // report's alarm / availability / TARP sections, so pulling them would be a
    // dozen wasted round trips per preview. See useDailyReportData.
    const { data: dailyData, loading: dailyLoading } = useDailyReportData(
        sensor,
        formData.endDate,
        Boolean(sensor) && isTabulation
    );

    // The language follows the SITE, not the viewer — the same resolution the
    // email drafts use, so a client never receives a report and an email in
    // different languages.
    const dailyLocale = useMemo(
        () => resolveEmailLocale(sensor, sensor?.timezone),
        [sensor]
    );

    // Weather, fog, rainfall and the data-update stamp exist nowhere in the
    // system — they are read off the radar software and reported by site.
    const [dailyManual, setDailyManual] = useState({
        dataUpdate: '',
        weather: '',
        fog: '',
        rainfall: '',
    });
    const handleManualChange = (fieldName, value) =>
        setDailyManual((prev) => ({ ...prev, [fieldName]: value }));

    /**
     * Seed Data Update with when the wall was last checked, in SITE wall time.
     *
     * The stamp is the one thing on this card that the system already knows —
     * it is the hourly checklist's own timestamp — so the analyst confirms or
     * corrects a figure instead of transcribing one. Seeds ONCE and only over an
     * empty field: the value they type is read off the radar software and must
     * survive a refetch (changing the report date re-runs the hook).
     */
    const dataUpdateSeededRef = useRef(false);
    useEffect(() => {
        if (dataUpdateSeededRef.current || !dailyData?.lastCheck) return;
        dataUpdateSeededRef.current = true;
        setDailyManual((prev) =>
            prev.dataUpdate ? prev : { ...prev, dataUpdate: dailyData.lastCheck }
        );
    }, [dailyData?.lastCheck]);

    /**
     * The summary's seven-day generator running-time strip.
     *
     * Unlike the observations above, this one is STORED — it is a history, not a
     * statement about the day being reported, and the analyst fills only the new
     * leftmost cell each morning. Keyed to the radar (`sensor.id`), not the wall
     * folder: re-aiming a radar does not give it a different generator.
     *
     * Owned here for the same reason as `dailyManual`: the export mounts a
     * second copy of the template, and a hook called inside it would start empty
     * and print a blank strip into the PDF.
     */
    const dailyGenerator = useGeneratorRuntime(
        sensor?.id,
        dailyData?.reportDay,
        Boolean(sensor) && isTabulation
    );

    // Figure state lives HERE, not in the template: the export mounts a second
    // copy of the template in a detached container, where component-local state
    // would start empty and every uploaded figure would vanish from the PDF.
    const dailyFigures = useDailyFigures();

    // One ref per analysis figure, so a click lands on the element it was made
    // against. Grown in place and never re-created, so an existing figure keeps
    // the same ref when a new one is added beside it.
    const dailyFigureRefsStore = useRef([]);
    const dailyFigureRefs = useMemo(() => {
        const store = dailyFigureRefsStore.current;
        while (store.length < dailyFigures.figures.length) store.push(createRef());
        return store.slice(0, dailyFigures.figures.length);
    }, [dailyFigures.figures.length]);

    // Whether this edition prints an Area Analysis section at all. The template
    // reads the SAME predicate to decide whether to render it, so the section
    // can never be demanded and hidden at the same time.
    const dailyNeedsAnalysis = hasActiveRisk(dailyData?.riskPresentation);

    /**
     * What is still missing before the daily report can be generated.
     *
     * Every observation is required: a client reading "Kondisi Cuaca: —" learns
     * nothing except that someone skipped a field, and the weather is context
     * the deformation is read against. The analysis figure is required only on
     * the days a section exists to hold it.
     */
    const dailyOutstanding = useMemo(() => {
        const missing = [];
        if (!String(dailyManual.dataUpdate || '').trim()) missing.push('data update');
        if (!String(dailyManual.weather || '').trim()) missing.push('weather');
        if (!String(dailyManual.fog || '').trim()) missing.push('fog');
        if (!String(dailyManual.rainfall || '').trim()) missing.push('rainfall');
        if (dailyNeedsAnalysis && !dailyFigures.figures.some((f) => f.image)) {
            missing.push('an area analysis image');
        }
        return missing;
    }, [dailyManual, dailyNeedsAnalysis, dailyFigures.figures]);

    // Seed the scan-area figure once the wall folder's heatmap resolves.
    // Seeds once only, and shares `seededRef` with the comprehensive path: only
    // one category is ever previewed at a time, and either way a later refetch
    // must not clobber an analyst's upload.
    useEffect(() => {
        if (seededRef.current) return;
        if (!dailyData?.deformationImage) return;
        seededRef.current = true;
        setAnnotationImage(dailyData.deformationImage);
    }, [dailyData?.deformationImage, setAnnotationImage]);

    useEffect(() => {
        if (seededRef.current) return;
        if (!comprehensiveData?.deformationImage) return;
        seededRef.current = true;
        setAnnotationImage(comprehensiveData.deformationImage);
    }, [comprehensiveData?.deformationImage, setAnnotationImage]);

    const frequencies = FREQUENCIES;
    const reportTypes = REPORT_TYPES;
    const categories = CATEGORIES;

    //filename
    const rawDate = formData.endDate || new Date().toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: 'numeric' }).split('T')[0];
    const compactDate = rawDate.replaceAll('-', '').slice(0);
    const preset = frequencies.find(f => f.value === formData.frequency && f.value !== CUSTOM_FREQUENCY);
    // A custom span names itself by its length ("2-Day", "2d") — there is no
    // preset label to look up, and "Custom" tells a reader nothing about the file.
    const freqLabel = preset?.label || (isCustomFrequency ? `${windowDays}-Day` : 'Unknown');
    const freqAlt = preset?.alt || (isCustomFrequency ? `${windowDays}d` : 'Unknown');
    const fileName = (sensor && isTabulation) ?
        // The title already says "Daily", so no granularity is prefixed — and
        // the sensor id has to appear in the filename for the report reminder's
        // "generated today" matcher to see it (see mergeSites).
        `${compactDate} ${DAILY_TITLE} of ${sensor?.radar_number} - ${sensor?.site_name}.pdf`
        : (sensor && formData.category === 'Data Quality') ?
        `${compactDate} ${freqAlt} ${formData.category} Assessment of ${sensor?.radar_number} - ${sensor?.site_name}.pdf`
        : (sensor && isComprehensive) ?
            // The title already carries the granularity ("Daily" / "2-Day" /
            // "Weekly" …), so nothing is prefixed to it here.
            `${compactDate} ${comprehensiveTitle(windowDays)} of ${sensor?.radar_number} - ${sensor?.site_name}.pdf`
            : `${compactDate}_${siteName}_${freqLabel}_${formData.reportType} ${formData.category} Report.pdf`;

    useEffect(() => {
        const handleEscape = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);


    // Measured back from the SITE's today, so the Start Date it fills in names the
    // same calendar the End Date and the report window are resolved on.
    const getStartDateForFreq = (freq, cat, customDays) => {
        const end = siteToday(reportTimeZone);
        if (freq === 'daily') return shiftDay(end, -1);
        if (freq === 'weekly') return shiftDay(end, -7);
        if (freq === 'monthly') return shiftDay(end, cat === 'Water Body' ? -183 : -30);
        if (freq === CUSTOM_FREQUENCY) return shiftDay(end, -clampCustomDays(customDays));
        return end;
    };

    /**
     * Is the chosen range backwards?
     *
     * `startDate` is only recomputed when FREQUENCY or CATEGORY changes (see
     * handleInputChange below) and is always measured back from today, never from
     * the chosen End Date. So picking Weekly and then moving End Date into the past
     * leaves start after end — which silently empties the InSAR / Water Body query
     * (`.gte(startDate).lte(endDate)`) and prints a backwards "Period:" line on the
     * report. Block the preview rather than generate an empty one.
     *
     * Lexical compare on 'YYYY-MM-DD' is chronological, the same comparison
     * windowForFrequency uses for its report-day check.
     */
    const invalidDateRange = Boolean(
        formData.startDate && formData.endDate && formData.startDate > formData.endDate
    );

    // Update your handleInputChange to use it
    const handleInputChange = (field, value) => {
        /**
         * A preview goes STALE the moment the window it was built from changes.
         *
         * The form used to be a separate screen — you left it to see the
         * preview, so the two could not disagree. Now they are side by side, and
         * an analyst who nudges the End Date after generating would be looking
         * at yesterday's report under today's dates, with "Generate & Save PDF"
         * still live beside it.
         *
         * Every field on this form feeds the data layer, so the preview is
         * dropped for all of them and has to be asked for again. The layout
         * editor deliberately does NOT come through here: it re-renders the
         * preview live, which is the whole point of the pane.
         */
        setShowPreview(false);

        setFormData(prev => {
            const newData = { ...prev, [field]: value };

            // The daily report has no granularity to choose — it is one day by
            // definition. Filling it in means the analyst is not asked for a
            // frequency the template ignores, and the Preview button is not
            // dead for a reason nothing on screen explains.
            if (field === 'category' && value === TABULATION) newData.frequency = 'daily';

            // If they changed frequency (or the custom span behind it), auto-update
            // the start date.
            if (field === 'frequency' || field === 'category' || field === 'customDays') {
                newData.startDate = getStartDateForFreq(newData.frequency, newData.category, newData.customDays);
            }

            return newData;
        });
    };

    const fetchDataFromSupabase = async () => {
        const config = REPORT_CONFIG[formData.reportType];
        const { data: tableData, error: tableError } = await supabase
            .from(config.table)
            .select('type, date, category, client_id,image_url,subcategory,tsf7,tsf8,rainfall')
            .gte('date', formData.startDate)
            .lte('date', formData.endDate)
            .eq('subcategory', 'MNDWI')
            .eq('client_id', formData?.clientID);

        if (tableError) throw tableError;

        // Get signed URLs for private bucket access
        const dataWithUrls = await Promise.all(
            (tableData || []).map(async (item) => {
                if (item.image_url) {
                    const { data, error } = await supabase.storage
                        .from(config.bucket)
                        .createSignedUrl(item.image_url, 3600); // expires in 1 hour

                    return {
                        ...item,
                        fullImageUrl: data?.signedUrl || null
                    };
                }
                return { ...item, fullImageUrl: null };
            })
        );

        return { mndwi: dataWithUrls, files: [] };
    };

    //REPORT CONTENT
    const periodAdjustment = (dateVal) => {
        const dateObj = new Date(dateVal);
        if (formData.frequency === 'monthly') {
            return dateObj.toLocaleDateString('en-CA', { year: "numeric", month: "long" })
        };
        return dateVal;
    };

    const dateAdjustment = (dateVal) =>
        new Date(dateVal).toLocaleDateString('en-CA', { year: "2-digit", month: "short" });
    const latestField = (arr, prop) =>
        arr?.length ? arr[arr.length - 1][prop] : null;
    const maxField = (arr, prop) =>
        arr?.length ? Math.max(...arr.map(arr => arr[prop])) : null;
    const minField = (arr, prop) =>
        arr?.length ? Math.min(...arr.map(arr => arr[prop])) : null;
    const prevVal = (arr, prop) =>
        arr?.length ? arr[arr.length - 2][prop] : null;
    const fieldDate = (arr, prop, maxF, prop2) =>
        arr?.length ? arr.find(arr => arr[prop] === maxF)[prop2] : null;
    const getDateofMax = (data, valueFields, dateFields) => {
        if (!data || data.length === 0) return null;

        const winner = data.reduce((prev, curr) => {
            const validValues = valueFields
                .map(key => curr[key])
                .filter(v => v != null && !isNaN(v));

            const currentMax = validValues.length ? Math.max(...validValues) : -Infinity;

            if (currentMax > prev.highestValue) {
                return { highestValue: currentMax, resultDate: curr[dateFields] };
            }
            return prev;
        }, { highestValue: -Infinity, resultDate: null });

        return winner.resultDate;
    }


    /**
     * Record the report row, upload the PDF, and log the work item.
     * Shared by the slice-based export (Data Quality / InSAR) and the per-page
     * export (Comprehensive), so the two can't drift apart.
     */
    const persistReport = async (pdfBlob, { title, description, cleanFileName }) => {
        const fileSizeInBytes = pdfBlob.size;
        const fileSizeInKB = (fileSizeInBytes / 1024).toFixed(2);
        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
        const formattedSize = fileSizeInBytes > 1024 * 1024 ? `${fileSizeInMB} MB` : `${fileSizeInKB} KB`;

        const { error: metadataError } = await supabase.from('reports').insert({
            title: title,
            type: formData.reportType.toLowerCase(),
            category: formData.category.toLowerCase(),
            created_at: new Date().toISOString(),
            status: 'Completed',
            client_id: formData?.clientID,
            filename: cleanFileName,
            description: description,
            generatedby: displayName,
            date: formData.endDate,
            size: formattedSize
        }).select().single();

        if (metadataError) throw metadataError;

        const { error: uploadError } = await supabase.storage.from('Reports').upload(
            cleanFileName,
            pdfBlob,
            { contentType: 'application/pdf', upsert: false }
        );

        if (uploadError) throw uploadError;

        // Work log is best-effort — a failure here must not fail the report.
        try {
            await supabase.from('work_log').insert([{
                created_at: new Date().toISOString(),
                subject: 1,
                location: siteName,
                // The LABEL, not the raw value: a custom span's value is the
                // uninformative 'custom', where the label is '2-Day'.
                category: `${freqLabel.toLowerCase()} report`,
                action: 'No action required',
                notes: `${title} has been generated`,
                submitted_by: user?.id,
                type: formData.reportType.toLowerCase(),
            }]);
        } catch (logErr) { console.warn("Failed to create work log.", logErr); }
    };

    const saveReportToSupabase = async () => {
        if (!generatedReport) return;

        // 1. Save the user's current scroll position
        const originalScrollX = window.scrollX;
        const originalScrollY = window.scrollY;

        try {
            setLoading(true);
            const config = REPORT_CONFIG[formData.reportType];
            const title = config.title;
            const description = config.description;
            const cleanFileName = `${formData?.clientID}/${fileName}`;
            const isRadarTemplate = config.template === 'RadarTemplate';

            // The Comprehensive report is composed of measured blocks, so its page
            // count is only known after layout and its pages are 1123px, not 1754.
            // The slicer below assumes a known count and a fixed page height, so it
            // cannot render this template — use the shared per-page exporter, which
            // reads the page count back off the DOM.
            // Same measured-block engine as the Comprehensive report, so the
            // same per-page exporter — the slicer below cannot render either.
            if (isTabulation) {
                // Inline the logo BEFORE the export render mounts: html2canvas
                // cannot fetch during rasterization, so a network <img> would
                // snapshot blank. Every other image in this report is already a
                // data URL — the analyst's uploads come through FileReader and
                // the seeded heatmap through urlToDataUrl.
                const logoDataUrl = await resolveFullLogo(fullClientLogo, clientLogo);
                // The appendix figures are the one thing on this page still held
                // in Supabase storage. Signed and inlined BEFORE the export
                // render mounts, for the reason the comprehensive path documents:
                // an image resolving in an effect measures at zero height, and
                // the capture would drop whole appendix pages from the PDF.
                const dailyAppendixItems = await resolveAppendixImages(
                    buildAppendixItems(dailyData?.dqpRows ?? [])
                );
                const pdfBlob = await generatePdfBlob(
                    <DailyRadarTemplate
                        data={dailyData}
                        appendixItems={dailyAppendixItems}
                        sensor={sensor}
                        reportInfo={generatedReport.info}
                        locale={dailyLocale}
                        logoSrc={logoDataUrl}
                        annotation={annotation}
                        figures={dailyFigures}
                        figureRefs={dailyFigureRefs}
                        manual={dailyManual}
                        generator={dailyGenerator}
                        // The layout AND its typed content, for the reason every
                        // other piece of state on this call is passed explicitly:
                        // this is a second, detached mount of the template, and
                        // anything it would have owned itself starts empty here.
                        layout={layout.entries}
                        layoutValues={layout.values}
                        exportMode
                    />,
                    PAGE_W
                );
                await persistReport(pdfBlob, { title, description, cleanFileName });
                window.scrollTo(originalScrollX, originalScrollY);
                setMessage('Report generated successfully!');
                return;
            }

            if (isComprehensive) {
                // Inline every async resource BEFORE the export render mounts.
                // html2canvas cannot fetch during rasterization, so a network
                // <img> would snapshot blank — and anything still resolving in an
                // effect measures at zero height, which silently drops pages from
                // the PDF. The template resolves nothing on its own from here.
                const logoDataUrl = await urlToDataUrl(clientLogo);
                const appendixItems = await resolveAppendixImages(
                    buildAppendixItems(comprehensiveData?.dqpRows ?? [])
                );
                const pdfBlob = await generatePdfBlob(
                    <ComprehensiveRadarTemplate
                        data={comprehensiveData}
                        sensor={sensor}
                        reportInfo={generatedReport.info}
                        logoSrc={logoDataUrl}
                        annotation={annotation}
                        appendixItems={appendixItems}
                        layout={layout.entries}
                        layoutValues={layout.values}
                        exportMode
                    />,
                    PAGE_W
                );
                await persistReport(pdfBlob, { title, description, cleanFileName });
                window.scrollTo(originalScrollX, originalScrollY);
                setMessage('Report generated successfully!');
                return;
            }

            // Calculate Radar Pages dynamically
            const appendixCount = isRadarTemplate ? processedRadarData.filter(item => item.notes && (item.images?.length || item.appendix)).length : 0;
            const itemsPerPage = 2;
            const appendixPages = Math.ceil(appendixCount / itemsPerPage);
            const radarTotalPages = 2 + (appendixPages > 0 ? appendixPages : 0); // Page 1 + Page 2 + Appendix Pages

            const pdfWidth = isRadarTemplate ? 1240 : 1280;
            const pageHeight = isRadarTemplate ? 1754 : 720;
            const totalPages = isRadarTemplate ? radarTotalPages : 5;
            const pdfHeight = pageHeight * totalPages; // 3369 or 3600
            const orientation = isRadarTemplate ? 'portrait' : 'landscape';

            // Load scripts if needed
            if (typeof window.html2pdf === 'undefined') {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                    script.onload = resolve;
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }

            // Also load html2canvas and jsPDF separately for manual control
            const loadScript = (src) => new Promise((resolve, reject) => {
                if (document.querySelector(`script[src="${src}"]`)) return resolve();
                const s = document.createElement('script');
                s.src = src;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });

            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
            await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

            window.scrollTo(0, 0);

            // 3. CONTAINER — visible, at true 0,0, on top of everything
            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = `${pdfWidth}px`;
            container.style.zIndex = '99999';
            container.style.backgroundColor = '#ffffff';
            container.style.margin = '0';
            container.style.padding = '0';
            document.body.insertBefore(container, document.body.firstChild);

            const root = createRoot(container);
            const TemplateComponent = config.template === 'RadarTemplate' ? RadarTemplate : InsarTemplate;

            root.render(
                <TemplateComponent
                    data={isRadarTemplate ? processedRadarData : generatedReport.data}
                    reportInfo={generatedReport.info}
                    exportMode={true}
                    sensor={sensor}
                />
            );

            await new Promise(resolve => setTimeout(resolve, 2500));

            // Measure after render
            const contentHeight = container.scrollHeight || pdfHeight;
            console.log('Measured contentHeight:', contentHeight); // Debug this

            // 4. CAPTURE EACH PAGE SEPARATELY with html2canvas
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({
                unit: 'mm',
                format: isRadarTemplate ? 'a4' : [338.7, 190.5],
                orientation: orientation,
                compress: true
            });

            const undoBaselineFix = applyHtml2CanvasBaselineFix();
            try {
                for (let i = 0; i < totalPages; i++) {
                    const yOffset = i * pageHeight;

                    const canvas = await window.html2canvas(container, {
                        scale: 1.5,
                        useCORS: true,
                        logging: false,
                        backgroundColor: '#ffffff',
                        windowWidth: pdfWidth,
                        windowHeight: contentHeight,
                        width: pdfWidth,
                        height: pageHeight,
                        x: 0,
                        y: yOffset,
                        scrollX: 0,
                        scrollY: 0,
                    });

                    const imgData = canvas.toDataURL('image/jpeg', 0.92);

                    // Page dimensions in mm
                    const mmWidth = pdf.internal.pageSize.getWidth();
                    const mmHeight = pdf.internal.pageSize.getHeight();

                    if (i > 0) pdf.addPage();
                    pdf.addImage(imgData, 'JPEG', 0, 0, mmWidth, mmHeight);

                    // --- [NEW] ADD PAGE NUMBER ---
                    pdf.setFontSize(8);
                    pdf.setTextColor(128); // Gray color
                    const pageNumText = `Page ${i + 1} of ${totalPages}`;
                    const textX = mmWidth - 15; // 15mm from the right edge
                    const textY = mmHeight - 10; // 10mm from the bottom edge
                    pdf.text(pageNumText, textX, textY, { align: 'right' });
                }
            } finally {
                undoBaselineFix();
            }

            // Output as blob
            const pdfBlob = pdf.output('blob');

            // 5. CLEANUP
            root.unmount();
            document.body.removeChild(container);
            window.scrollTo(originalScrollX, originalScrollY);

            await persistReport(pdfBlob, { title, description, cleanFileName });

            setMessage('Report generated successfully!');

        } catch (error) {
            console.error('Error:', error);
            setMessage(`Error: ${error.message}`);
            // Restore scroll even on error
            window.scrollTo(originalScrollX, originalScrollY);
        } finally {
            setLoading(false);
        }
    };

    const handleGenerateReport = async () => {
        const isManual = !sensor;
        const conditionalMessage = !isManual ? !formData.frequency || !formData.startDate || !formData.endDate : !formData.frequency || !formData.startDate || !formData.endDate || !formData?.clientID;
        if (conditionalMessage) return setMessage('Please select the required fields');
        if (invalidDateRange) return setMessage('Start Date must be on or before End Date.');

        setLoading(true);
        setMessage('');
        try {
            if (formData.reportType === 'Radar') {
                if ((isComprehensive && comprehensiveLoading) || (isTabulation && dailyLoading)) {
                    setMessage('Still gathering report data — try again in a moment.');
                    setLoading(false);
                    return;
                }
                setGeneratedReport({
                    data: radarData || [],
                    info: {
                        generatedBy: displayName,
                        type: formData.reportType,
                        category: formData.category,
                        frequency: freqLabel,
                        period: `${periodAdjustment(formData.startDate)} to ${periodAdjustment(formData.endDate)}`,
                        site: completeSiteName,
                        company: company
                    }
                });
                setShowPreview(true);
                setLoading(false);
                return;
            }
            setMessage('Fetching data...');
            const fetchedData = await fetchDataFromSupabase();



            const highestRainfall = maxField(fetchedData.mndwi, 'rainfall');
            const lowestRainfall = minField(fetchedData.mndwi, 'rainfall');
            const currRainfall = latestField(fetchedData.mndwi, 'rainfall');
            const rainfallStatus = currRainfall === highestRainfall ? `(Highest in last ${fetchedData.mndwi.length} months)` :
                currRainfall === lowestRainfall ? `(Lowest in last ${fetchedData.mndwi.length} months)` : null;
            const currTSF7 = latestField(fetchedData.mndwi, 'tsf7');
            const currTSF8 = latestField(fetchedData.mndwi, 'tsf8');
            const prevTSF7 = prevVal(fetchedData.mndwi, 'tsf7');
            const prevTSF8 = prevVal(fetchedData.mndwi, 'tsf8');
            const tsfStatus = (curr, prev) =>
                curr === 0 ? 'Dry. No significant surface water detected' :
                    curr > prev ? 'Increasing. Water surface area has increased' :
                        curr < prev ? 'Decreasing. Water surface area has decreased' : null;
            const tsf7Status = tsfStatus(currTSF7, prevTSF7);
            const tsf8Status = tsfStatus(currTSF8, prevTSF8);
            const highesttsf7 = maxField(fetchedData.mndwi, 'tsf7');
            const highesttsf8 = maxField(fetchedData.mndwi, 'tsf8');
            const highestArea = Math.max(highesttsf7, highesttsf8);
            const highestRainfallDate = fieldDate(fetchedData.mndwi, 'rainfall', highestRainfall, 'date');
            const highestAreaDate = getDateofMax(fetchedData.mndwi, ['tsf7', 'tsf8'], 'date');

            setGeneratedReport({
                data: fetchedData,
                info: {
                    generatedBy: displayName,
                    type: formData.reportType,
                    category: formData.category,
                    frequency: freqLabel,
                    period: `${periodAdjustment(formData.startDate)} to ${periodAdjustment(formData.endDate)}`,
                    latest: latestField(fetchedData.mndwi, 'date'),
                    rainfall: currRainfall,
                    rainfallStatus: rainfallStatus,
                    highestRainfall: highestRainfall,
                    highestRainfallDate: dateAdjustment(highestRainfallDate),
                    highestAreaDate: dateAdjustment(highestAreaDate),
                    tsf7: currTSF7,
                    tsf8: currTSF8,
                    tsf7Status: tsf7Status,
                    tsf8Status: tsf8Status,
                    highestArea: highestArea,
                    site: completeSiteName,
                    company: company
                }
            });
            setMessage('');
            setShowPreview(true);
        } catch (error) {
            setMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleSavePDF = async () => {
        if (!generatedReport) return;
        setLoading(true);
        setMessage('Generating PDF...');
        try {
            await saveReportToSupabase(generatedReport.data);
            setTimeout(() => onClose(), 2000);
        } catch (error) {
            setMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const previewReady = showPreview && generatedReport;

    return (
        <div
            className="w-full z-[9999] h-full bg-[var(--dtg-gray-900)]/40 backdrop-blur-sm fixed top-0 left-0 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="flex flex-col w-full max-w-[1700px] h-[93vh] bg-[var(--dtg-bg-card)] border border-[var(--dtg-border-medium)] rounded-lg shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Title bar — spans both panes, so the report's name is stated
                    once rather than repeated over each of them. */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--dtg-border-medium)] shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <FileText className="text-[var(--dtg-primary-teal-dark)] shrink-0" size={22} />
                        <h2 className="text-lg font-semibold text-[var(--dtg-gray-900)] truncate">
                            {previewReady ? `Preview — ${fileName}` : 'Create New Report'}
                        </h2>
                    </div>
                    <button onClick={onClose} aria-label="Close"><X size={22} /></button>
                </div>

                {/* Config left, paper right.
                    `min-h-0` on the row and `overflow-y-auto` on each pane is what
                    lets the two scroll INDEPENDENTLY — without it the flex children
                    take their content height and the whole modal scrolls as one,
                    which is the layout this replaced: the controls scrolled away
                    the moment you looked at page three. */}
                <div className="flex flex-1 min-h-0">
                    <aside className="w-[430px] shrink-0 border-r border-[var(--dtg-border-medium)] overflow-y-auto p-4 space-y-4">
                        {/* Client Selection */}
                        {!sensor && (
                            <div>
                                <label className="text-[var(--dtg-gray-700)] block mb-1 text-sm">Client / Site *</label>
                                <select
                                    required
                                    value={formData?.clientID}
                                    onChange={(e) => handleInputChange('clientID', e.target.value)}
                                    className="w-full text-[var(--dtg-gray-500)] px-3 py-2 border border-[var(--dtg-gray-300)] rounded-lg"
                                >
                                    <option value="">Select a Client</option>
                                    {/* Each site's usual report, named in the list
                                        itself — the selection changes the moment
                                        one is picked, so saying which report that
                                        will be BEFORE the click is what stops the
                                        change reading as the form losing state. */}
                                    {clientsList.map((client) => {
                                        const usual = siteDefaults.forSite(client.id)?.category;
                                        return (
                                            <option key={client.id} value={client.id}>
                                                {client.site_name}, {client.company}
                                                {usual ? ` — ${usual}` : ''}
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label htmlFor="reportTypeSelect" className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-1">Report Type</label>
                                <select id="reportTypeSelect" value={formData.reportType} onChange={(e) => handleInputChange('reportType', e.target.value)} className="w-full text-[var(--dtg-gray-500)] px-3 py-2 border border-[var(--dtg-gray-300)] rounded-lg">{reportTypes.map(t => <option key={t} value={t}>{t}</option>)}</select>
                            </div>
                            <div>
                                <label htmlFor="reportCategorySelect" className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-1">Category</label>
                                <select id="reportCategorySelect" value={formData.category} onChange={(e) => handleInputChange('category', e.target.value)} className="w-full text-[var(--dtg-gray-500)] px-3 py-2 border border-[var(--dtg-gray-300)] rounded-lg">{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
                            </div>
                        </div>

                        {/* What this client usually takes. Under the two selects
                            it describes, and above Frequency, which it also sets. */}
                        <SiteDefaultControl
                            siteName={siteName}
                            siteDefault={siteDefault}
                            matches={onSiteDefault}
                            hasSite={Boolean(formData.clientID)}
                            available={siteDefaults.available}
                            status={siteDefaults.status}
                            frequencyLabels={FREQUENCY_LABELS}
                            customFrequency={CUSTOM_FREQUENCY}
                            onSave={() => siteDefaults.save(formData.clientID, formData)}
                            onClear={() => siteDefaults.clear(formData.clientID)}
                        />

                        <div>
                            <label className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-2"><Calendar size={16} className="inline mr-2" />Frequency</label>
                            <div className="grid grid-cols-2 gap-2">
                                {frequencies.map(freq => (
                                    <button key={freq.value} type="button" onClick={() => handleInputChange('frequency', freq.value)} className={`px-3 py-2 text-sm rounded-lg border-2 transition-colors ${formData.frequency === freq.value ? 'border-[var(--dtg-primary-teal-dark)] bg-teal text-[var(--dtg-primary-teal-dark)]' : 'border-[var(--dtg-gray-300)] text-[var(--dtg-gray-500)] hover:border-gray-400'}`} disabled={loading}>
                                        {freq.label || 'Unknown'}
                                    </button>
                                ))}
                            </div>
                            {/* The span itself, revealed only by Custom — an always-visible
                                Days field would read as if it governed the presets too. */}
                            {isCustomFrequency && (
                                <div className="mt-3 flex items-center gap-2 flex-wrap">
                                    <label htmlFor="customDays" className="text-sm text-[var(--dtg-gray-700)]">Window length</label>
                                    <input
                                        id="customDays"
                                        type="number"
                                        min={MIN_CUSTOM_DAYS}
                                        max={MAX_CUSTOM_DAYS}
                                        step={1}
                                        value={formData.customDays}
                                        /* Kept raw while typing so the field can be cleared and
                                           retyped; clamped on blur and again wherever it is read,
                                           so a half-typed value never reaches the query. */
                                        onChange={(e) => handleInputChange('customDays', e.target.value)}
                                        onBlur={(e) => handleInputChange('customDays', clampCustomDays(e.target.value))}
                                        className="w-20 px-2 py-1.5 border border-[var(--dtg-gray-300)] rounded-lg text-[var(--dtg-gray-700)]"
                                        disabled={loading}
                                    />
                                    <span className="text-xs text-[var(--dtg-gray-500)]">
                                        days — the {windowDays * 24} h ending at the End Date
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div><label htmlFor="reportStartDate" className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-1">Start Date</label><input id="reportStartDate" type="date" value={formData.startDate} onChange={(e) => handleInputChange('startDate', e.target.value)} className={`w-full px-3 py-2 border rounded-lg ${invalidDateRange ? 'border-red-500' : 'border-[var(--dtg-gray-300)]'}`} /></div>
                            <div><label htmlFor="reportEndDate" className="block text-sm font-medium text-[var(--dtg-gray-700)] mb-1">End Date</label><input id="reportEndDate" type="date" value={formData.endDate} onChange={(e) => handleInputChange('endDate', e.target.value)} className={`w-full px-3 py-2 border rounded-lg ${invalidDateRange ? 'border-red-500' : 'border-[var(--dtg-gray-300)]'}`} /></div>
                        </div>

                        {/* Says WHY the button is dead — a disabled control with no
                            reason reads as a broken one. */}
                        {invalidDateRange && <p className="text-sm text-red-600">Start Date must be on or before End Date.</p>}
                        {previewWindow && (
                            <p className="text-xs text-[var(--dtg-gray-500)]">
                                Covers <span className="font-medium text-[var(--dtg-gray-700)]">{formatWindowBound(previewWindow.windowStart)}</span>
                                {' → '}
                                <span className="font-medium text-[var(--dtg-gray-700)]">{formatWindowBound(previewWindow.windowEnd)}</span>
                                {reportTimeZone ? ` (${reportTimeZone})` : ' (UTC)'}
                                {formData.endDate >= todayDay ? ` — the latest ${windowDays * 24} h.` : ' — a closed period.'}
                            </p>
                        )}

                        {/* The section layout. Above the figure controls because it
                            decides what the report CONTAINS, and those decide what
                            goes in it. Editable before a preview exists — a layout
                            belongs to the site, not to this report. */}
                        <ReportLayoutEditor layout={layout} category={formData.category} />

                        {/* Figure and annotation controls. Only meaningful once
                            there is a report under them, so they appear with it. */}
                        {previewReady && isComprehensive && (
                            <AnnotationToolbar annotation={annotation} label="Deformation figure" />
                        )}
                        {previewReady && isTabulation && (
                            <DailyReportToolbar
                                showAnalysis={dailyNeedsAnalysis}
                                outstanding={dailyOutstanding}
                                notice={dailyGenerator.error}
                                annotation={annotation}
                                figures={dailyFigures}
                                stationFill={
                                    formData.clientID
                                        ? {
                                            siteId: formData.clientID,
                                            // The SAME granularity the rest of the
                                            // report resolves its window from, so a
                                            // weekly edition summarises its seven days
                                            // without this path knowing it is weekly.
                                            frequency: resolvedFrequency,
                                            endDate: formData.endDate,
                                            timeZone: reportTimeZone,
                                            locale: dailyLocale,
                                            onFill: (lines) => {
                                                if (!lines) return;
                                                setDailyManual((prev) => ({
                                                    ...prev,
                                                    weather: lines.weather ?? prev.weather,
                                                    fog: lines.fog ?? prev.fog,
                                                    rainfall: lines.rainfall ?? prev.rainfall,
                                                }));
                                            },
                                        }
                                        : null
                                }
                            />
                        )}

                        {message && (
                            <div className={`p-3 text-sm rounded-lg ${message.includes('successfully') ? 'bg-green-50 text-green-800' :
                                message.includes('Error') ? 'bg-red-50 text-red-800' :
                                    'bg-blue-50 text-blue-800'
                                }`}>
                                {message}
                            </div>
                        )}

                        <div className="flex gap-2 pt-1 border-t border-[var(--dtg-border-medium)]">
                            <button onClick={onClose} className="px-4 py-2 border border-[var(--dtg-gray-300)] text-[var(--dtg-gray-500)] rounded-lg">Cancel</button>
                            <button
                                onClick={handleGenerateReport}
                                disabled={loading || !formData.startDate || invalidDateRange}
                                className="flex-1 px-4 py-2 border-2 border-[var(--dtg-primary-teal-dark)] text-[var(--dtg-primary-teal-dark)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Loading...' : previewReady ? 'Refresh preview' : 'Preview Report'}
                            </button>
                        </div>

                        {previewReady && (
                            <button
                                onClick={handleSavePDF}
                                // A report missing its observations must not reach a
                                // client. Says WHY it is dead in the label — a
                                // disabled control with no reason reads as broken.
                                disabled={loading || (isTabulation && dailyOutstanding.length > 0)}
                                className="w-full px-4 py-2 bg-teal-600 text-[var(--dtg-text-primary)] rounded-lg hover:bg-teal-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading
                                    ? 'Generating PDF...'
                                    : isTabulation && dailyOutstanding.length > 0
                                        ? `Fill in: ${dailyOutstanding.join(', ')}`
                                        : 'Generate & Save PDF'}
                            </button>
                        )}
                    </aside>

                    {/* The paper. Dark ground so the A4 sheets read as sheets, which
                        is also the background DailyReportToolbar was drawn against. */}
                    <section className="flex-1 min-w-0 overflow-auto bg-[#0b0e11] p-4">
                        {previewReady ? (
                            <ReportTemplateRenderer
                                reportType={formData.reportType}
                                category={formData.category}
                                data={isRadar ? processedRadarData : generatedReport.data}
                                reportInfo={generatedReport.info}
                                sensor={sensor}
                                comprehensiveData={comprehensiveData}
                                logoSrc={clientLogo}
                                annotation={annotation}
                                imageRef={imageRef}
                                dailyData={dailyData}
                                dailyLocale={dailyLocale}
                                dailyFigures={dailyFigures}
                                dailyFigureRefs={dailyFigureRefs}
                                dailyManual={dailyManual}
                                onDailyManualChange={handleManualChange}
                                dailyGenerator={dailyGenerator}
                                dailyLogo={dailyLogo}
                                onDailyLogoError={() => setFullLogoMissing(true)}
                                layout={layout.entries}
                                layoutValues={layout.values}
                            />
                        ) : (
                            <div className="h-full flex items-center justify-center text-center px-6">
                                <p className="text-sm text-white/45 max-w-sm leading-relaxed">
                                    Set the window on the left, then <span className="text-white/70">Preview Report</span>.
                                    Section changes then show up here as you make them.
                                </p>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}
