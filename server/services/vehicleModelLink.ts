import { z } from "zod";

// Older vehicle records may carry an empty string for an unset catalog link.
// Treat that legacy representation as omitted, while preserving explicit null
// as the user's request to clear a link.
export const serviceModelIdSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().uuid().nullable().optional(),
);

export function normalizeVehicleModelLink<T extends Record<string, unknown>>(
  input: T,
): T {
  if (input.service_model_id === undefined) {
    delete input.service_model_id;
  }
  return input;
}
