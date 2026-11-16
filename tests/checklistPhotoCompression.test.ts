import test from "node:test";
import assert from "node:assert/strict";
import { compressChecklistPhoto } from "../src/lib/checklistPhotoCompression.js";

function cameraJpeg() {
  const data = Buffer.alloc(1_000_000);
  // JPEG SOF: a highly compressed 8000 x 6000 camera image.
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x17, 0x70, 0x1f, 0x40]).copy(data);
  return new File([data], "camera.jpg", { type: "image/jpeg" });
}

test("foto grande é decodificada já reduzida, sem carregar a imagem original no canvas", async () => {
  const oldBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  let options: ImageBitmapOptions | undefined;
  let closed = false;
  let canvas: { width: number; height: number };
  let drawn = 0;
  let encoded = 0;
  canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage() { drawn++; assert.equal(canvas.width, 960); assert.equal(canvas.height, 1280); } }),
    toBlob: (callback: (blob: Blob | null) => void) => { encoded++; callback(new Blob([Buffer.alloc(150_000)])); },
  } as typeof canvas;
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: async (_file: File, requested: ImageBitmapOptions) => {
      options = requested;
      return { width: 960, height: 1280, close() { closed = true; } };
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true, value: { createElement: () => canvas },
  });
  Object.defineProperty(globalThis, "Image", {
    configurable: true, value: class { constructor() { throw Error("a foto não deve ser decodificada duas vezes"); } },
  });
  try {
    const output = await compressChecklistPhoto(cameraJpeg());
    assert.equal(options?.resizeWidth, 1280);
    assert.equal(output.size, 150_000);
    assert.equal(drawn, 1);
    assert.equal(encoded, 1);
    assert.equal(closed, true);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
  } finally {
    for (const [key, descriptor] of [["createImageBitmap", oldBitmap], ["document", oldDocument], ["Image", oldImage]] as const)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  }
});

test("foto já pequena não é ampliada e saída acima do limite é recomprimida antes do envio", async () => {
  const oldBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const png = Buffer.alloc(32);
  Buffer.from([137, 80, 78, 71]).copy(png);
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(500, 20);
  const file = new File([png], "small.png", { type: "image/png" });
  const sizes: number[] = [];
  let options: ImageBitmapOptions | undefined;
  let closed = false;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => sizes.push(canvas.width) }),
    toBlob: (callback: (blob: Blob | null) => void) =>
      callback(new Blob([Buffer.alloc(sizes.length === 1 ? 1_600_001 : 120_000)])),
  };
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true, value: async (_file: File, requested: ImageBitmapOptions) => {
      options = requested;
      return { width: 800, height: 500, close: () => { closed = true; } };
    },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
  try {
    const output = await compressChecklistPhoto(file);
    assert.deepEqual(options, {});
    assert.deepEqual(sizes, [800, 800]);
    assert.equal(output.size, 120_000);
    assert.equal(closed, true);
  } finally {
    for (const [key, descriptor] of [["createImageBitmap", oldBitmap], ["document", oldDocument]] as const)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  }
});

test("falha de decodificação em alta resolução tenta dimensões menores antes da via legada", async () => {
  const oldBitmap = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const attempts: number[] = [];
  let closed = false;
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => {} }),
    toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob([Buffer.alloc(1000)])),
  };
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true, value: async (_file: File, options: ImageBitmapOptions) => {
      attempts.push(options.resizeWidth!);
      if (options.resizeWidth === 1280) throw new Error("out of memory");
      return { width: 960, height: 720, close: () => { closed = true; } };
    },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => canvas } });
  Object.defineProperty(globalThis, "Image", {
    configurable: true, value: class { constructor() { throw Error("não recorrer ao decoder original"); } },
  });
  try {
    assert.equal((await compressChecklistPhoto(cameraJpeg())).size, 1000);
    assert.deepEqual(attempts, [1280, 960]);
    assert.equal(closed, true);
  } finally {
    for (const [key, descriptor] of [["createImageBitmap", oldBitmap], ["document", oldDocument], ["Image", oldImage]] as const)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  }
});
