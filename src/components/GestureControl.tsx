import { useEffect, useRef, useState, useCallback } from "react";
import { Fingerprint, Activity, ZapOff } from "lucide-react";
import { Button } from "@/components/ui/button";

// Usa /jarvis-agent/* que o Vite proxy redireciona para http://127.0.0.1:4000
// Isso contorna proxies de sistema que bloqueiam localhost:4000 no browser
const AGENT_URL = "/jarvis-agent";

const GESTURE_LABELS: Record<string, string> = {
  point: "☝ MOVER CURSOR",
  pinch: "🤌 CLICAR",
  peace: "✌ CLIQUE DIREITO",
  fist: "✊ ARRASTAR",
  open: "🖐 PARAR",
  none: "— SEM GESTO",
};

const GESTURE_COLORS: Record<string, string> = {
  point: "#22d3ee",
  pinch: "#4ade80",
  peace: "#f59e0b",
  fist: "#f87171",
  open: "#a78bfa",
  none: "rgba(34,211,238,0.2)",
};

// ─── Helpers de deteção de gestos ─────────────────────────────────────────────
function isFingerExtended(lm: any[], i: number): boolean {
  const tips = [4, 8, 12, 16, 20];
  const pips = [3, 6, 10, 14, 18];
  if (i === 0) return lm[4].x < lm[3].x; // polegar — usa eixo X
  return lm[tips[i]].y < lm[pips[i]].y;
}

function detectGesture(lm: any[]): string {
  const dx = lm[4].x - lm[8].x;
  const dy = lm[4].y - lm[8].y;
  if (Math.sqrt(dx * dx + dy * dy) < 0.05) return "pinch";
  const [t, i, m, r, p] = [0, 1, 2, 3, 4].map((x) => isFingerExtended(lm, x));
  if (!t && i && !m && !r && !p) return "point";
  if (!t && i && m && !r && !p) return "peace";
  if (!t && !i && !m && !r && !p) return "fist";
  if (t && i && m && r && p) return "open";
  return "none";
}

export function GestureControl() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<any>(null);
  const animRef = useRef<ReturnType<typeof setTimeout> | number>(0);
  const lastMoveRef = useRef(0);
  const gestureCountRef = useRef<Record<string, number>>({});
  const movePendingRef = useRef(false);
  const pinchFiredRef = useRef(false);
  const peaceFiredRef = useRef(false);
  // screen dimensions: read once on mount (safe for SSR)
  const screenW = useRef(typeof window !== "undefined" ? window.screen.width : 1920);
  const screenH = useRef(typeof window !== "undefined" ? window.screen.height : 1080);

  const [active, setActive] = useState(false);
  const [gesture, setGesture] = useState("none");
  const [mpLoaded, setMpLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [agentOnline, setAgentOnline] = useState(false);
  const agentOnlineRef = useRef(false);
  const [agentError, setAgentError] = useState("");
  // fingertip position in canvas % (0-1) for overlay dot
  const [fingerPos, setFingerPos] = useState<{ cx: number; cy: number; sx: number; sy: number } | null>(null);

  // ── Verificar se o agente local está online ────────────────────────────────
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(2000) });
        agentOnlineRef.current = r.ok;
        setAgentOnline(r.ok);
        if (r.ok) setAgentError("");
        else setAgentError(`HTTP ${r.status}`);
      } catch (e: any) {
        agentOnlineRef.current = false;
        setAgentOnline(false);
        setAgentError(e?.message ?? "erro");
      }
    };
    check();
    const iv = setInterval(check, 10000);
    return () => clearInterval(iv);
  }, []);

  // ── Carregar MediaPipe via CDN ─────────────────────────────────────────────
  useEffect(() => {
    // Versão pinada para estabilidade
    const VER = "0.4.1675469240";
    const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe`;
    const scripts = [
      `${CDN}/drawing_utils@0.3.1675466124/drawing_utils.js`,
      `${CDN}/hands@${VER}/hands.js`,
    ];
    let loaded = 0;
    const onLoad = () => {
      loaded++;
      if (loaded === scripts.length) setMpLoaded(true);
    };
    scripts.forEach((src) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        loaded++;
        if (loaded === scripts.length) setMpLoaded(true);
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.crossOrigin = "anonymous";
      s.onload = onLoad;
      s.onerror = () => setLoadError(true);
      document.head.appendChild(s);
    });
  }, []);

  const sendMouse = useCallback((action: string, x?: number, y?: number) => {
    if (!agentOnlineRef.current) return;
    // Move: fire-and-forget sem await para máxima velocidade
    if (action === "move") {
      if (movePendingRef.current) return; // drop frame se anterior ainda em voo
      movePendingRef.current = true;
      fetch(`${AGENT_URL}/mouse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, x, y }),
      })
        .catch(() => {})
        .finally(() => { movePendingRef.current = false; });
      return;
    }
    // Click/rclick: sem await mas sem guard (são eventos únicos)
    fetch(`${AGENT_URL}/mouse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, x, y }),
    }).catch(() => {});
  }, []);

  const startGestures = useCallback(async () => {
    const win = window as any;
    if (!mpLoaded || !win.Hands || !videoRef.current || !canvasRef.current) return;

    const stream = await navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480, facingMode: "user" } })
      .catch(() => null);
    if (!stream) return;

    videoRef.current.srcObject = stream;
    await videoRef.current.play();

    const hands = new win.Hands({
      locateFile: (f: string) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`,
    });
    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5,
    });

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    hands.onResults((results: any) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!results.multiHandLandmarks?.length) {
        setGesture("none");
        setFingerPos(null);
        return;
      }

      const lm = results.multiHandLandmarks[0];

      // Desenhar esqueleto da mão
      win.drawConnectors(ctx, lm, win.HAND_CONNECTIONS, {
        color: "rgba(34,211,238,0.5)",
        lineWidth: 1.5,
      });
      win.drawLandmarks(ctx, lm, {
        color: "#22d3ee",
        lineWidth: 1,
        radius: 3,
      });

      // Desenhar círculo grande no indicador (landmark 8)
      const fx = lm[8].x * canvas.width;
      const fy = lm[8].y * canvas.height;
      ctx.beginPath();
      ctx.arc(fx, fy, 10, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(34,211,238,0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(fx, fy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "#22d3ee";
      ctx.fill();

      const g = detectGesture(lm);
      setGesture(g);

      // Coordenadas do dedo indicador mapeadas para o ecrã
      // lm.x está em 0-1 da câmara; (1-lm[8].x) espelha para coords de ecrã
      const tipX = Math.round((1 - lm[8].x) * screenW.current);
      const tipY = Math.round(lm[8].y * screenH.current);
      // posição do dot na canvas (em %) — canvas tem scale-x-[-1] via CSS
      // então o dot visual está em (1-lm[8].x)
      setFingerPos({ cx: (1 - lm[8].x) * 100, cy: lm[8].y * 100, sx: tipX, sy: tipY });

      // Estabilizar gesto: exige 2 frames consecutivos
      gestureCountRef.current[g] = (gestureCountRef.current[g] || 0) + 1;
      Object.keys(gestureCountRef.current).forEach((k) => {
        if (k !== g) gestureCountRef.current[k] = 0;
      });
      // Ponto: mover após 2 frames estáveis
      if (g === "point") {
        pinchFiredRef.current = false;
        peaceFiredRef.current = false;
        if ((gestureCountRef.current["point"] || 0) >= 2) {
          const now = Date.now();
          if (now - lastMoveRef.current > 16) {
            lastMoveRef.current = now;
            sendMouse("move", tipX, tipY);
          }
        }
        return;
      }

      // Pinch: clicar UMA vez por gesto (precisa de 5 frames, depois aguarda soltar)
      if (g === "pinch") {
        peaceFiredRef.current = false;
        if ((gestureCountRef.current["pinch"] || 0) >= 5 && !pinchFiredRef.current) {
          pinchFiredRef.current = true;
          sendMouse("click", tipX, tipY);
        }
        return;
      }

      // Peace: clique direito UMA vez por gesto
      if (g === "peace") {
        pinchFiredRef.current = false;
        if ((gestureCountRef.current["peace"] || 0) >= 5 && !peaceFiredRef.current) {
          peaceFiredRef.current = true;
          sendMouse("rclick", tipX, tipY);
        }
        return;
      }

      // Outros gestos: reset de fired
      pinchFiredRef.current = false;
      peaceFiredRef.current = false;
    });

    handsRef.current = hands;

    // Usa setTimeout em vez de requestAnimationFrame para continuar
    // a funcionar mesmo quando a aba perde foco (outra janela/aba aberta)
    const detect = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) {
        animRef.current = setTimeout(detect, 50);
        return;
      }
      await handsRef.current?.send({ image: videoRef.current });
      animRef.current = setTimeout(detect, 33); // ~30fps — equilibra CPU e fluidez
    };
    detect();
    setActive(true);
  }, [mpLoaded, sendMouse]);

  const stopGestures = useCallback(() => {
    clearTimeout(animRef.current as ReturnType<typeof setTimeout>);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    handsRef.current = null;
    setActive(false);
    setGesture("none");
    setFingerPos(null);
  }, []);

  useEffect(() => () => stopGestures(), [stopGestures]);

  const gestureColor = GESTURE_COLORS[gesture] ?? GESTURE_COLORS.none;

  return (
    <div className="bg-black/50 border border-cyan-400/15 rounded-lg p-3 backdrop-blur-sm space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-[8px] uppercase tracking-[0.3em] text-cyan-400/50">
          // CONTROLO GESTUAL
        </div>
        <div
          className={`text-[8px] flex items-center gap-1 ${
            agentOnline ? "text-green-400/70" : "text-red-400/60"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full inline-block ${
              agentOnline ? "bg-green-400 animate-pulse" : "bg-red-400"
            }`}
          />
          {agentOnline ? "AGENTE ONLINE" : "AGENTE OFFLINE"}
        </div>
      </div>

      {/* Vídeo + Canvas overlay */}
      <div className="relative aspect-video bg-black/70 rounded overflow-hidden border border-cyan-400/10">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
          muted
          playsInline
        />
        <canvas
          ref={canvasRef}
          width={640}
          height={480}
          className="absolute inset-0 w-full h-full scale-x-[-1]"
        />

        {/* HUD brackets */}
        {active && (
          <>
            <div className="absolute top-1.5 left-1.5 w-3 h-3 border-t border-l border-cyan-400/90" />
            <div className="absolute top-1.5 right-1.5 w-3 h-3 border-t border-r border-cyan-400/90" />
            <div className="absolute bottom-1.5 left-1.5 w-3 h-3 border-b border-l border-cyan-400/90" />
            <div className="absolute bottom-1.5 right-1.5 w-3 h-3 border-b border-r border-cyan-400/90" />
          </>
        )}

        {/* Dot do indicador sobre o vídeo */}
        {active && fingerPos && (
          <div
            className="absolute w-4 h-4 rounded-full border-2 border-cyan-300 pointer-events-none -translate-x-1/2 -translate-y-1/2"
            style={{
              left: `${fingerPos.cx}%`,
              top: `${fingerPos.cy}%`,
              backgroundColor: gesture === "pinch" ? "rgba(74,222,128,0.5)" : "rgba(34,211,238,0.25)",
              borderColor: GESTURE_COLORS[gesture] ?? "#22d3ee",
              boxShadow: `0 0 8px ${GESTURE_COLORS[gesture] ?? "#22d3ee"}80`,
            }}
          />
        )}

        {/* Gesto atual */}
        {active && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center">
            <span
              className="text-[8px] uppercase tracking-[0.2em] px-2 py-0.5 rounded font-mono transition-colors duration-150"
              style={{
                color: gestureColor,
                backgroundColor: "rgba(0,0,0,0.65)",
                border: `1px solid ${gestureColor}50`,
              }}
            >
              {GESTURE_LABELS[gesture] ?? gesture}
            </span>
          </div>
        )}

        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <ZapOff className="h-5 w-5 text-cyan-400/20" />
            <span className="text-[8px] uppercase tracking-widest text-cyan-400/30">
              GESTOS OFFLINE
            </span>
          </div>
        )}

        {/* Scanlines CRT */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(34,211,238,0.3) 2px,rgba(34,211,238,0.3) 4px)",
          }}
        />
      </div>

      {/* Coordenadas de ecrã em tempo real */}
      {active && fingerPos && (
        <div className="flex justify-between text-[7px] font-mono text-cyan-400/40 px-1">
          <span>X: {fingerPos.sx}px</span>
          <span>Y: {fingerPos.sy}px</span>
          <span className="text-cyan-400/20">{screenW.current}×{screenH.current}</span>
        </div>
      )}

      {loadError && (
        <p className="text-[9px] text-red-400/70">
          Erro ao carregar MediaPipe. Verifica a ligação à internet.
        </p>
      )}

      {!agentOnline && (
        <p className="text-[9px] text-amber-400/60">
          Agente offline{agentError ? ` — ${agentError}` : " — inicia o jarvis-agent"}.
        </p>
      )}

      {/* Botão de teste rápido — sempre visível */}
      <button
        onClick={async () => {
          const cx = Math.round(screenW.current / 2);
          const cy = Math.round(screenH.current / 2);
          try {
            const r = await fetch(`${AGENT_URL}/mouse`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "move", x: cx, y: cy }),
            });
            if (!r.ok) setAgentError(`mouse HTTP ${r.status}`);
            else { setAgentError(""); setAgentOnline(true); agentOnlineRef.current = true; }
          } catch (e: any) {
            setAgentError(e?.message ?? "erro");
          }
        }}
        className="w-full text-[8px] uppercase tracking-widest text-cyan-400/50 hover:text-cyan-300 border border-cyan-400/10 hover:border-cyan-400/30 rounded py-1 transition"
      >
        ➜ TESTAR: MOVER PARA CENTRO ({Math.round(screenW.current/2)},{Math.round(screenH.current/2)})
      </button>

      {/* Legenda de gestos */}
      {active && (
        <div className="grid grid-cols-2 gap-1">
          {[
            { g: "point", label: "☝ Mover" },
            { g: "pinch", label: "🤌 Clicar" },
            { g: "peace", label: "✌ Dir.Click" },
            { g: "fist", label: "✊ Arrastar" },
          ].map(({ g, label }) => (
            <div
              key={g}
              className="flex items-center gap-1 bg-black/30 rounded px-1.5 py-0.5"
              style={{
                borderLeft: `2px solid ${
                  gesture === g ? GESTURE_COLORS[g] : "rgba(34,211,238,0.08)"
                }`,
              }}
            >
              <span
                className="text-[8px] transition-colors duration-150"
                style={{
                  color: gesture === g ? GESTURE_COLORS[g] : "rgba(34,211,238,0.35)",
                }}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
      )}

      <Button
        onClick={active ? stopGestures : startGestures}
        disabled={!mpLoaded && !active}
        size="sm"
        variant="outline"
        className={`w-full tracking-widest text-[9px] gap-2 ${
          active
            ? "bg-red-950/40 border-red-500/30 text-red-400 hover:bg-red-950/60"
            : "bg-cyan-950/30 border-cyan-400/20 text-cyan-300 hover:bg-cyan-950/50"
        }`}
      >
        {!mpLoaded && !active ? (
          "A CARREGAR..."
        ) : active ? (
          <>
            <Activity className="h-3 w-3" /> DESATIVAR
          </>
        ) : (
          <>
            <Fingerprint className="h-3 w-3" /> ATIVAR GESTOS
          </>
        )}
      </Button>
    </div>
  );
}
