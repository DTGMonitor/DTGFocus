'use client';

/**
 * Shared PDF export for block-composed reports.
 *
 * Two deliberately different paths:
 *   printLocal()      — the user's download. Vector, selectable text, via the
 *                       browser print dialog. Highest quality.
 *   generatePdfBlob() — the archive copy. Rasterized per page (html2canvas →
 *                       jsPDF) because we need a Blob to upload, which the print
 *                       dialog cannot give us.
 *
 * Both capture per `.pbr-page` element and derive the page count from the DOM.
 * This is what makes them compatible with measured pagination — the older radar
 * export in ReportTemplateModal slices one tall container at fixed y-offsets and
 * therefore needs the page count and page height known up front.
 *
 * html2canvas and jsPDF are injected from cdnjs at call time (pre-existing
 * approach, kept for consistency). This is a hard network dependency.
 */

/** Inject a CDN script once. */
export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function loadPdfScripts() {
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
  await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
}

/**
 * Correct html2canvas 1.4.1's text baseline for the duration of a capture.
 *
 * html2canvas does not ask the browser where a baseline is — it measures one,
 * per font+size, by appending a 1x1 <img> after a sample <span> and reading
 * `img.offsetTop - span.offsetTop`. That only works while the img is inline, so
 * it sits on the span's baseline. The probe sets the img's vertical-align but
 * never its display, and Tailwind's preflight says `img { display: block }` —
 * so the img drops onto its own line and the measured "baseline" comes back as
 * roughly a line-height instead of the font ascent. html2canvas then paints
 * every text run at `bounds.top + baseline`, i.e. a few px too low, scaling with
 * font size. That is the shifted-down text in the archived PDFs.
 *
 * Two things constrain the fix. The probe runs against the *main* document
 * (`new FontMetrics(document)`), so html2canvas's own `onclone` hook cannot
 * reach it — the override has to land in the real page. And the metrics cache
 * lives on the CanvasRenderer, which is rebuilt per html2canvas() call, so the
 * style must stay mounted across every call in a capture, not just the first.
 *
 * The 1x1 selector targets the probe's img (html2canvas sets width/height as
 * attributes) and no report content, which never renders a 1x1 image.
 *
 * @returns {() => void} Removes the override. Call it in a `finally`.
 */
export function applyHtml2CanvasBaselineFix() {
  const style = document.createElement('style');
  style.setAttribute('data-pbr-baseline-fix', '');
  style.textContent =
    'img[width="1"][height="1"]{display:inline!important;vertical-align:baseline!important;' +
    'max-width:none!important;height:auto!important}';
  document.head.appendChild(style);
  return () => {
    if (style.parentNode) style.parentNode.removeChild(style);
  };
}

/**
 * Fetch an image URL and return a data URL, so the export render has it decoded
 * and ready (html2canvas cannot fetch during rasterization — a network <img>
 * that hasn't finished loading snapshots blank). Falls back to the URL on error.
 */
export async function urlToDataUrl(url) {
  if (!url) return url;
  if (String(url).startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(url);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

/** Wait for layout to settle and every <img> in `root` to finish decoding. */
async function waitForImages(root, settleMs = 150) {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const imgEls = Array.from(root.querySelectorAll('img'));
  await Promise.all(
    imgEls.map((im) =>
      im.complete ? Promise.resolve() : new Promise((res) => { im.onload = res; im.onerror = res; })
    )
  );
  await new Promise((r) => setTimeout(r, settleMs));
}

/**
 * Render `pagesNode` into a hidden iframe and open the print dialog.
 * Vector output — the user picks "Save as PDF".
 *
 * @param {JSX.Element} pagesNode  Already-composed <PageSheet> elements.
 * @param {string} title           Pre-fills the print dialog's filename.
 */
export async function printLocal(pagesNode, title) {
  const { createRoot } = await import('react-dom/client');
  let iframe = null;
  let root = null;

  try {
    iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    Object.assign(iframe.style, {
      position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0',
    });
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    doc.open();
    doc.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>` +
        '@page { size: A4; margin: 0; }' +
        '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }' +
        'html, body { margin: 0; padding: 0; background: #fff; }' +
        // A hair under the A4 printable area so the forced break never spills
        // 1px onto an extra blank page.
        '.pbr-page { box-shadow: none !important; height: 1120px !important; page-break-after: always; break-after: page; overflow: hidden; }' +
        '.pbr-page:last-child { page-break-after: auto; break-after: auto; }' +
        '</style></head><body><div id="pbr-root"></div></body></html>'
    );
    doc.close();
    doc.title = title;

    root = createRoot(doc.getElementById('pbr-root'));
    root.render(pagesNode);

    await waitForImages(doc, 120);

    const win = iframe.contentWindow;
    // Chromium derives the "Save as PDF" filename from the *top* document's
    // title when printing a same-origin iframe — swap it, then restore.
    const prevDocTitle = document.title;
    document.title = title;
    let titleRestored = false;
    const restoreTitle = () => {
      if (!titleRestored) {
        document.title = prevDocTitle;
        titleRestored = true;
      }
    };
    const cleanup = () => {
      restoreTitle();
      try { if (root) root.unmount(); } catch { /* ignore */ }
      if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
    };
    win.onafterprint = cleanup;
    win.focus();
    win.print();
    // Fallback cleanup if onafterprint never fires (some browsers).
    setTimeout(cleanup, 60000);
  } catch (err) {
    try { if (root) root.unmount(); } catch { /* ignore */ }
    if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
    throw err;
  }
}

/**
 * Render `pagesNode` off-screen and rasterize each page into a single PDF Blob.
 * Used for the Supabase archive copy.
 *
 * @param {JSX.Element} pagesNode  Already-composed <PageSheet> elements.
 * @param {number} pageWidth       Container width in px (PAGE_W).
 * @returns {Promise<Blob>}
 */
export async function generatePdfBlob(pagesNode, pageWidth) {
  const { createRoot } = await import('react-dom/client');

  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'absolute',
    left: '-100000px',
    top: '0',
    width: `${pageWidth}px`,
    background: '#fff',
  });
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(pagesNode);

  try {
    await waitForImages(container, 200);
    await loadPdfScripts();

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const mmW = pdf.internal.pageSize.getWidth();
    const mmH = pdf.internal.pageSize.getHeight();

    // Page count comes from the DOM, so it cannot drift from what was measured.
    const pageEls = Array.from(container.querySelectorAll('.pbr-page'));
    if (pageEls.length === 0) throw new Error('No pages were rendered for export.');

    const undoBaselineFix = applyHtml2CanvasBaselineFix();
    try {
      for (let i = 0; i < pageEls.length; i++) {
        const canvas = await window.html2canvas(pageEls[i], {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, mmW, mmH);
      }
    } finally {
      undoBaselineFix();
    }

    return pdf.output('blob');
  } finally {
    try { root.unmount(); } catch { /* ignore */ }
    if (container.parentNode) container.parentNode.removeChild(container);
  }
}
