/** Dedicated Horse Power installation identity. */
export const PLATFORM = Object.freeze({
  name: "Horse Power",
  description: "Car Service",
  icon: "/brand/icon.jpg",
  logo: "/brand/horse-power.jpg",
});
export function platformTitle(workshopName?: string) {
  const name = workshopName?.trim();
  return name ? name + " · " + PLATFORM.name : PLATFORM.name;
}
