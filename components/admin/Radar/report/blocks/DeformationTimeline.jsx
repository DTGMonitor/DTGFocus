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
import { severityColor, tint } from '../severity';
import { SectionBar } from '../pageFrame';
import { AnnotatedImage } from '../AnnotatedImage';
import { resolveDetectedBy } from '@/utils/tabHelpers';
import { DAY_MS } from '@/utils/reportTimeline';

/** Text tone for a node that is neither current nor from the last 24h. */
const FAINT = '#9ca3af';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The detector's display name, never a raw UUID.
 *
 * resolveDetectedBy falls back to the UUID when the lookup misses, which is
 * reasonable for the live UI but is noise on a printed page a client reads —
 * and the lookup CAN miss: get_safe_crosscheckers only returns the names it is
 * asked for, so anyone outside that list resolves to nothing. Belt and braces
 * with the fetch fix in useComprehensiveReportData.
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
 * Was this node detected within the report's 24h "recent" horizon?
 *
 * With no clock supplied nothing is muted: greying a node claims it is stale,
 * and that is not a claim to make on a guess.
 */
const isRecent = (node, now) => {
  if (!Number.isFinite(now)) return true;
  const ms = new Date(node?.created_at).getTime();
  return Number.isFinite(ms) && ms >= now - DAY_MS;
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
function TimelineNode({ node, isCurrent, isRoot, isLast, muted, crosscheckers }) {
  const sev = severityColor(node?.tarp_level);
  const dotColor = isCurrent ? sev.color : muted ? LINE : MUTED;
  const subColor = muted ? FAINT : MUTED;

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
          {node?.tarp_level ? (
            muted
              ? <Badge text={node.tarp_level} color={MUTED} bg="#fff" border={LINE} />
              : <Badge text={node.tarp_level} color={sev.onColor} bg={sev.color} />
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
      </div>
    </div>
  );
}

/**
 * One chain of events, captioned when the report carries more than one.
 *
 * Without the caption two chains are just two runs of cards with a gap between
 * them — indistinguishable from one chain whose spacing happened to widen.
 */
function TimelineChain({ timeline, index, count, crosscheckers, now }) {
  const nodes = timeline?.trimmed ?? [];
  if (nodes.length === 0) return null;
  const current = nodes[nodes.length - 1];

  return (
    <div style={{ marginBottom: index < count - 1 ? 10 : 0 }}>
      {count > 1 ? (
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
            {current?.location ?? '—'}
          </span>
          <span style={{ flex: 1, height: 1, background: LINE }} />
        </div>
      ) : null}

      {nodes.map((node, i) => {
        const last = i === nodes.length - 1;
        return (
          <TimelineNode
            key={node.id ?? i}
            node={node}
            isCurrent={last}
            isRoot={i === 0 && timeline.headIsTrueRoot && nodes.length > 1}
            isLast={last}
            muted={!last && !isRecent(node, now)}
            crosscheckers={crosscheckers}
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
 */
export function DeformationImage({ annotation, interactive = false, imageRef, onImageLoad }) {
  if (!annotation?.image && !interactive) return null;
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
          onImageClick={(e) => annotation?.addPoint(e, imageRef?.current)}
          onImageLoad={onImageLoad}
          maxHeight={IMAGE_MAX_H}
          emptyHint="Drag & drop the deformation image here, or use “Upload image”."
        />
      </div>
    </div>
  );
}

/**
 * @param {{chain: object[], trimmed: object[], headIsTrueRoot: boolean}[]} timelines
 * @param {object[]} crosscheckers
 * @param {string|null} error   Partial-resolution notice.
 * @param {boolean} withHeader  Render the section bar (false when the image block already did).
 * @param {boolean} joinPrev    This block sits directly under the image block on the
 *   same page: drop the top border so the two boxes read as one framed section
 *   rather than two stacked ones with a seam between them. The page frame closes
 *   the gap to match — see PageSheet. The caller can only know this AFTER
 *   pagination, so it must not be assumed here.
 * @param {number} now          The instant the chains were trimmed against
 *   (data.timelineNow). Passed in rather than read from the clock here: a
 *   render must be pure, and trimming and muting have to share one clock or a
 *   node can be trimmed in as recent and then printed as stale.
 */
export function DeformationTimeline({
  timelines = [],
  crosscheckers = [],
  error = null,
  withHeader = false,
  joinPrev = false,
  now = null,
}) {
  const visible = timelines.filter((t) => (t.trimmed?.length ?? 0) > 0);

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
          borderBottom: `1px solid ${LINE}`,
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

        {visible.length === 0 ? (
          <div style={{ fontSize: 10, color: MUTED, padding: '6px 0' }}>
            No active deformation events for this period.
          </div>
        ) : (
          visible.map((t, ti) => (
            <TimelineChain
              key={ti}
              timeline={t}
              index={ti}
              count={visible.length}
              crosscheckers={crosscheckers}
              now={now}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default DeformationTimeline;
