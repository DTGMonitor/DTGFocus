/**
 * Multi-figure DQP rows.
 *
 * A dqp_values row used to hold ONE image (`image` FK) and ONE caption, while
 * the uploader looped over every selected file — so a two-file upload stored two
 * client_images rows and referenced only the last. These tests pin the shape
 * that replaced it: index-aligned `image_ids[]` / `image_captions[]`, resolved to
 * storage paths in a single query, and numbered as figures that run across the
 * whole appendix rather than restarting per item.
 */

import {
  DQP_IMAGE_COLUMNS,
  normaliseDqpImages,
  attachDqpImages,
  buildDqpImagePayload,
} from '@/utils/dqpImages';
import { buildAppendixItems, buildDqpGroups } from '@/utils/reportDqp';

/** A Supabase stand-in that records what it was asked for. */
const stubClient = (rows, { fail = false } = {}) => {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        select(cols) {
          return {
            in(col, ids) {
              calls.push({ table, cols, col, ids });
              return Promise.resolve(
                fail ? { data: null, error: new Error('boom') } : { data: rows, error: null }
              );
            },
          };
        },
      };
    },
  };
};

describe('normaliseDqpImages', () => {
  it('pairs each id with the caption at the same index', () => {
    expect(
      normaliseDqpImages({ image_ids: [250, 251], image_captions: ['Vegetation', 'Mask'] })
    ).toEqual([
      { id: 250, caption: 'Vegetation' },
      { id: 251, caption: 'Mask' },
    ]);
  });

  it('reads a short caption array as missing captions, never as a neighbour\'s', () => {
    // A caption silently shifted onto the wrong figure is worse than no caption:
    // the report would print a confident, incorrect one.
    expect(normaliseDqpImages({ image_ids: [1, 2, 3], image_captions: ['only'] })).toEqual([
      { id: 1, caption: 'only' },
      { id: 2, caption: '' },
      { id: 3, caption: '' },
    ]);
  });

  it('falls back to the pre-migration single-image columns', () => {
    // A client still running the old write path produces exactly this row.
    expect(normaliseDqpImages({ image: 251, caption: 'Alarm mask recommendations' })).toEqual([
      { id: 251, caption: 'Alarm mask recommendations' },
    ]);
  });

  it('prefers the arrays over the legacy columns when both are present', () => {
    // The backfill leaves both populated; the arrays are authoritative.
    expect(
      normaliseDqpImages({
        image: 251,
        caption: 'Mask',
        image_ids: [250, 251],
        image_captions: ['Vegetation', 'Mask'],
      })
    ).toHaveLength(2);
  });

  it('returns nothing for a row with no figures', () => {
    expect(normaliseDqpImages({ image: null, caption: null })).toEqual([]);
    expect(normaliseDqpImages({ image_ids: [] })).toEqual([]);
    expect(normaliseDqpImages(null)).toEqual([]);
  });

  it('selects both the array columns and the legacy pair', () => {
    // Dropping either half of this string re-introduces the bug it fixes.
    ['image_ids', 'image_captions', 'image', 'caption'].forEach((col) =>
      expect(DQP_IMAGE_COLUMNS).toContain(col)
    );
  });
});

describe('attachDqpImages', () => {
  const rows = [
    { parameter_id: 21, image_ids: [250, 251], image_captions: ['Vegetation', 'Mask'] },
    { parameter_id: 9, image_ids: [250], image_captions: [''] },
    { parameter_id: 3, image_ids: [], image_captions: [] },
  ];

  it('resolves every row in ONE query, with ids de-duplicated', async () => {
    const client = stubClient([
      { id: 250, image_url: 'site/2026-07-28_a.png' },
      { id: 251, image_url: 'site/2026-07-28_b.png' },
    ]);
    const out = await attachDqpImages(client, rows);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].table).toBe('client_images');
    expect(client.calls[0].ids.sort()).toEqual([250, 251]);

    expect(out[0].images).toEqual([
      { id: 250, caption: 'Vegetation', image_url: 'site/2026-07-28_a.png' },
      { id: 251, caption: 'Mask', image_url: 'site/2026-07-28_b.png' },
    ]);
    // The same image attached to two rows resolves for both.
    expect(out[1].images).toHaveLength(1);
    expect(out[2].images).toEqual([]);
  });

  it('preserves the row order of image_ids, not the lookup order', async () => {
    const client = stubClient([
      { id: 251, image_url: 'b.png' }, // returned first...
      { id: 250, image_url: 'a.png' },
    ]);
    const [row] = await attachDqpImages(client, [rows[0]]);
    // ...but 250 was declared first, and figure numbering follows the row.
    expect(row.images.map((i) => i.id)).toEqual([250, 251]);
  });

  it('drops an id whose image no longer exists rather than leaving a hole', async () => {
    // A figure that cannot render must not claim a figure number.
    const client = stubClient([{ id: 250, image_url: 'a.png' }]);
    const [row] = await attachDqpImages(client, [rows[0]]);
    expect(row.images.map((i) => i.id)).toEqual([250]);
  });

  it('degrades to no figures instead of throwing when the lookup fails', async () => {
    // A missing image must not take down the DQP table or stop a report.
    const client = stubClient(null, { fail: true });
    const out = await attachDqpImages(client, rows);
    expect(out.every((r) => r.images.length === 0)).toBe(true);
  });

  it('skips the query entirely when no row has a figure', async () => {
    const client = stubClient([]);
    const out = await attachDqpImages(client, [rows[2]]);
    expect(client.calls).toHaveLength(0);
    expect(out[0].images).toEqual([]);
  });
});

describe('buildDqpImagePayload', () => {
  it('writes equal-length arrays, which the CHECK constraint requires', () => {
    const payload = buildDqpImagePayload([
      { id: 250, caption: 'Vegetation' },
      { id: 251 }, // caption omitted
    ]);
    expect(payload.image_ids).toEqual([250, 251]);
    expect(payload.image_captions).toEqual(['Vegetation', '']);
  });

  it('mirrors the first figure into the legacy columns', () => {
    // So a client still on the old read path shows figure 1, not a stale one.
    const payload = buildDqpImagePayload([{ id: 250, caption: 'Vegetation' }, { id: 251 }]);
    expect(payload.image).toBe(250);
    expect(payload.caption).toBe('Vegetation');
  });

  it('clears both the arrays and the legacy columns for an empty list', () => {
    expect(buildDqpImagePayload([])).toEqual({
      image_ids: [],
      image_captions: [],
      image: null,
      caption: null,
    });
  });
});

describe('buildAppendixItems — figures across a multi-image appendix', () => {
  const row = (id, name, over = {}) => ({
    value: 'Acceptable',
    notes: 'note',
    appendix: null,
    parameters: { id, name, level: 2, parent_id: 6 },
    ...over,
  });
  const img = (id, caption) => ({ id, caption, image_url: `${id}.png` });

  it('numbers figures continuously across items, not per item', () => {
    // Item A carries two figures, so item B starts at 3. Restarting per item
    // would print two "Figure 1"s in one appendix.
    const items = buildAppendixItems([
      row(9, 'Data Availability', { images: [img(250, 'Vegetation'), img(251, 'Mask')] }),
      row(21, 'Alarm Mask', { images: [img(252, 'Sectors')] }),
    ]);

    expect(items.map((i) => [i.letter, i.figure])).toEqual([
      ['A', 1],
      ['B', 3],
    ]);
    expect(items[0].images).toHaveLength(2);
  });

  it('does not let a prose-only item consume a figure number', () => {
    const items = buildAppendixItems([
      row(9, 'Data Availability', { appendix: 'prose only', images: [] }),
      row(21, 'Alarm Mask', { images: [img(252, 'Sectors')] }),
    ]);
    expect(items.map((i) => [i.letter, i.figure])).toEqual([
      ['A', 1],
      ['B', 1], // the prose item took no figure, so B still starts at 1
    ]);
  });

  it('letters and numbers by parameter id, not input order', () => {
    const items = buildAppendixItems([
      row(21, 'Alarm Mask', { images: [img(252, 'Sectors')] }),
      row(9, 'Data Availability', { images: [img(250, 'A'), img(251, 'B')] }),
    ]);
    expect(items.map((i) => [i.parameterId, i.letter, i.figure])).toEqual([
      [9, 'A', 1],
      [21, 'B', 3],
    ]);
  });

  it('carries each caption on its own image, ready for signing', () => {
    const [item] = buildAppendixItems([
      row(9, 'Data Availability', { images: [img(250, 'Vegetation'), img(251, 'Mask')] }),
    ]);
    expect(item.images).toEqual([
      { id: 250, caption: 'Vegetation', image_url: '250.png', imageUrl: null },
      { id: 251, caption: 'Mask', image_url: '251.png', imageUrl: null },
    ]);
  });

  it('includes a legacy single-image row that was never migrated', () => {
    const [item] = buildAppendixItems([
      row(21, 'Alarm Mask', { image: 251, caption: 'Alarm mask recommendations' }),
    ]);
    expect(item.figure).toBe(1);
    expect(item.images).toHaveLength(1);
    expect(item.images[0].caption).toBe('Alarm mask recommendations');
  });

  it('excludes a row with figures but no notes', () => {
    // Unchanged rule: the note is what the appendix entry explains.
    expect(buildAppendixItems([row(9, 'X', { notes: '', images: [img(1, 'c')] })])).toEqual([]);
  });
});

describe('buildDqpGroups', () => {
  it('gives each grouped item its full figure list', () => {
    const groups = buildDqpGroups([
      { value: 'Optimal', parameters: { id: 6, name: 'Alarms', level: 1, parent_id: null } },
      {
        value: 'Acceptable',
        notes: 'n',
        appendix: null,
        images: [{ id: 250, caption: 'a', image_url: '250.png' }],
        parameters: { id: 21, name: 'Alarm Mask', level: 2, parent_id: 6 },
      },
    ]);
    expect(groups[0].items[0].images).toHaveLength(1);
  });

  it('gives a figureless row an empty list rather than undefined', () => {
    // The render layer maps over this directly.
    const groups = buildDqpGroups([
      {
        value: 'Optimal',
        notes: '',
        appendix: null,
        image: null,
        parameters: { id: 21, name: 'Alarm Mask', level: 2, parent_id: 6 },
      },
    ]);
    expect(groups[0].items[0].images).toEqual([]);
  });
});
