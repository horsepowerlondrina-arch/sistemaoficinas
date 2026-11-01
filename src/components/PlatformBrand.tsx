import { PLATFORM } from "../../shared/platformIdentity";

export function PlatformBrand({ compact = false }: { compact?: boolean }) {
  return compact
    ? <span className="platform-brand platform-brand--compact">
        <img src={PLATFORM.icon} alt="" width={22} height={22} />
        <span><strong>{PLATFORM.name}</strong></span>
      </span>
    : <span className="platform-brand platform-brand--full">
        <img className="platform-brand-logo" src={PLATFORM.logo} alt={`${PLATFORM.name} — ${PLATFORM.description}`} />
      </span>;
}
