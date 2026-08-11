'use client';

/**
 * Screen-only figure controls for the Daily Radar Report. Never part of the
 * paginated paper — none of this may appear in the PDF.
 *
 * STICKY, and collapsible. The report is several A4 sheets tall and the analyst
 * works down it: drawing a zone on page 1, then adding a graph to an area on
 * page 3. A panel that scrolled away with the top of the document meant
 * scrolling back up for every edit, so it rides the top of the modal's scroll
 * container instead — and folds away when the page underneath needs the room.
 *
 * The weather, fog, rainfall and data-update fields are NOT here. They are typed
 * straight onto the page where they will print (see DailySummary's
 * EditableValue and DailyHeader's DataUpdateInput), which is both fewer places
 * to look and a direct preview of the result.
 *
 * The one exception is the "Isi dari stasiun" button, which fills three of those
 * fields from the site's weather station. It sits here rather than beside the
 * fields because DailySummary is ALSO rendered into a hidden measurement layer
 * to compute page breaks — a control inside it would make the two passes
 * measure different heights.
 */

import { useState } from 'react';

import { AnnotationToolbar } from '@/components/admin/Radar/report/AnnotatedImage';
import { StationSummaryFill } from '@/components/admin/Reports/StationSummaryFill';

const panel = {
  background: '#111418',
  color: '#fff',
  padding: '8px 12px',
  borderRadius: 6,
  marginBottom: 10,
};

const field = {
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  borderRadius: 3,
  padding: '3px 6px',
  fontSize: 11,
  fontFamily: 'inherit',
};

const btn = {
  padding: '4px 9px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  color: '#fff',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * What is still missing before the PDF can be generated.
 *
 * Stated as a list rather than as a disabled button with no explanation: a dead
 * control the analyst cannot account for reads as a broken one.
 */
function Outstanding({ items }) {
  if (!items.length) {
    return (
      <span style={{ fontSize: 11, color: '#4ade80' }}>✓ Ready to generate</span>
    );
  }
  return (
    <span style={{ fontSize: 11, color: '#fbbf24' }}>
      Still required: {items.join(', ')}
    </span>
  );
}

/**
 * @param {boolean} showAnalysis  Whether this edition has a risk worth an Area
 *   Analysis section. False hides the controls entirely — the section is not
 *   printed either, so offering figure uploads for it would be a dead end.
 * @param {string[]} outstanding  Human-readable names of the still-empty
 *   required inputs, from the modal.
 * @param {object} annotation A useImageAnnotation() bundle for the scan area.
 * @param {object} figures    A useDailyFigures() bundle for the analysis areas.
 */
/**
 * @param {object} [stationFill]  Props for the "Isi dari stasiun" control:
 *   { siteId, frequency, endDate, timeZone, locale, onFill }. Omitted when no
 *   site is selected yet, in which case the button is simply absent rather than
 *   present and dead.
 * @param {string} [notice]  A failure the analyst has to know about but cannot
 *   see on the page — a generator figure that did not save still SHOWS in its
 *   cell, so nothing on the sheet would give the loss away.
 */
export function DailyReportToolbar({
  showAnalysis,
  outstanding = [],
  annotation,
  figures,
  stationFill,
  notice,
}) {
  const [open, setOpen] = useState(true);

  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        // The sheets below scroll under this, so it needs its own ground.
        background: '#0b0e11',
        paddingTop: 6,
        marginBottom: 6,
      }}
    >
      <div
        style={{
          ...panel,
          marginBottom: open ? 10 : 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ fontSize: 12 }}>Report editor</strong>
        <button type="button" onClick={() => setOpen((v) => !v)} style={btn}>
          {open ? '▲ Hide controls' : '▼ Show controls'}
        </button>
        <Outstanding items={outstanding} />
        {notice ? <span style={{ fontSize: 11, color: '#f87171' }}>{notice}</span> : null}
        {stationFill ? (
          <StationSummaryFill
            siteId={stationFill.siteId}
            frequency={stationFill.frequency}
            endDate={stationFill.endDate}
            timeZone={stationFill.timeZone}
            locale={stationFill.locale}
            onFill={stationFill.onFill}
          />
        ) : null}
        {open ? (
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Weather, fog, rainfall and the data update are typed on the page itself.
          </span>
        ) : null}
      </div>

      {open ? (
        <div style={{ maxHeight: '42vh', overflowY: 'auto' }}>
          <AnnotationToolbar annotation={annotation} label="Scan area figure" showNorth />

          {showAnalysis ? (
            <>
              <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 12 }}>Area analysis</strong>
                <button type="button" onClick={figures.addFigure} style={btn}>
                  + Add area
                </button>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  One deformation image per area, with any number of graphs beneath it.
                </span>
              </div>

              {figures.figures.map((figure, i) => (
                <div key={figure.id} style={{ marginLeft: 14 }}>
                  <AnnotationToolbar
                    annotation={figures.figureApis[i]}
                    label={`Area ${i + 1}`}
                    showNorth
                    extra={
                      <>
                        <input
                          type="text"
                          value={figure.name}
                          onChange={(e) => figures.setName(i, e.target.value)}
                          placeholder="Area name (e.g. 102_line)"
                          aria-label={`Area ${i + 1} name`}
                          style={{ ...field, width: 180 }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                              figures.addGraphs(i, e.target.files);
                              // Reset, so re-selecting the same file fires onChange again.
                              e.target.value = '';
                            }}
                            style={{ display: 'none' }}
                          />
                          <span style={btn}>+ Add graph(s)</span>
                        </label>
                        {figures.figures.length > 1 ? (
                          <button type="button" onClick={() => figures.removeFigure(i)} style={btn}>
                            ✕ Remove area
                          </button>
                        ) : null}
                      </>
                    }
                  />

                  {figure.graphs.length > 0 ? (
                    <div style={{ ...panel, marginTop: -4 }}>
                      <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 6 }}>
                        Graphs ({figure.graphs.length}) — captions are optional; each is already titled
                        with the area name.
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {figure.graphs.map((graph, gi) => (
                          <div
                            key={graph.id}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: 4,
                              padding: 6,
                              width: 170,
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={graph.image}
                              alt={`Graph ${gi + 1}`}
                              style={{ width: '100%', height: 60, objectFit: 'cover', borderRadius: 2 }}
                            />
                            <input
                              type="text"
                              value={graph.caption}
                              onChange={(e) => figures.setGraphCaption(i, gi, e.target.value)}
                              placeholder="Caption"
                              aria-label={`Area ${i + 1} graph ${gi + 1} caption`}
                              style={field}
                            />
                            <button type="button" onClick={() => figures.removeGraph(i, gi)} style={btn}>
                              ✕ Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </>
          ) : (
            <div style={{ ...panel, fontSize: 11, color: '#64748b' }}>
              No active deformation risk this period, so the Area Analysis section is not printed and
              needs no figures.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default DailyReportToolbar;
