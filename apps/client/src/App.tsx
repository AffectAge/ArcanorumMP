import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flag, LogOut, Plus } from "lucide-react";
import maplibregl from "maplibre-gl";
import { createMachine } from "xstate";
import { useMachine } from "@xstate/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { PublicGameState, SubmitOrderInput } from "@wego/shared";

const API_URL = "http://localhost:4000";

type Country = {
  id: string;
  name: string;
  color: string;
};

type CountryPayload = { country: Country };
type MePayload = { country: Country | null };

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

export default function App() {
  const queryClient = useQueryClient();
  const [authState, send] = useMachine(authMachine);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [selectedCountryName, setSelectedCountryName] = useState("");
  const [password, setPassword] = useState("");
  const [regName, setRegName] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regColor, setRegColor] = useState("#22c55e");
  const [authError, setAuthError] = useState<string | null>(null);
  const [gameState, setGameState] = useState<PublicGameState | null>(null);
  const [selfCountry, setSelfCountry] = useState<Country | null>(null);
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const socketRef = useRef<Socket | null>(null);

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
    mutationFn: (payload: { countryName: string; password: string; color: string }) => api<CountryPayload>("/api/auth/register", {
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

  const submitOrderMutation = useMutation({
    mutationFn: (payload: SubmitOrderInput) => api("/api/game/orders", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["game-state"] })
  });

  const readyMutation = useMutation({
    mutationFn: () => api("/api/game/ready", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["game-state"] })
  });

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://demotiles.maplibre.org/style.json",
      center: [5, 38],
      zoom: 2.8
    });

    map.on("load", () => {
      map.addSource("provinces", {
        type: "geojson",
        data: "/provinces.geojson"
      });

      map.addLayer({
        id: "provinces-fill",
        type: "fill",
        source: "provinces",
        paint: {
          "fill-color": ["coalesce", ["get", "ownerColor"], "#3f3f46"],
          "fill-opacity": ["case", ["boolean", ["get", "contested"], false], 0.9, 0.55]
        }
      });

      map.addLayer({
        id: "provinces-line",
        type: "line",
        source: "provinces",
        paint: {
          "line-color": ["case", ["boolean", ["get", "contested"], false], "#22c55e", "#ffffff"],
          "line-width": ["case", ["==", ["get", "id"], ""], 1, 1.5]
        }
      });

      map.on("mousemove", "provinces-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });

      map.on("mouseleave", "provinces-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      map.on("click", "provinces-fill", (event) => {
        const feature = event.features?.[0];
        const provinceId = feature?.properties?.id as string | undefined;
        if (provinceId) {
          setSelectedProvinceId(provinceId);
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
    if (!map || !gameState || !countriesQuery.data) return;

    const countryColors = new Map(countriesQuery.data.countries.map((c) => [c.id, c.color]));

    const source = map.getSource("provinces") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    fetch("/provinces.geojson")
      .then((response) => response.json())
      .then((geojson) => {
        geojson.features = geojson.features.map((feature: any) => {
          const province = gameState.provinces.find((item) => item.id === feature.properties.id);
          const ownerColor = province?.ownerCountryId ? countryColors.get(province.ownerCountryId) : null;

          return {
            ...feature,
            properties: {
              ...feature.properties,
              ownerColor,
              contested: province?.isContested ?? false
            }
          };
        });

        source.setData(geojson);
      })
      .catch(() => undefined);
  }, [countriesQuery.data, gameState]);

  const readySet = useMemo(() => new Set(gameState?.snapshot.readyCountries ?? []), [gameState]);
  const isSelfReady = selfCountry ? readySet.has(selfCountry.id) : false;

  const authOpen = authState.matches("unauthenticated") || authState.matches("authenticating") || authState.matches("checking");

  return (
    <div className="relative h-full w-full overflow-hidden bg-zinc-900 text-white">
      <div ref={mapContainerRef} className="absolute inset-0" />

      <div className="absolute left-4 top-4 z-20 w-[360px] rounded-xl border border-zinc-700/80 bg-zinc-900/85 p-4 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-400">WeGo</p>
            <p className="text-lg font-semibold">Ход #{gameState?.snapshot.turnNumber ?? "-"}</p>
          </div>
          {selfCountry && (
            <button
              className="rounded-md border border-zinc-700 p-2 text-zinc-300 transition hover:border-green-500 hover:text-green-400"
              onClick={() => logoutMutation.mutate()}
              title="Выход"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-zinc-800/70 p-2">
            <p className="text-zinc-400">Фаза</p>
            <p className="font-semibold text-green-400">{gameState?.snapshot.phase ?? "-"}</p>
          </div>
          <div className="rounded-lg bg-zinc-800/70 p-2">
            <p className="text-zinc-400">Таймер</p>
            <p className="font-semibold">{formatRemaining(remainingMs)}</p>
          </div>
        </div>

        <div className="mt-3 text-sm text-zinc-300">
          <p>
            Вы выбрали провинцию: <span className="text-white">{selectedProvinceId ?? "не выбрана"}</span>
          </p>
          {selfCountry && (
            <p>
              Страна: <span style={{ color: selfCountry.color }}>{selfCountry.name}</span>
            </p>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm transition hover:border-green-500 hover:text-green-400 disabled:opacity-50"
            onClick={() => selectedProvinceId && submitOrderMutation.mutate({ type: "BUILD_FACTORY", provinceId: selectedProvinceId })}
            disabled={!selectedProvinceId || gameState?.snapshot.phase !== "planning"}
          >
            Фабрика
          </button>
          <button
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm transition hover:border-green-500 hover:text-green-400 disabled:opacity-50"
            onClick={() => selectedProvinceId && submitOrderMutation.mutate({ type: "START_COLONIZATION", provinceId: selectedProvinceId })}
            disabled={!selectedProvinceId || gameState?.snapshot.phase !== "planning"}
          >
            Колонизация
          </button>
          <button
            className="col-span-2 rounded-md border border-zinc-700 px-3 py-2 text-sm transition hover:border-green-500 hover:text-green-400 disabled:opacity-50"
            onClick={() => selectedProvinceId && submitOrderMutation.mutate({ type: "MOVE_ARMY", provinceId: selectedProvinceId })}
            disabled={!selectedProvinceId || gameState?.snapshot.phase !== "planning"}
          >
            Передвинуть армию
          </button>
        </div>

        <button
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-800 px-3 py-2 text-sm font-semibold transition hover:bg-zinc-700 hover:text-green-400 disabled:opacity-60"
          onClick={() => readyMutation.mutate()}
          disabled={!selfCountry || isSelfReady || gameState?.snapshot.phase !== "planning"}
        >
          <Check size={16} />
          {isSelfReady ? "Ход отправлен" : "Сделать ход"}
        </button>
      </div>

      <Dialog.Root open={authOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5 text-white shadow-xl">
            <Dialog.Title className="text-xl font-semibold">Вход в игру</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-zinc-400">Выберите страну и введите пароль.</Dialog.Description>

            <div className="mt-4 space-y-3">
              {authError && (
                <div className="rounded-md border border-red-500/40 bg-red-900/20 px-3 py-2 text-xs text-red-300">
                  {authError}
                </div>
              )}
              <select
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none transition focus:border-green-500"
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
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none transition focus:border-green-500"
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />

              <button
                className="flex w-full items-center justify-center gap-2 rounded-md bg-zinc-800 px-3 py-2 text-sm font-semibold transition hover:bg-zinc-700 hover:text-green-400"
                onClick={() => loginMutation.mutate({ countryName: selectedCountryName, password })}
                disabled={!selectedCountryName || !password}
              >
                <Flag size={16} />
                Войти
              </button>
            </div>

            <Dialog.Root open={registerOpen} onOpenChange={setRegisterOpen}>
              <Dialog.Trigger asChild>
                <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm transition hover:border-green-500 hover:text-green-400">
                  <Plus size={16} />
                  Регистрация страны
                </button>
              </Dialog.Trigger>

              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
                  <Dialog.Title className="text-lg font-semibold">Регистрация страны</Dialog.Title>
                  <div className="mt-3 space-y-3">
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none transition focus:border-green-500"
                      placeholder="Название страны"
                      value={regName}
                      onChange={(event) => setRegName(event.target.value)}
                    />
                    <input
                      className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm outline-none transition focus:border-green-500"
                      type="password"
                      placeholder="Пароль"
                      value={regPassword}
                      onChange={(event) => setRegPassword(event.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-zinc-400" htmlFor="color">
                        Цвет:
                      </label>
                      <input
                        id="color"
                        className="h-10 w-20 cursor-pointer rounded border border-zinc-700 bg-zinc-800"
                        type="color"
                        value={regColor}
                        onChange={(event) => setRegColor(event.target.value)}
                      />
                    </div>
                    <button
                      className="w-full rounded-md bg-zinc-800 px-3 py-2 text-sm font-semibold transition hover:bg-zinc-700 hover:text-green-400"
                      onClick={() => registerMutation.mutate({ countryName: regName, password: regPassword, color: regColor })}
                      disabled={!regName || !regPassword}
                    >
                      Зарегистрировать
                    </button>
                  </div>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
