"use client";

import { type ChangeEvent, type ClipboardEvent, useEffect, useRef, useState } from "react";

import { AdvisorChatModal } from "@/components/mvp/AdvisorChatModal";
import { AdvisorProfileModal } from "@/components/mvp/AdvisorProfileModal";
import { Button, Textarea } from "@/components/mvp/ui";
import { AdvisorAvatarItem } from "@/components/ui/AdvisorAvatarItem";
import { ADVISOR_PROFILES } from "@/data/advisors";
import type { AdvisorProfile } from "@/data/advisors";
import { getCases, postAdvisor, postAnalysis, postOcrInterpret, postWizardEvent } from "@/lib/api/client";
import { toUiErrorMessage } from "@/lib/api/errors";
import type { AdvisorResponse, AnalysisResponse, CaseSummary, OcrCapabilitiesResponse, OcrExtractResponse } from "@/lib/api/types";
import { authFetch, hasStoredSession } from "@/lib/auth/client";
import { API_URL } from "@/lib/config";

type ConversationBlock = {
  id: string;
  speaker: "ex_partner" | "user" | "unknown";
  content: string;
  confidence?: number;
  source?: "manual" | "ocr";
};

type ResponseTone = "cordial" | "firme_respetuoso" | "amigable";

const OCR_EXTRACT_URL = `${API_URL}/v1/ocr/extract`;
const OCR_CAPABILITIES_URL = `${API_URL}/v1/ocr/capabilities`;
const responseStyleOptions: Array<{ value: ResponseTone; label: string }> = [
  { value: "cordial", label: "Cordial" },
  { value: "firme_respetuoso", label: "Firme" },
  { value: "amigable", label: "Amigable" },
];

function createBlock(speaker: ConversationBlock["speaker"], content: string, source: ConversationBlock["source"]): ConversationBlock {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, speaker, content: content.trim(), source };
}

function formatBlocks(blocks: ConversationBlock[]): string {
  return blocks
    .map((b) => `${b.speaker === "user" ? "Yo" : b.speaker === "ex_partner" ? "Ex pareja" : "Sin identificar"}: ${b.content.trim()}`)
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function looksLikeConversationInput(text: string): boolean {
  const lines = text.trim().split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length >= 3) return true;
  return /(yo|me|ex|ex pareja|tu|vos)\s*[:\-]/i.test(text);
}

function heuristicSegment(text: string, source: "manual" | "ocr"): ConversationBlock[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const blocks: ConversationBlock[] = [];
  let speaker: ConversationBlock["speaker"] = "ex_partner";
  let acc: string[] = [];
  for (const line of lines) {
    const marker = line.match(/^(yo|me|mi|tu|vos|ex|expareja|ex pareja|ella|el)\s*[:\-]\s*(.+)$/i);
    let nextSpeaker = speaker;
    let content = line;
    if (marker) {
      const label = marker[1].toLowerCase();
      nextSpeaker = ["yo", "me", "mi", "tu", "vos"].includes(label) ? "user" : "ex_partner";
      content = marker[2].trim();
    }
    if (acc.length > 0 && nextSpeaker !== speaker) {
      blocks.push(createBlock(speaker, acc.join(" "), source));
      acc = [];
    }
    speaker = nextSpeaker;
    acc.push(content);
  }
  if (acc.length > 0) blocks.push(createBlock(speaker, acc.join(" "), source));
  return blocks.filter((b) => b.content.length > 0);
}

function getSubmissionText(blocks: ConversationBlock[], messageText: string): string {
  const structured = formatBlocks(blocks).trim();
  return structured || messageText.trim();
}

export function WizardScaffold() {
  const [messageText, setMessageText] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [advisorResult, setAdvisorResult] = useState<AdvisorResponse | null>(null);
  const [loadingAdvisor, setLoadingAdvisor] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [contextOptional, setContextOptional] = useState("");
  const [contextExpanded, setContextExpanded] = useState(false);
  const [responseTone, setResponseTone] = useState<ResponseTone>("cordial");
  const [selectedProfile, setSelectedProfile] = useState<AdvisorProfile | null>(null);
  const [conversationBlocks, setConversationBlocks] = useState<ConversationBlock[]>([]);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrInfo, setOcrInfo] = useState<OcrExtractResponse | null>(null);
  const [ocrStatusMessage, setOcrStatusMessage] = useState<string | null>(null);
  const [autoParsing, setAutoParsing] = useState(false);
  const [autoParseError, setAutoParseError] = useState<string | null>(null);
  const [ocrCapabilities, setOcrCapabilities] = useState<OcrCapabilitiesResponse | null>(null);
  const [ocrCapabilitiesLoading, setOcrCapabilitiesLoading] = useState(true);
  const [activeCase, setActiveCase] = useState<CaseSummary | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const [advisorChatOpen, setAdvisorChatOpen] = useState(false);
  const [advisorChatIndex, setAdvisorChatIndex] = useState<number | null>(null);
  const [advisorChatInput, setAdvisorChatInput] = useState("");
  const [advisorChatSending, setAdvisorChatSending] = useState(false);
  const [advisorChatMessages, setAdvisorChatMessages] = useState<Array<{ id: string; role: "user" | "advisor"; text: string }>>([]);
  const selectedCaseId = activeCase?.id ?? null;
  const manualInterpretTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;
    void authFetch(OCR_CAPABILITIES_URL, { method: "GET", cache: "no-store" })
      .then(async (res) => {
        if (!mounted) return;
        if (!res.ok) throw new Error(String(res.status));
        setOcrCapabilities((await res.json()) as OcrCapabilitiesResponse);
      })
      .catch(() => {
        if (!mounted) return;
        setOcrCapabilities({ available: false, selected_provider: "auto", providers_checked: [], reason_codes: ["ocr_unavailable"] });
      })
      .finally(() => {
        if (mounted) setOcrCapabilitiesLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    void getCases().then((response) => {
      if (!mounted) return;
      const c = response.cases[0] ?? null;
      setActiveCase(c);
      if (!c) setCaseError("No se encontro contexto de caso para este usuario.");
    }).catch((exc) => {
      if (!mounted) return;
      setCaseError(toUiErrorMessage(exc, "No se pudo cargar el contexto del caso."));
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => () => {
    if (manualInterpretTimerRef.current !== null) window.clearTimeout(manualInterpretTimerRef.current);
  }, []);

  function syncBlocks(blocks: ConversationBlock[]) {
    setConversationBlocks(blocks);
    const text = formatBlocks(blocks);
    if (text) setMessageText(text);
  }

  async function interpretConversationText(rawText: string, source: "ocr" | "text", forceGemini = false) {
    const normalized = rawText.trim();
    if (!normalized) return;
    setAutoParsing(true);
    setAutoParseError(null);
    const localFallback = heuristicSegment(normalized, source === "ocr" ? "ocr" : "manual");
    try {
      if (!forceGemini && source !== "ocr" && localFallback.length >= 2) {
        syncBlocks(localFallback);
        return;
      }
      const interpreted = await postOcrInterpret({ text: normalized, source });
      const apiBlocks = interpreted.blocks
        .map((b) => ({ id: b.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, speaker: b.speaker, content: b.content.trim(), confidence: b.confidence, source: source === "ocr" ? "ocr" : "manual" as const }))
        .filter((b) => b.content.length > 0);
      if (apiBlocks.length > 0) {
        syncBlocks(apiBlocks);
      } else if (localFallback.length > 0) {
        syncBlocks(localFallback);
      }
    } catch {
      if (localFallback.length > 0) syncBlocks(localFallback);
      setAutoParseError("No pudimos interpretar todos los turnos. Revisa los bloques.");
    } finally {
      setAutoParsing(false);
    }
  }

  async function handleExtractTextFromImage(file: File) {
    if (ocrLoading) return;
    if (!hasStoredSession()) { setOcrError("Tu sesion no esta activa."); return; }
    setOcrLoading(true); setOcrError(null); setOcrInfo(null);
    try {
      const formData = new FormData(); formData.append("file", file);
      const response = await authFetch(OCR_EXTRACT_URL, { method: "POST", body: formData });
      if (!response.ok) throw new Error("No se pudo leer la imagen.");
      const payload = (await response.json()) as OcrExtractResponse;
      setMessageText(payload.extracted_text); setOcrInfo(payload); setOcrStatusMessage("Texto interpretado automaticamente.");
      await interpretConversationText(payload.extracted_text, "ocr", true);
    } catch (exc) {
      setOcrError(exc instanceof Error ? exc.message : "No se pudo leer el texto de la imagen.");
    } finally {
      setOcrLoading(false);
    }
  }

  async function processImageFile(file: File) {
    if (!file.type.startsWith("image/")) { setOcrError("Selecciona una imagen valida."); return; }
    setOcrStatusMessage("Procesando captura...");
    await handleExtractTextFromImage(file);
  }

  function handleImageSelection(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (file) void processImageFile(file); event.target.value = ""; }

  function handleStepPaste(event: ClipboardEvent<HTMLElement>) {
    const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith("image/"));
    if (imageItem) { const f = imageItem.getAsFile(); if (f) { event.preventDefault(); void processImageFile(f); } return; }
    const pastedText = event.clipboardData.getData("text");
    if (pastedText && looksLikeConversationInput(pastedText)) window.setTimeout(() => { void interpretConversationText(pastedText, "text"); }, 0);
  }

  function handleMessageTextChange(nextValue: string) {
    setMessageText(nextValue);
    if (manualInterpretTimerRef.current !== null) window.clearTimeout(manualInterpretTimerRef.current);
    if (!looksLikeConversationInput(nextValue)) return;
    manualInterpretTimerRef.current = window.setTimeout(() => { void interpretConversationText(nextValue, "text"); }, 450);
  }

  function updateConversationBlockSpeaker(id: string, speaker: ConversationBlock["speaker"]) { syncBlocks(conversationBlocks.map((b) => b.id === id ? { ...b, speaker } : b)); }
  function updateConversationBlockText(id: string, content: string) { syncBlocks(conversationBlocks.map((b) => b.id === id ? { ...b, content } : b)); }

  function buildContextPayload() {
    const context: Record<string, unknown> = { user_style: responseTone };
    if (contextOptional.trim()) context.contact_context = contextOptional.trim();
    if (conversationBlocks.length > 0) {
      context.conversation_structured = formatBlocks(conversationBlocks);
      context.conversation_blocks = conversationBlocks.map((b) => ({ speaker: b.speaker, content: b.content, confidence: b.confidence ?? null, source: b.source ?? "manual" }));
    }
    return context;
  }

  async function handleGenerateResponses() {
    const text = getSubmissionText(conversationBlocks, messageText);
    if (!text) return;
    setAnalysisError(null); setAdvisorError(null); setAdvisorResult(null); setCopiedIndex(null);
    setLoadingAnalysis(true); setAnalysisResult(null); setAnalysisId(null);
    try {
      const analysis = await postAnalysis({ message_text: text, mode: "reactive", relationship_type: "otro", case_id: selectedCaseId ?? undefined, source_type: ocrInfo ? "ocr" : "text", quick_mode: false, context: buildContextPayload() });
      setAnalysisResult(analysis); setAnalysisId(analysis.analysis_id);
      setLoadingAnalysis(false); setLoadingAdvisor(true);
      const advisor = await postAdvisor({ message_text: text, mode: "reactive", relationship_type: "otro", case_id: selectedCaseId ?? undefined, source_type: ocrInfo ? "ocr" : "text", quick_mode: false, save_session: true, analysis_id: analysis.analysis_id, context: buildContextPayload() });
      setAdvisorResult(advisor);
    } catch (exc) {
      const msg = toUiErrorMessage(exc, "No se pudieron generar respuestas.");
      if (!analysisResult) setAnalysisError(msg); else setAdvisorError(msg);
    } finally {
      setLoadingAnalysis(false); setLoadingAdvisor(false);
    }
  }

  function handleStartNewConversation() {
    setMessageText(""); setContextOptional(""); setAnalysisResult(null); setAnalysisId(null); setAnalysisError(null); setAdvisorResult(null); setAdvisorError(null); setCopiedIndex(null);
    setOcrInfo(null); setOcrError(null); setOcrStatusMessage(null); setOcrLoading(false); setConversationBlocks([]); setAutoParsing(false); setAutoParseError(null); setResponseTone("cordial"); setContextExpanded(false);
  }

  function openAdvisorChat(index: number) {
    const text = advisorResult?.responses[index]?.text;
    if (!text) return;
    setAdvisorChatIndex(index); setAdvisorChatMessages([{ id: `advisor-initial-${index}`, role: "advisor", text }]); setAdvisorChatInput(""); setAdvisorChatOpen(true);
  }

  async function handleSendAdvisorRefinement() {
    if (advisorChatIndex === null || !advisorResult || advisorChatSending || !advisorChatInput.trim()) return;
    const baseText = advisorResult.responses[advisorChatIndex]?.text ?? "";
    if (!baseText) return;
    setAdvisorChatSending(true);
    try {
      const result = await postAdvisor({ message_text: `Mensaje base:\n${baseText}\n\nInstruccion:\n${advisorChatInput.trim()}`, mode: "reactive", relationship_type: "otro", source_type: "text", quick_mode: true, save_session: false, context: buildContextPayload() });
      const refined = result.responses[advisorChatIndex]?.text ?? result.responses[0]?.text ?? baseText;
      setAdvisorResult((prev) => {
        if (!prev) return prev;
        const next = [...prev.responses];
        if (!next[advisorChatIndex]) return prev;
        next[advisorChatIndex] = { ...next[advisorChatIndex], text: refined };
        return { ...prev, responses: next };
      });
      setAdvisorChatMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: advisorChatInput.trim() }, { id: `a-${Date.now() + 1}`, role: "advisor", text: refined }]);
      setAdvisorChatInput("");
    } catch (exc) {
      setAdvisorError(toUiErrorMessage(exc, "No se pudo refinar la respuesta."));
    } finally {
      setAdvisorChatSending(false);
    }
  }

  async function handleCopy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      const sessionId = advisorResult?.session_id;
      if (sessionId) {
        void postWizardEvent({ event_name: "reply_copied", session_id: sessionId, analysis_id: analysisId ?? undefined, advisor_id: ADVISOR_PROFILES[index]?.id, response_index: index }).catch(() => {});
      }
      setCopiedIndex(index); window.setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      setAdvisorError("No se pudo copiar la respuesta.");
    }
  }

  const showInterpretedPanel = autoParsing || ocrLoading || conversationBlocks.length > 0 || Boolean(autoParseError);
  const hasConversationInput = messageText.trim().length > 0;

  return (
    <section className="mx-auto w-full min-w-0 space-y-6" onPaste={handleStepPaste}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[20px] font-semibold text-[#111]">Sube, pega o escribe la conversacion.</h2>
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelection} disabled={ocrCapabilities?.available === false || ocrCapabilitiesLoading} className="hidden" />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={ocrCapabilities?.available === false || ocrCapabilitiesLoading} className="h-[34px] rounded-md border border-[#ddd] bg-white px-[10px] text-[13px] text-[#111] hover:bg-[#fafafa] disabled:cursor-not-allowed disabled:opacity-60">Seleccionar archivo</button>
          </div>
        </div>
        {caseError ? <p className="text-[13px] text-[#b91c1c]">{caseError}</p> : null}
        {ocrLoading || autoParsing ? <p className="text-[13px] text-[#666]">Interpretando conversacion...</p> : null}
        {ocrStatusMessage ? <p className="text-[13px] text-[#666]">{ocrStatusMessage}</p> : null}
        {ocrError ? <p className="text-[13px] text-[#b91c1c]">{ocrError}</p> : null}
        {autoParseError ? <p className="text-[13px] text-[#92400e]">{autoParseError}</p> : null}

        <div className={`grid gap-6 ${showInterpretedPanel ? "md:grid-cols-2" : "grid-cols-1"}`}>
          <div className="space-y-3">
            {showInterpretedPanel ? <p className="text-[13px] font-semibold text-[#555]">Conversacion original</p> : null}
            <Textarea value={messageText} onChange={(event) => handleMessageTextChange(event.target.value)} rows={8} placeholder="Pega aqui la conversacion de WhatsApp o el mensaje recibido..." className="min-h-[160px] rounded-[10px] border border-[#e5e5e5] p-[18px] text-[16px] leading-[1.5] text-[#111]" />
          </div>
          {showInterpretedPanel ? (
            <section className="min-h-0 rounded-[10px] border border-[#eee] bg-[#fafafa] p-4">
              <p className="text-[13px] font-semibold text-[#555]">Conversacion interpretada</p>
              <p className="mt-1 text-[12px] text-[#666]">Revisa quien dijo cada mensaje antes de generar la respuesta.</p>
              <div className="mt-3 max-h-[460px] space-y-3 overflow-y-auto pr-1">
                {conversationBlocks.length === 0 ? <p className="text-[13px] text-[#666]">Aun no hay bloques interpretados.</p> : null}
                {conversationBlocks.map((item) => (
                  <div key={item.id} className="rounded-[10px] border border-[#eee] bg-white p-3">
                    <div className="mb-2 inline-flex rounded-[16px] border border-[#ddd] bg-white p-0.5 text-[13px]">
                      <button type="button" onClick={() => updateConversationBlockSpeaker(item.id, "ex_partner")} className={`rounded-[14px] px-2 py-1 ${item.speaker === "ex_partner" ? "bg-[#f3f4f6] text-[#111]" : "text-[#666]"}`}>Ex pareja</button>
                      <button type="button" onClick={() => updateConversationBlockSpeaker(item.id, "user")} className={`rounded-[14px] px-2 py-1 ${item.speaker === "user" ? "bg-[#f3f4f6] text-[#111]" : "text-[#666]"}`}>Yo</button>
                      <button type="button" onClick={() => updateConversationBlockSpeaker(item.id, "unknown")} className={`rounded-[14px] px-2 py-1 ${item.speaker === "unknown" ? "bg-[#f3f4f6] text-[#111]" : "text-[#666]"}`}>Sin identificar</button>
                    </div>
                    <Textarea value={item.content} onChange={(event) => updateConversationBlockText(item.id, event.target.value)} rows={Math.max(2, Math.ceil(item.content.length / 52))} className="w-full resize-none whitespace-pre-wrap break-words border border-[#e5e5e5] bg-white p-3 text-[14px] leading-6 text-[#111]" />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <div>
          <button type="button" onClick={() => setContextExpanded((prev) => !prev)} className="text-[13px] text-[#666] hover:text-[#111]">* Agregar contexto (opcional)</button>
          {contextExpanded ? <Textarea value={contextOptional} onChange={(event) => setContextOptional(event.target.value)} rows={3} className="mt-2 rounded-[10px] border border-[#e5e5e5] bg-white text-[14px] text-[#111]" /> : null}
        </div>

        <div className="space-y-2">
          <p className="text-[14px] font-semibold text-[#111]">Modo de respuesta</p>
          <div className="flex flex-wrap gap-2">
            {responseStyleOptions.map((item) => (
              <button key={item.value} type="button" onClick={() => setResponseTone(item.value)} className={`rounded-[16px] border px-[10px] py-[6px] text-[13px] ${responseTone === item.value ? "border-[#bbb] bg-[#f3f4f6] text-[#111]" : "border-[#ddd] bg-white text-[#666] hover:bg-[#fafafa]"}`}>{item.label}</button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {hasConversationInput ? <button type="button" onClick={handleStartNewConversation} className="h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-4 text-[13px] text-[#111] hover:bg-[#fafafa]">Limpiar</button> : null}
          <Button type="button" onClick={() => void handleGenerateResponses()} disabled={(!messageText.trim() && conversationBlocks.length === 0) || loadingAnalysis || loadingAdvisor} variant="primary" className="h-9 rounded-[8px] bg-[#111] px-4 text-[13px] text-white hover:bg-[#222]">{loadingAnalysis ? "Analizando..." : loadingAdvisor ? "Generando..." : "Generar respuestas"}</Button>
        </div>
      </div>

      {analysisError ? <p className="text-[13px] text-[#b91c1c]">{analysisError}</p> : null}
      {advisorError ? <p className="text-[13px] text-[#b91c1c]">{advisorError}</p> : null}

      {analysisResult ? <div className="rounded-[10px] border border-[#e5e5e5] bg-[#fafafa] p-4 text-[14px] text-[#111] whitespace-pre-wrap">{analysisResult.summary}</div> : null}

      {advisorResult ? (
        <div className="space-y-3">
          <h3 className="text-[18px] font-semibold text-[#111]">Respuestas sugeridas</h3>
          <div className="grid gap-3 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => {
              const advisor = ADVISOR_PROFILES[index];
              const responseText = advisorResult.responses[index]?.text ?? "";
              return (
                <article key={`${advisor?.id ?? index}-${index}`} onClick={() => openAdvisorChat(index)} className="flex min-w-0 cursor-pointer flex-col rounded-[10px] border border-[#e5e5e5] bg-white p-3">
                  <header className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2">
                    <AdvisorAvatarItem name={advisor?.name ?? "Advisor"} role={advisor?.role ?? "Perspectiva"} avatarSrc={advisor?.avatar64 ?? "/advisors/generic.svg"} size={56} tone="light" onClick={() => advisor && setSelectedProfile(advisor)} />
                  </header>
                  <p className="mt-3 flex-1 whitespace-pre-wrap break-words text-[14px] leading-6 text-[#111]">{responseText || "Sin respuesta disponible."}</p>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button type="button" onClick={(event) => { event.stopPropagation(); openAdvisorChat(index); }} disabled={!responseText} variant="secondary" className="h-9 border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111] hover:bg-[#fafafa]">Refinar</Button>
                    <Button type="button" onClick={(event) => { event.stopPropagation(); void handleCopy(responseText, index); }} disabled={!responseText} variant="primary" className="h-9 bg-[#111] px-3 text-[13px] text-white hover:bg-[#222]">{copiedIndex === index ? "Copiada" : "Usar"}</Button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <AdvisorChatModal isOpen={advisorChatOpen} advisorName={advisorChatIndex !== null ? (ADVISOR_PROFILES[advisorChatIndex]?.name ?? "Adviser") : "Adviser"} messages={advisorChatMessages} draft={advisorChatInput} sending={advisorChatSending} onDraftChange={setAdvisorChatInput} onSend={() => void handleSendAdvisorRefinement()} onUseResponse={() => setAdvisorChatOpen(false)} onClose={() => setAdvisorChatOpen(false)} />
      <AdvisorProfileModal profile={selectedProfile} onClose={() => setSelectedProfile(null)} />
    </section>
  );
}
