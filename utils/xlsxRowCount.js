/**
 * xlsxRowCount.js — Best-effort, dependency-free row counter for .xlsx files.
 *
 * An .xlsx file is a ZIP archive; the first worksheet lives at
 * `xl/worksheets/sheet1.xml`, where each spreadsheet row is one `<row …>`
 * element. We locate that entry via the ZIP central directory, inflate it with
 * the browser's built-in `DecompressionStream` (no SheetJS / JSZip needed), and
 * count the `<row` tags.
 *
 * This exists purely to warn the analyst *before* upload when a file is large
 * enough to risk the 60-second serverless time limit. It is advisory only:
 * any failure (unsupported browser, atypical workbook, stored/encrypted entry)
 * returns `null` and the caller falls back to its normal behaviour.
 */

const ZIP_EOCD_SIG = 0x06054b50; // End Of Central Directory
const ZIP_CD_SIG = 0x02014b50; // Central Directory file header
const FIRST_SHEET_PATH = 'xl/worksheets/sheet1.xml';

/** Inflate raw DEFLATE bytes using the platform DecompressionStream. */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(bytes).body.pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Count the data rows in the first worksheet of an .xlsx File/Blob.
 *
 * @param {File|Blob} file
 * @returns {Promise<number|null>} data-row count (excluding the header row),
 *   or null if the count could not be determined.
 */
export async function countXlsxRows(file) {
  try {
    if (typeof DecompressionStream === 'undefined') return null;

    const buf = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(buf.buffer);

    // --- Locate the End Of Central Directory record (scan backwards). ---
    // The EOCD is within the last 64 KB (22-byte record + up to 64 KB comment).
    let eocd = -1;
    const minPos = Math.max(0, buf.length - 22 - 0xffff);
    for (let i = buf.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === ZIP_EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd === -1) return null;

    const cdCount = view.getUint16(eocd + 10, true);
    let cdOffset = view.getUint32(eocd + 16, true);

    // --- Walk the central directory for the first-sheet entry. ---
    const decoder = new TextDecoder('utf-8');
    let sheetEntry = null;
    for (let n = 0; n < cdCount; n++) {
      if (cdOffset + 46 > buf.length) return null;
      if (view.getUint32(cdOffset, true) !== ZIP_CD_SIG) return null;

      const method = view.getUint16(cdOffset + 10, true);
      const compSize = view.getUint32(cdOffset + 20, true);
      const nameLen = view.getUint16(cdOffset + 28, true);
      const extraLen = view.getUint16(cdOffset + 30, true);
      const commentLen = view.getUint16(cdOffset + 32, true);
      const localOffset = view.getUint32(cdOffset + 42, true);
      const name = decoder.decode(buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

      if (name === FIRST_SHEET_PATH) {
        sheetEntry = { method, compSize, localOffset };
        break;
      }
      cdOffset += 46 + nameLen + extraLen + commentLen;
    }
    if (!sheetEntry) return null;

    // --- Resolve the data offset from the local file header. ---
    const lo = sheetEntry.localOffset;
    if (lo + 30 > buf.length) return null;
    const localNameLen = view.getUint16(lo + 26, true);
    const localExtraLen = view.getUint16(lo + 28, true);
    const dataStart = lo + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + sheetEntry.compSize;
    if (dataEnd > buf.length) return null;

    const compressed = buf.subarray(dataStart, dataEnd);

    // method 0 = stored (no compression); method 8 = raw DEFLATE.
    let xmlBytes;
    if (sheetEntry.method === 0) {
      xmlBytes = compressed;
    } else if (sheetEntry.method === 8) {
      xmlBytes = await inflateRaw(compressed);
    } else {
      return null;
    }

    const xml = decoder.decode(xmlBytes);

    // Count <row …> opening tags. The header row is included, so subtract one.
    const matches = xml.match(/<row[ >]/g);
    if (!matches) return null;
    return Math.max(0, matches.length - 1);
  } catch {
    return null;
  }
}
