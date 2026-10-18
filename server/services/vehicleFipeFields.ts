import { z } from "zod";
export const vehicleFipeFields = {
  fipe_code: z
    .string()
    .trim()
    .regex(/^(?:\d{6}-\d)?$/, "Código FIPE inválido.")
    .default(""),
  fipe_model: z.string().trim().max(300).default(""),
  fipe_year_id: z
    .string()
    .trim()
    .regex(
      /^(?:(?:19|20|21)\d{2}-\d{1,2}|32000-\d{1,2})?$/,
      "Ano FIPE inválido.",
    )
    .default(""),
};
