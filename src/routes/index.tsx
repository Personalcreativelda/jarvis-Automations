import { useEffect, useRef, useState, useCallback } from "react";
import { JarvisOrb, type JarvisState } from "@/components/JarvisOrb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mic, MicOff, Settings, Send, Radio, RadioTower, Trash2, Maximize2, Minimize2 } from "lucide-react";
import { createRecognition, speak, stopSpeaking, ELEVEN_VOICES, startThinkingSound, stopThinkingSound } from "@/lib/jarvis-voice";
import { SystemMonitor } from "@/components/SystemMonitor";
import { WebcamCard, type WebcamCardHandle } from "@/components/WebcamCard";
import { GestureControl } from "@/components/GestureControl";
import { CommandLog, type LogEntry } from "@/components/CommandLog";
import { WeatherCard } from "@/components/WeatherCard";
import { useWakeWord } from "@/hooks/use-wake-word";

type Msg = { role: "user" | "jarvis"; text: string; ts: number };
type Engine = "browser" | "elevenlabs";

export function Jarvis() {
  const [state, setState] = useState<JarvisState>("idle");
  const [transcript, setTranscript] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [webhook, setWebhook] = useState("");
  const [lang, setLang] = useState("pt-PT");
  const [engine, setEngine] = useState<Engine>("elevenlabs");
  const [voiceId, setVoiceId] = useState(ELEVEN_VOICES[0].id);
  const [showSettings, setShowSettings] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState<string>("");
  const [sessionId] = useState<string>(() => {
    if (typeof window === "undefined") return "jarvis-default";
    let id = localStorage.getItem("jarvis_session_id");
    if (!id) {
      id = `jarvis-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("jarvis_session_id", id);
    }
    return id;
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const [fullscreen, setFullscreen] = useState(false);
  const webcamRef = useRef<WebcamCardHandle>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioLevelRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>("");

  // Enumerate microphone devices (requests permission on first use)
  useEffect(() => {
    if (!navigator.mediaDevices) return; // undefined em HTTP — requer HTTPS
    const loadDevices = async () => {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach((t) => t.stop());
      } catch {}
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter((d) => d.kind === "audioinput"));
      } catch {}
    };
    loadDevices();
    navigator.mediaDevices.addEventListener("devicechange", loadDevices);
    return () => navigator.mediaDevices.removeEventListener("devicechange", loadDevices);
  }, []);

  // Radar sound while thinking
  useEffect(() => {
    if (state === "thinking") {
      startThinkingSound();
    } else {
      stopThinkingSound();
    }
  }, [state]);

  // Mic analyser — only active in fullscreen AND when listening or speaking
  const micActive = fullscreen && (state === "listening" || state === "speaking");
  useEffect(() => {
    if (!micActive) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (micStreamRef.current) { micStreamRef.current.getTracks().forEach((t) => t.stop()); micStreamRef.current = null; }
      analyserRef.current = null;
      setAudioLevel(0);
      return;
    }
    if (!navigator.mediaDevices) return; // undefined em HTTP
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let running = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: micId ? { deviceId: { exact: micId } } : true });
        micStreamRef.current = stream;
        ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        analyserRef.current = analyser;
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!running) return;
          analyser.getByteFrequencyData(buf);
          const avg = buf.slice(0, 32).reduce((a, b) => a + b, 0) / 32;
          const level = Math.min(1, avg / 128);
          audioLevelRef.current = level;
          setAudioLevel(level);
          animFrameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {}
    })();
    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
      analyserRef.current = null;
      micStreamRef.current = null;
      setAudioLevel(0);
    };
  }, [micActive, micId]);

  // Enter conv mode automatically when going fullscreen
  useEffect(() => {
    if (fullscreen && !convModeRef.current) {
      enterConvMode();
      setTimeout(() => startListeningCmdRef.current(), 300);
    }
    if (!fullscreen && convModeRef.current) {
      exitConvMode();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);
  const recRef = useRef<any>(null);
  const listeningRef = useRef(false);
  // ref que aponta sempre para a versão mais recente de startListeningCmd
  // (evita stale closure quando handleWake é chamado pela wake word)
  const startListeningCmdRef = useRef<() => void>(() => {});

  // ── Modo Conversa ──────────────────────────────────────────────────
  // Após ativar pelo wake word, JARVIS fica em loop de escuta automática
  // até 45s de inatividade ou frase de saída
  const convModeRef = useRef(false);
  const convTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inConvMode, setInConvMode] = useState(false);
  const CONV_TIMEOUT = 45_000;
  const EXIT_PHRASES = ["chega", "adeus", "até logo", "obrigado adeus", "fechar", "encerrar", "sair", "descansar", "boa noite", "até já"];

  const isExitPhrase = (text: string) => {
    const t = text.toLowerCase();
    return EXIT_PHRASES.some((p) => t.includes(p));
  };

  const exitConvMode = useCallback(() => {
    convModeRef.current = false;
    setInConvMode(false);
    if (convTimerRef.current) clearTimeout(convTimerRef.current);
    convTimerRef.current = null;
    resumeWakeWord();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetConvTimer = useCallback(() => {
    if (convTimerRef.current) clearTimeout(convTimerRef.current);
    convTimerRef.current = setTimeout(() => exitConvMode(), CONV_TIMEOUT);
  }, [exitConvMode]);

  const enterConvMode = useCallback(() => {
    convModeRef.current = true;
    setInConvMode(true);
    resetConvTimer();
  }, [resetConvTimer]);

  // ── Barge-in setting (user preference — default OFF) ─────────────────────
  // Quando OFF: JARVIS só escuta depois de terminar de falar
  // Quando ON:  utilizador pode interromper JARVIS a meio da frase
  const [bargeInAllowed, setBargeInAllowed] = useState(false);
  const bargeInAllowedRef = useRef(false);
  bargeInAllowedRef.current = bargeInAllowed;

  // ── Barge-in refs ─────────────────────────────────────────────────────────
  const bargeInRecRef = useRef<any>(null);
  const bargeInEnabledRef = useRef(false);
  const speakInterruptedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const launchBargeInRef = useRef<() => void>(() => {});
  const stopBargeInRef = useRef<() => void>(() => {});
  const startBargeInRef = useRef<() => void>(() => {});

  const addLog = (source: LogEntry["source"], type: LogEntry["type"], text: string) => {
    setLogs((prev) => [
      ...prev.slice(-99),
      { id: ++logIdRef.current, ts: Date.now(), source, type, text },
    ]);
  };

  // ── Wake Word ──────────────────────────────────────────────────────────────
  // Chama sempre via ref para ter sempre o startListeningCmd com o webhook atual
  const handleWake = useCallback(() => {
    const wakeReplies = [
      "Sim, senhor. A ouvir.",
      "Às suas ordens. Diga.",
      "Online. Qual é a missão?",
      "Aqui, senhor. Pode falar.",
      "Pronto. O que precisa?",
    ];
    const reply = wakeReplies[Math.floor(Math.random() * wakeReplies.length)];
    setMessages((m) => [...m, { role: "jarvis", text: reply, ts: Date.now() }]);
    setState("speaking");
    // Fala a resposta de ativação e só depois inicia a escuta do comando
    const savedLang = localStorage.getItem("jarvis_lang") || "pt-PT";
    const savedEngine = (localStorage.getItem("jarvis_engine") as Engine) || "elevenlabs";
    const savedVoice = localStorage.getItem("jarvis_voice") || ELEVEN_VOICES[0].id;
    enterConvMode();
    speakInterruptedRef.current = false;
    isSpeakingRef.current = true;
    speak(reply, { lang: savedLang, engine: savedEngine, voiceId: savedVoice }).then(() => {
      isSpeakingRef.current = false;
      stopBargeInRef.current();
      setState("idle");
      if (!speakInterruptedRef.current) {
        setTimeout(() => startListeningCmdRef.current(), 1500);
      }
      speakInterruptedRef.current = false;
    });
    setTimeout(() => startBargeInRef.current(), 1800);
  }, []);

  const { wakeState, startWakeWord, stopWakeWord, resumeWakeWord } = useWakeWord({
    lang,
    onWake: handleWake,
  });

  useEffect(() => {
    setWebhook(localStorage.getItem("jarvis_webhook") || "");
    const savedLang = localStorage.getItem("jarvis_lang") || "pt-PT";
    setLang(savedLang);
    const savedEngine = (localStorage.getItem("jarvis_engine") as Engine) || "elevenlabs";
    setEngine(savedEngine);
    const savedVoice = localStorage.getItem("jarvis_voice") || ELEVEN_VOICES[0].id;
    setVoiceId(savedVoice);
    setMicId(localStorage.getItem("jarvis_mic") || "");
    setBargeInAllowed(localStorage.getItem("jarvis_bargein") === "1");

    const tick = () =>
      setClock(new Date().toISOString().slice(0, 19).replace("T", " "));
    tick();
    const iv = setInterval(tick, 1000);

    const t = setTimeout(() => {
      const greet = "Pronto para servir, senhor. Qual é a missão?";
      setMessages([{ role: "jarvis", text: greet, ts: Date.now() }]);
      addLog("system", "response", greet);
      setState("speaking");
      speak(greet, { lang: savedLang, engine: savedEngine, voiceId: savedVoice }).then(() =>
        setState("idle"),
      );
    }, 600);
    return () => {
      clearTimeout(t);
      clearInterval(iv);
    };
  }, []);

  const saveSettings = () => {
    localStorage.setItem("jarvis_webhook", webhook);
    localStorage.setItem("jarvis_lang", lang);
    localStorage.setItem("jarvis_engine", engine);
    localStorage.setItem("jarvis_voice", voiceId);
    localStorage.setItem("jarvis_mic", micId);
    localStorage.setItem("jarvis_bargein", bargeInAllowed ? "1" : "0");
    setShowSettings(false);
  };

  // Normalise: lowercase + strip diacritics so speech-to-text without accents still matches
  const normalise = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const VISION_PHRASES = [
    // PT-PT
    "olha isto", "ve isto", "o que ves", "o que estou a fazer", "o que ve",
    "olha para aqui", "analisa isto", "descreve isto", "ve o que",
    "o que esta na camara", "o que aparece",
    "consegues ver", "consegue ver", "podes ver", "pode ver",
    "ve aqui", "veja aqui", "ve ai", "veja ai",
    "estas a ver", "esta a ver", "o que estas a ver", "o que esta a ver",
    "o que ves agora", "o que esta a acontecer",
    "oque esta ver", "oque estas a ver",
    // PT-BR
    "olha aqui", "olha ai", "ta vendo", "esta vendo", "vendo aqui", "vendo ai",
    "o que esta vendo", "o que voce ve", "me diz o que ve", "me diz o que ves",
    "o que tem aqui", "o que tem ai", "analisa aqui", "descreve aqui",
    "o que aparece ai", "o que ta acontecendo", "o que esta acontecendo",
    "voce consegue ver", "voce ve",
    "o que voce esta a ver", "o que voce esta vendo",
    // EN fallback
    "look at this", "what do you see", "what can you see", "can you see",
  ];

  const isVisionPhrase = (text: string) => {
    const n = normalise(text);
    return VISION_PHRASES.some((p) => n.includes(normalise(p)));
  };

  const captureWebcamFrame = (): string | null => {
    const refOk = !!webcamRef.current;
    const isActive = webcamRef.current?.isActive() ?? false;
    addLog("system", "response", `[CAM] ref=${refOk ? "ok" : "NULL"} active=${isActive ? "SIM" : "NÃO"}`);
    if (!refOk) return null;
    if (!isActive) {
      addLog("system", "error", "[CAM] câmara offline — liga a câmara primeiro");
      return null;
    }
    const frame = webcamRef.current!.captureFrame();
    addLog("system", "response", `[CAM] frame=${frame ? frame.length + " chars" : "NULL"}`);
    return frame;
  };

  // Extrai reply + jarvis_action de qualquer formato que o n8n possa devolver:
  // 1. JSON puro: { "reply": "...", "jarvis_action": {...} }
  // 2. Bloco markdown: ```json { ... } ```
  // 3. Texto + bloco markdown: "Texto intro ```json {...} ```"
  // 4. Texto simples
  const parseN8nRaw = (
    raw: string,
    fallbackAction?: Record<string, any> | null,
  ): { reply: string; action: Record<string, any> | null; memorySave: Record<string, any> | null } => {
    // Bloco markdown ```json ... ``` (qualquer posição na string)
    const codeMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeMatch) {
      try {
        const inner = JSON.parse(codeMatch[1]);
        const innerReply = inner.reply || inner.output || inner.text || inner.message || "";
        const prefixText = raw.slice(0, raw.indexOf("```")).trim();
        return {
          reply: innerReply || prefixText || raw,
          action: inner.jarvis_action || inner.action_browser || fallbackAction || null,
          memorySave: inner.memory_save || null,
        };
      } catch {}
    }
    // JSON puro
    const trimmed = raw.trimStart();
    if (trimmed.startsWith("{")) {
      try {
        const inner = JSON.parse(trimmed);
        return {
          reply: inner.reply || inner.output || inner.text || inner.message || raw,
          action: inner.jarvis_action || inner.action_browser || fallbackAction || null,
          memorySave: inner.memory_save || null,
        };
      } catch {}
    }
    // Texto simples
    return { reply: raw, action: fallbackAction || null, memorySave: null };
  };

  const sendToN8n = async (text: string, image?: string) => {
    if (!webhook) {
      setError("Configura o webhook n8n nas definições.");
      setShowSettings(true);
      setState("idle");
      resumeWakeWord();
      return;
    }
    setError(null);
    setState("thinking");
    setMessages((m) => [...m, { role: "user", text, ts: Date.now() }]);
    addLog("n8n", "command", image ? `[📷 + imagem] ${text}` : text);
    try {
      const payload: Record<string, any> = { message: text, timestamp: Date.now(), sessionId };
      if (image) {
        // Send raw base64 (no data URL prefix) so n8n can use it directly
        payload.imagem = image;
      }
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const ct = res.headers.get("content-type") || "";
      let reply = "";
      let jarvisAction: Record<string, any> | null = null;
      let memorySave: Record<string, any> | null = null;
      if (ct.includes("application/json")) {
        const data = await res.json();
        const rawField = data.reply || data.output || data.text || data.message || "";
        const rawStr =
          typeof rawField === "string" ? rawField : JSON.stringify(rawField);
        const parsed = parseN8nRaw(rawStr, data.jarvis_action || data.action_browser);
        reply = parsed.reply;
        jarvisAction = parsed.action;
        memorySave = parsed.memorySave || data.memory_save || null;
      } else {
        const rawStr = await res.text();
        const parsed = parseN8nRaw(rawStr);
        reply = parsed.reply;
        jarvisAction = parsed.action;
        memorySave = parsed.memorySave;
      }
      // Guardar memória em background se o agente aprendeu algo novo
      if (memorySave) {
        fetch("/jarvis-agent/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(memorySave),
        }).then(() => addLog("system", "response", `[MEMÓRIA] Guardado: ${JSON.stringify(memorySave)}`)).catch(() => {});
      }
      reply = reply || "Tarefa executada.";
      addLog("n8n", "response", reply);
      setMessages((m) => [...m, { role: "jarvis", text: reply, ts: Date.now() }]);
      // Execute jarvis_action in background (open browser, youtube, etc.)
      if (jarvisAction) {
        // jarvis_action may arrive as a JSON string — parse it if so
        const actionPayload: Record<string, any> =
          typeof jarvisAction === "string"
            ? (() => { try { return JSON.parse(jarvisAction); } catch { return {}; } })()
            : jarvisAction;
        addLog("system", "response", `jarvis_action: ${JSON.stringify(actionPayload)}`);
        if (actionPayload.type) {
          // Acções de app local → /app; acções de browser → /browser
          const APP_TYPES = new Set([
            "app_open", "spotify_play", "media",
            "whatsapp_send", "whatsapp_open", "app_type",
          ]);
          const endpoint = APP_TYPES.has(actionPayload.type)
            ? "/jarvis-agent/app"
            : "/jarvis-agent/browser";
          fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(actionPayload),
          }).then((r) => r.json()).then((r) => addLog("system", "response", `Action: ${r.result || r.error}`)).catch(() => {});
        }
      }
      setState("speaking");
      speakInterruptedRef.current = false;
      isSpeakingRef.current = true;
      // 1800ms de delay: garante que o eco do TTS não dispara o barge-in
      setTimeout(() => startBargeInRef.current(), 1800);
      await speak(reply, { lang, engine, voiceId });
      isSpeakingRef.current = false;
      stopBargeInRef.current();
      setState("idle");
      if (convModeRef.current && !speakInterruptedRef.current) {
        resetConvTimer();
        // 1500ms: deixa o áudio dissipar completamente antes de abrir o microfone
        setTimeout(() => startListeningCmdRef.current(), 1500);
      } else if (!convModeRef.current && !speakInterruptedRef.current) {
        resumeWakeWord();
      }
      // speakInterruptedRef=true → barge-in onend trata do próximo passo
    } catch (e: any) {
      isSpeakingRef.current = false;
      stopBargeInRef.current();
      const isNet = /fetch|network/i.test(e?.message ?? "");
      const msg = isNet
        ? "Sem resposta do n8n. Verifica se o workflow está activo e o URL está correcto."
        : `Erro de comunicação: ${e?.message ?? "desconhecido"}`;
      addLog("n8n", "error", msg);
      setError(msg);
      setMessages((m) => [...m, { role: "jarvis", text: msg, ts: Date.now() }]);
      setState("idle");
      if (convModeRef.current) {
        resetConvTimer();
        setTimeout(() => startListeningCmdRef.current(), 800);
      } else {
        resumeWakeWord();
      }
    }
  };

  const startListeningCmd = () => {
    if (listeningRef.current) return stopListening();
    const rec = createRecognition(lang);
    if (!rec) {
      setError("Reconhecimento de voz não suportado neste browser. Usa Chrome ou Edge.");
      return;
    }
    recRef.current = rec;
    listeningRef.current = true;
    setState("listening");
    setTranscript("");
    let finalText = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          // Só aceita resultados com confiança mínima de 50%
          const conf: number | undefined = r[0].confidence;
          if (conf == null || conf >= 0.5) finalText += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      setTranscript(finalText + interim);
    };
    rec.onerror = (e: any) => {
      listeningRef.current = false;
      // "aborted" e "no-speech" são eventos normais — não mostrar erro ao utilizador
      const isSilent = e.error === "aborted" || e.error === "no-speech";
      if (!isSilent) setError(`Erro de microfone: ${e.error}`);
      setState("idle");
      if (convModeRef.current) {
        resetConvTimer();
        // Se foi no-speech, aguarda mais tempo antes de tentar de novo
        const delay = e.error === "no-speech" ? 1500 : 400;
        setTimeout(() => startListeningCmdRef.current(), delay);
      } else {
        resumeWakeWord();
      }
    };
    rec.onend = () => {
      listeningRef.current = false;
      // Usa só resultados finais (com confiança validada) — nunca o transcript interim
      const text = finalText.trim();
      setTranscript("");
      if (!text) {
        // Nenhuma fala detetada — retomar com delay adequado para não criar loop
        if (convModeRef.current) {
          resetConvTimer();
          setTimeout(() => startListeningCmdRef.current(), 800);
        } else {
          setState("idle");
          resumeWakeWord();
        }
        return;
      }
      if (convModeRef.current && isExitPhrase(text)) {
        const byeReplies = [
          "Até logo, senhor. Estou em espera.",
          "Compreendido. A entrar em modo de espera.",
          "Certamente. Estarei aqui quando precisar.",
          "Claro, senhor. A aguardar.",
          "Como queira. Disponível quando precisar.",
        ];
        const bye = byeReplies[Math.floor(Math.random() * byeReplies.length)];
        setMessages((m) => [...m, { role: "jarvis", text: bye, ts: Date.now() }]);
        setState("speaking");
        speak(bye, { lang, engine, voiceId }).then(() => {
          setState("idle");
          exitConvMode();
        });
      } else {
        const img = isVisionPhrase(text) ? captureWebcamFrame() : null;
        sendToN8n(text, img ?? undefined);
      }
    };
    rec.start();
  };

  // Atualizar o ref a cada render para que handleWake use sempre a versão mais recente
  startListeningCmdRef.current = startListeningCmd;

  const startListening = () => startListeningCmd();

  const stopListening = () => {
    listeningRef.current = false;
    recRef.current?.stop();
  };

  // ── Barge-in: ouve enquanto JARVIS fala — interrompe ao detetar voz ───────
  const stopBargeIn = () => {
    bargeInEnabledRef.current = false;
    try { bargeInRecRef.current?.abort(); } catch {}
    bargeInRecRef.current = null;
  };

  const launchBargeIn = () => {
    if (!bargeInEnabledRef.current || !isSpeakingRef.current || bargeInRecRef.current) return;
    const rec = createRecognition(lang);
    if (!rec) return;
    bargeInRecRef.current = rec;
    let fired = false;
    let finalBarge = "";

    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const conf: number | undefined = r[0].confidence;
          if (conf == null || conf >= 0.55) finalBarge += r[0].transcript;
        } else {
          interim += r[0].transcript;
        }
      }
      // Só dispara barge-in com fala CONFIRMADA (final) de pelo menos 8 chars
      // Evita que ruído ambiente ou eco do TTS disparem a interrupção
      if (!fired && finalBarge.trim().length >= 8) {
        fired = true;
        speakInterruptedRef.current = true;
        isSpeakingRef.current = false;
        bargeInEnabledRef.current = false;
        stopSpeaking();
        setState("listening");
        setTranscript(finalBarge.trim());
      } else if (fired) {
        setTranscript(finalBarge + interim);
      }
    };

    rec.onerror = () => {
      bargeInRecRef.current = null;
      if (fired) {
        setState("idle");
        if (convModeRef.current) setTimeout(() => startListeningCmdRef.current(), 300);
        return;
      }
      if (bargeInEnabledRef.current && isSpeakingRef.current) {
        setTimeout(() => launchBargeInRef.current(), 500);
      }
    };

    rec.onend = () => {
      bargeInRecRef.current = null;
      if (!fired) {
        // Timeout sem detetar fala — reiniciar enquanto TTS ainda ativo
        if (bargeInEnabledRef.current && isSpeakingRef.current) {
          setTimeout(() => launchBargeInRef.current(), 300);
        }
        return;
      }
      // Utilizador interrompeu — processar texto capturado
      setTranscript("");
      const text = finalBarge.trim();
      if (text) {
        if (convModeRef.current && isExitPhrase(text)) {
          const byeReplies = [
            "Até logo, senhor. Estou em espera.",
            "Compreendido. A entrar em modo de espera.",
            "Certamente. Estarei aqui quando precisar.",
            "Claro, senhor. A aguardar.",
            "Como queira. Disponível quando precisar.",
          ];
          const bye = byeReplies[Math.floor(Math.random() * byeReplies.length)];
          setMessages((m) => [...m, { role: "jarvis", text: bye, ts: Date.now() }]);
          setState("speaking");
          speak(bye, { lang, engine, voiceId }).then(() => { setState("idle"); exitConvMode(); });
        } else {
          const img = isVisionPhrase(text) ? captureWebcamFrame() : null;
          sendToN8n(text, img ?? undefined);
        }
      } else {
        setState("idle");
        if (convModeRef.current) {
          resetConvTimer();
          setTimeout(() => startListeningCmdRef.current(), 400);
        }
      }
    };

    try { rec.start(); } catch { bargeInRecRef.current = null; }
  };

  const startBargeIn = () => {
    // Se barge-in estiver desativado nas definições, não escuta enquanto fala
    if (!bargeInAllowedRef.current) return;
    if (!convModeRef.current || !isSpeakingRef.current) return;
    bargeInEnabledRef.current = true;
    launchBargeInRef.current();
  };

  // Atualizar refs barge-in a cada render
  launchBargeInRef.current = launchBargeIn;
  stopBargeInRef.current = stopBargeIn;
  startBargeInRef.current = startBargeIn;

  const sendText = () => {
    const t = textInput.trim();
    if (!t) return;
    setTextInput("");
    sendToN8n(t);
  };

  // ── Fullscreen derived values ─────────────────────────────────────────────
  const lastJarvisMsg = [...messages].reverse().find((m) => m.role === "jarvis");
  const fullscreenText = transcript
    ? transcript
    : state === "speaking" && lastJarvisMsg
    ? lastJarvisMsg.text
    : state === "thinking"
    ? "A processar..."
    : lastJarvisMsg?.text ?? "";

  return (
    <div className="min-h-screen grid-bg relative overflow-hidden">
      {/* ── FULLSCREEN OVERLAY — rendered on top, WebcamCard stays mounted ── */}
      {fullscreen && (
        <div className="fixed inset-0 z-40 bg-[#020c14] flex flex-col items-center justify-center overflow-hidden">
          <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />
          <div className="pointer-events-none absolute inset-5 border border-jarvis/15 rounded-2xl" />
          <div className="pointer-events-none absolute top-5 left-7 right-7 flex justify-between text-[9px] uppercase tracking-[0.35em] text-jarvis/30">
            <span>// J.A.R.V.I.S v2.6 — Stark Industries</span>
            <span suppressHydrationWarning>{clock}</span>
          </div>
          <div className="absolute top-4 right-6 flex gap-4 z-10">
            <button onClick={() => setShowSettings((s) => !s)} className="text-jarvis/40 hover:text-jarvis transition" title="Definições">
              <Settings className="h-4 w-4" />
            </button>
            <button onClick={() => setFullscreen(false)} className="text-jarvis/40 hover:text-jarvis transition" title="Sair do fullscreen">
              <Minimize2 className="h-4 w-4" />
            </button>
          </div>
          <div style={{ transform: "scale(1.5)", transformOrigin: "center" }}>
            <JarvisOrb state={state} level={audioLevel} />
          </div>
          <p className={`mt-32 text-base text-jarvis/80 tracking-wide max-w-2xl text-center leading-relaxed px-8 min-h-[3rem] ${
            state === "listening" ? "text-jarvis/60 italic" : ""
          }`}>
            {fullscreenText && `"${fullscreenText}"`}
          </p>
        </div>
      )}
      <div className="pointer-events-none absolute inset-4 border border-jarvis/30 rounded-lg" />
      <div className="pointer-events-none absolute top-4 left-4 right-4 flex justify-between text-[10px] uppercase tracking-[0.3em] text-jarvis/70 px-4 py-2">
        <span>// J.A.R.V.I.S v2.6 — Stark Industries</span>
        <span suppressHydrationWarning>{clock}</span>
      </div>

      {/* Wake word indicator — barra de escuta sempre visível no topo */}
      {wakeState !== "off" && (
        <div
          className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 py-1 text-[9px] uppercase tracking-[0.3em] transition-colors duration-300 ${
            inConvMode
              ? "bg-jarvis/10 text-jarvis"
              : wakeState === "activated"
              ? "bg-jarvis/20 text-jarvis"
              : "bg-black/60 text-cyan-400/50"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              inConvMode ? "bg-jarvis animate-pulse" : wakeState === "activated" ? "bg-jarvis animate-ping" : "bg-cyan-400/40 animate-pulse"
            }`}
          />
          {inConvMode
            ? "MODO CONVERSA ATIVO · DI \"CHEGA\" PARA SAIR"
            : wakeState === "activated"
            ? "JARVIS ATIVADO — A OUVIR..."
            : "EM ESCUTA · DI \"JARVIS\""}
          {inConvMode && (
            <button
              onClick={exitConvMode}
              className="ml-3 px-2 py-0.5 rounded border border-jarvis/30 text-[8px] hover:bg-jarvis/20 transition"
            >
              ✕ SAIR
            </button>
          )}
        </div>
      )}

      <header className="relative z-10 flex items-center justify-between px-8 py-6">
        <h1 className="text-xl tracking-[0.5em] text-jarvis text-glow">J · A · R · V · I · S</h1>
        <div className="flex items-center gap-3">
        <button
          onClick={() => setShowSettings((s) => !s)}
          className="text-jarvis/70 hover:text-jarvis transition"
          aria-label="Settings"
        >
          <Settings className="h-5 w-5" />
        </button>
        <button
          onClick={() => setFullscreen(true)}
          className="text-jarvis/70 hover:text-jarvis transition"
          aria-label="Fullscreen"
          title="Modo fullscreen"
        >
          <Maximize2 className="h-5 w-5" />
        </button>
        </div>
        {/* Botão wake word */}
        <button
          onClick={() => (wakeState === "off" ? startWakeWord() : stopWakeWord())}
          title={wakeState === "off" ? "Ativar escuta wake word" : "Desativar escuta wake word"}
          className={`transition ${
            wakeState !== "off" ? "text-jarvis" : "text-jarvis/40 hover:text-jarvis/70"
          }`}
          aria-label="Wake word"
        >
          {wakeState !== "off" ? (
            <RadioTower className="h-5 w-5 animate-pulse" />
          ) : (
            <Radio className="h-5 w-5" />
          )}
        </button>
      </header>

      <div className="relative z-10 flex gap-4 px-4 pb-4" style={{height: "calc(100vh - 80px)"}}>
        <aside className="hidden lg:flex flex-col w-80 shrink-0 pt-2 gap-3 overflow-y-auto jarvis-scroll">
          <WeatherCard />
          <SystemMonitor />
        </aside>

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Orb — fixo no centro superior, nunca se move */}
        <div className="flex justify-center pt-4 pb-2">
          <JarvisOrb state={state} />
        </div>

        {/* Chat + controlos — scroll independente */}
        <div className="flex-1 overflow-y-auto jarvis-scroll px-4 pb-4">
        <div className="w-full max-w-2xl mx-auto space-y-4">
          {transcript && (
            <div className="text-center text-sm text-jarvis/80 italic">"{transcript}"</div>
          )}

          <div className="flex items-center justify-between">
            <div className="space-y-2 flex-1 max-h-64 overflow-y-auto pr-2 jarvis-scroll">
              {messages.slice(-20).map((m) => (
              <div
                key={m.ts}
                className={`text-sm leading-relaxed px-4 py-3 rounded-md border backdrop-blur-sm ${
                  m.role === "jarvis"
                    ? "bg-card border-jarvis/30 text-foreground"
                    : "bg-secondary/40 border-border text-muted-foreground ml-8"
                }`}
              >
                <span className="block text-[10px] uppercase tracking-widest text-jarvis/60 mb-1">
                  {m.role === "jarvis" ? "J.A.R.V.I.S" : "User"}
                </span>
                {m.text}
              </div>
              ))}
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                title="Limpar histórico"
                className="ml-2 self-start mt-1 p-1.5 rounded text-jarvis/40 hover:text-destructive hover:bg-destructive/10 transition shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          {error && (
            <div className="text-xs text-destructive border border-destructive/40 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2 items-center pt-4">
            <Button
              onClick={startListening}
              size="lg"
              className="flex-1 bg-jarvis text-primary-foreground hover:bg-jarvis-glow shadow-glow gap-2 font-display tracking-widest"
            >
              {state === "listening" ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              {state === "listening" ? "PARAR" : "FALAR"}
            </Button>
          </div>

          <div className="flex gap-2">
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendText()}
              placeholder="…ou escreve um comando"
              className="bg-input/50 border-jarvis/30 text-foreground placeholder:text-muted-foreground"
            />
            <Button onClick={sendText} variant="outline" size="icon" className="border-jarvis/40">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
        </div>
        </main>

        <aside className="hidden lg:flex flex-col w-80 shrink-0 pt-2 gap-3 overflow-y-auto jarvis-scroll">
          <WebcamCard ref={webcamRef} />
          <GestureControl />
          <CommandLog entries={logs} onClear={() => setLogs([])} />
        </aside>
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-card border border-jarvis/40 rounded-lg p-6 space-y-4 shadow-glow max-h-[90vh] overflow-y-auto">
            <h2 className="text-jarvis tracking-widest text-glow">DEFINIÇÕES</h2>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Webhook n8n
              </label>
              <Input
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder="https://n8n.exemplo.com/webhook/jarvis"
                className="bg-input/50 border-jarvis/30"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Motor de voz
              </label>
              <select
                value={engine}
                onChange={(e) => setEngine(e.target.value as Engine)}
                className="w-full bg-input/50 border border-jarvis/30 rounded-md px-3 py-2 text-sm"
              >
                <option value="elevenlabs">ElevenLabs (cinematográfico)</option>
                <option value="browser">Browser (grátis, robótico)</option>
              </select>
            </div>

            {engine === "elevenlabs" && (
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-widest text-muted-foreground">
                  Voz ElevenLabs
                </label>
                <select
                  value={voiceId}
                  onChange={(e) => setVoiceId(e.target.value)}
                  className="w-full bg-input/50 border border-jarvis/30 rounded-md px-3 py-2 text-sm"
                >
                  {ELEVEN_VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-jarvis/40"
                  onClick={() =>
                    speak("Sistemas online. Como posso ajudar, senhor?", {
                      lang,
                      engine,
                      voiceId,
                    })
                  }
                >
                  Testar voz
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Microfone (visualizador)
              </label>
              <select
                value={micId}
                onChange={(e) => setMicId(e.target.value)}
                className="w-full bg-input/50 border border-jarvis/30 rounded-md px-3 py-2 text-sm"
              >
                <option value="">Microfone predefinido do sistema</option>
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microfone ${d.deviceId.slice(0, 8)}`}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
                ⚠ O reconhecimento de voz usa sempre o microfone predefinido do Windows.<br />
                Para mudar o mic do JARVIS: <strong>Definições Windows → Som → Entrada</strong>.
              </p>
            </div>

            <div className="flex items-start gap-3 py-1">
              <input
                id="bargein-toggle"
                type="checkbox"
                checked={bargeInAllowed}
                onChange={(e) => setBargeInAllowed(e.target.checked)}
                className="mt-0.5 accent-jarvis h-4 w-4 cursor-pointer"
              />
              <div>
                <label htmlFor="bargein-toggle" className="text-xs uppercase tracking-widest text-muted-foreground cursor-pointer">
                  Interromper enquanto fala
                </label>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  Desativado: JARVIS só escuta depois de terminar de falar.<br />
                  Ativado: podes interromper JARVIS a meio da frase.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-widest text-muted-foreground">
                Idioma (reconhecimento)
              </label>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="w-full bg-input/50 border border-jarvis/30 rounded-md px-3 py-2 text-sm"
              >
                <option value="pt-PT">Português (Portugal)</option>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="en-US">English (US)</option>
                <option value="en-GB">English (UK)</option>
                <option value="es-ES">Español</option>
              </select>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="ghost" onClick={() => setShowSettings(false)}>
                Cancelar
              </Button>
              <Button
                onClick={saveSettings}
                className="bg-jarvis text-primary-foreground hover:bg-jarvis-glow"
              >
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
