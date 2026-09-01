'use client';

/**
 * Deformation event timeline (trimmed) + the deformation image.
 *
 * IMPORTANT — badges are NOT positional here.
 *
 * TimelineView (the live UI) derives its badges from position: `index === 0` is
 * Root, `index === chain.length - 1` is Current. That is correct for a full
 * chain and WRONG for a trimmed one — index 0 of a trimmed chain is usually the
 * context node, not the root. Reusing that logic would make the report assert
 * that a mid-chain event was the origin of the movement.
 *
 * So: Current is always the tail (the trim guarantees the tail is the current
 * node), and Root renders only when `headIsTrueRoot` says the trimmed head really
 * is chain[0].
 */

import { INK, MUTED, LINE, IMAGE_MAX_H } from '../constants';
import { severityColor, bandColor, tint } from '../severity';
import { recordColour, recordBadgeLabel } from '@/config/riskDisplay';
import { SectionBar } from '../pageFrame';
import { AnnotatedImage } from '../AnnotatedImage';
import { resolveDetectedBy } from '@/utils/tabHelpers';
import { DAY_MS } from '@/utils/reportTimeline';
import { buildEventDetails } from '@/utils/reportDefDetails';
import { groupTimelinesByFolder, folderDisplayLabel } from '@/utils/reportWallFolders';

/** Text tone for a node that is neither current nor from within the window. */
const FAINT = '#9ca3af';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The detector's display name, never a raw UUID.
 *
 * resolveDetectedBy falls back to the UUID when the lookup misses, which is
 * reasonable for the live UI but is noise on a printed page a client reads —
 * and the lookup CAN miss: the roster covers admins on shift, so a record left
 * by anyone else resolves to nothing. Belt and braces with the roster fetch in
 * useComprehensiveReportData.
 */
const detectedByName = (uuid, crosscheckers) => {
  const resolved = resolveDetectedBy(uuid, crosscheckers);
  if (!resolved || resolved === '—') return '—';
  return UUID_RE.test(resolved) ? 'Unknown' : resolved;
};

const fmtDetected = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Was this node detected within the report's "recent" horizon?
 *
 * The horizon is the report window (24h for a daily one, 48h for a two-day one),
 * supplied by the caller as `recentMs` — it MUST be the same span the chains were
 * trimmed against, or a node trimmed in as recent would print as stale. Defaults
 * to 24h for callers that predate custom spans.
 *
 * With no clock supplied nothing is muted: greying a node claims it is stale,
 * and that is not a claim to make on a guess.
 */
const isRecent = (node, now, recentMs = DAY_MS) => {
  if (!Number.isFinite(now)) return true;
  const span = Number.isFinite(recentMs) && recentMs > 0 ? recentMs : DAY_MS;
  const ms = new Date(node?.created_at).getTime();
  return Number.isFinite(ms) && ms >= now - span;
};

const Badge = ({ text, color, bg, border }) => (
  <span
    style={{
      fontSize: 8,
      fontWeight: 700,
      padding: '1px 6px',
      borderRadius: 8,
      color,
      background: bg,
      border: `1px solid ${border ?? bg}`,
      whiteSpace: 'nowrap',
    }}
  >
    {text}
  </span>
);

/**
 * One event card.
 *
 * `isLast` is per CHAIN, not per report: the rail's connector is what makes a
 * run of cards read as one continuous movement, so it must stop at the tail of
 * each chain. Drawing it under every card ran the line straight through the gap
 * between two unrelated chains and presented them as a single history.
 *
 * `muted` greys a node that is neither the current state nor from the last 24h
 * — historical context the reader should not weigh as live.
 */
function TimelineNode({ node, isCurrent, isRoot, isLast, muted, crosscheckers, riskMode }) {
  // The more severe of the deformation type's band and the record's own TARP
  // level. Neither alone is enough: a record whose site assigns no level (a rock
  // fall, a Leonora blast) still has a band from its type, and a linear trend
  // reported at TARP 4 must not print in the calmer of the two.
  // The badge follows the site — a TARP level, or the band name where the site
  // quotes no levels — and is absent when there is neither.
  const sev = bandColor(recordColour(node ?? {}));
  const badge = recordBadgeLabel(node ?? {}, riskMode);
  const dotColor = isCurrent ? sev.color : muted ? LINE : MUTED;
  const subColor = muted ? FAINT : MUTED;
  const details = buildEventDetails(node);

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {/* Rail */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 12, flexShrink: 0 }}>
        <span
          style={{
            width: isCurrent ? 9 : 7,
            height: isCurrent ? 9 : 7,
            borderRadius: '50%',
            background: isCurrent ? '#fff' : dotColor,
            border: `2px solid ${dotColor}`,
            marginTop: 5,
          }}
        />
        {!isLast ? <span style={{ flex: 1, width: 1, background: LINE, marginTop: 2 }} /> : null}
      </div>

      {/* Card */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          border: `1px solid ${isCurrent ? sev.color : LINE}`,
          background: isCurrent ? tint(sev.color, 0.08) : '#fff',
          padding: '6px 9px',
          marginBottom: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: muted ? MUTED : INK }}>{node?.def_type ?? '—'}</span>
          {/* The TARP level, or the band name at a site that quotes no levels. */}
          {badge ? (
            muted
              ? <Badge text={badge} color={MUTED} bg="#fff" border={LINE} />
              : <Badge text={badge} color={sev.onColor} bg={sev.color} />
          ) : null}
          {isRoot ? <Badge text="Root" color={MUTED} bg="#fff" border={LINE} /> : null}
          {isCurrent ? (
            <span style={{ marginLeft: 'auto' }}>
              <Badge text="Current" color={sev.onColor} bg={sev.color} />
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 9, color: subColor, marginTop: 2 }}>Location: {node?.location ?? '—'}</div>
        <div style={{ fontSize: 9, color: subColor }}>Detected: {fmtDetected(node?.created_at)}</div>
        <div style={{ fontSize: 9, color: subColor }}>
          By: {detectedByName(node?.detected_by, crosscheckers)}
        </div>

        {/* The measured numbers behind the badge — velocities for a trend, the
            event time for an occurrence, the predicted date for a forecast.
            Set on its own hairline-separated row so it reads as evidence rather
            than as more metadata. */}
        {details.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0 10px',
              marginTop: 3,
              paddingTop: 3,
              borderTop: `1px solid ${muted ? LINE : tint(sev.color, 0.25)}`,
            }}
          >
            {details.map((d) => (
              <span key={d.label} style={{ fontSize: 9, color: subColor, whiteSpace: 'nowrap' }}>
                {d.label}:{' '}
                <strong style={{ color: muted ? MUTED : INK, fontWeight: 700 }}>{d.value}</strong>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The caption that names a chain — which event it is, and where.
 *
 * Without it two chains are just two runs of cards with a gap between them —
 * indistinguishable from one chain whose spacing happened to widen. It rides on
 * the FIRST chunk of a chain only: a chain split across a page break repeats no
 * caption, the same way a continued table repeats no section bar.
 */
function ChainCaption({ index, count, location }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
      <span
        style={{
          fontSize: 8,
          fontWeight: 800,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: '#fff',
          background: MUTED,
          padding: '1px 6px',
          borderRadius: 2,
          whiteSpace: 'nowrap',
        }}
      >
        Event {index + 1} of {count}
      </span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: MUTED,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {location ?? '—'}
      </span>
      <span style={{ flex: 1, height: 1, background: LINE }} />
    </div>
  );
}

/** 'DD/MM/YYYY' from an ISO timestamp, by parts so no timezone can shift the day. */
const fmtDay = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

/**
 * The label that introduces one wall folder's chains.
 *
 * Rendered only when the report spans more than one folder (a wall-folder change
 * within the window). Because different folders can scan different locations, the
 * header keeps each folder's events attributed to it rather than fused with the
 * current folder's — the current folder is badged Current, a retired one Archived
 * with the day it was decommissioned.
 *
 * Like the chain caption, it rides on the FIRST chunk of the folder's run.
 */
function FolderHeader({ group }) {
  const { folder, isArchived } = group;
  const archivedDay = isArchived ? fmtDay(folder?.decommissioned_at) : null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
        paddingBottom: 3,
        borderBottom: `1px solid ${LINE}`,
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: INK,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {folderDisplayLabel(folder)}
      </span>
      <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
        {isArchived ? (
          <Badge text={archivedDay ? `Archived ${archivedDay}` : 'Archived'} color={MUTED} bg="#fff" border={LINE} />
        ) : (
          <Badge text="Current folder" color={MUTED} bg="#fff" border={LINE} />
        )}
      </span>
    </div>
  );
}

/**
 * Cards one block may carry before the chain it draws is split across blocks.
 *
 * A card runs ~70px at its tallest (four metadata lines plus the evidence row),
 * so eight of them plus a caption stay well inside the ~990px a page has left
 * once the footer is reserved. The paginator never splits a block, so this is
 * the only thing standing between a long chain and a card printed under the
 * footer — see useReportPagination.
 */
export const NODES_PER_TIMELINE_BLOCK = 8;

/**
 * Flatten the report's chains into block-sized chunks the paginator can place.
 *
 * The section used to be ONE block holding every chain, which the paginator
 * could only give a page to and let overflow: a radar with three active events
 * printed its last card half under the footer and lost the rest. Each chunk is
 * now its own block, so page breaks fall BETWEEN cards.
 *
 * Chunks are cut at chain boundaries first — a chain is the unit a reader
 * follows — and only a chain longer than `nodesPerBlock` is split inside itself.
 * Folder grouping is decided ONCE here, over every chain in the report, because
 * a per-block decision would see one chain and drop the folder labels the moment
 * the section was split.
 *
 * @param {Array<{trimmed: object[], headIsTrueRoot: boolean, folder?: object}>} timelines
 * @param {{nodesPerBlock?: number}} options
 * @returns {object[]} Chunk descriptors, in print order. Empty when the report
 *   has no active chains — the caller renders its own empty state.
 */
export function buildTimelineChunks(timelines = [], { nodesPerBlock = NODES_PER_TIMELINE_BLOCK } = {}) {
  const visible = (timelines ?? []).filter((t) => (t?.trimmed?.length ?? 0) > 0);
  if (visible.length === 0) return [];

  // Group by folder only when the report actually spans more than one — a radar
  // that never changed folders renders exactly as before (a flat run of chains).
  const distinctFolders = new Set(visible.map((t) => t.folder?.id ?? '—')).size;
  const sections =
    distinctFolders > 1
      ? groupTimelinesByFolder(visible, null).map((g) => ({ header: g, key: g.folderId, timelines: g.timelines }))
      : [{ header: null, key: 'flat', timelines: visible }];

  const size = Number.isFinite(nodesPerBlock) && nodesPerBlock > 0 ? nodesPerBlock : NODES_PER_TIMELINE_BLOCK;
  const chunks = [];

  sections.forEach((section, si) => {
    const lastSection = si === sections.length - 1;
    section.timelines.forEach((timeline, ti) => {
      const nodes = timeline.trimmed ?? [];
      const lastChain = ti === section.timelines.length - 1;

      for (let start = 0; start < nodes.length; start += size) {
        const slice = nodes.slice(start, start + size);
        const tail = start + slice.length >= nodes.length;
        chunks.push({
          key: `${section.key}-${ti}-${start}`,
          // Header and caption belong to the run, not to every slice of it.
          folder: ti === 0 && start === 0 ? section.header : null,
          caption: start === 0,
          index: ti,
          count: section.timelines.length,
          timeline,
          nodes: slice,
          offset: start,
          chainLength: nodes.length,
          tail,
          // Only consulted when several chunks share one box (the unpaginated
          // path). Chunks rendered as separate blocks are spaced by the page
          // frame instead — see PageSheet's BLOCK_GAP.
          gapAfter: !tail ? 0 : lastChain ? (lastSection ? 0 : 12) : 10,
        });
      }
    });
  });

  return chunks;
}

/**
 * One chunk: its folder header and chain caption if it opens a run, then the
 * slice of cards it carries.
 */
function TimelineChunkView({ chunk, gap = 0, crosscheckers, now, recentMs, riskMode }) {
  const { folder, caption, index, count, timeline, nodes, offset, chainLength, tail } = chunk;
  const current = (timeline?.trimmed ?? [])[chainLength - 1];

  return (
    <div style={{ marginBottom: gap }}>
      {folder ? <FolderHeader group={folder} /> : null}
      {caption && count > 1 ? (
        <ChainCaption index={index} count={count} location={current?.location} />
      ) : null}

      {nodes.map((node, i) => {
        // Only the chain's real tail is Current — a chunk that ends mid-chain
        // ends on an ordinary card, and its rail keeps running so the reader can
        // see the movement continues over the page break.
        const isTail = tail && i === nodes.length - 1;
        return (
          <TimelineNode
            key={node.id ?? `${offset + i}`}
            node={node}
            isCurrent={isTail}
            isRoot={offset === 0 && i === 0 && timeline?.headIsTrueRoot && chainLength > 1}
            isLast={isTail}
            muted={!isTail && !isRecent(node, now, recentMs)}
            crosscheckers={crosscheckers}
            riskMode={riskMode}
          />
        );
      })}
    </div>
  );
}

/**
 * The deformation figure, as its own block so it paginates independently.
 *
 * Wraps the shared AnnotatedImage: the analyst can drop in / replace the image
 * and draw labelled zones on it, exactly as in the Post-Blast report. The
 * annotation state is owned by the caller (see useImageAnnotation) because the
 * export mounts a second copy of this tree.
 *
 * `figure` is the document-wide figure number this image claims. It is the
 * report's first figure, so the appendix must start counting after it — see
 * ComprehensiveRadarTemplate's `figureOffset`. The caption only renders once an
 * image is actually present: an empty drop zone is not a figure, and numbering
 * it would leave the export (which drops the empty block) one ahead.
 *
 * WHETHER THE EMPTY BOX IS DRAWN IS `placeholder`, NOT `interactive`.
 *
 * The two used to be the same test, and that silently trimmed the report. Every
 * template is mounted twice — once for the analyst and once, non-interactively,
 * into the hidden layer that MEASURES the page breaks. With no image uploaded,
 * the measured copy rendered nothing at all while the visible copy rendered a
 * ~190px drop zone, so the paginator packed each page ~190px too full and the
 * last block on it printed under the footer. Geometry may never depend on
 * `interactive`; the caller passes the SAME `placeholder` to both passes (see
 * ComprehensiveRadarTemplate's `hasImageBlock`).
 */
export function DeformationImage({
  annotation,
  interactive = false,
  // Defaulted to `interactive` only so a caller that predates the split behaves
  // as it did. Every caller inside these reports passes it explicitly.
  placeholder = interactive,
  imageRef,
  onImageLoad,
  figure = 1,
  caption = 'Deformation overview.',
}) {
  if (!annotation?.image && !placeholder) return null;
  return (
    <div>
      <SectionBar title="Deformation / Event" />
      <div style={{ border: `1px solid ${LINE}`, borderTop: 'none', padding: 6 }}>
        <AnnotatedImage
          image={annotation?.image}
          boundaries={annotation?.boundaries}
          draft={annotation?.draft}
          interactive={interactive}
          imageRef={imageRef}
          onDrop={annotation?.handleDrop}
          onPaste={annotation?.handlePaste}
          onImageClick={(e) => annotation?.addPoint(e, imageRef?.current)}
          onImageLoad={onImageLoad}
          onLabelMove={annotation?.moveLabel}
          maxHeight={IMAGE_MAX_H}
          emptyHint="Drag, drop or paste (Ctrl+V) the deformation image here, or use “Upload image”."
        />
        {annotation?.image ? (
          <div style={{ fontSize: 8, fontStyle: 'italic', color: MUTED, marginTop: 3, textAlign: 'left' }}>
            <strong>Figure {figure}. </strong>
            {caption}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @param {{chain: object[], trimmed: object[], headIsTrueRoot: boolean}[]} timelines
 *   Every chain in the report. Ignored when `chunk` is given.
 * @param {object|null} chunk   ONE chunk from buildTimelineChunks — the block
 *   form. A section long enough to outrun a page arrives as several blocks, each
 *   drawing its own slice, because the paginator clips a block it cannot fit
 *   rather than splitting it. Omitted renders every chain in one box, which is
 *   what this block did before it learned to split.
 * @param {object[]} crosscheckers
 * @param {string|null} error   Partial-resolution notice. Print it on the FIRST
 *   chunk only; repeating it once per block would read as several failures.
 * @param {boolean} withHeader  Render the section bar (false when the image block already did).
 * @param {boolean} joinNext    The NEXT block continues this one on the same
 *   page: drop the bottom border so the two read as one frame. Like `joinPrev`
 *   this is only knowable after pagination, so the caller resolves it from the
 *   packed pages — see ComprehensiveRadarTemplate.
 * @param {boolean} joinPrev    This block sits directly under the image block on the
 *   same page: drop the top border so the two boxes read as one framed section
 *   rather than two stacked ones with a seam between them. The page frame closes
 *   the gap to match — see PageSheet. The caller can only know this AFTER
 *   pagination, so it must not be assumed here.
 * @param {number} now          The instant the chains were trimmed against
 *   (data.timelineNow). Passed in rather than read from the clock here: a
 *   render must be pure, and trimming and muting have to share one clock or a
 *   node can be trimmed in as recent and then printed as stale.
 * @param {number} recentMs     The horizon the chains were trimmed against
 *   (data.timelineWindowMs — the report window, so a two-day report keeps two
 *   days of precursors legible). Same reasoning as `now`: it must match what
 *   trimChain was given. Omitted falls back to 24h.
 * @param {string} riskMode     The site's risk wording (config/riskDisplay.ts),
 *   which decides whether a card's badge quotes a TARP level or names the band.
 *   Omitted defaults to the DTG standard, the TARP level.
 */
export function DeformationTimeline({
  timelines = [],
  chunk = null,
  crosscheckers = [],
  error = null,
  withHeader = false,
  joinPrev = false,
  joinNext = false,
  now = null,
  recentMs = DAY_MS,
  riskMode = 'tarp',
}) {
  const chunks = chunk ? [chunk] : buildTimelineChunks(timelines);

  return (
    <div>
      {withHeader ? <SectionBar title="Deformation / Event" /> : null}
      {/* Longhand borders, not `border` + a `borderTop` override: the shorthand
          only loses to the longhand by declaration order, which is a property
          of object key order — too subtle to rest a frame on. */}
      <div
        style={{
          borderLeft: `1px solid ${LINE}`,
          borderRight: `1px solid ${LINE}`,
          // The block below continues this one on the same page: closing the
          // edge would rule a line between two chains that the section never
          // drew when it was a single box.
          borderBottom: joinNext ? 'none' : `1px solid ${LINE}`,
          // The section bar or the figure above already closes this edge.
          borderTop: withHeader || joinPrev ? 'none' : `1px solid ${LINE}`,
          padding: '8px 10px',
        }}
      >
        {error ? (
          <div style={{ fontSize: 9, color: severityColor('sub-optimal').color, marginBottom: 6, fontWeight: 600 }}>
            {error}
          </div>
        ) : null}

        {chunks.length === 0 ? (
          <div style={{ fontSize: 10, color: MUTED, padding: '6px 0' }}>
            No active deformation events for this period.
          </div>
        ) : (
          chunks.map((c, ci) => (
            <TimelineChunkView
              key={c.key}
              chunk={c}
              // Spacing between chunks that share this box. The last one adds
              // none: a block is spaced from the next by the page frame.
              gap={ci < chunks.length - 1 ? c.gapAfter : 0}
              crosscheckers={crosscheckers}
              now={now}
              recentMs={recentMs}
              riskMode={riskMode}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default DeformationTimeline;
