const maxSide = 1920;
const maxUploadBytes = 1_600_000;

/** Read only the image header so large camera photos can be decoded at a smaller size. */
async function imageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  const bytes = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xd9 || marker === 0xda || at + 2 > bytes.length) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = view.getUint16(at);
    if (length < 2 || at + length > bytes.length) break;
    if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker) && length >= 7) {
      return { height: view.getUint16(at + 3), width: view.getUint16(at + 5) };
    }
    at += length;
  }
  return null;
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Não foi possível preparar a foto.")),
    "image/jpeg", quality,
  ));
}

export async function compressChecklistPhoto(file: File): Promise<Blob> {
  // Keep the native camera's original JPEG when it already fits the server limit.
  if (file.type === "image/jpeg" && file.size >= 100 && file.size <= maxUploadBytes) return file;
  const dimensions = await imageDimensions(file);
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  let objectUrl: string | null = null;
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (typeof createImageBitmap === "function") {
      let decodeError: unknown;
      const alreadySmall = dimensions && Math.max(dimensions.width, dimensions.height) <= maxSide;
      for (const side of alreadySmall ? [maxSide] : [1920, 1600, 1280, 960]) {
        try {
          const resize = alreadySmall
            ? {}
            : dimensions?.height && dimensions.height > dimensions.width
              ? { resizeHeight: side, resizeQuality: "high" as const }
              : { resizeWidth: side, resizeQuality: "high" as const };
          bitmap = await createImageBitmap(file, resize);
          break;
        } catch (error) {
          decodeError = error;
        }
      }
      if (!bitmap && /memory|allocation|quota/i.test(String(decodeError)))
        throw new Error("Não foi possível preparar a foto.");
      // Older browsers may not support resized decoding; retain the existing image path.
    }
    if (!bitmap) {
      objectUrl = URL.createObjectURL(file);
      image = new Image();
      const loading = image;
      await new Promise<void>((resolve, reject) => {
        loading.onload = () => resolve();
        loading.onerror = () => reject(new Error("Não foi possível abrir a foto."));
        loading.src = objectUrl!;
      });
    }
    const source = bitmap || image!;
    const width = bitmap?.width || image!.naturalWidth;
    const height = bitmap?.height || image!.naturalHeight;
    if (!width || !height) throw new Error("Não foi possível abrir a foto.");
    canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a foto.");
    for (const [side, quality] of [[1920, 0.82], [1600, 0.78], [1280, 0.72], [960, 0.64]] as const) {
      const scale = Math.min(1, side / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await encode(canvas, quality);
      if (blob.size >= 100 && blob.size <= maxUploadBytes) return blob;
    }
    throw new Error("A foto ficou muito grande. Tente novamente.");
  } finally {
    bitmap?.close();
    if (image) { image.onload = null; image.onerror = null; image.src = ""; }
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
