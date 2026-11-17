import { imageFilesFrom } from '@/utils/clipboardImages';

// A File whose lastModified is stamped at creation, the way Chrome mints a new
// one on every getAsFile() / files[i] access.
const png = (stamp) => new File(['x'], 'image.png', { type: 'image/png', lastModified: stamp });

describe('imageFilesFrom', () => {
  it('returns ONE image when the browser lists the same paste in items and files', () => {
    let clock = 1000;
    const data = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => png(clock++) }],
      files: [png(clock++)],
    };
    expect(imageFilesFrom(data)).toHaveLength(1);
  });

  it('falls back to files when items carries no image', () => {
    const data = { items: [{ kind: 'string', type: 'text/plain' }], files: [png(1), png(2)] };
    expect(imageFilesFrom(data)).toHaveLength(2);
  });

  it('keeps every image from items and ignores non-images', () => {
    const data = {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => png(1) },
        { kind: 'file', type: 'application/pdf', getAsFile: () => new File(['x'], 'a.pdf', { type: 'application/pdf' }) },
        { kind: 'file', type: 'image/jpeg', getAsFile: () => new File(['y'], 'b.jpg', { type: 'image/jpeg' }) },
      ],
      files: [],
    };
    expect(imageFilesFrom(data).map((f) => f.name)).toEqual(['image.png', 'b.jpg']);
  });

  it('handles a missing source', () => {
    expect(imageFilesFrom(null)).toEqual([]);
  });
});
