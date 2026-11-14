import { contrastInk, workshopIdentity } from "./workshopIdentity.js";

/** CSS tokens scoped to the authenticated workshop shell. */
export function workshopTheme(shop: Record<string, unknown>) {
  const accent = workshopIdentity(shop).accent_color;
  return {
    "--red": accent,
    "--red-soft": `color-mix(in srgb, ${accent} 10%, white)`,
    "--red-ink": contrastInk(accent),
    "--accent": accent,
  };
}
