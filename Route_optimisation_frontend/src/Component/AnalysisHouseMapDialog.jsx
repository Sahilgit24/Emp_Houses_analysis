import {useEffect, useMemo, useRef, useState} from "react";
import L from "leaflet";
import {MapContainer, Marker, Polygon, Popup, TileLayer, useMap} from "react-leaflet";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";

const HOUSE_STATUS_ICON_PATHS = {
    own: "/house-icons/collected-by-me.jpeg",
    other: "/house-icons/collected-by-others.jpeg",
    attention: "/house-icons/needs-attention.jpeg",
    remaining: "/house-icons/not-collected.jpeg",
};

function coordinatesFor(house) {
    const latitude = Array.isArray(house) ? house[0] : house?.lat;
    const longitude = Array.isArray(house) ? house[1] : house?.lon;
    if (latitude == null || longitude == null || latitude === "" || longitude === "") return null;
    const lat = Number(latitude);
    const lon = Number(longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

function houseKey(item) {
    return `${item.beatName || ""}\u0000${item.house.houseId}`;
}

function HouseMapViewport({houses, geofencePolygons, selectedHouse}) {
    const map = useMap();

    useEffect(() => {
        const selectedCoordinates = selectedHouse ? coordinatesFor(selectedHouse.house) : null;
        if (selectedCoordinates) {
            map.flyTo(selectedCoordinates, Math.max(map.getZoom(), 16), {duration: 0.4});
            return;
        }

        const points = houses
            .map(({house}) => coordinatesFor(house))
            .filter(Boolean);
        const fencePoints = geofencePolygons.flatMap((polygon) =>
            polygon
                .map((point) => coordinatesFor(point))
                .filter(Boolean)
        );
        const bounds = [...points, ...fencePoints];

        if (bounds.length > 1) map.fitBounds(bounds, {padding: [24, 24]});
        else if (bounds.length === 1) map.setView(bounds[0], 16);
    }, [geofencePolygons, houses, map, selectedHouse]);

    return null;
}

function HouseMarker({item, selected, onSelect}) {
    const markerRef = useRef(null);
    const icon = useMemo(() => {
        const iconSize = selected ? [38, 53] : [32, 45];
        return L.icon({
            iconUrl: HOUSE_STATUS_ICON_PATHS[item.markerStatus] || HOUSE_STATUS_ICON_PATHS.own,
            iconSize,
            iconAnchor: [iconSize[0] / 2, iconSize[1] - 1],
            popupAnchor: [0, -iconSize[1] + 3],
        });
    }, [item.markerStatus, selected]);

    useEffect(() => {
        if (selected) markerRef.current?.openPopup();
    }, [selected]);

    const coordinates = coordinatesFor(item.house);
    if (!coordinates) return null;

    return (
        <Marker
            ref={markerRef}
            position={coordinates}
            icon={icon}
            eventHandlers={{click: onSelect}}
        >
            <Popup>
                <div className="min-w-36">
                    <p className="font-semibold">House {item.house.houseId}</p>
                    <p>{item.statusLabel}</p>
                    {item.lastScannedDate && <p>Last scanned: {item.lastScannedDate}</p>}
                    {item.scannerName && <p>Collected by: {item.scannerName}</p>}
                    {item.beatName && <p>Beat: {item.beatName}</p>}
                    {item.currentGapDays != null && <p>Days since scan: {item.currentGapDays}</p>}
                    {item.typicalIntervalDays != null && <p>Typical interval: {item.typicalIntervalDays} days</p>}
                    {item.detailText && <p>{item.detailText}</p>}
                    <p className="text-xs text-slate-500">
                        {coordinates[0].toFixed(6)}, {coordinates[1].toFixed(6)}
                    </p>
                </div>
            </Popup>
        </Marker>
    );
}

export default function AnalysisHouseMapDialog({
    open,
    onOpenChange,
    title,
    description,
    houses,
    geofencePolygons = [],
}) {
    const [selectedHouseId, setSelectedHouseId] = useState(null);
    const selectedHouse = houses.find((item) => houseKey(item) === selectedHouseId) || null;
    const coordinates = houses.map(({house}) => coordinatesFor(house)).filter(Boolean);
    const fenceCoordinates = geofencePolygons.flatMap((polygon) =>
        polygon.map((point) => coordinatesFor(point)).filter(Boolean)
    );
    const center = coordinates[0] || fenceCoordinates[0] || [0, 0];

    useEffect(() => {
        if (!open) setSelectedHouseId(null);
    }, [open, houses]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                overlayClassName="z-[1000]"
                className="z-[1001] flex h-[90vh] w-[calc(100vw-2rem)] max-h-[900px] flex-col gap-3 overflow-hidden p-4 sm:max-w-7xl"
            >
                <DialogHeader className="shrink-0 pr-8">
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <section aria-label="House list" className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200">
                        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                            Houses <span className="font-normal text-slate-500">({houses.length})</span>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {houses.length ? houses.map((item, index) => {
                                const isSelected = houseKey(item) === selectedHouseId;
                                const location = coordinatesFor(item.house);
                                return (
                                    <button
                                        type="button"
                                        key={houseKey(item)}
                                        onClick={() => setSelectedHouseId(houseKey(item))}
                                        aria-pressed={isSelected}
                                        className={`flex w-full items-start gap-3 border-b border-slate-100 px-3 py-3 text-left transition hover:bg-green-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-green-600 ${isSelected ? "bg-green-50" : "bg-white"}`}
                                    >
                                        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-green-100 text-xs font-bold text-green-800">
                                            {index + 1}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-semibold text-slate-900">
                                                House {item.house.houseId}
                                            </span>
                                            <span className="mt-0.5 block text-xs text-slate-600">{item.statusLabel}</span>
                                            {(item.lastScannedDate || item.scannerName) && (
                                                <span className="mt-1 block truncate text-xs text-slate-500">
                                                    {[item.lastScannedDate, item.scannerName].filter(Boolean).join(" | ")}
                                                </span>
                                            )}
                                            {item.detailText && (
                                                <span className="mt-1 block text-xs text-slate-500">{item.detailText}</span>
                                            )}
                                            {!location && (
                                                <span className="mt-1 block text-xs text-amber-700">Location unavailable</span>
                                            )}
                                        </span>
                                        {item.beatName && (
                                            <span className="max-w-28 truncate text-right text-xs text-slate-500">{item.beatName}</span>
                                        )}
                                    </button>
                                );
                            }) : (
                                <p className="p-6 text-center text-sm text-slate-500">No houses in this group.</p>
                            )}
                        </div>
                    </section>
                    <section aria-label="House map" className="min-h-0 overflow-hidden rounded-lg border border-slate-200">
                        <MapContainer center={center} zoom={14} scrollWheelZoom className="h-[38vh] w-full lg:h-full">
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                            <HouseMapViewport
                                houses={houses}
                                geofencePolygons={geofencePolygons}
                                selectedHouse={selectedHouse}
                            />
                            {geofencePolygons.map((polygon, index) => {
                                const points = polygon
                                    .map((point) => coordinatesFor(point))
                                    .filter(Boolean);
                                return points.length > 2 ? (
                                    <Polygon
                                        key={`geofence-${index}`}
                                        positions={points}
                                        pathOptions={{color: "#dc2626", weight: 3, fillColor: "#dc2626", fillOpacity: 0.08, dashArray: "7 5"}}
                                    />
                                ) : null;
                            })}
                            {houses.map((item) => (
                                <HouseMarker
                                    key={houseKey(item)}
                                    item={item}
                                    selected={houseKey(item) === selectedHouseId}
                                    onSelect={() => setSelectedHouseId(houseKey(item))}
                                />
                            ))}
                        </MapContainer>
                    </section>
                </div>
                <p className="shrink-0 text-xs text-slate-500">
                    Select a house in the list or on the map to highlight it and view its details.
                </p>
            </DialogContent>
        </Dialog>
    );
}
