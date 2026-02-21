import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock3, Eye, EyeOff, Flag, Hash, LogOut, Plus, RotateCw } from "lucide-react";
import maplibregl from "maplibre-gl";
import { createMachine } from "xstate";
import { useMachine } from "@xstate/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicGameState } from "@wego/shared";

const API_URL = "http://localhost:4000";
const ADM1_GEOJSON_URL = `${API_URL}/api/map/adm1`;
const POLITICAL_BASEMAP_STYLE = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "background",
      type: "background",
      paint: {
        "background-color": "#1f2937"
      }
    }
  ]
} as const;

type Country = {
  id: string;
  name: string;
  color: string;
  flagImage?: string | null;
  coatOfArmsImage?: string | null;
  uiShowRegionLabels?: boolean;
};

type CountryPayload = { country: Country };
type MePayload = { country: Country | null };
type HoverRegion = {
  id: string;
  name: string;
  ownerName: string | null;
  contested: boolean;
};

const authMachine = createMachine({
  id: "auth",
  initial: "checking",
  states: {
    checking: {
      on: {
        AUTHED: "authenticated",
        NEED_LOGIN: "unauthenticated"
      }
    },
    unauthenticated: {
      on: {
        SUBMIT: "authenticating"
      }
    },
    authenticating: {
      on: {
        AUTH_SUCCESS: "authenticated",
        AUTH_FAIL: "unauthenticated"
      }
    },
    authenticated: {
      on: {
        LOGOUT: "unauthenticated"
      }
    }
  }
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    try {
      const data = JSON.parse(text) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } };
      const fields = data.details?.fieldErrors;
      if (fields) {
        const firstField = Object.keys(fields)[0];
        const firstMessage = firstField ? fields[firstField]?.[0] : undefined;
        if (firstMessage) {
          throw new Error(firstMessage);
        }
      }

      throw new Error(data.error ?? text);
    } catch {
      throw new Error(text);
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function formatRemaining(ms: number | null): string {
  if (!ms || ms <= 0) return "00:00";
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function getProvinceId(properties: Record<string, unknown> | undefined, index: number): string {
  const direct =
    (properties?.id as string | undefined) ??
    (properties?.shapeID as string | undefined) ??
    (properties?.adm1_code as string | undefined) ??
    (properties?.iso_3166_2 as string | undefined);
  if (direct && direct.trim().length > 0) return direct;

  const neId = properties?.ne_id;
  if (typeof neId === "number" || typeof neId === "string") {
    return `ne_${String(neId)}`;
  }

  const admin = (properties?.admin as string | undefined) ?? "unknown";
  const name = (properties?.name as string | undefined) ?? `province_${index}`;
  return `${admin}:${name}:${index}`;
}

function getProvinceName(properties: Record<string, unknown> | undefined, fallbackId: string): string {
  return (
    (properties?.name as string | undefined) ??
    (properties?.shapeName as string | undefined) ??
    (properties?.name_en as string | undefined) ??
    fallbackId
  );
}

function getPhaseIcon(phase: PublicGameState["snapshot"]["phase"] | undefined) {
  if (phase === "planning") {
    return { icon: <Clock3 size={15} />, color: "text-amber-400", title: "Планирование" };
  }
  if (phase === "resolve") {
    return { icon: <RotateCw size={15} />, color: "text-orange-400", title: "Резолв" };
  }
  return { icon: <Check size={15} />, color: "text-emerald-400", title: "Коммит" };
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const queryClient = useQueryClient();
  const [authState, send] = useMachine(authMachine);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedCountryName, setSelectedCountryName] = useState("");
  const [password, setPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regColor, setRegColor] = useState("#22c55e");
  const [regFlagImage, setRegFlagImage] = useState<string | null>(null);
  const [regCoatOfArmsImage, setRegCoatOfArmsImage] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [selfCountry, setSelfCountry] = useState<Country | null>(null);
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [selectedProvinceName, setSelectedProvinceName] = useState<string | null>(null);
  const [regionsLoadError, setRegionsLoadError] = useState<string | null>(null);
  const [showRegionLabels, setShowRegionLabels] = useState(true);
  const [toggleAnim, setToggleAnim] = useState(false);
  const [hoveredRegion, setHoveredRegion] = useState<HoverRegion | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; provinceId: string; provinceName: string } | null>(null);
  const [colonizationModalOpen, setColonizationModalOpen] = useState(false);
  const [colonizationPointsInput, setColonizationPointsInput] = useState(10);
  const [colonizationTarget, setColonizationTarget] = useState<{ provinceId: string; provinceName: string } | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const regionsGeoJsonRef = useRef<any>(null);

  const countriesQuery = useQuery({
    queryKey: ["countries"],
    queryFn: () => api<{ countries: Country[] }>("/api/countries")
  });

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MePayload>("/api/auth/me"),
    retry: false
  });

  const stateQuery = useQuery({
    queryKey: ["game-state"],
    queryFn: () => api<PublicGameState>("/api/game/state"),
    enabled: !!selfCountry,
    retry: false
  });

  useEffect(() => {
    if (meQuery.data?.country) {
      setSelfCountry(meQuery.data.country);
      send({ type: "AUTHED" });
    } else if (meQuery.data?.country === null || meQuery.isError) {
      send({ type: "NEED_LOGIN" });
    }
  }, [meQuery.data, meQuery.isError, send]);

  useEffect(() => {
    if (stateQuery.data) {
      setGameState(stateQuery.data);
    }
  }, [stateQuery.data]);

  useEffect(() => {
    if (!selfCountry) return;

    const socket = io(API_URL, { withCredentials: true });
    socket.on("game:state", (payload: PublicGameState) => {
      setGameState(payload);
      queryClient.setQueryData(["game-state"], payload);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [selfCountry, queryClient]);

  useEffect(() => {
    if (!gameState?.snapshot.phaseEndsAt) {
      setRemainingMs(null);
      return;
    }

    const tick = () => {
      setRemainingMs(Math.max(0, gameState.snapshot.phaseEndsAt! - Date.now()));
    };

    tick();
    const timerId = window.setInterval(tick, 1000);
    return () => window.clearInterval(timerId);
  }, [gameState?.snapshot.phaseEndsAt]);

  const loginMutation = useMutation({
    mutationFn: (payload: { countryName: string; password: string }) => api<CountryPayload>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
    onMutate: () => send({ type: "SUBMIT" }),
    onSuccess: (data) => {
      setAuthError(null);
      setSelfCountry(data.country);
      send({ type: "AUTH_SUCCESS" });
      queryClient.invalidateQueries({ queryKey: ["game-state"] });
      queryClient.invalidateQueries({ queryKey: ["countries"] });
    },
    onError: (error) => {
      send({ type: "AUTH_FAIL" });
      setAuthError(error instanceof Error ? error.message : "Ошибка входа");
    }
  });

  const registerMutation = useMutation({
    mutationFn: (payload: {
      countryName: string;
      password: string;
      color: string;
      flagImage?: string;
      coatOfArmsImage?: string;
    }) => api<CountryPayload>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
    onSuccess: (data) => {
      setAuthError(null);
      setSelfCountry(data.country);
      send({ type: "AUTH_SUCCESS" });
      setRegisterOpen(false);
      queryClient.invalidateQueries({ queryKey: ["countries"] });
      queryClient.invalidateQueries({ queryKey: ["game-state"] });
    },
    onError: (error) => setAuthError(error instanceof Error ? error.message : "Ошибка регистрации")
  });

  const logoutMutation = useMutation({
    mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      setSelfCountry(null);
      setGameState(null);
      send({ type: "LOGOUT" });
    }
  });

  const colonizationMutation = useMutation({
    mutationFn: (payload: { provinceId: string; provinceName?: string; points: number }) =>
      api("/api/game/colonization", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["game-state"] })
  });

  const readyMutation = useMutation({
    mutationFn: () => api("/api/game/ready", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["game-state"] })
  });

  const uiStateMutation = useMutation({
    mutationFn: (payload: { showRegionLabels: boolean }) =>
      api("/api/game/ui-state", {
        method: "POST",
        body: JSON.stringify(payload)
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["game-state"] })
  });

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: POLITICAL_BASEMAP_STYLE as any,
      center: [10, 25],
      zoom: 1.5
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();

    map.on("load", async () => {
      try {
        const response = await fetch(ADM1_GEOJSON_URL);
        if (!response.ok) {
          throw new Error(`Не удалось загрузить ADM1 карту: ${response.status}`);
        }
        const geojson = await response.json();
        const normalizedGeojson = {
          ...geojson,
          features: (geojson.features ?? []).map((feature: any, index: number) => {
            const provinceId = getProvinceId(feature?.properties, index);
            const provinceName = getProvinceName(feature?.properties, provinceId);
            return {
              ...feature,
              properties: {
                ...(feature?.properties ?? {}),
                id: provinceId,
                name: provinceName
              }
            };
          })
        };
        regionsGeoJsonRef.current = normalizedGeojson;

        map.addSource("provinces", {
          type: "geojson",
          data: normalizedGeojson
        });
      } catch (error) {
        setRegionsLoadError(error instanceof Error ? error.message : "Ошибка загрузки карты регионов");
        return;
      }

      map.addLayer({
        id: "provinces-fill",
        type: "fill",
        source: "provinces",
        paint: {
          "fill-color": ["coalesce", ["get", "ownerColor"], "#ffffff"],
          "fill-opacity": ["case", ["boolean", ["get", "contested"], false], 0.7, 0.12]
        }
      });

      map.addLayer({
        id: "provinces-line",
        type: "line",
        source: "provinces",
        paint: {
          "line-color": ["case", ["boolean", ["get", "contested"], false], "#22c55e", "#f4f4f5"],
          "line-width": ["case", ["boolean", ["get", "contested"], false], 2.2, 1.2]
        }
      });

      map.addLayer({
        id: "provinces-hover",
        type: "line",
        source: "provinces",
        paint: {
          "line-color": "#000000",
          "line-width": 3.2
        },
        filter: ["==", ["get", "id"], ""]
      });

      map.addLayer({
        id: "provinces-hover-fill",
        type: "fill",
        source: "provinces",
        paint: {
          "fill-color": "#000000",
          "fill-opacity": 0.14
        },
        filter: ["==", ["get", "id"], ""]
      });

      // Dedicated transparent hit layer for robust pointer events.
      map.addLayer({
        id: "provinces-hover-hit",
        type: "fill",
        source: "provinces",
        paint: {
          "fill-color": "#000000",
          "fill-opacity": 0.001
        }
      });

      map.addLayer({
        id: "regions-label",
        type: "symbol",
        source: "provinces",
        layout: {
          "text-field": ["get", "name"],
          "text-size": 12
        },
        paint: {
          "text-color": "#e4e4e7",
          "text-halo-color": "#18181b",
          "text-halo-width": 1.2
        }
      });

      map.on("mousemove", "provinces-hover-hit", (event) => {
        map.getCanvas().style.cursor = "pointer";
        const feature = event.features?.[0];
        const id = feature?.properties?.id as string | undefined;
        if (!id) return;
        map.setFilter("provinces-hover", ["==", ["get", "id"], id]);
        map.setFilter("provinces-hover-fill", ["==", ["get", "id"], id]);
        setHoverPos({ x: event.point.x, y: event.point.y });
        setHoveredRegion({
          id,
          name: (feature?.properties?.name as string | undefined) ?? id,
          ownerName: (feature?.properties?.ownerName as string | undefined) ?? null,
          contested: Boolean(feature?.properties?.contested)
        });
      });

      map.on("mouseleave", "provinces-hover-hit", () => {
        map.getCanvas().style.cursor = "";
        map.setFilter("provinces-hover", ["==", ["get", "id"], ""]);
        map.setFilter("provinces-hover-fill", ["==", ["get", "id"], ""]);
        setHoveredRegion(null);
      });

      // Reliable RMB handling: use native canvas mousedown and query rendered region manually.
      const canvas = map.getCanvas();
      const handleNativeContextMenu = (e: MouseEvent) => {
        e.preventDefault();
      };
      const handleNativeMouseDown = (e: MouseEvent) => {
        if (e.button !== 2) return;
        e.preventDefault();
        e.stopPropagation();

        const rect = canvas.getBoundingClientRect();
        const point = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        };
        const features = map.queryRenderedFeatures([point.x, point.y], { layers: ["provinces-hover-hit"] });
        const feature = features[0];
        const provinceId = feature?.properties?.id as string | undefined;
        const provinceName = (feature?.properties?.name as string | undefined) ?? provinceId;
        if (!provinceId) return;

        setContextMenu({
          x: point.x,
          y: point.y,
          provinceId,
          provinceName: provinceName ?? provinceId
        });
      };
      const handleMapContextMenu = (event: maplibregl.MapMouseEvent) => {
        event.preventDefault();
        const features = map.queryRenderedFeatures(event.point, { layers: ["provinces-hover-hit"] });
        const feature = features[0];
        const provinceId = feature?.properties?.id as string | undefined;
        const provinceName = (feature?.properties?.name as string | undefined) ?? provinceId;
        if (!provinceId) return;
        setContextMenu({
          x: event.point.x,
          y: event.point.y,
          provinceId,
          provinceName: provinceName ?? provinceId
        });
      };
      canvas.addEventListener("contextmenu", handleNativeContextMenu);
      canvas.addEventListener("mousedown", handleNativeMouseDown);
      map.on("contextmenu", handleMapContextMenu);

      map.on("click", "provinces-hover-hit", (event) => {
        setContextMenu(null);
        const feature = event.features?.[0];
        const provinceId = feature?.properties?.id as string | undefined;
        const provinceName = (feature?.properties?.name as string | undefined) ?? provinceId;
        if (provinceId) {
          setSelectedProvinceId(provinceId);
          setSelectedProvinceName(provinceName ?? provinceId);
        }
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !gameState || !countriesQuery.data || !regionsGeoJsonRef.current) return;

    const countryColors = new Map(countriesQuery.data.countries.map((c) => [c.id, c.color]));

    const source = map.getSource("provinces") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    const styledGeojson = {
      type: "FeatureCollection",
      features: regionsGeoJsonRef.current.features.map((feature: any) => {
        const featureId = feature.properties.id;
        const province = gameState.provinces.find((item) => item.id === featureId);
        const ownerColor = province?.ownerCountryId ? countryColors.get(province.ownerCountryId) : null;

        return {
          ...feature,
          properties: {
            ...feature.properties,
            id: featureId,
            name: feature.properties.name ?? featureId,
            ownerCountryId: province?.ownerCountryId ?? null,
            ownerName: province?.ownerCountryId ? countriesQuery.data.countries.find((c) => c.id === province.ownerCountryId)?.name ?? null : null,
            ownerColor,
            contested: province?.isContested ?? false
          }
        };
      })
    };

    source.setData(styledGeojson as any);
  }, [countriesQuery.data, gameState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const updateVisibility = () => {
      if (!map.getLayer("regions-label")) return;
      map.setLayoutProperty("regions-label", "visibility", showRegionLabels ? "visible" : "none");
    };

    if (map.isStyleLoaded()) {
      updateVisibility();
    } else {
      map.once("load", updateVisibility);
    }
  }, [showRegionLabels]);

  useEffect(() => {
    if (!selfCountry || !gameState) return;
    const value = gameState.uiStateByCountry?.[selfCountry.id]?.showRegionLabels;
    if (typeof value === "boolean") {
      setShowRegionLabels(value);
    }
  }, [gameState, selfCountry]);

  const readySet = useMemo(() => new Set(gameState?.snapshot.readyCountries ?? []), [gameState]);
  const isSelfReady = selfCountry ? readySet.has(selfCountry.id) : false;
  const phaseUI = getPhaseIcon(gameState?.snapshot.phase);
  const selfColonizationPoints = selfCountry ? gameState?.countryResourcesById?.[selfCountry.id]?.colonizationPoints ?? 0 : 0;
  const selectedProvinceCost = selectedProvinceId
    ? gameState?.provinces.find((province) => province.id === selectedProvinceId)?.colonizationCost ?? 100
    : 100;
  const selfSelectedProvinceProgress =
    selfCountry && selectedProvinceId
      ? gameState?.colonizationProgress.find(
          (entry) => entry.countryId === selfCountry.id && entry.provinceId === selectedProvinceId
        )?.progress ?? 0
      : 0;

  const authOpen = authState.matches("unauthenticated") || authState.matches("authenticating") || authState.matches("checking");

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-900 text-white">
      <div ref={mapContainerRef} className="absolute inset-0" />

      <div className="absolute left-0 top-0 z-20 w-full border-b border-zinc-700/80 bg-zinc-950/85 backdrop-blur-md">
        <div className="absolute left-0 top-0 h-full w-40 border-r border-zinc-700/80 bg-zinc-900/95 p-2">
          <div className="h-full w-full rounded-lg bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-800 p-[2px] shadow-[0_0_18px_rgba(0,0,0,0.4)]">
            <div className="relative h-full w-full overflow-hidden rounded-[7px] border border-zinc-700/80">
              {selfCountry?.flagImage ? (
                <img className="h-full w-full object-cover" src={selfCountry.flagImage} alt="Флаг страны" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] tracking-wider text-zinc-500">FLAG</div>
              )}
            </div>
          </div>
        </div>
        {regionsLoadError && <p className="mb-2 text-xs text-red-300">{regionsLoadError}</p>}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 pl-[176px]">
          {selectedProvinceName && (
            <div className="rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-sm">
              <span className="text-zinc-400">Регион</span> <span className="font-semibold text-white">{selectedProvinceName}</span>
            </div>
          )}
          {selfCountry && (
            <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-sm">
              <span className="text-zinc-400">Страна</span>
              <span className="font-semibold" style={{ color: selfCountry.color }}>
                {selfCountry.name}
              </span>
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-green-400">{selfColonizationPoints} CP</span>
              {selfCountry?.coatOfArmsImage && (
                <img className="h-6 w-6 rounded border border-zinc-700 object-cover" src={selfCountry.coatOfArmsImage} alt="Герб страны" />
              )}
            </div>
          )}
          <button
            className="ml-auto flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-300 transition hover:border-green-500 hover:text-green-400"
            title="Таймер хода"
            aria-label="Таймер хода"
          >
            <Clock3 size={15} />
            <span className="font-semibold">{formatRemaining(remainingMs)}</span>
          </button>
          <button
            className={`flex items-center rounded-md border border-zinc-700 bg-zinc-900/90 p-2 text-sm transition hover:border-green-500 ${phaseUI.color}`}
            title={phaseUI.title}
            aria-label={phaseUI.title}
          >
            {phaseUI.icon}
          </button>
          <button
            className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-300 transition hover:border-green-500 hover:text-green-400"
            title={`Ход #${gameState?.snapshot.turnNumber ?? "-"}`}
            aria-label={`Ход #${gameState?.snapshot.turnNumber ?? "-"}`}
          >
            <Hash size={15} />
            <span className="font-semibold">{gameState?.snapshot.turnNumber ?? "-"}</span>
          </button>
          <button
            className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-300 transition hover:border-green-500 hover:text-green-400 disabled:opacity-60"
            onClick={() => readyMutation.mutate()}
            disabled={!selfCountry || isSelfReady || gameState?.snapshot.phase !== "planning"}
            title={isSelfReady ? "Ход отправлен" : "Сделать ход"}
            aria-label={isSelfReady ? "Ход отправлен" : "Сделать ход"}
          >
            <Check size={15} />
          </button>
          {selfCountry && (
            <button
              className="rounded-md border border-zinc-700 bg-zinc-900/90 p-2 text-zinc-300 transition hover:border-green-500 hover:text-green-400"
              onClick={() => logoutMutation.mutate()}
              title="Выход"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </div>

      <Dialog.Root open={authOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="auth-overlay fixed inset-0 z-40 bg-zinc-950/80 backdrop-blur-md" />
          <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center px-6 py-10">
            <div className="auth-card w-full max-w-4xl overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-900/95 shadow-2xl">
              <div className="grid min-h-[70vh] grid-cols-1 md:grid-cols-2">
                <div className="relative hidden overflow-hidden border-r border-zinc-800 md:block">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,197,94,0.3),transparent_60%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.08),transparent_55%)]" />
                  <div className="relative z-10 flex h-full flex-col justify-between p-8">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-zinc-400">WEGO GLOBAL</p>
                      <h2 className="mt-4 text-3xl font-semibold leading-tight text-white">
                        Вход в
                        <br />
                        стратегическую
                        <br />
                        кампанию
                      </h2>
                    </div>
                    <p className="text-sm text-zinc-300">Выберите страну, войдите по паролю и переходите в глобальный ход.</p>
                  </div>
                </div>

                <div className="p-6 md:p-10">
                  <Dialog.Title className="text-2xl font-semibold">Авторизация страны</Dialog.Title>
                  <Dialog.Description className="mt-2 text-sm text-zinc-400">Выберите страну и введите пароль.</Dialog.Description>

                  <div className="mt-6 space-y-4">
                    {authError && (
                      <div className="rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-2 text-xs text-red-300">{authError}</div>
                    )}
                    <select
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm outline-none transition focus:border-green-500"
                      value={selectedCountryName}
                      onChange={(event) => setSelectedCountryName(event.target.value)}
                    >
                      <option value="">Выберите страну</option>
                      {countriesQuery.data?.countries.map((country) => (
                        <option key={country.id} value={country.name}>
                          {country.name}
                        </option>
                      ))}
                    </select>

                    <input
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm outline-none transition focus:border-green-500"
                      type="password"
                      placeholder="Пароль"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />

                    <button
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 px-3 py-3 text-sm font-semibold transition hover:bg-zinc-700 hover:text-green-400 disabled:opacity-60"
                      onClick={() => loginMutation.mutate({ countryName: selectedCountryName, password })}
                      disabled={!selectedCountryName || !password}
                    >
                      <Flag size={16} />
                      Войти в игру
                    </button>
                  </div>

                  <Dialog.Root open={registerOpen} onOpenChange={setRegisterOpen}>
                    <Dialog.Trigger asChild>
                      <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 py-3 text-sm transition hover:border-green-500 hover:text-green-400">
                        <Plus size={16} />
                        Регистрация страны
                      </button>
                    </Dialog.Trigger>

                    <Dialog.Portal>
                      <Dialog.Overlay className="auth-overlay fixed inset-0 z-[60] bg-zinc-950/85 backdrop-blur-md" />
                      <Dialog.Content className="fixed inset-0 z-[70] flex items-center justify-center px-6 py-10">
                        <div className="auth-card w-full max-w-3xl rounded-2xl border border-zinc-700/70 bg-zinc-900/95 p-8 shadow-2xl">
                          <Dialog.Title className="text-2xl font-semibold">Регистрация страны</Dialog.Title>
                          <Dialog.Description className="mt-2 text-sm text-zinc-400">
                            Укажите название, пароль и цвет вашей страны.
                          </Dialog.Description>
                          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
                            <input
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm outline-none transition focus:border-green-500"
                              placeholder="Название страны"
                              value={regName}
                              onChange={(event) => setRegName(event.target.value)}
                            />
                            <input
                              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3 text-sm outline-none transition focus:border-green-500"
                              type="password"
                              placeholder="Пароль"
                              value={regPassword}
                              onChange={(event) => setRegPassword(event.target.value)}
                            />
                            <div className="flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3">
                              <label className="text-sm text-zinc-400" htmlFor="color">
                                Цвет страны:
                              </label>
                              <input
                                id="color"
                                className="h-9 w-16 cursor-pointer rounded border border-zinc-700 bg-zinc-900"
                                type="color"
                                value={regColor}
                                onChange={(event) => setRegColor(event.target.value)}
                              />
                            </div>
                            <div className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3">
                              <label className="block text-sm text-zinc-400" htmlFor="flagImage">
                                Флаг страны
                              </label>
                              <input
                                id="flagImage"
                                className="w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-xs file:text-white"
                                type="file"
                                accept="image/*"
                                onChange={async (event) => {
                                  const file = event.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    setRegFlagImage(await fileToDataUrl(file));
                                  } catch (error) {
                                    setAuthError(error instanceof Error ? error.message : "Ошибка загрузки флага");
                                  }
                                }}
                              />
                              {regFlagImage && <img className="h-14 w-20 rounded border border-zinc-700 object-cover" src={regFlagImage} alt="Предпросмотр флага" />}
                            </div>
                            <div className="space-y-2 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-3">
                              <label className="block text-sm text-zinc-400" htmlFor="coatImage">
                                Герб страны
                              </label>
                              <input
                                id="coatImage"
                                className="w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-700 file:px-2 file:py-1 file:text-xs file:text-white"
                                type="file"
                                accept="image/*"
                                onChange={async (event) => {
                                  const file = event.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    setRegCoatOfArmsImage(await fileToDataUrl(file));
                                  } catch (error) {
                                    setAuthError(error instanceof Error ? error.message : "Ошибка загрузки герба");
                                  }
                                }}
                              />
                              {regCoatOfArmsImage && (
                                <img className="h-14 w-14 rounded border border-zinc-700 object-cover" src={regCoatOfArmsImage} alt="Предпросмотр герба" />
                              )}
                            </div>
                            <button
                              className="rounded-lg bg-zinc-800 px-3 py-3 text-sm font-semibold transition hover:bg-zinc-700 hover:text-green-400 disabled:opacity-60"
                              onClick={() =>
                                registerMutation.mutate({
                                  countryName: regName,
                                  password: regPassword,
                                  color: regColor,
                                  flagImage: regFlagImage ?? undefined,
                                  coatOfArmsImage: regCoatOfArmsImage ?? undefined
                                })
                              }
                              disabled={!regName || !regPassword}
                            >
                              Зарегистрировать
                            </button>
                          </div>
                        </div>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <button
        className={`absolute bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900/90 p-3 text-white backdrop-blur transition hover:-translate-y-0.5 hover:scale-105 hover:border-green-500 hover:text-green-400 active:translate-y-0 active:scale-100 ${
          toggleAnim ? "icon-toggle-animate" : ""
        }`}
        onClick={() => {
          const nextValue = !showRegionLabels;
          setShowRegionLabels(nextValue);
          uiStateMutation.mutate({ showRegionLabels: nextValue });
          setToggleAnim(false);
          requestAnimationFrame(() => setToggleAnim(true));
        }}
        onAnimationEnd={() => setToggleAnim(false)}
        title={showRegionLabels ? "Скрыть названия провинций" : "Показать названия провинций"}
        aria-label={showRegionLabels ? "Скрыть названия провинций" : "Показать названия провинций"}
      >
        {showRegionLabels ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>

      {hoveredRegion && (
        <div
          className="pointer-events-none absolute z-30 min-w-[220px] rounded-lg border border-zinc-700 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-200 shadow-xl"
          style={{
            left: Math.min(hoverPos.x + 16, window.innerWidth - 260),
            top: Math.max(hoverPos.y - 12, 80)
          }}
        >
          <p className="text-sm font-semibold text-white">{hoveredRegion.name}</p>
          <p className="mt-1 text-zinc-400">ID: {hoveredRegion.id}</p>
          <p className="mt-1">
            Контроль: <span className="text-white">{hoveredRegion.ownerName ?? "Нейтрально"}</span>
          </p>
          {hoveredRegion.contested && <p className="mt-1 font-semibold text-green-400">Оспаривается</p>}
        </div>
      )}

      {contextMenu && (
        <div
          className="absolute z-40 w-44 rounded-lg border border-zinc-700 bg-zinc-900/95 p-2 shadow-2xl"
          style={{
            left: Math.min(contextMenu.x + 12, window.innerWidth - 200),
            top: Math.min(contextMenu.y + 12, window.innerHeight - 120)
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <p className="mb-2 text-xs text-zinc-400">{contextMenu.provinceName}</p>
          <button
            className="w-full rounded-md border border-zinc-700 px-3 py-2 text-left text-sm transition hover:border-green-500 hover:text-green-400"
            onClick={() => {
              setColonizationTarget({
                provinceId: contextMenu.provinceId,
                provinceName: contextMenu.provinceName
              });
              setSelectedProvinceId(contextMenu.provinceId);
              setSelectedProvinceName(contextMenu.provinceName);
              setColonizationPointsInput(Math.max(1, Math.min(100, selfColonizationPoints || 1)));
              setColonizationModalOpen(true);
              setContextMenu(null);
            }}
          >
            Колонизация
          </button>
        </div>
      )}

      <Dialog.Root open={colonizationModalOpen} onOpenChange={setColonizationModalOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
            <Dialog.Title className="text-lg font-semibold">Колонизация провинции</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-zinc-400">
              {colonizationTarget?.provinceName ?? selectedProvinceName ?? "Провинция не выбрана"}
            </Dialog.Description>
            <div className="mt-4 space-y-3 text-sm">
              <p>
                Доступно очков: <span className="font-semibold text-green-400">{selfColonizationPoints}</span>
              </p>
              <p>
                Ваш прогресс:{" "}
                <span className="font-semibold">
                  {selfSelectedProvinceProgress}/{selectedProvinceCost}
                </span>
              </p>
              <input
                className="w-full"
                type="range"
                min={1}
                max={Math.max(1, selfColonizationPoints)}
                value={Math.min(colonizationPointsInput, Math.max(1, selfColonizationPoints))}
                onChange={(event) => setColonizationPointsInput(Number(event.target.value))}
                disabled={selfColonizationPoints <= 0}
              />
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-green-500"
                type="number"
                min={1}
                max={selfColonizationPoints}
                value={colonizationPointsInput}
                onChange={(event) => setColonizationPointsInput(Number(event.target.value))}
                disabled={selfColonizationPoints <= 0}
              />
              <button
                className="w-full rounded-md border border-zinc-700 px-3 py-2 text-sm transition hover:border-green-500 hover:text-green-400 disabled:opacity-60"
                disabled={!colonizationTarget || selfColonizationPoints <= 0 || colonizationPointsInput <= 0}
                onClick={() => {
                  if (!colonizationTarget) return;
                  const points = Math.min(Math.max(1, Math.floor(colonizationPointsInput)), selfColonizationPoints);
                  colonizationMutation.mutate(
                    {
                      provinceId: colonizationTarget.provinceId,
                      provinceName: colonizationTarget.provinceName,
                      points
                    },
                    {
                      onSuccess: () => setColonizationModalOpen(false)
                    }
                  );
                }}
              >
                Начать колонизацию
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
