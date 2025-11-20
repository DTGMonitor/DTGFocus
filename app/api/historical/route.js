import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const timezone = searchParams.get('timezone');
  const units = searchParams.get('units');

  if (!lat || !lon || !start || !end) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }

  const url = `https://meteostat.p.rapidapi.com/point/hourly?lat=${lat}&lon=${lon}&start=${start}&end=${end}&tz=${timezone}&units=${units}`;

  try {
    const response = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": process.env.METEOSTAT_API_KEY, // Matches .env.local
        "X-RapidAPI-Host": process.env.METEOSTAT_HOST,   // Matches .env.local
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Upstream error from Meteostat" }, 
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);

  } catch (error) {
    console.error("❌ historical API error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}