import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const place_id = searchParams.get('place_id');
  const units = searchParams.get('units');

  if (!place_id || !units) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  try {
    // Using the logic from your Netlify function (Header-based auth)
    const response = await fetch(
      `https://www.meteosource.com/api/v1/free/point?place_id=${place_id}&units=${units}`,
      {
        headers: {
          "X-API-Key": process.env.METEOSOURCE_API_KEY, // Matches .env.local
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Upstream error from Meteosource" }, 
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error("❌ point API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}