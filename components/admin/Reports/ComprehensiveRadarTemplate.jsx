'use client';

/**
 * Comprehensive Radar Report.
 *
 * Composed on the shared measured-block page frame (components/admin/Radar/report),
 * the same engine the Post-Blast report uses — NOT the fixed-page layout of the
 * Data Quality template. Sections here are variable length (deformation chains,
 * non-optimal parameters, appendices), so pages have to be discovered by
 * measurement rather than hand-placed.
 *
 * Block order:
 *   Header → Executive Summary → Key Findings → Deformation image → Deformation
 *   timeline → Data Quality → System Performance → Glossary → Appendix[] →
 *   Disclaimer
 *
 * Unlike RadarTemplate, this destructures `reportInfo`. RadarTemplate is declared
 * ({ data, sensor, exportMode }) while both call sites pass reportInfo, so it is
 * silently dropped there — which is exactly why the author/company/site never
 * reach that PDF.
 */

import { useEffect, useMemo, useState } from 'react';

import { FALLBACK_LOGO } from '@/components/admin/Radar/report/constants';
import { ReportPages } from '@/components/admin/Radar/report/pageFrame';
import { HeaderBlock } from '@/components/admin/Radar/report/HeaderBlock';
import { useReportPagination, resolvePages } from '@/components/admin/Radar/report/useReportPagination';
import { urlToDataUrl } from '@/components/admin/Radar/report/pdfExport';

import { ExecutiveSummary } from '@/components/admin/Radar/report/blocks/ExecutiveSummary';
import { KeyFindings, buildKeyFindings } from '@/components/admin/Radar/report/blocks/KeyFindings';
import { DeformationImage, DeformationTimeline } from '@/components/admin/Radar/report/blocks/DeformationTimeline';
import { DataQuality } from '@/components/admin/Radar/report/blocks/DataQuality';
import { SystemPerformance } from '@/components/admin/Radar/report/blocks/SystemPerformance';
import { Glossary, AppendixItem, Disclaimer } from '@/components/admin/Radar/report/blocks/GlossaryAppendix';

import { buildStatusGroups, buildAppendixItems } from '@/utils/reportDqp';
import { supabase } from '@/lib/supabaseClient';

export const COMPREHENSIVE_TITLE = 'Daily Radar Reporting Services';

const fmtLongDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Are two blocks (by key) directly adjacent on the same packed page?
 *
 * Blocks can only be welded into one frame when they really do touch. The
 * paginator is free to push the timeline onto the next page, where a joined
 * block would render with its top border missing and no figure above it to
 * explain why — so this is asked of the packed pages, never assumed.
 */
function blocksAreAdjacent(pages, blocks, keyA, keyB) {
  const a = blocks.findIndex((b) => b.key === keyA);
  const b = blocks.findIndex((x) => x.key === keyB);
  if (a === -1 || b === -1) return false;
  return pages.some((idxs) => {
    const pa = idxs.indexOf(a);
    return pa !== -1 && idxs[pa + 1] === b;
  });
}

/**
 * Sign each appendix image and inline it as a data URL.
 *
 * html2canvas cannot fetch during rasterization, so a remote <img> snapshots
 * blank; and the signed URL expires in an hour, which would break a long-lived
 * preview. Inlining solves both.
 *
 * Exported because the export path MUST await this before it mounts the template
 * — see `useAppendixImages`.
 */
export async function resolveAppendixImages(items) {
  return Promise.all(
    items.map(async (item) => {
      const path = item.image?.image_url;
      if (!path) return item;
      try {
        const { data } = await supabase.storage.from('Radar').createSignedUrl(path, 3600);
        if (!data?.signedUrl) return item;
        return { ...item, imageUrl: await urlToDataUrl(data.signedUrl) };
      } catch {
        return item; // A missing figure must not stop the report.
      }
    })
  );
}

/**
 * Appendix figures, resolved.
 *
 * `preResolved` is how the export path avoids a race it cannot win. Resolving in
 * an effect means the first render has `imageUrl: null` on every item, so each
 * appendix block measures at heading+prose with no figure — hundreds of px short.
 * The preview never notices, because it re-packs when the images land. The export
 * captures on a fixed timer (`waitForImages`), and signing a Supabase URL plus
 * fetching the bytes does not finish inside it — so the export rasterizes the
 * short measurement and silently loses whole pages.
 *
 * The logo and the deformation image are already pre-inlined by the caller for
 * the same reason. Appendix figures were the one async resource still resolving
 * inside the render.
 */
function useAppendixImages(items, preResolved) {
  const [resolved, setResolved] = useState(preResolved ?? items);

  useEffect(() => {
    if (preResolved) return; // Already inlined before mount; nothing to race.
    let cancelled = false;
    (async () => {
      const out = await resolveAppendixImages(items);
      if (!cancelled) setResolved(out);
    })();
    return () => { cancelled = true; };
  }, [items, preResolved]);

  return preResolved ?? resolved;
}

/**
 * @param {object} data        A useComprehensiveReportData() result payload.
 * @param {object} sensor
 * @param {object} reportInfo  { generatedBy, site, company, period, ... }
 * @param {boolean} exportMode Render every page stacked, non-interactive.
 * @param {string} logoSrc     The CLIENT's logo (clients.logo_path), not DTG's.
 * @param {object} annotation  A useImageAnnotation() bundle, owned by the caller
 *   so the uploaded image and drawn zones survive into the export render.
 * @param {object} imageRef    Ref for the annotated <img>, for click → % maths.
 * @param {object[]} appendixItems  Pre-resolved appendix items (see
 *   resolveAppendixImages). REQUIRED on the export path — without it the figures
 *   resolve after the capture and the PDF loses pages.
 */
export function ComprehensiveRadarTemplate({
  data,
  sensor,
  reportInfo,
  exportMode = false,
  logoSrc,
  annotation,
  imageRef,
  appendixItems: preResolvedAppendix,
}) {
  // Stabilised: `data?.dqpRows ?? []` would be a fresh array each render, so every
  // downstream useMemo would recompute and the pagination effect would re-fire.
  const dqpRows = useMemo(() => data?.dqpRows ?? [], [data?.dqpRows]);

  const statusGroups = useMemo(() => buildStatusGroups(dqpRows), [dqpRows]);
  const rawAppendixItems = useMemo(() => buildAppendixItems(dqpRows), [dqpRows]);
  const appendixItems = useAppendixImages(rawAppendixItems, preResolvedAppendix);

  const appendixByParamId = useMemo(() => {
    const m = new Map();
    appendixItems.forEach((i) => { if (i.parameterId != null) m.set(i.parameterId, i.letter); });
    return m;
  }, [appendixItems]);

  const findings = useMemo(() => buildKeyFindings(data), [data]);

  // Declared before the blocks: they close over bumpMeasure.
  // `annotation.image` is a dep because adding a figure changes the block's
  // height and the pages must re-pack around it.
  const { pages, measureRef, measureLayer, bumpMeasure } = useReportPagination([
    data, appendixItems, statusGroups, annotation?.image, annotation?.boundaries,
  ]);

  const metaItems = [
    { label: 'Edition', value: fmtLongDate(data?.window?.windowEnd ?? new Date()) },
    { label: 'Author', value: reportInfo?.generatedBy || '—' },
    { label: 'Sensor', value: sensor?.radar_number || '—' },
  ];

  // The figure block renders whenever there is an image OR the analyst can add
  // one (preview), so the drop zone is reachable even before an upload.
  const hasImageBlock = Boolean(annotation?.image) || !exportMode;

  // The deformation image is Figure 1 when one has actually been uploaded, so
  // the appendix figures start at 2. Keyed off the image and NOT `hasImageBlock`
  // — the block also renders as an empty drop zone in preview, and numbering
  // that would make the preview disagree with the export, which omits it.
  const figureOffset = annotation?.image ? 1 : 0;

  /**
   * Built twice, exactly as the Post-Blast report does — an interactive set for
   * the visible page and a static set for the hidden measurement layer.
   *
   * They cannot be the same array: both are mounted at once, so a single
   * interactive set would bind `imageRef` twice and the LAST mount (the hidden
   * measurement copy) would win. Every click would then be measured against an
   * off-screen element and the drawn zones would land in the wrong place.
   */
  const buildBlocks = (interactive, timelineJoinsImage) => {
    const out = [
      <HeaderBlock
        key="header"
        title={COMPREHENSIVE_TITLE}
        titleSuffix=""
        company={reportInfo?.company}
        siteName={reportInfo?.site ?? sensor?.site_name}
        metaItems={metaItems}
        logoSrc={logoSrc || FALLBACK_LOGO}
        onImageLoad={bumpMeasure}
      />,
      <ExecutiveSummary
        key="kpi"
        risk={data?.risk}
        quality={data?.quality}
        uptime={data?.availability?.uptimePercentage}
        alarms={data?.alarms}
      />,
      <KeyFindings key="findings" findings={findings} />,
    ];

    if (hasImageBlock) {
      out.push(
        <DeformationImage
          key="def-img"
          annotation={annotation}
          interactive={interactive}
          imageRef={imageRef}
          onImageLoad={bumpMeasure}
          figure={1}
        />
      );
    }

    out.push(
      <DeformationTimeline
        key="def-timeline"
        timelines={data?.timelines ?? []}
        crosscheckers={data?.crosscheckers ?? []}
        error={data?.timelineError}
        // The image block already carried the section bar, if it rendered.
        withHeader={!hasImageBlock}
        // Continue the figure's frame when the two end up on the same page.
        joinPrev={timelineJoinsImage}
        // The same instant the chains were trimmed against.
        now={data?.timelineNow}
      />
    );

    out.push(
      <DataQuality
        key="dq"
        radarRecord={data?.radarRecord}
        groups={statusGroups}
        appendixByParamId={appendixByParamId}
      />
    );

    out.push(
      <SystemPerformance
        key="sysperf"
        availability={data?.availability}
        alarmCauses={data?.alarms?.causes ?? []}
      />
    );

    out.push(<Glossary key="glossary" radarNumber={sensor?.radar_number} />);

    // One block per appendix item — the paginator places them, so there is no
    // fixed items-per-page constant to drift out of sync with the export loop.
    appendixItems.forEach((item, i) => {
      out.push(
        <AppendixItem
          key={`appendix-${item.letter}`}
          item={figureOffset ? { ...item, figure: item.figure + figureOffset } : item}
          onImageLoad={bumpMeasure}
          withHeader={i === 0}
        />
      );
    });

    out.push(<Disclaimer key="disclaimer" />);
    return out;
  };

  // Two passes: whether the timeline can continue the figure's frame depends on
  // where the paginator put it, and the paginator needs blocks to measure first.
  // The measured pass is unjoined — the join only removes a 1px border, so it
  // cannot shift the packing that decides it (no feedback loop).
  const measureBlocks = buildBlocks(false, false);
  const effectivePages = resolvePages(pages, measureBlocks);
  const timelineJoinsImage = blocksAreAdjacent(effectivePages, measureBlocks, 'def-img', 'def-timeline');
  const displayBlocks = buildBlocks(!exportMode, timelineJoinsImage);

  return (
    <>
      {/* The preview centres the sheets in the modal; the export container is
          already exactly one page wide, so the wrapper would only add margin. */}
      {exportMode ? (
        <ReportPages blocks={displayBlocks} pages={effectivePages} />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ReportPages blocks={displayBlocks} pages={effectivePages} />
        </div>
      )}

      {/* Hidden measurement layer — rendered in BOTH modes. Pagination is what
          produces the pages, so the export path needs it too; without it `pages`
          stays null and the whole report collapses onto one oversized sheet.
          It is off-screen and visibility:hidden, so it costs the export nothing. */}
      <div ref={measureRef} aria-hidden="true" style={measureLayer}>
        {measureBlocks.map((node, i) => (
          <div key={i}>{node}</div>
        ))}
      </div>
    </>
  );
}

export default ComprehensiveRadarTemplate;
