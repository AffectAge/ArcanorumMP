import crypto from "node:crypto";
import { createActor, createMachine } from "xstate";
import type { Server } from "socket.io";
import { submitOrderSchema, type PublicGameState, type SubmitOrderInput } from "@wego/shared";
import { prisma } from "./prisma.js";
import { config } from "./config.js";
import { hashToScore } from "./deterministic.js";

type Phase = "planning" | "resolve" | "commit";

type MachineContext = {
  planningDurationMs: number;
  resolveDurationMs: number;
  commitDurationMs: number;
};

export class WeGoEngine {
  private readonly io: Server;
  private readonly actor;
  private currentTurnId = "";
  private currentTurnNumber = 1;
  private currentPhase: Phase = "planning";
  private phaseEndsAt: Date | null = null;
  private readonly readyCountries = new Set<string>();
  private needsNewTurn = false;

  constructor(io: Server) {
    this.io = io;

    const machine = createMachine(
      {
        id: "wego",
        context: {
          planningDurationMs: config.planningDurationMs,
          resolveDurationMs: config.resolveDurationMs,
          commitDurationMs: config.commitDurationMs
        } as MachineContext,
        initial: "planning",
        states: {
          planning: {
            entry: "enterPlanning",
            on: {
              ALL_READY: { target: "resolve" }
            },
            after: {
              PLANNING_TIMEOUT: { target: "resolve" }
            }
          },
          resolve: {
            entry: "enterResolve",
            after: {
              RESOLVE_TIMEOUT: { target: "commit" }
            }
          },
          commit: {
            entry: "enterCommit",
            after: {
              COMMIT_TIMEOUT: { target: "planning" }
            }
          }
        }
      },
      {
        delays: {
          PLANNING_TIMEOUT: ({ context }) => context.planningDurationMs,
          RESOLVE_TIMEOUT: ({ context }) => context.resolveDurationMs,
          COMMIT_TIMEOUT: ({ context }) => context.commitDurationMs
        },
        actions: {
          enterPlanning: () => {
            void this.handleEnterPlanning();
          },
          enterResolve: () => {
            void this.handleEnterResolve();
          },
          enterCommit: () => {
            void this.handleEnterCommit();
          }
        }
      }
    );

    this.actor = createActor(machine);
  }

  async init() {
    await this.ensureProvinces();
    await this.ensurePlanningTurn();
    this.actor.start();
    await this.emitState();
  }

  async submitOrder(countryId: string, payload: SubmitOrderInput) {
    if (this.currentPhase !== "planning") {
      throw new Error("Сейчас нельзя отправлять действия. Идет резолв/коммит.");
    }

    const input = submitOrderSchema.parse(payload);
    await this.ensureProvince(input.provinceId, input.provinceName);

    await prisma.order.deleteMany({
      where: {
        turnId: this.currentTurnId,
        countryId,
        type: input.type,
        provinceId: input.provinceId
      }
    });

    await prisma.order.create({
      data: {
        turnId: this.currentTurnId,
        countryId,
        type: input.type,
        provinceId: input.provinceId,
        targetProvinceId: input.targetProvinceId
      }
    });

    await this.refreshContestedFlags();
    await this.emitState();
  }

  async markReady(countryId: string) {
    if (this.currentPhase !== "planning") {
      return;
    }

    this.readyCountries.add(countryId);
    await this.emitState();

    const totalCountries = await prisma.country.count();
    if (totalCountries > 0 && this.readyCountries.size >= totalCountries) {
      this.actor.send({ type: "ALL_READY" });
    }
  }

  async getPublicState(): Promise<PublicGameState> {
    const provinces = await prisma.province.findMany({ orderBy: { name: "asc" } });

    return {
      snapshot: {
        turnNumber: this.currentTurnNumber,
        phase: this.currentPhase,
        phaseEndsAt: this.phaseEndsAt ? this.phaseEndsAt.getTime() : null,
        readyCountries: [...this.readyCountries]
      },
      provinces: provinces.map((province: { id: string; name: string; ownerCountryId: string | null; contested: boolean }) => ({
        id: province.id,
        name: province.name,
        ownerCountryId: province.ownerCountryId,
        isContested: province.contested
      }))
    };
  }

  private async emitState() {
    const state = await this.getPublicState();
    this.io.emit("game:state", state);
  }

  private async ensureProvinces() {
    // Провинции создаются лениво из выбранных на карте ADM-единиц.
  }

  private async ensureProvince(id: string, name?: string) {
    await prisma.province.upsert({
      where: { id },
      update: name ? { name } : {},
      create: {
        id,
        name: name ?? id
      }
    });
  }

  private async ensurePlanningTurn() {
    const latest = await prisma.turn.findFirst({ orderBy: { turnNumber: "desc" } });

    if (!latest || latest.phase !== "planning") {
      const turnNumber = latest ? latest.turnNumber + 1 : 1;
      const turn = await prisma.turn.create({
        data: {
          turnNumber,
          phase: "planning",
          phaseEndsAt: new Date(Date.now() + config.planningDurationMs),
          seed: crypto.randomUUID()
        }
      });

      this.currentTurnId = turn.id;
      this.currentTurnNumber = turn.turnNumber;
      this.currentPhase = "planning";
      this.phaseEndsAt = turn.phaseEndsAt;
      this.readyCountries.clear();
      this.needsNewTurn = false;
      return;
    }

    this.currentTurnId = latest.id;
    this.currentTurnNumber = latest.turnNumber;
    this.currentPhase = "planning";
    this.phaseEndsAt = latest.phaseEndsAt;
    this.readyCountries.clear();
    this.needsNewTurn = false;
  }

  private async handleEnterPlanning() {
    this.currentPhase = "planning";
    this.readyCountries.clear();

    if (this.needsNewTurn) {
      const nextTurn = await prisma.turn.create({
        data: {
          turnNumber: this.currentTurnNumber + 1,
          phase: "planning",
          phaseEndsAt: new Date(Date.now() + config.planningDurationMs),
          seed: crypto.randomUUID()
        }
      });

      this.currentTurnId = nextTurn.id;
      this.currentTurnNumber = nextTurn.turnNumber;
      this.phaseEndsAt = nextTurn.phaseEndsAt;
      this.needsNewTurn = false;
      await this.refreshContestedFlags();
      await this.emitState();
      return;
    }

    const phaseEndsAt = new Date(Date.now() + config.planningDurationMs);
    this.phaseEndsAt = phaseEndsAt;

    await prisma.turn.update({
      where: { id: this.currentTurnId },
      data: { phase: "planning", phaseEndsAt }
    });

    await this.emitState();
  }

  private async handleEnterResolve() {
    this.currentPhase = "resolve";
    this.phaseEndsAt = null;

    // Auto-ready по таймауту: на старте резолва считаем всех игроков готовыми.
    const countries = await prisma.country.findMany({ select: { id: true } });
    for (const country of countries) {
      this.readyCountries.add(country.id);
    }

    await prisma.turn.update({
      where: { id: this.currentTurnId },
      data: { phase: "resolve", phaseEndsAt: null }
    });

    const turn = await prisma.turn.findUniqueOrThrow({ where: { id: this.currentTurnId } });
    const orders = await prisma.order.findMany({
      where: { turnId: this.currentTurnId, type: "START_COLONIZATION" }
    });

    const ordersByProvince = new Map<string, Array<(typeof orders)[number]>>();
    for (const order of orders) {
      const list = ordersByProvince.get(order.provinceId) ?? [];
      list.push(order);
      ordersByProvince.set(order.provinceId, list);
    }

    for (const [provinceId, provinceOrders] of ordersByProvince.entries()) {
      if (provinceOrders.length === 0) continue;

      if (provinceOrders.length > 1) {
        await prisma.province.update({ where: { id: provinceId }, data: { contested: true } });
      }

      const ranked = provinceOrders
        .map((order: (typeof orders)[number]) => ({
          order,
          score: hashToScore(`${turn.seed}:${order.countryId}:${provinceId}`)
        }))
        .sort(
          (
            a: { order: (typeof orders)[number]; score: number },
            b: { order: (typeof orders)[number]; score: number }
          ) => b.score - a.score
        );

      const winner = ranked[0];

      await prisma.province.update({
        where: { id: provinceId },
        data: {
          ownerCountryId: winner.order.countryId,
          contested: false
        }
      });

      await prisma.order.update({ where: { id: winner.order.id }, data: { status: "APPLIED" } });

      if (ranked.length > 1) {
        await prisma.battle.create({
          data: {
            turnId: this.currentTurnId,
            provinceId,
            attackerId: winner.order.countryId,
            defenderId: ranked[1].order.countryId,
            winnerCountryId: winner.order.countryId,
            summary: `Провинция ${provinceId}: победила страна ${winner.order.countryId}`
          }
        });

        const losers = ranked.slice(1);
        await prisma.order.updateMany({
          where: { id: { in: losers.map((entry) => entry.order.id) } },
          data: { status: "REJECTED" }
        });
      }
    }

    await this.emitState();
  }

  private async handleEnterCommit() {
    this.currentPhase = "commit";
    this.phaseEndsAt = null;

    await prisma.turn.update({
      where: { id: this.currentTurnId },
      data: {
        phase: "commit",
        committedAt: new Date(),
        phaseEndsAt: null
      }
    });

    this.needsNewTurn = true;
    await this.emitState();
  }

  private async refreshContestedFlags() {
    await prisma.province.updateMany({ data: { contested: false } });

    const grouped = await prisma.order.groupBy({
      by: ["provinceId"],
      where: {
        turnId: this.currentTurnId,
        type: "START_COLONIZATION"
      },
      _count: {
        provinceId: true
      }
    });

    const contestedIds = grouped
      .filter((group: { provinceId: string; _count: { provinceId: number } }) => group._count.provinceId > 1)
      .map((group: { provinceId: string; _count: { provinceId: number } }) => group.provinceId);

    if (contestedIds.length > 0) {
      await prisma.province.updateMany({
        where: { id: { in: contestedIds } },
        data: { contested: true }
      });
    }
  }
}
