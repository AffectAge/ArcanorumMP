import { Room } from "colyseus";
import { MapSchema, Schema, defineTypes } from "@colyseus/schema";
import { createActor, createMachine, assign } from "xstate";
import { getSessionByToken } from "../authStore.js";

class PlayerState extends Schema {
  name = "Commander";
  countryId = "";
  color = "#22C55E";
  connected = true;
  hasSubmitted = false;
  submittedOrderCount = 0;
}

defineTypes(PlayerState, {
  name: "string",
  countryId: "string",
  color: "string",
  connected: "boolean",
  hasSubmitted: "boolean",
  submittedOrderCount: "uint16",
});

class WegoState extends Schema {
  phase = "planning";
  turn = 1;
  phaseEndsAt = 0;
  lastResolutionSummary = "No turns resolved yet.";
  players = new MapSchema();
}

defineTypes(WegoState, {
  phase: "string",
  turn: "uint16",
  phaseEndsAt: "number",
  lastResolutionSummary: "string",
  players: { map: PlayerState },
});

const DEFAULT_PHASE_MS = {
  planning: 20000,
  lock: 3000,
  resolve: 1200,
  apply: 1200,
};

function normalizeOrders(payload) {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((entry) => `${entry ?? ""}`.trim())
    .filter(Boolean)
    .slice(0, 32);
}

function createWegoMachine(room, options) {
  const minPlayersToAutoLock = Number(options.minPlayersToAutoLock ?? 2);
  const phaseMs = {
    planning: Number(options.planningMs ?? DEFAULT_PHASE_MS.planning),
    lock: Number(options.lockMs ?? DEFAULT_PHASE_MS.lock),
    resolve: Number(options.resolveMs ?? DEFAULT_PHASE_MS.resolve),
    apply: Number(options.applyMs ?? DEFAULT_PHASE_MS.apply),
  };

  const setPhase = (context, phaseName) => {
    const endsAt = Date.now() + phaseMs[phaseName];
    room.state.phase = phaseName;
    room.state.phaseEndsAt = endsAt;

    room.broadcast("phase_changed", {
      phase: phaseName,
      turn: context.turn,
      phaseEndsAt: endsAt,
    });
  };

  return createMachine(
    {
      id: "wego",
      initial: "planning",
      context: {
        turn: 1,
        currentOrders: {},
        lastResolutionSummary: "No turns resolved yet.",
      },
      states: {
        planning: {
          entry: ["planningEntry", "syncTurnToState"],
          on: {
            COMMIT_ORDER: { actions: "commitOrders" },
          },
          always: [{ guard: "allConnectedPlayersReady", target: "lock" }],
          after: {
            PLANNING_TIMEOUT: { target: "lock" },
          },
        },
        lock: {
          entry: "lockEntry",
          after: {
            LOCK_TIMEOUT: { target: "resolve" },
          },
        },
        resolve: {
          entry: ["resolveEntry", "resolveOrders"],
          after: {
            RESOLVE_TIMEOUT: { target: "apply" },
          },
        },
        apply: {
          entry: ["applyEntry", "applyResolution"],
          after: {
            APPLY_TIMEOUT: {
              target: "planning",
              actions: "startNextTurn",
            },
          },
        },
      },
    },
    {
      delays: {
        PLANNING_TIMEOUT: phaseMs.planning,
        LOCK_TIMEOUT: phaseMs.lock,
        RESOLVE_TIMEOUT: phaseMs.resolve,
        APPLY_TIMEOUT: phaseMs.apply,
      },
      guards: {
        allConnectedPlayersReady: () => {
          const connectedPlayers = [...room.state.players.values()].filter(
            (player) => player.connected,
          );

          if (connectedPlayers.length < minPlayersToAutoLock) {
            return false;
          }

          return connectedPlayers.every((player) => player.hasSubmitted);
        },
      },
      actions: {
        planningEntry: assign((context) => {
          setPhase(context, "planning");

          for (const player of room.state.players.values()) {
            if (player.connected) {
              player.hasSubmitted = false;
              player.submittedOrderCount = 0;
            }
          }

          return {
            ...context,
            currentOrders: {},
          };
        }),
        lockEntry: (context) => {
          setPhase(context, "lock");
        },
        resolveEntry: (context) => {
          setPhase(context, "resolve");
        },
        applyEntry: (context) => {
          setPhase(context, "apply");
        },
        commitOrders: assign((context, event) => {
          const sessionId = event.sessionId;
          const player = room.state.players.get(sessionId);

          if (!player || !player.connected) {
            return context;
          }

          const orders = normalizeOrders(event.orders);

          player.hasSubmitted = true;
          player.submittedOrderCount = orders.length;

          return {
            ...context,
            currentOrders: {
              ...context.currentOrders,
              [sessionId]: orders,
            },
          };
        }),
        resolveOrders: assign((context) => {
          const summaryParts = [];

          for (const [sessionId, orders] of Object.entries(context.currentOrders)) {
            summaryParts.push(`${sessionId.slice(0, 5)}: ${orders.length} orders`);
          }

          const summary =
            summaryParts.length > 0
              ? `Turn ${context.turn} resolved -> ${summaryParts.join(" | ")}`
              : `Turn ${context.turn} resolved -> no submitted orders`;

          room.broadcast("turn_resolved", {
            turn: context.turn,
            summary,
            ordersByPlayer: context.currentOrders,
          });

          return {
            ...context,
            lastResolutionSummary: summary,
          };
        }),
        applyResolution: (context) => {
          room.state.lastResolutionSummary = context.lastResolutionSummary;
        },
        startNextTurn: assign((context) => ({
          ...context,
          turn: context.turn + 1,
        })),
        syncTurnToState: (context) => {
          room.state.turn = context.turn;
        },
      },
    },
  );
}

export class WegoRoom extends Room {
  async onAuth(_client, options) {
    const authToken = `${options?.token ?? ""}`;
    const session = await getSessionByToken(authToken);
    if (!session) {
      throw new Error("Unauthorized: invalid or expired token");
    }
    return session;
  }

  onCreate(options = {}) {
    this.setState(new WegoState());
    this.maxClients = Number(options.maxClients ?? 8);

    const machine = createWegoMachine(this, options);
    this.phaseActor = createActor(machine);
    this.phaseActor.start();

    this.onMessage("commit_orders", (client, message) => {
      this.phaseActor.send({
        type: "COMMIT_ORDER",
        sessionId: client.sessionId,
        orders: message?.orders ?? [],
      });
    });
  }

  onJoin(client, options = {}, auth) {
    const player = new PlayerState();
    player.name = `${auth?.countryName ?? options.name ?? "Commander"}`.slice(0, 24) || "Commander";
    player.countryId = `${auth?.countryId ?? ""}`;
    player.color = `${auth?.countryColor ?? "#22C55E"}`;
    player.connected = true;

    this.state.players.set(client.sessionId, player);
  }

  onLeave(client) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      player.hasSubmitted = false;
      player.submittedOrderCount = 0;
    }
  }

  onDispose() {
    this.phaseActor?.stop();
  }
}
