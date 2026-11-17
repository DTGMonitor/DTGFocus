'use client';

/**
 * Ctrl+V straight into an upload.
 *
 * Every image upload in the app can be fed by pasting, because the file being
 * uploaded is nearly always a screenshot that was just taken — a snip of the
 * radar view, a graph off a vendor tool, a photo pasted out of a chat. Saving
 * it to disk purely so it can be picked back out of a file dialog is pure
 * ceremony, and it is the step people forget.
 *
 * Two shapes, because upload surfaces come in two kinds:
 *
 *   usePasteImages       one target on screen — listen on the document, so the
 *                        user can press Ctrl+V without aiming first.
 *   usePasteZone         several targets on screen — each claims only the
 *                        pastes that happen inside it. `PasteZone` wraps this
 *                        for the common case of one zone per list item, where
 *                        a hook cannot be called inside the map.
 *
 * A page may mix the two: a zone consumes its paste and marks it, and the
 * document listener stands down for anything a zone claimed (see
 * pasteClaimedByZone).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  DROPZONE_ATTR,
  hasPlainText,
  imageFilesFrom,
  isTextEntryTarget,
  pasteClaimedByZone,
} from '@/utils/clipboardImages';

/**
 * The shared decision: does this paste carry images this target should take?
 *
 * A paste into a text field is left alone whenever the clipboard also carries
 * text — copying a cell out of Excel puts both a bitmap and the cell's text on
 * the clipboard, and the user typing in the notes box meant the text. A paste
 * carrying ONLY an image is taken even from inside a field, since there is
 * nothing else it could have meant.
 */
function imagesForTarget(event, multiple) {
  const data = event?.clipboardData;
  const files = imageFilesFrom(data);
  if (!files.length) return null;
  if (isTextEntryTarget(event.target) && hasPlainText(data)) return null;
  return multiple ? files : files.slice(0, 1);
}

/**
 * Holds the latest callback without making it a dependency.
 *
 * Callers pass an inline function (`addFiles` is a plain const in most of these
 * modals), so depending on it directly would tear down and re-add the document
 * listener on every single render.
 */
function useLatest(value) {
  const ref = useRef(value);
  // Assigned in an effect, not during render: the effect commits before any
  // user event can fire, so a handler reading ref.current always sees the
  // callback from the render it was last committed with.
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Document-level paste → images, for a surface with ONE upload target.
 *
 * @param {(files: File[]) => void} onFiles  Called with at least one file.
 *   Never called with an empty list, so a caller can treat a call as "the user
 *   just added these".
 * @param {object} options
 * @param {boolean} options.enabled  Callers whose component stays mounted while
 *   its modal is CLOSED must pass their open flag. A listener left armed would
 *   swallow the user's clipboard image from anywhere in the app and drop it
 *   into an invisible form.
 * @param {boolean} options.multiple  false hands over only the first image.
 */
export function usePasteImages(onFiles, { enabled = true, multiple = true } = {}) {
  const latest = useLatest(onFiles);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return undefined;

    const handlePaste = (event) => {
      if (pasteClaimedByZone(event)) return;
      const files = imagesForTarget(event, multiple);
      if (!files) return;
      event.preventDefault();
      latest.current?.(files);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [enabled, multiple, latest]);
}

/**
 * Props for ONE upload target among several, each taking its own paste.
 *
 * Spread onto the element that should own the paste. It is made focusable so a
 * click puts the caret nowhere and the next Ctrl+V still arrives here — without
 * that, a paste with nothing focused goes to the document and no zone would
 * ever see it.
 *
 * @param {(files: File[]) => void} onFiles
 * @param {object} options
 * @param {boolean} options.multiple
 * @param {boolean} options.disabled  A zone that cannot accept a file now (mid
 *   save, say) stops claiming pastes rather than dropping them silently.
 * @param {string} options.label  Spoken name for the zone, e.g. "Site logo".
 * @returns props to spread: tabIndex, onPaste, the claim marker and a title.
 */
export function usePasteZone(onFiles, { multiple = true, disabled = false, label } = {}) {
  const latest = useLatest(onFiles);

  const onPaste = useCallback(
    (event) => {
      if (disabled) return;
      const files = imagesForTarget(event, multiple);
      if (!files) return;
      // Consumed here, and marked for any document-level listener above.
      event.preventDefault();
      event.stopPropagation();
      latest.current?.(files);
    },
    [multiple, disabled, latest]
  );

  return useMemo(
    () => ({
      [DROPZONE_ATTR]: '',
      tabIndex: disabled ? -1 : 0,
      onPaste,
      title: disabled
        ? undefined
        : `Click here, then press Ctrl+V to paste ${multiple ? 'image(s)' : 'an image'}${
            label ? ` as ${label}` : ''
          }`,
    }),
    [onPaste, disabled, multiple, label]
  );
}

export default usePasteImages;
