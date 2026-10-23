import { PLATFORM } from "../../shared/platformIdentity";
export function PlatformBrand({ compact = false }: { compact?: boolean }) {
  return <span className={compact ? "platform-brand platform-brand--compact" : "platform-brand"}>
    <img src={PLATFORM.icon} alt="" width={compact ? 22 : 48} height={compact ? 22 : 48} />
    <span><strong>{PLATFORM.name}</strong>{!compact && <small>{PLATFORM.description}</small>}</span>
  </span>;
}
