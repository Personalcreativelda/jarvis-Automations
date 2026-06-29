// Voice helpers: browser SpeechSynthesis (free) + ElevenLabs (cinematic)

type SR = any;

export function createRecognition(lang = "pt-PT"): SR | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec: SR = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  return rec;
}

export const ELEVEN_VOICES: { id: string; label: string }[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "George (British, deep) — JARVIS" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "Daniel (British, authoritative)" },
  { id: "nPczCjzI2devNBz1zQrb", label: "Brian (deep, narrator)" },
  { id: "bIHbv24MWmeRgasZH58o", label: "Will (warm)" },
  { id: "N2lVS1w4EtoT3dr4eOWO", label: "Callum (intense)" },
  { id: "cjVigY5qzO86Huf0OWal", label: "Eric (smooth)" },
  { id: "iP95p4xoKVk53GoZ742B", label: "Chris (natural)" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", label: "Liam (articulate)" },
];

let currentAudio: HTMLAudioElement | null = null;
let currentAudioResolve: (() => void) | null = null;

export function stopSpeaking() {
  try {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = "";
      currentAudio = null;
    }
    if (currentAudioResolve) {
      currentAudioResolve();
      currentAudioResolve = null;
    }
  } catch {}
}

export async function speakBrowser(text: string, lang = "pt-PT"): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 1;
    u.pitch = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => v.lang.startsWith(lang) && /male|daniel|google/i.test(v.name)) ||
      voices.find((v) => v.lang.startsWith(lang)) ||
      voices[0];
    if (preferred) u.voice = preferred;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export async function speakElevenLabs(text: string, voiceId: string): Promise<void> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voiceId }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`TTS ${res.status}: ${msg}`);
  }

  // Stream via MediaSource — playback starts on first chunk, not after full download
  const supportsMS =
    typeof MediaSource !== "undefined" &&
    typeof MediaSource.isTypeSupported === "function" &&
    MediaSource.isTypeSupported("audio/mpeg");

  if (!supportsMS || !res.body) {
    // Fallback: full blob download (Firefox / older browsers)
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    return new Promise<void>((resolve) => {
      currentAudioResolve = resolve;
      audio.onended = () => { URL.revokeObjectURL(url); currentAudioResolve = null; resolve(); };
      audio.onerror = () => { URL.revokeObjectURL(url); currentAudioResolve = null; resolve(); };
      audio.play().catch(() => { currentAudioResolve = null; resolve(); });
    });
  }

  return new Promise<void>((resolve) => {
    const ms = new MediaSource();
    const blobUrl = URL.createObjectURL(ms);
    const audio = new Audio(blobUrl);
    currentAudio = audio;

    const finish = () => {
      URL.revokeObjectURL(blobUrl);
      currentAudioResolve = null;
      resolve();
    };

    currentAudioResolve = finish;
    audio.onended = finish;
    audio.onerror = finish;

    ms.addEventListener("sourceopen", () => {
      let sb: SourceBuffer;
      try {
        sb = ms.addSourceBuffer("audio/mpeg");
      } catch {
        finish();
        return;
      }

      const reader = res.body!.getReader();
      let playStarted = false;

      const pump = () => {
        reader.read().then(({ done, value }) => {
          if (done) {
            try { if (ms.readyState === "open") ms.endOfStream(); } catch {}
            return;
          }
          try {
            sb.appendBuffer(value);
            // Start playback after first chunk buffered
            if (!playStarted) {
              playStarted = true;
              setTimeout(() => audio.play().catch(() => finish()), 30);
            }
          } catch {
            finish();
          }
        }).catch(() => finish());
      };

      sb.addEventListener("updateend", pump);
      pump();
    });
  });
}

// ── Thinking sound — radar sweep ────────────────────────────────────────────
let _thinkCtx: AudioContext | null = null;
let _thinkTimer: ReturnType<typeof setInterval> | null = null;

function _radarPing(ctx: AudioContext) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  const t = ctx.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(900, t);
  osc.frequency.exponentialRampToValueAtTime(200, t + 0.55);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.12, t + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  osc.start(t);
  osc.stop(t + 0.6);
}

export function startThinkingSound() {
  if (typeof window === "undefined") return;
  stopThinkingSound();
  try {
    _thinkCtx = new AudioContext();
    _radarPing(_thinkCtx);
    _thinkTimer = setInterval(() => _thinkCtx && _radarPing(_thinkCtx), 1600);
  } catch {}
}

export function stopThinkingSound() {
  if (_thinkTimer) { clearInterval(_thinkTimer); _thinkTimer = null; }
  if (_thinkCtx) { _thinkCtx.close().catch(() => {}); _thinkCtx = null; }
}

export async function speak(
  text: string,
  opts: { lang?: string; engine?: "browser" | "elevenlabs"; voiceId?: string },
): Promise<void> {
  if (opts.engine === "elevenlabs") {
    try {
      return await speakElevenLabs(text, opts.voiceId || ELEVEN_VOICES[0].id);
    } catch (e) {
      console.error("ElevenLabs falhou, a usar browser:", e);
      return speakBrowser(text, opts.lang);
    }
  }
  return speakBrowser(text, opts.lang);
}
