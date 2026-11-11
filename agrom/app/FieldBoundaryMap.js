"use client";

import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMapEvents } from "react-leaflet";

function BoundaryClickHandler({ onPoint }) {
  useMapEvents({
    click(event) {
      onPoint([event.latlng.lng, event.latlng.lat]);
    },
  });
  return null;
}

export default function FieldBoundaryMap({ center, points, onAddPoint }) {
  const positions = points.map(([longitude, latitude]) => [latitude, longitude]);

  return (
    <MapContainer
      center={[center.latitude, center.longitude]}
      zoom={15}
      minZoom={4}
      maxZoom={19}
      scrollWheelZoom
      className="field-drawing-map"
    >
      <TileLayer
        attribution="Imagery © Esri"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />
      <BoundaryClickHandler onPoint={onAddPoint} />
      {positions.length >= 3
        ? <Polygon positions={positions} pathOptions={{ color: "#87e1a7", fillColor: "#4dca7a", fillOpacity: 0.18, weight: 3 }} />
        : positions.length >= 2 && <Polyline positions={positions} pathOptions={{ color: "#87e1a7", weight: 3, dashArray: "7 5" }} />}
      {positions.map((position, index) => <CircleMarker center={position} radius={5} pathOptions={{ color: "#f4fff7", fillColor: "#36bf70", fillOpacity: 1, weight: 2 }} key={`${position[0]}-${position[1]}-${index}`} />)}
    </MapContainer>
  );
}