"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/mvp/AdvisorAvatar3D.module.css";

type AvatarVariant = "female" | "male";
type AvatarStatus = "loading" | "ready" | "speaking" | "error";

type AdvisorAvatar3DProps = {
  audioElement?: HTMLAudioElement | null;
  speechText?: string | null;
  isSpeaking: boolean;
  avatarVariant?: AvatarVariant;
  size?: number;
  modelUrl?: string | null;
  fallbackImageSrc?: string | null;
  label: string;
  playbackId?: number;
};

type TalkingHeadInstance = {
  showAvatar: (avatar: Record<string, unknown>) => Promise<void>;
  streamStart: (
    options?: Record<string, unknown>,
    onAudioStart?: (() => void) | null,
    onAudioEnd?: (() => void) | null,
  ) => Promise<void>;
  streamAudio: (payload: Record<string, unknown>) => void;
  streamInterrupt: () => void;
  streamStop: () => void;
  startListening: (analyzer: AnalyserNode, options?: Record<string, unknown>) => void;
  stopListening: () => void;
  lookAtCamera: (durationMs: number) => void;
  lookAhead: (durationMs: number) => void;
  setMood: (mood: string) => void;
  stop?: () => void;
};

const DEFAULT_READY_PLAYER_ME_FEMALE_URL =
  "https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png";
let talkingHeadModulePromise: Promise<typeof import("@/vendor/talkinghead/talkinghead.mjs")> | null = null;
const preloadedAvatarModels = new Set<string>();

function loadTalkingHeadModule() {
  if (!talkingHeadModulePromise) {
    talkingHeadModulePromise = import("@/vendor/talkinghead/talkinghead.mjs");
  }
  return talkingHeadModulePromise;
}

export function preloadAdvisorAvatarAssets(modelUrl?: string | null) {
  if (typeof window === "undefined") return;
  void loadTalkingHeadModule();
  if (!modelUrl || preloadedAvatarModels.has(modelUrl)) return;
  preloadedAvatarModels.add(modelUrl);
  void fetch(modelUrl, { cache: "force-cache" }).catch(() => undefined);
}

function resolveReadyPlayerMeUrl(avatarVariant: AvatarVariant, explicitUrl?: string | null) {
  if (explicitUrl) return explicitUrl;
  const generic = process.env.NEXT_PUBLIC_READY_PLAYER_ME_AVATAR_URL?.trim();
  const female = process.env.NEXT_PUBLIC_READY_PLAYER_ME_AVATAR_FEMALE_URL?.trim();
  const male = process.env.NEXT_PUBLIC_READY_PLAYER_ME_AVATAR_MALE_URL?.trim();
  if (avatarVariant === "male") return male || generic || DEFAULT_READY_PLAYER_ME_FEMALE_URL;
  return female || generic || DEFAULT_READY_PLAYER_ME_FEMALE_URL;
}

function estimateSpeechDurationMs(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const punctuationCount = (text.match(/[.,;:!?]/g) ?? []).length;
  return Math.max(1400, words.length * 320 + punctuationCount * 90);
}

function buildApproximateVisemeTrack(text: string) {
  const normalized = text
    .replace(/\u00f1/gi, "nn")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.,;:!? ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const totalDurationMs = estimateSpeechDurationMs(normalized);
  const tokens: Array<{ viseme: string | null; weight: number }> = [];

  for (let index = 0; index < normalized.length; index += 1) {
    const pair = normalized.slice(index, index + 2);
    const current = normalized[index] ?? "";

    if (pair === "ch") {
      tokens.push({ viseme: "CH", weight: 1.5 });
      index += 1;
      continue;
    }
    if (pair === "rr") {
      tokens.push({ viseme: "RR", weight: 1.3 });
      index += 1;
      continue;
    }
    if (pair === "ll") {
      tokens.push({ viseme: "I", weight: 1.1 });
      index += 1;
      continue;
    }

    if (current === " ") {
      tokens.push({ viseme: null, weight: 0.55 });
      continue;
    }
    if (/[.,!?]/.test(current)) {
      tokens.push({ viseme: null, weight: 1.4 });
      continue;
    }
    if (/[;:]/.test(current)) {
      tokens.push({ viseme: null, weight: 1 });
      continue;
    }
    if ("bpwm".includes(current)) {
      tokens.push({ viseme: "PP", weight: 1.1 });
      continue;
    }
    if ("fv".includes(current)) {
      tokens.push({ viseme: "FF", weight: 1 });
      continue;
    }
    if ("tdl".includes(current)) {
      tokens.push({ viseme: "DD", weight: 1 });
      continue;
    }
    if ("szjx".includes(current)) {
      tokens.push({ viseme: "SS", weight: 1 });
      continue;
    }
    if ("gkcq".includes(current)) {
      tokens.push({ viseme: "kk", weight: 1 });
      continue;
    }
    if (current === "n") {
      tokens.push({ viseme: "nn", weight: 1 });
      continue;
    }
    if (current === "r") {
      tokens.push({ viseme: "RR", weight: 0.9 });
      continue;
    }
    if (current === "a") {
      tokens.push({ viseme: "aa", weight: 1.2 });
      continue;
    }
    if (current === "e") {
      tokens.push({ viseme: "E", weight: 1.1 });
      continue;
    }
    if (current === "i" || current === "y") {
      tokens.push({ viseme: "I", weight: 1.05 });
      continue;
    }
    if (current === "o") {
      tokens.push({ viseme: "O", weight: 1.15 });
      continue;
    }
    if (current === "u") {
      tokens.push({ viseme: "U", weight: 1.1 });
      continue;
    }

    tokens.push({ viseme: "SS", weight: 0.8 });
  }

  const totalWeight = tokens.reduce((sum, token) => sum + token.weight, 0) || 1;
  let cursorMs = 0;
  const visemes: string[] = [];
  const vtimes: number[] = [];
  const vdurations: number[] = [];

  for (const token of tokens) {
    const durationMs = Math.max(55, Math.round((token.weight / totalWeight) * totalDurationMs));
    if (token.viseme) {
      visemes.push(token.viseme);
      vtimes.push(cursorMs);
      vdurations.push(durationMs);
    }
    cursorMs += durationMs;
  }

  return { visemes, vtimes, vdurations };
}

export function AdvisorAvatar3D({
  audioElement = null,
  speechText = null,
  isSpeaking,
  avatarVariant = "female",
  size = 168,
  modelUrl,
  fallbackImageSrc = null,
  label,
  playbackId = 0,
}: AdvisorAvatar3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<TalkingHeadInstance | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const sourceAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const activePlaybackRef = useRef<number>(-1);
  const [loadState, setLoadState] = useState<Exclude<AvatarStatus, "speaking">>("loading");
  const [runtimeErrorMessage, setRuntimeErrorMessage] = useState<string | null>(null);

  const resolvedModelUrl = useMemo(
    () => resolveReadyPlayerMeUrl(avatarVariant, modelUrl),
    [avatarVariant, modelUrl],
  );
  const modelUnavailable = !resolvedModelUrl;
  const status: AvatarStatus = modelUnavailable
    ? "error"
    : loadState === "error"
      ? "error"
      : isSpeaking
        ? "speaking"
        : loadState;
  const errorMessage = modelUnavailable ? "Avatar 3D no disponible" : runtimeErrorMessage;

  useEffect(() => {
    if (!containerRef.current || !resolvedModelUrl) {
      return;
    }

    let cancelled = false;

    async function loadAvatar() {
      try {
        setLoadState("loading");
        setRuntimeErrorMessage(null);
        const { TalkingHead } = await loadTalkingHeadModule();
        if (cancelled || !containerRef.current) return;

        const head = new TalkingHead(containerRef.current, {
          cameraView: "head",
          cameraRotateEnable: false,
          cameraPanEnable: false,
          cameraZoomEnable: false,
          // We drive speaking with explicit viseme tracks, so skip the vendor's
          // default eager loading of bundled lipsync processors.
          lipsyncModules: [],
          modelFPS: 30,
          modelPixelRatio: 1,
          lightAmbientIntensity: 2.1,
          lightDirectIntensity: 20,
          lightDirectPhi: 0.18,
          lightDirectTheta: 2.2,
          avatarMood: "neutral",
          avatarIdleEyeContact: 0.2,
          avatarIdleHeadMove: 0.12,
          avatarSpeakingEyeContact: 0.28,
          avatarSpeakingHeadMove: 0.18,
        }) as unknown as TalkingHeadInstance;

        await head.showAvatar({
          url: resolvedModelUrl,
          body: avatarVariant === "male" ? "M" : "F",
          avatarMood: "neutral",
        });

        if (cancelled) {
          head.stopListening();
          head.streamStop();
          head.stop?.();
          return;
        }

        headRef.current = head;
        setLoadState("ready");
      } catch (error) {
        console.error("avatar_3d_load_failed", error);
        setLoadState("error");
        setRuntimeErrorMessage("No pudimos cargar el avatar 3D");
      }
    }

    void loadAvatar();

    return () => {
      cancelled = true;
      headRef.current?.streamInterrupt();
      headRef.current?.streamStop();
      headRef.current?.stopListening();
      headRef.current?.stop?.();
      headRef.current = null;
    };
  }, [avatarVariant, resolvedModelUrl]);

  useEffect(() => {
    return () => {
      analyserRef.current?.disconnect();
      sourceNodeRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => undefined);
      analyserRef.current = null;
      sourceNodeRef.current = null;
      audioContextRef.current = null;
      sourceAudioElementRef.current = null;
    };
  }, []);

  useEffect(() => {
    const head = headRef.current;
    if (!head) return;

    async function attachAudioAnalyzer() {
      const activeHead = headRef.current;
      if (!activeHead) return;
      if (!audioElement) return;
      if (sourceAudioElementRef.current === audioElement && analyserRef.current) {
        activeHead.startListening(analyserRef.current, {
          listeningActiveThresholdLevel: 72,
          listeningSilenceThresholdLevel: 36,
        });
        return;
      }

      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new AudioContext();
        }
        const context = audioContextRef.current;
        if (context.state === "suspended") {
          await context.resume();
        }

        analyserRef.current?.disconnect();
        sourceNodeRef.current?.disconnect();

        const analyser = context.createAnalyser();
        const sourceNode = context.createMediaElementSource(audioElement);
        sourceNode.connect(analyser);
        sourceNode.connect(context.destination);

        analyserRef.current = analyser;
        sourceNodeRef.current = sourceNode;
        sourceAudioElementRef.current = audioElement;

        activeHead.startListening(analyser, {
          listeningActiveThresholdLevel: 72,
          listeningSilenceThresholdLevel: 36,
        });
      } catch (error) {
        console.warn("avatar_audio_analyzer_failed", error);
      }
    }

    if (isSpeaking && audioElement) {
      void attachAudioAnalyzer();
    }
    if (!isSpeaking) {
      head.stopListening();
    }
  }, [audioElement, isSpeaking]);

  useEffect(() => {
    const head = headRef.current;
    if (!head || !speechText?.trim()) return;

    if (!isSpeaking) {
      activePlaybackRef.current = -1;
      head.streamInterrupt();
      head.streamStop();
      head.stopListening();
      head.lookAhead(800);
      return;
    }

    if (activePlaybackRef.current === playbackId) return;
    activePlaybackRef.current = playbackId;

    const visemeTrack = buildApproximateVisemeTrack(speechText);

    async function animateSpeech() {
      const activeHead = headRef.current;
      if (!activeHead) return;
      try {
        await activeHead.streamStart({
          waitForAudioChunks: false,
          lipsyncType: "visemes",
        });
        activeHead.lookAtCamera(1200);
        activeHead.setMood("neutral");
        activeHead.streamAudio(visemeTrack);
      } catch (error) {
        console.error("avatar_3d_speaking_failed", error);
        setLoadState("error");
        setRuntimeErrorMessage("No pudimos sincronizar el avatar");
      }
    }

    void animateSpeech();
  }, [isSpeaking, playbackId, speechText]);

  const avatarSizeStyle = {
    width: `${size}px`,
    height: `${size}px`,
  };
  const initials = (label || "A").trim()[0]?.toUpperCase() || "A";

  return (
    <div className={styles.avatarShell} style={avatarSizeStyle}>
      {status === "error" || !resolvedModelUrl ? (
        fallbackImageSrc ? (
          <Image
            src={fallbackImageSrc}
            alt={label}
            fill
            priority
            className={styles.avatarFallbackImage}
            sizes={`${size}px`}
          />
        ) : (
          <span className={styles.avatarFallbackInitial}>{initials}</span>
        )
      ) : (
        <div ref={containerRef} className={styles.avatarCanvas} />
      )}

      {status === "loading" ? <div className={styles.avatarLoading}>Cargando avatar</div> : null}
      <div className={styles.avatarStatus}>
        {status === "speaking"
          ? "Hablando"
          : status === "ready"
            ? "Listo"
            : status === "loading"
              ? "Cargando"
              : "Fallback"}
      </div>
      {errorMessage ? <div className={styles.avatarError}>{errorMessage}</div> : null}
    </div>
  );
}
