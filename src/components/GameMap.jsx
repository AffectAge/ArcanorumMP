import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";

const ADMIN_REGIONS_SOURCE_ID = "admin-regions";
const ADMIN_REGIONS_FILL_LAYER_ID = "admin-regions-fill";
const ADMIN_REGIONS_LINE_LAYER_ID = "admin-regions-line";
const ADMIN_REGIONS_HOVER_LAYER_ID = "admin-regions-hover";
const ADMIN_REGIONS_URL = "/admin_regions.geojson";

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function countryToCoordinate(countryId) {
  const hash = hashString(countryId || "country");
  const lng = -170 + (hash % 340);
  const lat = -55 + ((hash >> 8) % 120);
  return [lng, lat];
}

export function GameMap({ countries, players, activeCountryId }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const hoveredRegionRef = useRef(null);

  const onlineCountByCountry = useMemo(() => {
    const counts = new Map();
    for (const player of players) {
      if (!player.connected) {
        continue;
      }
      const current = counts.get(player.countryId) ?? 0;
      counts.set(player.countryId, current + 1);
    }
    return counts;
  }, [players]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    mapRef.current = new maplibregl.Map({
      container: containerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [20, 20],
      zoom: 2.1,
      minZoom: 1.4,
      maxZoom: 7,
      attributionControl: false,
    });

    const map = mapRef.current;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      if (!map.getSource(ADMIN_REGIONS_SOURCE_ID)) {
        map.addSource(ADMIN_REGIONS_SOURCE_ID, {
          type: "geojson",
          data: ADMIN_REGIONS_URL,
        });
      }

      if (!map.getLayer(ADMIN_REGIONS_FILL_LAYER_ID)) {
        map.addLayer({
          id: ADMIN_REGIONS_FILL_LAYER_ID,
          type: "fill",
          source: ADMIN_REGIONS_SOURCE_ID,
          paint: {
            "fill-color": "#0f0f0f",
            "fill-opacity": 0.24,
          },
        });
      }

      if (!map.getLayer(ADMIN_REGIONS_LINE_LAYER_ID)) {
        map.addLayer({
          id: ADMIN_REGIONS_LINE_LAYER_ID,
          type: "line",
          source: ADMIN_REGIONS_SOURCE_ID,
          paint: {
            "line-color": "#22C55E",
            "line-width": 1.15,
            "line-opacity": 0.95,
          },
        });
      }

      if (!map.getLayer(ADMIN_REGIONS_HOVER_LAYER_ID)) {
        map.addLayer({
          id: ADMIN_REGIONS_HOVER_LAYER_ID,
          type: "line",
          source: ADMIN_REGIONS_SOURCE_ID,
          paint: {
            "line-color": "#F59E0B",
            "line-width": 2.6,
            "line-opacity": 0.95,
          },
          filter: ["==", ["id"], -1],
        });
      }

      map.on("mousemove", ADMIN_REGIONS_FILL_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        map.getCanvas().style.cursor = "pointer";
        hoveredRegionRef.current = feature.id;
        map.setFilter(ADMIN_REGIONS_HOVER_LAYER_ID, ["==", ["id"], feature.id]);
      });

      map.on("mouseleave", ADMIN_REGIONS_FILL_LAYER_ID, () => {
        map.getCanvas().style.cursor = "";
        hoveredRegionRef.current = null;
        map.setFilter(ADMIN_REGIONS_HOVER_LAYER_ID, ["==", ["id"], -1]);
      });

      map.on("click", ADMIN_REGIONS_FILL_LAYER_ID, (event) => {
        const feature = event.features?.[0];
        if (!feature) {
          return;
        }

        const regionName =
          feature.properties?.name ??
          feature.properties?.name_en ??
          feature.properties?.woe_label ??
          "Unknown region";
        const countryName =
          feature.properties?.admin ??
          feature.properties?.geonunit ??
          feature.properties?.adm0name ??
          "Unknown country";

        new maplibregl.Popup({ closeButton: false, offset: 12 })
          .setLngLat(event.lngLat)
          .setHTML(
            `<strong>${regionName}</strong><br/><span>${countryName}</span>`,
          )
          .addTo(map);
      });
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    for (const marker of markersRef.current) {
      marker.remove();
    }
    markersRef.current = [];

    for (const country of countries) {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "h-5 w-5 rounded-full border-2 border-white/70 shadow-[0_0_0_4px_rgba(15,23,42,0.5)]";
      element.style.background = country.color;
      if (country.id === activeCountryId) {
        element.className += " ring-4 ring-cyan-400/70";
      }

      const online = onlineCountByCountry.get(country.id) ?? 0;
      const popup = new maplibregl.Popup({ offset: 15 }).setHTML(
        `<strong>${country.name}</strong><br/>Online: ${online}`,
      );

      const marker = new maplibregl.Marker({ element })
        .setLngLat(countryToCoordinate(country.id))
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    }
  }, [countries, onlineCountByCountry, activeCountryId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
