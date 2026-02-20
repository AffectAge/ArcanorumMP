import { create } from "zustand";
import { Client } from "colyseus.js";

const apiBase = import.meta.env.VITE_API_URL ?? "http://localhost:2567";
const colyseusEndpoint = import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567";

const mapPlayers = (playersMap) => {
  const output = [];
  playersMap?.forEach((player, sessionId) => {
    output.push({
      sessionId,
      name: player.name,
      countryId: player.countryId,
      color: player.color,
      connected: player.connected,
      hasSubmitted: player.hasSubmitted,
      submittedOrderCount: player.submittedOrderCount,
    });
  });
  return output;
};

async function postJson(path, payload) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }
  return data;
}

export const useWegoStore = create((set, get) => ({
  authStatus: "guest",
  countries: [],
  authError: "",
  country: null,
  token: "",

  status: "idle",
  phase: "planning",
  turn: 1,
  phaseEndsAt: 0,
  lastResolutionSummary: "No turns resolved yet.",
  players: [],
  messages: [],
  error: "",
  client: null,
  room: null,

  refreshCountries: async () => {
    try {
      const response = await fetch(`${apiBase}/api/countries`);
      const data = await response.json();
      set({ countries: data.countries ?? [] });
    } catch {
      set({ authError: "Cannot load countries list." });
    }
  },

  register: async ({ name, color, password }) => {
    set({ authStatus: "auth_loading", authError: "" });
    try {
      const data = await postJson("/api/register", { name, color, password });
      set({
        authStatus: "authenticated",
        token: data.token,
        country: data.country,
      });
      await get().refreshCountries();
      await get().connect();
    } catch (error) {
      set({
        authStatus: "guest",
        authError: error instanceof Error ? error.message : "Registration failed",
      });
    }
  },

  login: async ({ countryId, password }) => {
    set({ authStatus: "auth_loading", authError: "" });
    try {
      const data = await postJson("/api/login", { countryId, password });
      set({
        authStatus: "authenticated",
        token: data.token,
        country: data.country,
      });
      await get().connect();
    } catch (error) {
      set({
        authStatus: "guest",
        authError: error instanceof Error ? error.message : "Login failed",
      });
    }
  },

  connect: async () => {
    const currentRoom = get().room;
    if (currentRoom) {
      return;
    }

    const token = get().token;
    if (!token) {
      set({ error: "No auth token. Please login first." });
      return;
    }

    set({ status: "connecting", error: "" });

    try {
      const client = new Client(colyseusEndpoint);
      const room = await client.joinOrCreate("wego", { token });

      room.onStateChange((state) => {
        set({
          phase: state.phase,
          turn: state.turn,
          phaseEndsAt: state.phaseEndsAt,
          lastResolutionSummary: state.lastResolutionSummary,
          players: mapPlayers(state.players),
        });
      });

      room.onMessage("phase_changed", (message) => {
        set((state) => ({
          messages: [...state.messages.slice(-11), `phase ${message.phase} | turn ${message.turn}`],
        }));
      });

      room.onMessage("turn_resolved", (message) => {
        set((state) => ({
          messages: [...state.messages.slice(-11), message.summary],
        }));
      });

      room.onError((code, message) => {
        set({ error: `[${code}] ${message ?? "server error"}` });
      });

      room.onLeave((code) => {
        set({
          status: "disconnected",
          error: `Disconnected (${code})`,
          room: null,
          client: null,
        });
      });

      set({
        status: "connected",
        client,
        room,
      });
    } catch (error) {
      set({
        status: "error",
        error: error instanceof Error ? error.message : "Failed to connect",
      });
    }
  },

  commitOrders: (ordersText) => {
    const room = get().room;
    if (!room) {
      return;
    }

    const orders = `${ordersText ?? ""}`
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);

    room.send("commit_orders", { orders });

    set((state) => ({
      messages: [...state.messages.slice(-11), `submitted ${orders.length} orders`],
    }));
  },

  leaveGame: async () => {
    const room = get().room;
    if (!room) {
      return;
    }

    await room.leave(true);
    set({
      status: "disconnected",
      room: null,
      client: null,
    });
  },

  logout: async () => {
    await get().leaveGame();
    set({
      authStatus: "guest",
      country: null,
      token: "",
      authError: "",
      players: [],
      messages: [],
      phase: "planning",
      turn: 1,
      phaseEndsAt: 0,
      lastResolutionSummary: "No turns resolved yet.",
    });
  },
}));
