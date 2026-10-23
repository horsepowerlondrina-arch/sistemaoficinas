/** Descriptive placeholder, independent of every workshop and of a future product name. */
export const PLATFORM = Object.freeze({
  name: "Sistema Oficinas",
  description: "Gestão para oficinas",
  icon: "/brand/platform.svg",
});
export function platformTitle(workshopName?: string) {
  const name = workshopName?.trim();
  return name ? name + " · " + PLATFORM.name : PLATFORM.name;
}
