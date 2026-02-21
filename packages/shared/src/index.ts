import { z } from "zod";

export const gamePhaseSchema = z.enum(["planning", "resolve", "commit"]);
export type GamePhase = z.infer<typeof gamePhaseSchema>;

export const orderTypeSchema = z.enum([
  "BUILD_FACTORY",
  "START_COLONIZATION",
  "MOVE_ARMY"
]);

export const loginSchema = z.object({
  countryName: z.string().min(2).max(64),
  password: z.string().min(4).max(128)
});

export const registerSchema = z.object({
  countryName: z.string().min(2).max(64),
  password: z.string().min(4).max(128),
  color: z.string().regex(/^#([A-Fa-f0-9]{6})$/)
});

export const submitOrderSchema = z.object({
  type: orderTypeSchema,
  provinceId: z.string().min(1),
  targetProvinceId: z.string().optional()
});

export type SubmitOrderInput = z.infer<typeof submitOrderSchema>;

export type TurnSnapshot = {
  turnNumber: number;
  phase: GamePhase;
  phaseEndsAt: number | null;
  readyCountries: string[];
};

export type ProvinceView = {
  id: string;
  name: string;
  ownerCountryId: string | null;
  isContested: boolean;
};

export type PublicGameState = {
  snapshot: TurnSnapshot;
  provinces: ProvinceView[];
};
