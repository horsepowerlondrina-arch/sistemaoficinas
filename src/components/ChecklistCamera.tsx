import { useEffect, useRef, useState } from "react";
import { Modal } from "./ui";

const maxUploadBytes = 1_600_000;

function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Não foi possível preparar a foto.")),
    "image/jpeg",
    0.72,
  ));
}

export function ChecklistCamera({ onClose, onCapture }: {
  onClose: () => void;
  onCapture: (photo: Blob) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Câmera indisponível neste navegador.");
        const camera = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        });
        if (!active) { camera.getTracks().forEach((track) => track.stop()); return; }
        stream.current = camera;
        if (!video.current) { stop(); return; }
        video.current.srcObject = camera;
        await video.current.play();
        if (active) setReady(true);
      } catch {
        stop();
        if (active) setError("Não foi possível abrir a câmera. Verifique a permissão do Chrome ou escolha uma foto da galeria.");
      }
    }
    void start();
    return () => { active = false; stop(); };
  }, []);

  async function capture() {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight || saving) return;
    setSaving(true);
    setError("");
    const canvas = document.createElement("canvas");
    try {
      let photo: Blob | null = null;
      for (const side of [1280, 960, 720]) {
        const scale = Math.min(1, side / Math.max(source.videoWidth, source.videoHeight));
        canvas.width = Math.max(1, Math.round(source.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(source.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Não foi possível preparar a foto.");
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        photo = await jpeg(canvas);
        if (photo.size >= 100 && photo.size <= maxUploadBytes) break;
        photo = null;
      }
      if (!photo) throw new Error("A foto ficou muito grande. Tente novamente.");
      stop();
      await onCapture(photo);
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  return (
    <Modal title="Tirar foto" description="A câmera abre nesta página. Autorize o acesso quando o Chrome solicitar." onClose={() => { if (!saving) onClose(); }}>
      <div className="modal-body checklist-camera-body">
        <video ref={video} autoPlay playsInline muted aria-label="Visualização da câmera" />
        {!ready && !error && <p role="status">Abrindo câmera...</p>}
        {error && <p role="alert" className="error-box">{error}</p>}
      </div>
      <div className="modal-footer">
        <button type="button" className="button" disabled={saving} onClick={onClose}>Cancelar</button>
        <button type="button" className="button primary" disabled={!ready || saving} onClick={() => void capture()}>
          {saving ? "Salvando foto..." : "Capturar foto"}
        </button>
      </div>
    </Modal>
  );
}
