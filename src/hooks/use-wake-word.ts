/**
 * useWakeWord
 *
 * Fica em escuta contínua no microfone.
 * Quando deteta a wake word (ex: "jarvis"), chama onWake().
 * Funciona em Chrome/Edge via Web Speech API (não precisa de modelo offline).
 *
 * Fluxo:
 *  1. startWakeWord() — inicia reconhecimento contínuo (baixo consumo, apenas deteta a keyword)
 *  2. Ao ouvir a wake word → para o reconhecimento de wake word → chama onWake()
 *  3. onWake() deve iniciar o reconhecimento de comando completo
 *  4. Depois do comando ser processado, chama resumeWakeWord() para retomar a escuta
 */

import { useCallback, useEffect, useRef, useState } from "react";

const WAKE_WORDS = ["jarvis", "e aí jarvis", "ei jarvis", "hey jarvis", "ok jarvis", "oi jarvis"];

function matchesWakeWord(text: string): boolean {
  const t = text.toLowerCase().trim();
  return WAKE_WORDS.some((w) => t.includes(w));
}

export type WakeWordState = "off" | "listening" | "activated";

interface UseWakeWordOptions {
  lang?: string;
  onWake: () => void;
}

export function useWakeWord({ lang = "pt-PT", onWake }: UseWakeWordOptions) {
  const [wakeState, setWakeState] = useState<WakeWordState>("off");
  const recRef = useRef<any>(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(false); // pausado enquanto comando está em progresso

  const stopRec = useCallback(() => {
    if (recRef.current) {
      try { recRef.current.abort(); } catch {}
      recRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    if (!activeRef.current || pausedRef.current) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.lang = lang;
    rec.continuous = false;       // um utterance de cada vez — mais estável
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    recRef.current = rec;

    rec.onresult = (e: any) => {
      let heard = "";
      for (let i = 0; i < e.results.length; i++) {
        // Ignora resultados com confiança muito baixa (< 40%) para evitar falsos positivos
        const conf: number | undefined = e.results[i][0]?.confidence;
        if (conf != null && conf < 0.4) continue;
        for (let j = 0; j < e.results[i].length; j++) {
          heard += e.results[i][j].transcript + " ";
        }
      }
      if (heard.trim() && matchesWakeWord(heard)) {
        setWakeState("activated");
        pausedRef.current = true;
        stopRec();
        onWake();
      }
    };

    // Reinicia automaticamente ao terminar (sem wake word detetada)
    rec.onend = () => {
      if (activeRef.current && !pausedRef.current) {
        // pequeno delay para não sobrecarregar CPU
        setTimeout(startLoop, 150);
      }
    };

    rec.onerror = (e: any) => {
      // "no-speech" é normal — reinicia
      if (e.error === "no-speech" || e.error === "aborted") return;
      // Outros erros: aguarda antes de tentar de novo
      if (activeRef.current && !pausedRef.current) {
        setTimeout(startLoop, 2000);
      }
    };

    try {
      rec.start();
      setWakeState("listening");
    } catch {}
  }, [lang, onWake, stopRec]);

  const startWakeWord = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    pausedRef.current = false;
    startLoop();
  }, [startLoop]);

  const stopWakeWord = useCallback(() => {
    activeRef.current = false;
    pausedRef.current = false;
    stopRec();
    setWakeState("off");
  }, [stopRec]);

  /** Chamar depois do comando ser processado para retomar a escuta */
  const resumeWakeWord = useCallback(() => {
    if (!activeRef.current) return;
    pausedRef.current = false;
    setWakeState("listening");
    setTimeout(startLoop, 500);
  }, [startLoop]);

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      activeRef.current = false;
      stopRec();
    };
  }, [stopRec]);

  return { wakeState, startWakeWord, stopWakeWord, resumeWakeWord };
}
