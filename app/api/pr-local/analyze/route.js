import { NextResponse } from 'next/server';
import { runRunnerJob } from '@/utils/devPythonRunner';

export const dynamic = 'force-dynamic';

/**
 * DEV-ONLY analyze endpoint. Mirrors the Vercel Python function
 * (api/pattern-recognition/analyze.py) but runs the pipeline via the local
 * Python CLI, so the app works under `npm run dev`. Disabled on Vercel — the
 * Python function serves /api/pattern-recognition/analyze in production.
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

  const files = body?.files || [];
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 });
  }

  try {
    const result = await runRunnerJob({ mode: 'analyze', files, params: body.params || {} });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error('[pr-local/analyze]', err);
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 });
  }
}
