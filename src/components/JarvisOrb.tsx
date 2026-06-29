import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

export type JarvisState = "idle" | "listening" | "thinking" | "speaking";

// Canvas constants (canvas is 288×288, center at 144,144)
const BAR_COUNT = 64;
const INNER_R = 72;  // bars start just outside the inner orb edge (orb radius ≈ 64px)
const MAX_BAR = 54;  // max bar length — reaches ≈ 126px, inside the dashed ring at 128px
const MIN_BAR = 2;   // base tick height at silence

export function JarvisOrb({ state, level = 0 }: { state: JarvisState; level?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef  = useRef<number>(0);
  const phaseRef  = useRef(0);
  // Keep mutable refs so the animation loop never needs restarting
  const levelRef  = useRef(level);
  const stateRef  = useRef(state);
  levelRef.current = level;
  stateRef.current = state;

  // Single animation loop — runs for lifetime of the component
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const SIZE = canvas.width; // 288
    const CX = SIZE / 2;
    const CY = SIZE / 2;

    const draw = () => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const st = stateRef.current;
      const lv = levelRef.current;
      const active   = st === "listening" || st === "speaking";
      const thinking = st === "thinking";

      // Phase: faster when active, medium when thinking, slow crawl at idle
      phaseRef.current += active ? 0.09 : thinking ? 0.03 : 0.012;

      for (let i = 0; i < BAR_COUNT; i++) {
        const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;

        let amp: number;
        if (active) {
          // Two-frequency wave for organic, non-symmetric look
          const w1 = Math.sin(phaseRef.current       + i * 0.30);
          const w2 = Math.sin(phaseRef.current * 1.8 + i * 0.11) * 0.35;
          const combined = ((w1 + w2) / 1.35) * 0.5 + 0.5; // normalise 0..1
          amp = lv * combined + 0.08; // always a small baseline when active
        } else if (thinking) {
          amp = (Math.sin(phaseRef.current * 2.5 + i * 0.22) * 0.5 + 0.5) * 0.18;
        } else {
          amp = 0;
        }

        const barLen = MIN_BAR + Math.max(0, amp) * MAX_BAR;
        const x1 = CX + Math.cos(angle) * INNER_R;
        const y1 = CY + Math.sin(angle) * INNER_R;
        const x2 = CX + Math.cos(angle) * (INNER_R + barLen);
        const y2 = CY + Math.sin(angle) * (INNER_R + barLen);

        const opacity = active
          ? Math.min(0.95, 0.18 + amp * 0.82)
          : thinking
          ? 0.12 + amp * 0.45
          : 0.10;

        ctx.strokeStyle = `rgba(34, 211, 238, ${opacity})`;
        ctx.lineWidth   = 1.6;
        ctx.lineCap     = "round";
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(frameRef.current);
  }, []); // runs once — reads state/level from refs

  const scale = 1 + level * 0.25;

  return (
    <div className="relative h-72 w-72 flex items-center justify-center">
      {/* radial waveform canvas — sits behind the rings */}
      <canvas
        ref={canvasRef}
        width={288}
        height={288}
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
      />

      {/* outer rotating rings */}
      <div className="absolute inset-0 rounded-full border border-jarvis/30 animate-spin-slow" />
      <div className="absolute inset-4 rounded-full border-2 border-dashed border-jarvis/40 animate-spin-reverse" />
      <div className="absolute inset-10 rounded-full border border-jarvis/50 animate-spin-slow" />

      {/* tick marks */}
      <svg className="absolute inset-0 animate-spin-reverse" viewBox="0 0 100 100">
        {Array.from({ length: 36 }).map((_, i) => (
          <line
            key={i}
            x1="50" y1="2" x2="50" y2={i % 3 === 0 ? "6" : "4"}
            stroke="currentColor"
            className="text-jarvis/60"
            strokeWidth="0.4"
            transform={`rotate(${i * 10} 50 50)`}
          />
        ))}
      </svg>

      {/* core orb */}
      <div
        className={cn(
          "relative h-32 w-32 rounded-full transition-all duration-300",
          "bg-gradient-to-br from-jarvis-glow via-jarvis to-jarvis-deep",
          "shadow-glow",
          state !== "idle" && "animate-pulse-ring shadow-glow-lg",
        )}
        style={{ transform: `scale(${scale})` }}
      >
        <div className="absolute inset-2 rounded-full bg-background/40 backdrop-blur-sm flex items-center justify-center">
          <div className="h-6 w-6 rounded-full bg-jarvis-glow shadow-glow" />
        </div>
        {state === "listening" && (
          <div className="absolute inset-0 rounded-full overflow-hidden">
            <div className="h-px w-full bg-jarvis-glow shadow-glow animate-scan" />
          </div>
        )}
      </div>

      {/* status label */}
      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs uppercase tracking-[0.4em] text-jarvis text-glow">
        {state === "idle"      && "standby"}
        {state === "listening" && "listening"}
        {state === "thinking"  && "processing"}
        {state === "speaking"  && "responding"}
      </div>
    </div>
  );
}
