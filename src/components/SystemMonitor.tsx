import { useEffect, useRef, useState } from "react";

interface Stats {
  cpuPercent: number;
  ramPercent: number;
  ramUsed: string;
  ramTotal: string;
  gpuName: string;
  cores: number;
}

function getGpuName(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return "N/A";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "WebGL";
    return (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) || "Unknown";
  } catch {
    return "N/A";
  }
}

function getRam() {
  const mem = (performance as any).memory;
  if (!mem) return { percent: 45, used: "N/A", total: "N/A" };
  const usedMB = mem.usedJSHeapSize / 1048576;
  const totalMB = mem.jsHeapSizeLimit / 1048576;
  return {
    percent: Math.round((usedMB / totalMB) * 100),
    used: `${usedMB.toFixed(0)} MB`,
    total: `${(totalMB / 1024).toFixed(1)} GB`,
  };
}

function CircleGauge({
  percent,
  label,
  sublabel,
}: {
  percent: number;
  label: string;
  sublabel?: string;
}) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, Math.max(0, percent)) / 100);
  const color =
    percent > 80 ? "#f87171" : percent > 60 ? "#fbbf24" : "#22d3ee";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-28 h-28">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 84 84">
          <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(34,211,238,0.08)" strokeWidth="5" />
          <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1s ease, stroke 0.5s" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-mono font-bold" style={{ color }}>
            {percent}%
          </span>
        </div>
      </div>
      <span className="text-[10px] uppercase tracking-[0.25em] text-cyan-400/60">{label}</span>
      {sublabel && (
        <span className="text-[10px] font-mono text-cyan-300/50">{sublabel}</span>
      )}
    </div>
  );
}

function BarGauge({ percent }: { percent: number }) {
  const color =
    percent > 80 ? "bg-red-400/70" : percent > 60 ? "bg-amber-400/70" : "bg-cyan-400/70";
  return (
    <div className="h-1.5 w-full bg-cyan-400/10 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all duration-1000`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export function SystemMonitor() {
  const [stats, setStats] = useState<Stats>({
    cpuPercent: 18,
    ramPercent: 0,
    ramUsed: "...",
    ramTotal: "...",
    gpuName: "...",
    cores: typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0,
  });

  const cpuRef = useRef(18);
  const gpuRef = useRef("...");
  const [coreColors, setCoreColors] = useState<number[]>([]);

  useEffect(() => {
    gpuRef.current = getGpuName();
    const count = Math.min(navigator.hardwareConcurrency, 16);
    setCoreColors(Array.from({ length: count }, () => 0.15 + Math.random() * 0.55));

    const interval = setInterval(() => {
      const delta = (Math.random() - 0.46) * 7;
      cpuRef.current = Math.max(4, Math.min(94, cpuRef.current + delta));
      const ram = getRam();
      setStats({
        cpuPercent: Math.round(cpuRef.current),
        ramPercent: ram.percent,
        ramUsed: ram.used,
        ramTotal: ram.total,
        gpuName: gpuRef.current,
        cores: navigator.hardwareConcurrency,
      });
      setCoreColors(Array.from({ length: count }, () => 0.15 + Math.random() * 0.55));
    }, 1600);
    return () => clearInterval(interval);
  }, []);

  const coreCount = Math.min(stats.cores, 16);

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="text-[10px] uppercase tracking-[0.35em] text-cyan-400/40 px-1">
        DIAGNÓSTICO DO SISTEMA
      </div>

      {/* CPU */}
      <div className="bg-black/50 border border-cyan-400/15 rounded-lg p-4 backdrop-blur-sm space-y-3">
        <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/50">
          // PROCESSADOR
        </div>
        <div className="flex items-center gap-3">
          <CircleGauge percent={stats.cpuPercent} label="CPU" sublabel={`${stats.cores} cores`} />
          <div className="flex-1 space-y-2">
            <div className="grid grid-cols-4 gap-0.5">
              {Array.from({ length: coreCount }).map((_, i) => (
                <div
                  key={i}
                  className="h-3 rounded-sm"
                  style={{
                    backgroundColor: `rgba(34,211,238,${coreColors[i] ?? 0.3})`,
                    transition: "background-color 1.6s",
                  }}
                />
              ))}
            </div>
            <div className="text-[10px] text-cyan-400/40 uppercase tracking-widest">
              Threads ativas
            </div>
            <BarGauge percent={stats.cpuPercent} />
          </div>
        </div>
      </div>

      {/* RAM */}
      <div className="bg-black/50 border border-cyan-400/15 rounded-lg p-4 backdrop-blur-sm space-y-3">
        <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/50">
          // MEMÓRIA RAM
        </div>
        <div className="flex items-center gap-3">
          <CircleGauge percent={stats.ramPercent} label="RAM" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-cyan-400/40">USO</span>
              <span className="text-cyan-300">{stats.ramUsed}</span>
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className="text-cyan-400/40">LIMITE</span>
              <span className="text-cyan-300">{stats.ramTotal}</span>
            </div>
            <BarGauge percent={stats.ramPercent} />
          </div>
        </div>
      </div>

      {/* GPU */}
      <div className="bg-black/50 border border-cyan-400/15 rounded-lg p-4 backdrop-blur-sm space-y-2">
        <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/50">// GPU</div>
        <div className="text-xs font-mono text-cyan-300/80 leading-relaxed break-all line-clamp-2">
          {stats.gpuName}
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] uppercase tracking-widest text-cyan-400/40">
            <span>Carga estimada</span>
            <span className="text-cyan-300">{Math.round(stats.cpuPercent * 0.7)}%</span>
          </div>
          <BarGauge percent={Math.round(stats.cpuPercent * 0.7)} />
        </div>
        <div className="flex justify-between text-[10px] font-mono mt-1">
          <span className="text-cyan-400/40">VRAM LIVE</span>
          <span className="text-green-400/70">● ONLINE</span>
        </div>
      </div>

      {/* Network indicator */}
      <div className="bg-black/50 border border-cyan-400/15 rounded-lg p-4 backdrop-blur-sm">
        <div className="text-[10px] uppercase tracking-[0.3em] text-cyan-400/50 mb-2">
          // REDE
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-cyan-400/40 uppercase tracking-widest">Status</span>
          <span className="text-xs text-green-400/80 font-mono flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            CONECTADO
          </span>
        </div>
      </div>
    </div>
  );
}
