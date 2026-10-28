export function extensionMessage(
  type: string,
  data: Record<string, unknown> = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const listener = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        event.data?.channel !== "horse-power-extension" ||
        event.data?.requestId !== requestId
      )
        return;
      cleanup();
      const result = event.data.result;
      if (result?.ok) resolve(result);
      else reject(new Error(result?.error || "Falha ao conectar a extensão."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error("Instale a extensão de teste INT-015 na homologação e recarregue esta página."),
      );
    }, 3000);
    window.addEventListener("message", listener);
    window.postMessage(
      { channel: "horse-power-web", requestId, type, ...data },
      window.location.origin,
    );
  });
}
