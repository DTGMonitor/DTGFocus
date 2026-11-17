'use client';

/**
 * One pasteable upload target among several on the same screen.
 *
 * `usePasteZone` is the hook behind this, but a hook cannot be called inside a
 * `.map()` — and the surfaces that need per-target pastes are all lists: the
 * two logo slots on a site, the N figures on a DQP row, the per-area graph
 * lists on a daily report. So each item renders one of these instead.
 *
 * The wrapper is focusable, because that is what makes "paste into THIS one"
 * expressible at all: a click lands focus here and the next Ctrl+V arrives on
 * this element rather than on the document, where it could only have been
 * guessed at. A focus ring is drawn for the same reason — the user has to be
 * able to see which target their paste will land in.
 *
 * Props:
 *   onFiles   {function}  (File[]) => void. Never called with an empty list.
 *   multiple  {boolean}   false hands over only the first image.
 *   disabled  {boolean}   stops claiming pastes (e.g. mid-save).
 *   label     {string}    spoken name, used in the tooltip and for a11y.
 *   as        {string}    element to render, default 'div'.
 *   className {string}    merged after the focus-ring classes.
 */

import { usePasteZone } from '@/utils/usePasteImages';

export default function PasteZone({
  onFiles,
  multiple = true,
  disabled = false,
  label,
  as: Tag = 'div',
  className = '',
  children,
  ...rest
}) {
  const zoneProps = usePasteZone(onFiles, { multiple, disabled, label });

  return (
    <Tag
      {...zoneProps}
      aria-label={label ? `${label} — paste target` : 'Image paste target'}
      className={`rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--dtg-primary-teal-light)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dtg-bg-card)] ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
