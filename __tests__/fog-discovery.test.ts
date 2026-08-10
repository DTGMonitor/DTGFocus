/**
 * @jest-environment node
 */
// ambient.ts refuses to load where `window` exists, so this suite runs in node.
// That guard is itself asserted at the bottom of the file.

import { discoverStations, fetchStationRecords, AmbientError } from '@/lib/weather/ambient';

// Every expectation below was derived by calling the live endpoint, not by
// reading documentation — there isn't any. All four were wrong on the first
// attempt and each failed in a different, misleading way.

const EAST_LUWU = { latitude: -2.5034, longitude: 121.5176 };

function mockFetch(handler: (url: string) => { status: number; body: string }) {
  const spy = jest.fn(async (url: string) => {
    const { status, body } = handler(String(url));
    return {
      status,
      text: async () => body,
    } as unknown as Response;
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

const DEVICE = {
  _id: 'x',
  macAddress: 'C8:C9:A3:0F:C7:FD',
  tz: { name: 'Asia/Singapore' },
  info: {
    name: 'ASBSAR1',
    coords: {
      coords: { lat: -2.5034, lon: 121.5176 },
      location: 'East Luwu Regency',
      elevation: 1024.815063476562,
    },
  },
  lastData: {
    stationtype: 'AMBWeatherPro_V5.1.1',
    dateutc: 1786333200000,
    tempf: 76.6,
    humidity: 71,
    windspeedmph: 3.8,
    solarradiation: 205.29,
    baromrelin: 26.695,
    dailyrainin: 0,
    tz: 'Asia/Singapore',
    hl: { dateutc: 1786333200000, tempf: { h: 77.4, l: 64.9, c: 62 } },
  },
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('$publicBox encoding', () => {
  test('uses the bracketed Feathers form, not a JSON array', () => {
    // A JSON array in one parameter is rejected outright:
    //   400 {"name":"BadRequest","message":"Invalid query parameter $publicBox"}
    const spy = mockFetch(() => ({ status: 200, body: JSON.stringify({ data: [] }) }));

    return discoverStations(EAST_LUWU, 40).then(() => {
      const url = decodeURIComponent(String(spy.mock.calls[0][0]));
      expect(url).toContain('$publicBox[0][0]=');
      expect(url).toContain('$publicBox[0][1]=');
      expect(url).toContain('$publicBox[1][0]=');
      expect(url).toContain('$publicBox[1][1]=');
      expect(url).not.toMatch(/\$publicBox=\[/);
    });
  });

  test('each corner is [longitude, latitude], not [latitude, longitude]', async () => {
    // Swapping them is not a silent miss — the server names the mistake:
    //   500 {"message":"Longitude/latitude is out of bounds, lng: -2.8652 lat: 121.158"}
    // which is also what proves element 0 is read as longitude.
    const spy = mockFetch(() => ({ status: 200, body: JSON.stringify({ data: [] }) }));
    await discoverStations(EAST_LUWU, 40);

    const url = new URL(String(spy.mock.calls[0][0]));
    const lon0 = Number(url.searchParams.get('$publicBox[0][0]'));
    const lat0 = Number(url.searchParams.get('$publicBox[0][1]'));
    const lon1 = Number(url.searchParams.get('$publicBox[1][0]'));
    const lat1 = Number(url.searchParams.get('$publicBox[1][1]'));

    // East Luwu: longitude ~121.5, latitude ~-2.5. The two are unmistakable.
    expect(lon0).toBeGreaterThan(120);
    expect(lon1).toBeGreaterThan(120);
    expect(lat0).toBeLessThan(0);
    expect(lat1).toBeLessThan(0);
    expect(lon0).toBeLessThan(lon1);
    expect(lat0).toBeLessThan(lat1);
  });

  test('sends exactly one request — no ordering fallback', async () => {
    const spy = mockFetch(() => ({ status: 200, body: JSON.stringify({ data: [] }) }));
    await discoverStations(EAST_LUWU, 40);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('discovery response envelope', () => {
  test('unwraps { data: [...] }', async () => {
    // The device SEARCH answers an envelope; /devices/{mac} answers the object
    // directly. Treating the envelope as an array yields zero candidates on a
    // perfectly good 200 — indistinguishable from "no stations nearby".
    mockFetch(() => ({ status: 200, body: JSON.stringify({ data: [DEVICE] }) }));

    const found = await discoverStations(EAST_LUWU, 40);
    expect(found).toHaveLength(1);
    expect(found[0].macAddress).toBe('C8:C9:A3:0F:C7:FD');
    expect(found[0].name).toBe('ASBSAR1');
    expect(found[0].distanceKm).toBeCloseTo(0, 1);
    expect(found[0].elevationM).toBeCloseTo(1024.8, 1);
    expect(found[0].timezone).toBe('Asia/Singapore');
    expect(found[0].capabilities.solar).toBe(true);
  });

  test('still accepts a bare array, in case the shape changes back', async () => {
    mockFetch(() => ({ status: 200, body: JSON.stringify([DEVICE]) }));
    expect(await discoverStations(EAST_LUWU, 40)).toHaveLength(1);
  });

  test('filters candidates outside the radius by true distance', async () => {
    // The bounding box is deliberately wider than the circle it approximates.
    const far = {
      ...DEVICE,
      macAddress: 'AA:BB:CC:DD:EE:FF',
      info: { ...DEVICE.info, coords: { ...DEVICE.info.coords, coords: { lat: -2.9, lon: 121.9 } } },
    };
    mockFetch(() => ({ status: 200, body: JSON.stringify({ data: [DEVICE, far] }) }));

    const found = await discoverStations(EAST_LUWU, 10);
    expect(found.map((c) => c.macAddress)).toEqual(['C8:C9:A3:0F:C7:FD']);
  });

  test('a station with no coordinates cannot be a candidate', async () => {
    // Without a position its solar geometry cannot be computed, which
    // disqualifies it from Index B entirely — not a cosmetic gap.
    mockFetch(() => ({
      status: 200,
      body: JSON.stringify({ data: [{ ...DEVICE, info: { name: 'nowhere' } }] }),
    }));
    expect(await discoverStations(EAST_LUWU, 40)).toHaveLength(0);
  });
});

describe('single station fetch', () => {
  test('finds the record nested under lastData and ignores the hl block', async () => {
    mockFetch(() => ({ status: 200, body: JSON.stringify(DEVICE) }));

    const { parsed } = await fetchStationRecords('C8:C9:A3:0F:C7:FD');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].record.tempf).toBe(76.6);
  });

  test('HTTP 204 is a station-not-found, not a parse error', async () => {
    mockFetch(() => ({ status: 204, body: '' }));

    await expect(fetchStationRecords('00:00:00:00:00:00')).rejects.toMatchObject({
      kind: 'station_not_found',
    });
  });

  test('an empty body on a 200 means the same thing', async () => {
    mockFetch(() => ({ status: 200, body: '   ' }));
    await expect(fetchStationRecords('00:00:00:00:00:00')).rejects.toBeInstanceOf(
      AmbientError
    );
  });
});
