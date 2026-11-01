/** Product identity shared by all workshops; workshop accents remain independent. */
export const PLATFORM = Object.freeze({
  name: "OSDrive",
  description: "Gestão para oficinas",
  icon: "/brand/osdrive-icon.png",
  logo: "/brand/osdrive-logo.png",
});
export function platformTitle(workshopName?: string) {
  const name = workshopName?.trim();
  return name ? name + " · " + PLATFORM.name : PLATFORM.name;
}
