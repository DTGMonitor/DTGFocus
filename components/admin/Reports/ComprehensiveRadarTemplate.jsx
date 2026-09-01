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
 * Block order (the DEFAULT — see below):
 *   Header → Executive Summary → Key Findings → Deformation image → Deformation
 *   timeline → Data Quality → System Performance → Alarm Improvement →
 *   Procedural Updates (TARP) → Glossary → Appendix[] → Disclaimer
 *
 * That order is no longer written into the block array. Blocks are built into a
 * KEYED BAG — one key per section, matching config/reportSections.ts — and the
 * site's saved layout decides which of them print and in what order, and where
 * its own custom tables, paragraphs and image slots sit among them
 * (composeLayoutBlocks). A site with no saved layout gets exactly the order
 * above, which is the report this template has always produced.
 *
 * Unlike RadarTemplate, this destructures `reportInfo`. RadarTemplate is declared
 * ({ data, sensor, exportMode }) while both call sites pass reportInfo, so it is
 * silently dropped there — which is exactly why the author/company/site never
 * reach that PDF.
 */

import { useMemo } from 'react';

import { FALLBACK_LOGO } from '@/components/admin/Radar/report/constants';
import { ReportPages } from '@/components/admin/Radar/report/pageFrame';
import { HeaderBlock } from '@/components/admin/Radar/report/HeaderBlock';
import { useReportPagination, resolvePages, blocksAreAdjacent } from '@/components/admin/Radar/report/useReportPagination';
import { useAppendixImages, resolveAppendixImages } from '@/components/admin/Radar/report/useAppendixImages';

import { ExecutiveSummary } from '@/components/admin/Radar/report/blocks/ExecutiveSummary';
import { KeyFindings, buildKeyFindings } from '@/components/admin/Radar/report/blocks/KeyFindings';
import {
  DeformationImage,
  DeformationTimeline,
  buildTimelineChunks,
} from '@/components/admin/Radar/report/blocks/DeformationTimeline';
import { DataQuality } from '@/components/admin/Radar/report/blocks/DataQuality';
import { SystemPerformance } from '@/components/admin/Radar/report/blocks/SystemPerformance';
import { AlarmImprovements } from '@/components/admin/Radar/report/blocks/AlarmImprovements';
import { ProceduralUpdates } from '@/components/admin/Radar/report/blocks/ProceduralUpdates';
import { Glossary, AppendixItem, Disclaimer } from '@/components/admin/Radar/report/blocks/GlossaryAppendix';

import { buildStatusGroups, buildAppendixItems } from '@/utils/reportDqp';
import { chunkImprovements } from '@/utils/reportAlarmImprovements';
import { composeLayoutBlocks } from '@/components/admin/Radar/report/layoutBlocks';
import { COMPREHENSIVE_SECTIONS } from '@/config/reportSections';
import { defaultLayout, layoutSignature } from '@/utils/reportLayout';

/**
 * Re-exported: the export path in ReportTemplateModal has always imported this
 * from the template it feeds, and the resolution itself is now shared with the
 * Daily report (components/admin/Radar/report/useAppendixImages).
 */
export { resolveAppendixImages };

/** The daily edition's title, kept for callers that only ever produce that one. */
export const COMPREHENSIVE_TITLE = 'Daily Radar Reporting Services';

/**
 * The report's printed title for a given window length, in days.
 *
 * The three named granularities keep their established wording; anything else —
 * the custom spans, the two-day report this was added for — is named by its
 * length. The title is also the filename stem, so the two cannot drift.
 */
export function comprehensiveTitle(windowDays) {
  const days = Number(windowDays);
  if (!Number.isFinite(days) || days <= 0) return COMPREHENSIVE_TITLE;

  const whole = Math.round(days);
  if (Math.abs(days - whole) > 0.01) return `${days.toFixed(1)}-Day Radar Reporting Services`;
  if (whole === 1) return COMPREHENSIVE_TITLE;
  if (whole === 7) return 'Weekly Radar Reporting Services';
  if (whole === 30) return 'Monthly Radar Reporting Services';
  return `${whole}-Day Radar Reporting Services`;
}

const fmtLongDate = (d) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * The timeline's block keys. The first slice keeps the historical `def-timeline`
 * so the figure's join is asked about the same pair of blocks whether or not the
 * section is sliced at all.
 */
const timelineKey = (i) => (i === 0 ? 'def-timeline' : `def-timeline-${i}`);

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
 * @param {object[]} layout   The site's normalized layout entries
 *   (utils/reportLayout). Omitted falls back to the default order.
 * @param {object} layoutValues  This report's content for the layout's custom
 *   sections, keyed by section id. Owned by the caller for the same reason as
 *   `annotation`: the export mounts a second copy of this template, and state
 *   held here would start empty in it.
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
  layout,
  layoutValues,
}) {
  const layoutEntries = useMemo(
    () => (Array.isArray(layout) && layout.length > 0 ? layout : defaultLayout(COMPREHENSIVE_SECTIONS)),
    [layout]
  );
  const customValues = useMemo(() => layoutValues ?? {}, [layoutValues]);
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

  // Pre-chunked: the paginator never splits a block, so a long recommendation
  // table has to arrive as several. Empty when nothing was raised or resolved
  // this period, which is what drops the section entirely. Stabilised for the
  // same reason as dqpRows — a fresh `?? []` each render would re-fire the
  // pagination effect forever.
  const improvementRows = useMemo(
    () => data?.alarmImprovements?.rows ?? [],
    [data?.alarmImprovements?.rows]
  );
  const improvementChunks = useMemo(() => chunkImprovements(improvementRows), [improvementRows]);

  // Pre-chunked for the same reason: a radar with several active events produced
  // one timeline block taller than the sheet, and a block the paginator cannot
  // fit is clipped, not split — the last cards printed under the footer and the
  // rest of the section vanished. One block per chain (long chains split inside
  // themselves) lets the page break fall between cards.
  const timelineChunks = useMemo(() => buildTimelineChunks(data?.timelines ?? []), [data?.timelines]);
  // A report with no active chains still prints the section, saying so.
  const timelineBlocks = timelineChunks.length > 0 ? timelineChunks : [null];

  // Declared before the blocks: they close over bumpMeasure.
  // `annotation.image` is a dep because adding a figure changes the block's
  // height and the pages must re-pack around it.
  // The layout arrives as a SIGNATURE and not as the entries themselves: both
  // the entries and the values are new objects on every keystroke in the layout
  // editor, so passing them would re-measure the whole report on each one — and
  // passing neither would leave the page breaks describing a table that has
  // since grown a row.
  const { pages, measureRef, measureLayer, bumpMeasure } = useReportPagination([
    data, appendixItems, statusGroups, improvementChunks, annotation?.image, annotation?.boundaries,
    layoutSignature(layoutEntries, customValues),
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
  const buildBlocks = (interactive, timelineJoins) => {
    /**
     * One key per section in the catalogue, each holding EVERY block that
     * section produces this period. A section whose data is empty contributes
     * an empty array and therefore no blocks, exactly as it did when this was a
     * push-sequence — a period with no TARP change has never printed a
     * Procedural Updates heading over nothing, and switching the section on in
     * a layout must not change that.
     */
    const groups = {};

    groups.header = [
      <HeaderBlock
        key="header"
        title={comprehensiveTitle(data?.window?.days)}
        titleSuffix=""
        company={reportInfo?.company}
        siteName={reportInfo?.site ?? sensor?.site_name}
        metaItems={metaItems}
        logoSrc={logoSrc || FALLBACK_LOGO}
        onImageLoad={bumpMeasure}
      />,
    ];

    groups.executive = [
      <ExecutiveSummary
        key="kpi"
        risk={data?.risk}
        riskPresentation={data?.riskPresentation}
        quality={data?.quality}
        uptime={data?.availability?.uptimePercentage}
        alarms={data?.alarms}
        reportWindow={data?.window}
      />,
    ];

    groups.findings = [<KeyFindings key="findings" findings={findings} />];

    // The figure and the timeline are ONE section: the timeline continues the
    // figure's frame when they land on the same page, and a layout that could
    // separate them would leave a welded block with nothing above it.
    groups.deformation = [];

    if (hasImageBlock) {
      groups.deformation.push(
        <DeformationImage
          key="def-img"
          annotation={annotation}
          interactive={interactive}
          // The SAME decision in both passes. Keyed off `interactive` — as it
          // was — the hidden measurement copy drew nothing where the visible one
          // draws a drop zone, and every page was packed that much too full.
          placeholder={hasImageBlock}
          imageRef={imageRef}
          onImageLoad={bumpMeasure}
          figure={1}
        />
      );
    }

    // One block per chunk. Only the first carries the section bar and the
    // partial-resolution notice; a continuation joins the block above when the
    // paginator kept the two together, so a section broken mid-page still reads
    // as one framed timeline and one broken across a page break does not weld
    // itself to nothing.
    timelineBlocks.forEach((chunk, i) => {
      groups.deformation.push(
        <DeformationTimeline
          key={timelineKey(i)}
          chunk={chunk}
          crosscheckers={data?.crosscheckers ?? []}
          error={i === 0 ? data?.timelineError : null}
          // The image block already carried the section bar, if it rendered.
          withHeader={!hasImageBlock && i === 0}
          // Continue the frame above when the two end up on the same page, and
          // leave the frame open for the block below when it continues here.
          joinPrev={timelineJoins.has(i)}
          joinNext={timelineJoins.has(i + 1)}
          // The same instant AND horizon the chains were trimmed against.
          now={data?.timelineNow}
          recentMs={data?.timelineWindowMs}
          // Whether a card's badge quotes a TARP level or names the band.
          riskMode={data?.riskPresentation?.mode}
        />
      );
    });

    groups.dataQuality = [
      <DataQuality
        key="dq"
        radarRecord={data?.radarRecord}
        groups={statusGroups}
        appendixByParamId={appendixByParamId}
      />,
    ];

    groups.systemPerformance = [
      <SystemPerformance
        key="sysperf"
        availability={data?.availability}
        alarmCauses={data?.alarms?.causes ?? []}
        alarmFolders={data?.alarms?.byFolder ?? []}
      />,
    ];

    // Alarm improvements sit directly under System Performance BY DEFAULT: that
    // section reports what the alarms did, this one what was asked of the site
    // about them. Only when something was raised or resolved inside the window
    // — a period with no exchange gets no section at all.
    groups.alarmImprovements = improvementChunks.map((chunk, i) => (
      <AlarmImprovements
        key={`alarm-improvements-${i}`}
        rows={chunk}
        summary={data?.alarmImprovements?.summary}
        withHeader={i === 0}
        withLegend={i === improvementChunks.length - 1}
      />
    ));

    // Only when the TARP actually changed inside the window — an unchanged plan
    // gets no section at all (the block also guards this).
    groups.tarpUpdates =
      (data?.tarp?.updates?.length ?? 0) > 0
        ? [<ProceduralUpdates key="tarp-updates" tarp={data.tarp} />]
        : [];

    groups.glossary = [<Glossary key="glossary" radarNumber={sensor?.radar_number} />];

    // One block per appendix item — the paginator places them, so there is no
    // fixed items-per-page constant to drift out of sync with the export loop.
    groups.appendix = appendixItems.map((item, i) => (
      <AppendixItem
        key={`appendix-${item.letter}`}
        item={figureOffset ? { ...item, figure: item.figure + figureOffset } : item}
        onImageLoad={bumpMeasure}
        withHeader={i === 0}
      />
    ));

    groups.disclaimer = [<Disclaimer key="disclaimer" />];

    return composeLayoutBlocks({
      entries: layoutEntries,
      groups,
      values: customValues,
      onImageLoad: bumpMeasure,
    });
  };

  // Two passes: whether the timeline can continue the figure's frame depends on
  // where the paginator put it, and the paginator needs blocks to measure first.
  // The measured pass is unjoined — the join only removes a 1px border, so it
  // cannot shift the packing that decides it (no feedback loop).
  const measureBlocks = buildBlocks(false, new Set());
  const effectivePages = resolvePages(pages, measureBlocks);

  // Slice 0 joins the deformation figure above it; every later slice joins the
  // slice it continues.
  const timelineJoins = new Set(
    timelineBlocks
      .map((_, i) => i)
      .filter((i) =>
        blocksAreAdjacent(
          effectivePages,
          measureBlocks,
          i === 0 ? 'def-img' : timelineKey(i - 1),
          timelineKey(i)
        )
      )
  );

  const displayBlocks = buildBlocks(!exportMode, timelineJoins);

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
