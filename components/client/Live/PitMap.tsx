// PitMap.tsx
import React, { useMemo, useEffect, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { toLngLat, generateCoordinateGrid } from '@/utils/geoUtils';
import { Target } from 'lucide-react';
import Map, {
    Layer,
    Marker,
    NavigationControl,
    Source,
    useMap,
} from 'react-map-gl/maplibre';
import { supabase } from '@/lib/supabaseClient';

// You will need to determine the exact Easting/Northing bounds of your /background/MockPit.png
const IMAGE_BOUNDS = {
    minE: 58100,
    maxE: 58800,
    minN: 13100,
    maxN: 13800,
};

export interface Sensor {
    id: string;
    easting: number;
    northing: number;
    latest_deformation: number;
    latest_timestamp: string;
    // Optional fields that might come from DB or be computed
    type?: 'Radar' | 'Prism' | 'Piezometer' | 'InSAR';
    tarp?: 1 | 2 | 3 | 4;
    label?: string;
}

interface PitMapProps {
    onSensorSelect?: (sensor: Sensor) => void;
}

export default function PitMap({ onSensorSelect }: PitMapProps) {
    const [sensors, setSensors] = useState<Sensor[]>([]);

    // Fetch sensors from Supabase on mount
    useEffect(() => {
        const fetchSensors = async () => {
            const { data, error } = await supabase
                .from('sensors')
                .select('*');

            if (error) {
                console.error("Bugger, couldn't fetch sensors:", error);
            } else if (data) {
                setSensors(data);
            }
        };

        fetchSensors();
    }, []);
    // 1. Generate our 50m Grid Lines GeoJSON
    const gridGeoJSON = useMemo(() =>
        generateCoordinateGrid(IMAGE_BOUNDS.minE, IMAGE_BOUNDS.maxE, IMAGE_BOUNDS.minN, IMAGE_BOUNDS.maxN, 50),
        []);

    // 2. Map the image corners to Lng/Lat for the image overlay
    const imageCoordinates = useMemo(() => [
        toLngLat(IMAGE_BOUNDS.minE, IMAGE_BOUNDS.maxN), // Top Left
        toLngLat(IMAGE_BOUNDS.maxE, IMAGE_BOUNDS.maxN), // Top Right
        toLngLat(IMAGE_BOUNDS.maxE, IMAGE_BOUNDS.minN), // Bottom Right
        toLngLat(IMAGE_BOUNDS.minE, IMAGE_BOUNDS.minN), // Bottom Left
    ] as [[number, number], [number, number], [number, number], [number, number]], []);

    // Set the camera to look right at the SSR461 cluster
    const initialViewState = {
        longitude: toLngLat(58465, 13455)[0],
        latitude: toLngLat(58465, 13455)[1],
        zoom: 15, // Zoomed out slightly so both clusters fit on screen
        pitch: 45,
        bearing: 0
    };

    const handleSensorClick = (sensor: Sensor) => {
        console.log(`Clicked ${sensor.id} - Ready to fetch history!`);
        if (onSensorSelect) {
            onSensorSelect(sensor);
        }
    };

    return (
        <div className="w-full h-screen bg-[#020d0d]">
            <Map
                initialViewState={initialViewState}
                mapStyle={{
                    version: 8,
                    sources: {},
                    layers: [] // Blank base style because we are providing our own drone imagery
                }}
                maplibreLogo={false}
            >
                <NavigationControl position="top-right" />

                {/* --- LAYER 1: The Pit Background Image --- */}
                <Source
                    id="pit-image"
                    type="image"
                    url="/background/MockPit.png"
                    coordinates={imageCoordinates}
                >
                    <Layer
                        id="pit-image-layer"
                        type="raster"
                        paint={{ 'raster-opacity': 0.8, 'raster-saturation': -0.2 }}
                    />
                </Source>

                {/* --- LAYER 2: Easting / Northing Coordinate Grid --- */}
                <Source id="coordinate-grid" type="geojson" data={gridGeoJSON as any}>
                    {/* The lines themselves */}
                    <Layer
                        id="grid-lines"
                        type="line"
                        paint={{
                            'line-color': '#ffffff',
                            'line-opacity': 0.15,
                            'line-dasharray': [2, 2],
                            'line-width': 1
                        }}
                    />
                    {/* The labels for the lines (e.g., "58200E") */}
                    <Layer
                        id="grid-labels"
                        type="symbol"
                        layout={{
                            'text-field': ['get', 'label'],
                            'text-size': 10,
                            'symbol-placement': 'line',
                            'text-offset': [0, -1]
                        }}
                        paint={{
                            'text-color': 'rgba(255,255,255,0.4)'
                        }}
                    />
                </Source>

                {/* --- LAYER 3: Sensor Markers --- */}
                {sensors.map((sensor) => {
                    const [lng, lat] = toLngLat(sensor.easting, sensor.northing);

                    // TARP Logic - you can tweak these thresholds based on your site's actual trigger levels
                    const isCritical = sensor.latest_deformation > 5.0;
                    const isWarning = sensor.latest_deformation > 2.0;

                    const markerColor = isCritical ? 'bg-red-500' : isWarning ? 'bg-orange-500' : 'bg-[#8EB69B]';

                    return (
                        <Marker key={sensor.id} longitude={lng} latitude={lat} anchor="center">
                            <div
                                className="relative group cursor-pointer flex items-center justify-center"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleSensorClick(sensor);
                                }}
                            >
                                {isCritical && <div className={`w-6 h-6 rounded-full ${markerColor} opacity-50 animate-ping absolute`} />}
                                <div className={`w-4 h-4 rounded-full ${markerColor} border border-white flex items-center justify-center z-10 shadow-lg`}>
                                    <Target size={10} className="text-[#020d0d]" />
                                </div>

                                <div className="absolute bottom-full mb-2 hidden group-hover:block bg-black/90 text-white text-[10px] px-2 py-1 rounded border border-white/20 whitespace-nowrap z-50">
                                    <span className={`font-bold ${isCritical ? 'text-red-400' : 'text-[#8EB69B]'}`}>{sensor.id}</span> <br />
                                    Def: {sensor.latest_deformation.toFixed(2)} mm
                                </div>
                            </div>
                        </Marker>
                    );
                })}
            </Map>
        </div>
    );
}
