'use client';

/**
 * Rotatable north arrow for a deformation figure.
 *
 * A radar plan view is drawn in the radar's own frame, not in map north, so the
 * bearing differs per wall folder and per scan — there is no value that could be
 * derived here. The analyst sets it, and the figure carries it, exactly as the
 * printed report does.
 *
 * Inline SVG, not an asset: html2canvas cannot fetch during rasterization, so a
 * `<img src="/icons/north.svg">` would snapshot blank into the PDF. Every colour
 * is an inline literal for the same reason.
 *
 * The rotation is applied to the NEEDLE and the ring, never to the letter — a
 * compass whose "N" prints upside down at 180° reads as a rendering fault.
 */

/**
 * @param {number} rotation  Degrees clockwise from up. 0 points to the top of
 *   the figure, which is what an un-rotated radar view means.
 * @param {number} size      Box size in px.
 * @param {string} letter    'U' (Utara) on the Indonesian path, 'N' otherwise.
 */
export function NorthArrow({ rotation = 0, size = 42, letter = 'N' }) {
  const deg = Number.isFinite(Number(rotation)) ? Number(rotation) : 0;

  return (
    <div
      style={{
        width: size,
        // The letter sits under the dial, so the box is taller than it is wide.
        height: size + 12,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        lineHeight: 1,
        pointerEvents: 'none',
      }}
      aria-label={`North arrow, ${Math.round(deg)} degrees`}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        {/* Dial. Drawn unrotated so the ring never appears to wobble. */}
        <circle cx="24" cy="24" r="21" fill="rgba(255,255,255,0.82)" stroke="#0D3036" strokeWidth="2" />
        <g transform={`rotate(${deg} 24 24)`}>
          {/* Filled half points north; the hollow half is the tail, so the
              bearing is unambiguous at a glance even in greyscale print. */}
          <polygon points="24,5 31,24 24,20 17,24" fill="#C00000" stroke="#C00000" strokeWidth="1" />
          <polygon points="24,43 17,24 24,28 31,24" fill="#ffffff" stroke="#0D3036" strokeWidth="1" />
          {/* Cardinal ticks, so a rotated dial reads as a compass and not as a
              pointer someone knocked out of true. */}
          <line x1="5" y1="24" x2="10" y2="24" stroke="#0D3036" strokeWidth="1.5" />
          <line x1="38" y1="24" x2="43" y2="24" stroke="#0D3036" strokeWidth="1.5" />
        </g>
      </svg>
      <span style={{ fontSize: 11, fontWeight: 800, color: '#0D3036', marginTop: 2 }}>{letter}</span>
    </div>
  );
}

export default NorthArrow;
