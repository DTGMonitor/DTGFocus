/**
 * Reading images off a clipboard or a drag.
 *
 * A ClipboardEvent's `clipboardData` and a DragEvent's `dataTransfer` are the
 * same DataTransfer shape, so one set of readers serves paste and drop alike.
 * Three copies of `firstImageFile` had grown up independently (the report
 * annotation hook, the daily-figures hook and the report layout editor); this
 * is that function, kept in one place so every upload surface agrees on what
 * counts as a pasted image.
 *
 * Two details that are easy to get wrong:
 *
 * 1. `items` and `files` overlap but neither is always complete. A screenshot
 *    from the OS snipping tool arrives only as an `items` entry in some
 *    browsers, while other sources may fill only `files`. Chrome fills BOTH
 *    with the same image, so they are alternatives, never added together.
 * 2. `getAsFile()` is only valid synchronously inside the event handler. Any
 *    caller that awaits before reading must read here first and await after.
 */

/** Every image on a DataTransfer / ClipboardData, in the order offered. */
export function imageFilesFrom(source) {
  const isImage = (file) => Boolean(file && file.type?.startsWith('image/'));

  // `items` and `files` are two views of the SAME payload, not two payloads.
  // Chrome lists a pasted screenshot in both, and each access mints a fresh
  // File whose `lastModified` is the moment of access — so the pair cannot be
  // de-duplicated by identity, and reading both doubles every paste. Read
  // `items` (the superset: it is the only place a snipping-tool paste appears
  // in some browsers) and fall back to `files` only when it yielded nothing.
  const fromItems = [];
  for (const item of source?.items ?? []) {
    if (item.kind === 'file' && item.type?.startsWith('image/')) {
      const file = item.getAsFile();
      if (isImage(file)) fromItems.push(file);
    }
  }
  if (fromItems.length) return fromItems;

  return Array.from(source?.files ?? []).filter(isImage);
}

/** First image on a DataTransfer / ClipboardData, or null. */
export function firstImageFile(source) {
  return imageFilesFrom(source)[0] ?? null;
}

/**
 * Does this clipboard carry text as well as (or instead of) an image?
 *
 * Used to decide whether a paste landing in a text field belongs to the field.
 * Copying a cell out of Excel puts BOTH a bitmap and the cell's text on the
 * clipboard, so an image-hungry paste handler would hijack an ordinary paste
 * into a notes box and drop a spreadsheet screenshot into the figure list.
 */
export function hasPlainText(source) {
  const types = source?.types;
  if (!types) return false;
  // `types` is a DOMStringList on some engines and a plain array on others.
  for (const type of types) {
    if (type === 'text/plain' || type === 'text/html') return true;
  }
  return false;
}

/**
 * Is this event's target something the user is typing into?
 *
 * `isContentEditable` covers rich-text hosts; the tag check covers the ordinary
 * inputs. A file input is deliberately NOT in this list — it takes no text, so
 * a paste over one is meant for the upload.
 */
export function isTextEntryTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.isContentEditable) return true;
  const el = target.closest('input, textarea');
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  return type !== 'file' && type !== 'checkbox' && type !== 'radio' && type !== 'button';
}

/**
 * Marks an element as owning the pastes that happen inside it.
 *
 * A page can hold several independent upload targets (the daily report has a
 * scan area and N analysis areas; the site modal has two logo slots). A paste
 * into one of them also bubbles to any document-level listener, which would
 * read the same image and drop it into a second target as well. A zone stamps
 * this attribute and consumes the event; the document listener checks for both
 * marks and stands down.
 *
 * Kept identical to the value `useImageAnnotation` already publishes, so the
 * annotation figures and the generic zones below mark each other's pastes.
 */
export const DROPZONE_ATTR = 'data-annotation-dropzone';

/** True when the paste has already been claimed by an upload zone. */
export function pasteClaimedByZone(event) {
  if (event?.defaultPrevented) return true;
  const target = event?.target;
  return Boolean(
    target && typeof target.closest === 'function' && target.closest(`[${DROPZONE_ATTR}]`)
  );
}
