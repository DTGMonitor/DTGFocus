import { NextResponse } from 'next/server';
import { runRunnerJob } from '@/utils/devPythonRunner';

export const dynamic = 'force-dynamic';

/**
 * DEV-ONLY classify-manual endpoint. Mirrors the Vercel Python function
 * (api/pattern-recognition/classify-manual.py) using the local Python CLI so
 * the boundary editor works under `npm run dev`. Disabled on Vercel.
 */
export async function POST(request) {
  if (process.env.VERCEL) {
    return NextResponse.json({ error: 'Not available in production.' }, { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  try {
    const result = await runRunnerJob({ mode: 'classify-manual', ...body });
    return NextResponse.json(
      {
        windows: result.windows,
        onsetOfFailure: result.onsetOfFailure,
        fukuzono: result.fukuzono ?? null,
        slo: result.slo ?? null,
        combinedChartJson: result.combinedChartJson,
        stageSummaryRows: result.stageSummaryRows,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[pr-local/classify-manual]', err);
    return NextResponse.json({ error: 'Classification failed. Please try again.' }, { status: 500 });
  }
}
