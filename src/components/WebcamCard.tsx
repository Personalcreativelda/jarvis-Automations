import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface WebcamCardHandle {
  /** Returns a JPEG base64 data URL of the current frame, or null if camera is off */
  captureFrame: () => string | null;
  isActive: () => boolean;
}

export const WebcamCard = forwardRef<WebcamCardHandle>(function WebcamCard(_props, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const activeRef = useRef(false); // always up-to-date, safe to use in closures
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);

  useImperativeHandle(ref, () => ({
    captureFrame: () => {
      console.log("[WebcamCard] captureFrame called, active:", activeRef.current, "videoRef:", !!videoRef.current, "canvasRef:", !!canvasRef.current);
      if (!activeRef.current || !videoRef.current || !canvasRef.current) {
        console.warn("[WebcamCard] captureFrame: returning null — active or refs missing");
        return null;
      }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      console.log("[WebcamCard] video dimensions:", video.videoWidth, "x", video.videoHeight, "readyState:", video.readyState);
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // Reset transform before drawing to avoid accumulation across calls
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      console.log("[WebcamCard] frame captured, base64 length:", base64.length);
      return base64;
    },
    isActive: () => activeRef.current,
  }));

  const startCamera = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      activeRef.current = true;
      setActive(true);
    } catch (e: any) {
      setError(e.message || "Acesso à câmara negado");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    activeRef.current = false;
    setActive(false);
  };

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="bg-black/50 border border-cyan-400/15 rounded-lg p-4 backdrop-blur-sm space-y-3">
      <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/50">
        // VISÃO ÓPTICA
      </div>

      {/* Video feed */}
      <div className="relative aspect-video bg-black/70 rounded overflow-hidden border border-cyan-400/10">
        <video
          ref={videoRef}
          className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-500 ${active ? "opacity-100" : "opacity-0"}`}
          muted
          playsInline
        />

        {/* HUD corner brackets */}
        {active && (
          <>
            <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-cyan-400/90" />
            <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-cyan-400/90" />
            <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-cyan-400/90" />
            <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-cyan-400/90" />

            {/* center crosshair */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-4 h-px bg-cyan-400/30" />
              <div className="absolute h-4 w-px bg-cyan-400/30" />
              <div className="absolute w-3 h-3 rounded-full border border-cyan-400/30" />
            </div>

            {/* scan line animation */}
            <div
              className="absolute left-0 right-0 h-px bg-cyan-400/20 pointer-events-none"
              style={{ animation: "scanline 3s linear infinite" }}
            />

            {/* status label */}
            <div className="absolute bottom-2 left-0 right-0 flex justify-center">
              <span className="text-[8px] uppercase tracking-[0.25em] text-cyan-400/70 bg-black/60 px-2 py-0.5 rounded">
                ● IDENTIFICAÇÃO ATIVA
              </span>
            </div>
          </>
        )}

        {/* Offline state */}
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <CameraOff className="h-6 w-6 text-cyan-400/20" />
            <span className="text-[8px] uppercase tracking-widest text-cyan-400/30">
              CÂMARA OFFLINE
            </span>
          </div>
        )}

        {/* CRT scanlines overlay */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.06]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(34,211,238,0.3) 2px, rgba(34,211,238,0.3) 4px)",
          }}
        />
      </div>

      {error && <p className="text-[9px] text-red-400/80">{error}</p>}

      {/* Stats row */}
      {active && (
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            { label: "RES", value: "320p" },
            { label: "FPS", value: "30" },
            { label: "ID", value: "OK" },
          ].map((s) => (
            <div key={s.label} className="bg-black/40 rounded p-1">
              <div className="text-[8px] text-cyan-400/40 uppercase">{s.label}</div>
              <div className="text-[9px] font-mono text-cyan-300">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <Button
        onClick={active ? stopCamera : startCamera}
        size="sm"
        variant="outline"
        className={`w-full tracking-widest text-[9px] gap-2 ${
          active
            ? "bg-red-950/40 border-red-500/30 text-red-400 hover:bg-red-950/60"
            : "bg-cyan-950/30 border-cyan-400/20 text-cyan-300 hover:bg-cyan-950/50"
        }`}
      >
        {active ? (
          <>
            <CameraOff className="h-3 w-3" /> DESLIGAR
          </>
        ) : (
          <>
            <Camera className="h-3 w-3" /> ATIVAR CÂMARA
          </>
        )}
      </Button>
      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
});
