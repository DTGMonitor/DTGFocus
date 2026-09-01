'use client';

/**
 * Assemble a report's blocks in the order its site's layout asks for.
 *
 * Both block-composed templates (Tabulation and Comprehensive) used to end
 * their build with one long `out.push(...)` sequence — the order was the source
 * code. That is what made "this client wants a rainfall table after the
 * movement table" a code change. Now each template builds the same blocks into
 * a KEYED BAG and hands it here with the site's layout; the order and the
 * custom sections come from data.
 *
 * A default section contributes however many blocks the day's data produced —
 * one legend, three movement slices, eleven glossary groups — so a layout entry
 * maps to an ARRAY, and a section whose data is empty contributes none. That is
 * the same behaviour as before this file existed: a report with no appendix has
 * never printed an appendix heading over nothing, and enabling the section in
 * the layout must not change that.
 *
 * Blocks are React elements built by the caller, which is why this lives beside
 * the page frame rather than in utils/reportLayout.js.
 */

import { sectionContent, chunkTableRows, visibleEntries } from '@/utils/reportLayout';
import { buildCustomSectionBlocks } from './blocks/CustomSections';

/**
 * @param {object[]} entries  A normalized layout (utils/reportLayout).
 * @param {Record<string, React.ReactNode[]>} groups  Default blocks by section key.
 *   A key absent from the bag contributes nothing — that is how a template
 *   drops a section its data did not fill, without the layout knowing.
 * @param {object} values     Per-report custom content, keyed by section id.
 * @param {Function} onImageLoad  bumpMeasure. Wired into every custom image, for
 *   the reason useReportPagination documents: an image has zero height until it
 *   decodes, so without this the first pack runs against the wrong numbers.
 * @returns {React.ReactNode[]}
 */
export function composeLayoutBlocks({ entries, groups, values = {}, onImageLoad }) {
    const out = [];
    for (const entry of visibleEntries(entries)) {
        if (entry.kind === 'custom') {
            const content = sectionContent(entry, values[entry.id]);
            out.push(...buildCustomSectionBlocks(entry, content, { onImageLoad, chunk: chunkTableRows }));
            continue;
        }
        const blocks = groups[entry.key];
        if (Array.isArray(blocks)) out.push(...blocks);
        else if (blocks) out.push(blocks);
    }
    return out;
}

export default composeLayoutBlocks;
