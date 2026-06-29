import { useEffect, useRef } from "react";
import { Terminal, CheckCircle2, XCircle, Clock } from "lucide-react";

export type LogEntry = {
  id: number;
  ts: number;
  source: "n8n" | "local" | "system";
  type: "command" | "response" | "error";
  text: string;
};

const SOURCE_LABELS: Record<LogEntry["source"], string> = {
  n8n: "N8N",
  local: "LOCAL",
  system: "SYS",
};

const SOURCE_COLORS: Record<LogEntry["source"], string> = {
  n8n: "text-violet-400/70",
  local: "text-cyan-400/70",
  system: "text-amber-400/60",
};

const SOURCE_BORDER: Record<LogEntry["source"], string> = {
  n8n: "border-violet-400/20",
  local: "border-cyan-400/20",
  system: "border-amber-400/20",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface CommandLogProps {
  entries: LogEntry[];
  onClear: () => void;
}

export function CommandLog({ entries, onClear }: CommandLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="bg-black/50 border border-cyan-400/15 rounded-lg p-4 backdrop-blur-sm flex flex-col gap-2 h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.3em] text-cyan-400/50">
          <Terminal className="h-3.5 w-3.5" />
          LOG DE EXECUÇÃO
        </div>
        {entries.length > 0 && (
          <button onClick={onClear} className="text-[9px] text-cyan-400/25 hover:text-red-400/60 transition uppercase tracking-wider">
            LIMPAR
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex gap-2 shrink-0">
        {(["n8n", "local", "system"] as const).map((s) => (
          <div key={s} className="flex items-center gap-1">
            <span className={`text-[7px] font-mono ${SOURCE_COLORS[s]}`}>
              ● {SOURCE_LABELS[s]}
            </span>
          </div>
        ))}
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0 pr-0.5" style={{ maxHeight: "340px" }}>
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2 opacity-40">
            <Clock className="h-5 w-5 text-cyan-400/30" />
            <span className="text-[8px] uppercase tracking-widest text-cyan-400/30">
              Aguardando comandos...
            </span>
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className={`rounded px-2 py-1.5 border bg-black/30 ${SOURCE_BORDER[e.source]}`}
            >
              {/* Meta row */}
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5">
                  {e.type === "error" ? (
                    <XCircle className="h-2.5 w-2.5 text-red-400/70 shrink-0" />
                  ) : e.type === "response" ? (
                    <CheckCircle2 className="h-2.5 w-2.5 text-green-400/60 shrink-0" />
                  ) : (
                    <span className="h-2.5 w-2.5 flex items-center justify-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400/50 inline-block" />
                    </span>
                  )}
                  <span className={`text-[7px] font-mono uppercase ${SOURCE_COLORS[e.source]}`}>
                    {SOURCE_LABELS[e.source]}
                  </span>
                  <span className="text-[7px] text-cyan-400/20 uppercase tracking-wider">
                    {e.type === "command" ? "CMD" : e.type === "response" ? "RSP" : "ERR"}
                  </span>
                </div>
                <span className="text-[7px] font-mono text-cyan-400/25">
                  {formatTime(e.ts)}
                </span>
              </div>
              {/* Text */}
              <p
                className={`text-[9px] leading-relaxed font-mono break-words line-clamp-3 ${
                  e.type === "error"
                    ? "text-red-400/70"
                    : e.type === "response"
                    ? "text-green-300/70"
                    : "text-cyan-200/80"
                }`}
              >
                {e.text}
              </p>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Footer counter */}
      {entries.length > 0 && (
        <div className="shrink-0 text-[7px] font-mono text-cyan-400/20 text-right">
          {entries.length} entrada{entries.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
