'use client';

/**
 * Daily Radar Report.
 *
 * The one-page-a-day report DTG issues to site, composed on the shared measured
 * block page frame (components/admin/Radar/report) — the same engine the
 * Post-Blast and Comprehensive reports use. Pages are DISCOVERED by measurement,
 * not hand-placed: the movement table grows with the number of monitored areas
 * and the analysis section carries however many figures and graphs the analyst
 * attached, so no fixed page layout can hold it.
 *
 * Block order:
 *   Header + cards → Summary → Scan-area figure → Movement table → Legend →
 *   Analysis figure[+ its graphs]… → Glossary intro → Glossary group[] →
 *   Appendix[]
 *
 * Two things about this report are unlike the other two:
 *
 *   1. It is written in the SITE's language. Nothing here branches on locale —
 *      every string comes from `dailyStrings(locale)` and every remark from
 *      `dailyRemark`, so adding a third language is a config change.
 *   2. It signs and disclaims EVERY page, so it replaces the page frame's footer
 *      strip and must tell the paginator how much taller its own is
 *      (DAILY_USABLE_H). Getting that wrong packs blocks under the footer.
 */

import { useMemo } from 'react';

import { FALLBACK_LOGO, DAILY_USABLE_H, IMAGE_MAX_H } from '@/components/admin/Radar/report/constants';
import { ReportPages } from '@/components/admin/Radar/report/pageFrame';
import {
  useReportPagination,
  resolvePages,
  blocksAreAdjacent,
} from '@/components/admin/Radar/report/useReportPagination';
import { useAppendixImages } from '@/components/admin/Radar/report/useAppendixImages';

import { DailyHeader } from '@/components/admin/Radar/report/blocks/DailyHeader';
import {
  DailySummary,
  DailyMovementTable,
  DailyLegend,
} from '@/components/admin/Radar/report/blocks/DailySummary';
import {
  DailyScanArea,
  DailyAnalysisImage,
  DailyAnalysisGraph,
} from '@/components/admin/Radar/report/blocks/DailyFigures';
import {
  DailyGlossaryIntro,
  DailyGlossaryGroup,
  DailyFooter,
} from '@/components/admin/Radar/report/blocks/DailyGlossary';
import { DailyAppendixItem } from '@/components/admin/Radar/report/blocks/DailyAppendix';

import {
  dailyStrings,
  dailyLongDate,
  formatDataUpdate,
  normaliseQualityTier,
  dailyRiskSentence,
  dailyQualitySummary,
  dailySubtitle,
} from '@/config/dailyReportLocale';
import { dailyGlossaryGroups } from '@/config/dailyGlossary';
import { buildAppendixItems } from '@/utils/reportDqp';
import {
  buildStatusRows,
  splitStatusRows,
  splitStatusRowsIntoBlocks,
  applyAreaRoster,
  isDataUpdateLate,
  hasActiveRisk,
} from '@/utils/dailyStatusRows';

/**
 * The stem of the report's FILENAME.
 *
 * Deliberately not the category name ("Tabulation"): the page itself is titled
 * "LAPORAN HARIAN / DAILY REPORT" and the daily email draft calls it the same,
 * so a file named after the internal category would arrive at the client under
 * a third name for one document.
 */
export const DAILY_TITLE = 'Daily Radar Report';

/**
 * Figure heights, tuned so page 1 holds the header, summary, scan figure,
 * movement table and legend — the layout of the printed report. A taller scan
 * image is not worth pushing the legend onto a second page for.
 */
const SCAN_IMAGE_MAX_H = 320;

/**
 * Block key for slice `i` of the movement table.
 *
 * The first slice keeps the key the report has always used, so the scan
 * figure's join to the table is asked about the same pair of blocks whether or
 * not the table is sliced at all.
 */
const movementKey = (i) => (i === 0 ? 'movement' : `movement-${i}`);
const ANALYSIS_IMAGE_MAX_H = Math.min(400, IMAGE_MAX_H);
const GRAPH_MAX_H = 250;

/**
 * @param {object} data      A useDailyReportData() result payload.
 * @param {object} sensor
 * @param {object} reportInfo  { generatedBy, company, site, ... }
 * @param {string} locale    'en' | 'id' — resolved from the SITE (resolveEmailLocale).
 * @param {boolean} exportMode  Render every page stacked, non-interactive.
 * @param {string} logoSrc   The CLIENT's full logo. A data URL on the export path.
 * @param {Function} onLogoError  Falls back to the LogoOnly variant.
 * @param {object} annotation  A useImageAnnotation() bundle for the scan area,
 *   owned by the caller so the image and zones survive into the export render.
 * @param {object} imageRef  Ref for the scan-area <img>, for click → % maths.
 * @param {object} figures   A useDailyFigures() bundle for the analysis areas.
 * @param {object[]} figureRefs  One ref per analysis figure, same reasoning as
 *   `imageRef` — a click has to be measured against the element it landed on.
 * @param {object} manual    { dataUpdate, weather, fog, rainfall } — analyst
 *   input, typed straight onto the page (see DailySummary's EditableValue).
 * @param {Function} onManualChange  (field, value) => void. Absent on the
 *   export path, where the page is not editable.
 * @param {object} generator  A useGeneratorRuntime() bundle for the summary's
 *   seven-day running-time strip. Owned by the caller for the same reason as
 *   `manual`: the export mounts a second copy of this template, and state held
 *   here would start empty in it.
 * @param {object[]} appendixItems  Pre-resolved appendix items (see
 *   resolveAppendixImages). REQUIRED on the export path — without it the figures
 *   resolve after the capture and the PDF loses pages.
 */
export function DailyRadarTemplate({
  data,
  sensor,
  reportInfo,
  locale = 'en',
  exportMode = false,
  logoSrc,
  onLogoError,
  annotation,
  imageRef,
  figures,
  figureRefs,
  manual,
  onManualChange,
  generator,
  appendixItems: preResolvedAppendix,
}) {
  const strings = useMemo(() => dailyStrings(locale), [locale]);
  const glossary = useMemo(() => dailyGlossaryGroups(locale), [locale]);

  // Stabilised: `data?.defRecords ?? []` would be a fresh array each render, so
  // every downstream memo would recompute and the pagination effect re-fire.
  const defRecords = useMemo(() => data?.defRecords ?? [], [data?.defRecords]);

  /**
   * The appendix — the evidence behind the day's data-quality verdict.
   *
   * Built from the SAME DQP rows the quality note is (`buildQualityNote` in the
   * data hook), through the same builder the Comprehensive report uses, so a
   * parameter that downgraded the day appears with its note and its figures in
   * both documents. Empty on a day the analyst annotated nothing, which drops
   * the section entirely — there is no heading over an empty appendix.
   */
  const dqpRows = useMemo(() => data?.dqpRows ?? [], [data?.dqpRows]);
  const rawAppendixItems = useMemo(() => buildAppendixItems(dqpRows), [dqpRows]);
  const appendixItems = useAppendixImages(rawAppendixItems, preResolvedAppendix);

  /**
   * Which movement table this radar prints — one row per active chain (the DTG
   * standard) or one row per registered monitoring point. Resolved by the data
   * hook from the radar, so the roster it fetched and the table rendered here
   * can never disagree. See config/movementTableStyle.ts.
   */
  const movementStyle = data?.movementStyle ?? 'chain';
  const areaRoster = useMemo(() => data?.areaRoster ?? [], [data?.areaRoster]);

  const rows = useMemo(() => {
    // A site that quotes no TARP numbers gets a blank column rather than a
    // level its own chart does not contain.
    const noLevelLabel = (data?.riskMode ?? 'tarp') === 'tarp' ? 'TARP 1' : '';
    const active = buildStatusRows(defRecords, {
      locale,
      riskMode: data?.riskMode ?? 'tarp',
      noLevelLabel,
    });
    if (movementStyle !== 'roster') return active;
    return applyAreaRoster(active, areaRoster, { locale, noLevelLabel });
  }, [defRecords, locale, data?.riskMode, movementStyle, areaRoster]);

  /**
   * The table's blocks.
   *
   * The chain table is ONE block, as it has always been: it is bounded by how
   * many findings are open at once and has never needed a second sheet. A
   * roster table is bounded by how many points the wall has, which the report
   * does not control — and the paginator clips a block taller than a page
   * rather than splitting it, so that one is laid out as several.
   */
  const movementBlocks = useMemo(
    () => (movementStyle === 'roster' ? splitStatusRowsIntoBlocks(rows) : [splitStatusRows(rows)]),
    [rows, movementStyle]
  );

  const analysisFigures = figures?.figures ?? [];
  const figureApis = figures?.figureApis ?? [];

  const dataUpdateLate = isDataUpdateLate(manual?.dataUpdate, data?.deadline, data?.reportDay);

  // The risk card's sub-line is the only part of the presentation that is prose
  // rather than a label, so it is the only part that translates.
  const risk = data?.riskPresentation
    ? { ...data.riskPresentation, subtitle: dailySubtitle(data.riskPresentation.subtitle, locale) }
    : null;

  const cards = {
    date: dailyLongDate(data?.reportDay ?? new Date(), locale),
    dataUpdate: formatDataUpdate(manual?.dataUpdate, data?.timeZone),
    dataUpdateLate,
    quality: data?.quality?.label ?? null,
    risk,
  };

  /**
   * A day with nothing moving has nothing to zoom into and no curve to plot, so
   * the whole Area Analysis section drops out. The modal makes the same call to
   * decide whether the section is REQUIRED before the PDF can be generated —
   * both read `hasActiveRisk`, so the section can never be demanded and hidden
   * at the same time.
   */
  const showAnalysis = hasActiveRisk(data?.riskPresentation);

  // Declared before the blocks: they close over bumpMeasure. `analysisFigures`
  // is a dep because adding a figure or a graph changes the block heights and
  // the pages have to re-pack around them.
  // `generator?.columns?.length` and not the columns themselves: the strip
  // appears when the window resolves, which changes the summary block's height,
  // but typing a figure into a cell it already has cannot.
  const { pages, measureRef, measureLayer, bumpMeasure } = useReportPagination(
    [
      data,
      rows,
      annotation?.image,
      annotation?.boundaries,
      analysisFigures,
      locale,
      generator?.columns?.length ?? 0,
      // The whole item array, not its length: the figures arrive as data URLs
      // after the first render (useAppendixImages), and a block that measured
      // at heading-height with no image would leave the pages packed short.
      appendixItems,
    ],
    { usableHeight: DAILY_USABLE_H }
  );

  // A figure block is included whenever there is an image OR the analyst can
  // still add one (preview), so the drop zone is reachable before an upload and
  // an area left empty never prints.
  //
  // Both decisions are made HERE and not inside buildBlocks, because they must
  // not depend on `interactive`. The two passes below differ only in that flag,
  // and `effectivePages` holds INDICES into the measured array — a block
  // present in one pass and absent from the other would slide every later block
  // onto the wrong page.
  const hasScanImage = Boolean(annotation?.image) || !exportMode;
  const includeFigure = (i) => showAnalysis && (Boolean(figureApis[i]?.image) || !exportMode);

  /**
   * Built twice, exactly as the Comprehensive report does — an interactive set
   * for the visible page and a static set for the hidden measurement layer.
   *
   * They cannot be the same array: both are mounted at once, so a single
   * interactive set would bind every image ref TWICE and the last mount (the
   * hidden measurement copy) would win. Every click would then be measured
   * against an off-screen element and the drawn zones would land in the wrong
   * place.
   */
  const buildBlocks = (interactive, joins) => {
    const out = [
      <DailyHeader
        key="header"
        title={strings.reportTitle}
        radarNumber={sensor?.radar_number}
        company={reportInfo?.company ?? sensor?.company}
        logoSrc={logoSrc || FALLBACK_LOGO}
        onLogoError={onLogoError}
        strings={strings}
        cards={cards}
        onImageLoad={bumpMeasure}
        editable={interactive}
        dataUpdateValue={manual?.dataUpdate}
        onDataUpdateChange={(v) => onManualChange?.('dataUpdate', v)}
      />,
      <DailySummary
        key="summary"
        strings={strings}
        deformation={dailyRiskSentence(data?.riskPresentation, locale)}
        quality={data?.quality?.label}
        qualitySummary={dailyQualitySummary(data?.quality?.label, locale)}
        qualityNote={data?.quality?.note}
        manual={manual}
        editable={interactive}
        onManualChange={onManualChange}
        generator={generator}
      />,
    ];

    if (hasScanImage) {
      out.push(
        <DailyScanArea
          key="scan"
          strings={strings}
          annotation={annotation}
          interactive={interactive}
          imageRef={imageRef}
          onImageLoad={bumpMeasure}
          maxHeight={SCAN_IMAGE_MAX_H}
        />
      );
    }

    // One block per slice of the table. Only the first carries the section bar;
    // a continuation repeats the column headers (every block renders a complete
    // table) but not the heading, which would read as a second table.
    movementBlocks.forEach((blockSplit, i) => {
      out.push(
        <DailyMovementTable
          key={movementKey(i)}
          strings={strings}
          split={blockSplit}
          withHeader={i === 0}
          joinPrev={joins.movement.has(i)}
        />
      );
    });

    out.push(
      <DailyLegend
        key="legend"
        strings={strings}
        locale={locale}
        currentQuality={normaliseQualityTier(data?.quality?.label)}
        currentRisk={data?.riskPresentation?.label ?? null}
        qualityNote={data?.quality?.note}
      />
    );

    // One block per analysis image and one per graph. Grouping an image with its
    // graphs would produce a block taller than a page as soon as an area carries
    // three curves, and the paginator never splits a block.
    analysisFigures.forEach((figure, i) => {
      if (!includeFigure(i)) return;
      const name = figure.name || strings.analysisAreaFallback(i + 1);
      const api = figureApis[i];

      out.push(
        <DailyAnalysisImage
          key={`analysis-${figure.id}`}
          strings={strings}
          api={api}
          areaName={name}
          interactive={interactive}
          imageRef={figureRefs?.[i]}
          onImageLoad={bumpMeasure}
          withHeader={i === 0}
          maxHeight={ANALYSIS_IMAGE_MAX_H}
        />
      );

      figure.graphs.forEach((graph) => {
        out.push(
          <DailyAnalysisGraph
            key={`graph-${graph.id}`}
            strings={strings}
            graph={graph}
            areaName={name}
            onImageLoad={bumpMeasure}
            joinPrev={joins.graphs.has(graph.id)}
            maxHeight={GRAPH_MAX_H}
          />
        );
      });
    });

    out.push(<DailyGlossaryIntro key="glossary-intro" strings={strings} />);
    glossary.forEach((group) => {
      out.push(<DailyGlossaryGroup key={`glossary-${group.letter}`} strings={strings} group={group} />);
    });

    // One block per appendix entry — the paginator places them, exactly as in
    // the Comprehensive report, so there is no items-per-page constant here to
    // drift out of sync with anything.
    appendixItems.forEach((item, i) => {
      out.push(
        <DailyAppendixItem
          key={`appendix-${item.letter}`}
          strings={strings}
          item={item}
          onImageLoad={bumpMeasure}
          withHeader={i === 0}
        />
      );
    });

    return out;
  };

  // Two passes: whether a block can continue the frame above it depends on where
  // the paginator put it, and the paginator needs blocks to measure first. The
  // measured pass is unjoined — a join only removes a 1px border, so it cannot
  // shift the packing that decides it (no feedback loop).
  const NO_JOINS = { movement: new Set(), graphs: new Set() };
  const measureBlocks = buildBlocks(false, NO_JOINS);
  const effectivePages = resolvePages(pages, measureBlocks);

  const joins = {
    // Slice 0 joins the scan figure above it; every later slice joins the slice
    // it continues, so a table broken mid-page reads as one table and a table
    // broken across a page break does not weld itself to nothing.
    movement: new Set(
      movementBlocks
        .map((_, i) => i)
        .filter((i) =>
          blocksAreAdjacent(
            effectivePages,
            measureBlocks,
            i === 0 ? 'scan' : movementKey(i - 1),
            movementKey(i)
          )
        )
    ),
    graphs: new Set(
      analysisFigures.flatMap((figure) =>
        figure.graphs
          .filter((graph, gi) => {
            const prevKey = gi === 0 ? `analysis-${figure.id}` : `graph-${figure.graphs[gi - 1].id}`;
            return blocksAreAdjacent(effectivePages, measureBlocks, prevKey, `graph-${graph.id}`);
          })
          .map((graph) => graph.id)
      )
    ),
  };

  const displayBlocks = buildBlocks(!exportMode, joins);

  const renderFooter = ({ pageNum, total }) => (
    <DailyFooter
      strings={strings}
      preparedBy={reportInfo?.generatedBy}
      pageNum={pageNum}
      total={total}
    />
  );

  return (
    <>
      {/* The preview centres the sheets in the modal; the export container is
          already exactly one page wide, so the wrapper would only add margin. */}
      {exportMode ? (
        <ReportPages blocks={displayBlocks} pages={effectivePages} renderFooter={renderFooter} />
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <ReportPages blocks={displayBlocks} pages={effectivePages} renderFooter={renderFooter} />
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

export default DailyRadarTemplate;
