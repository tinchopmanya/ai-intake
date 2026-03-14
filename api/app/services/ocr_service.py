from __future__ import annotations

import io
import logging
import re
import shutil
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from statistics import mean

logger = logging.getLogger(__name__)


class OcrError(Exception):
    def __init__(self, detail: str, *, status_code: int = 422) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass(frozen=True)
class OcrResult:
    extracted_text: str
    provider: str
    confidence: float | None
    warnings: list[str]
    conversation_turns: list["OcrConversationTurn"] | None = None
    raw_text: str | None = None
    metadata: dict[str, object] | None = None


@dataclass(frozen=True)
class OcrConversationTurn:
    speaker: str
    text: str
    time: str | None = None


@dataclass(frozen=True)
class OcrCapabilities:
    available: bool
    selected_provider: str
    providers_checked: list[str]
    reason_codes: list[str]


class OcrService:
    def __init__(
        self,
        provider: str = "auto",
        tesseract_cmd: str | None = None,
        tesseract_lang: str = "spa+por+eng",
        tesseract_psm: int = 6,
        tesseract_oem: int = 3,
        whatsapp_crop_top_px: int = 80,
        whatsapp_crop_bottom_px: int = 120,
        wa_top_crop_ratio: float = 0.15,
        wa_bottom_crop_ratio: float = 0.17,
        whatsapp_crop_enabled: bool = True,
        turn_detection_enabled: bool = True,
    ) -> None:
        self._provider = (provider or "auto").strip().lower()
        self._tesseract_cmd = (tesseract_cmd or "").strip() or None
        self._tesseract_lang = (tesseract_lang or "spa+por+eng").strip() or "spa+por+eng"
        self._tesseract_psm = max(3, min(13, int(tesseract_psm)))
        self._tesseract_oem = max(0, min(3, int(tesseract_oem)))
        self._whatsapp_crop_top_px = max(0, int(whatsapp_crop_top_px))
        self._whatsapp_crop_bottom_px = max(0, int(whatsapp_crop_bottom_px))
        self._wa_top_crop_ratio = max(0.0, min(0.4, float(wa_top_crop_ratio)))
        self._wa_bottom_crop_ratio = max(0.0, min(0.4, float(wa_bottom_crop_ratio)))
        self._whatsapp_crop_enabled = bool(whatsapp_crop_enabled)
        self._turn_detection_enabled = bool(turn_detection_enabled)

    def extract_text(self, image_bytes: bytes) -> OcrResult:
        providers = self._resolve_provider_order()
        failures: list[str] = []

        for provider in providers:
            try:
                if provider == "google_vision":
                    return self._extract_google_vision(image_bytes)
                if provider == "tesseract":
                    return self._extract_tesseract(image_bytes)
            except OcrError as exc:
                failures.append(exc.detail)
                if self._provider != "auto":
                    raise
            except Exception as exc:
                logger.exception("Unexpected OCR failure provider=%s: %s", provider, exc)
                failures.append(f"{provider}_unexpected_error")
                if self._provider != "auto":
                    raise OcrError("ocr_internal_error", status_code=500) from exc

        if failures and all(code == "ocr_no_text_detected" for code in failures):
            raise OcrError("ocr_no_text_detected", status_code=422)

        if failures:
            logger.warning("OCR unavailable. provider_order=%s failures=%s", providers, failures)
        raise OcrError("ocr_unavailable", status_code=503)

    def capabilities(self, *, multipart_available: bool) -> OcrCapabilities:
        if not multipart_available:
            return OcrCapabilities(
                available=False,
                selected_provider=self._provider,
                providers_checked=self._resolve_provider_order(),
                reason_codes=["python_multipart_not_installed"],
            )

        providers = self._resolve_provider_order()
        reasons: list[str] = []
        available = False

        for provider in providers:
            if provider == "google_vision":
                ok, reason = self._google_vision_capability()
            elif provider == "tesseract":
                ok, reason = self._tesseract_capability()
            else:
                ok, reason = False, "ocr_provider_unsupported"

            if ok:
                available = True
                break
            reasons.append(reason)
            if self._provider != "auto":
                break

        return OcrCapabilities(
            available=available,
            selected_provider=self._provider,
            providers_checked=providers,
            reason_codes=reasons,
        )

    def _resolve_provider_order(self) -> list[str]:
        if self._provider == "google_vision":
            return ["google_vision"]
        if self._provider == "tesseract":
            return ["tesseract"]
        return ["google_vision", "tesseract"]

    def _extract_google_vision(self, image_bytes: bytes) -> OcrResult:
        try:
            from google.cloud import vision
        except ImportError as exc:
            raise OcrError("google_vision_dependency_missing", status_code=503) from exc

        try:
            client = vision.ImageAnnotatorClient()
        except Exception as exc:
            logger.exception("Google Vision client init failed: %s", exc)
            raise OcrError("google_vision_not_configured", status_code=503) from exc

        image = vision.Image(content=image_bytes)
        try:
            response = client.document_text_detection(image=image)
        except Exception as exc:
            logger.exception("Google Vision request failed: %s", exc)
            raise OcrError("google_vision_request_failed", status_code=503) from exc

        if response.error and response.error.message:
            logger.warning("Google Vision error response: %s", response.error.message)
            raise OcrError("google_vision_request_failed", status_code=503)

        annotation = response.full_text_annotation
        extracted = (annotation.text or "").strip() if annotation else ""
        if not extracted:
            raise OcrError("ocr_no_text_detected", status_code=422)

        confidences: list[float] = []
        if annotation:
            for page in annotation.pages:
                for block in page.blocks:
                    for paragraph in block.paragraphs:
                        for word in paragraph.words:
                            if getattr(word, "confidence", None) is not None:
                                confidences.append(float(word.confidence))
        avg_confidence = round(mean(confidences), 4) if confidences else None

        return OcrResult(
            extracted_text=extracted,
            provider="google_vision",
            confidence=avg_confidence,
            warnings=[],
        )

    def _extract_tesseract(self, image_bytes: bytes) -> OcrResult:
        try:
            from PIL import Image
            from PIL import UnidentifiedImageError
        except ImportError as exc:
            raise OcrError("pillow_not_installed", status_code=503) from exc

        try:
            import pytesseract
        except ImportError as exc:
            raise OcrError("pytesseract_not_installed", status_code=503) from exc

        self._configure_tesseract_cmd(pytesseract)
        self._ensure_tesseract_runtime(pytesseract)

        try:
            image = Image.open(io.BytesIO(image_bytes))
            image = image.convert("RGB")
        except UnidentifiedImageError as exc:
            raise OcrError("invalid_image_file", status_code=422) from exc
        except Exception as exc:
            raise OcrError("invalid_image_file", status_code=422) from exc

        frame_image, crop_metadata, crop_warnings = self._crop_whatsapp_frame(image)
        preprocessed_image, preprocess_warnings = self._preprocess_for_chat(frame_image)
        tesseract_config = self._build_tesseract_config()
        logger.info(
            "OCR tesseract config: lang=%s config=%s",
            self._tesseract_lang,
            tesseract_config,
        )

        blocks = self._detect_message_blocks(preprocessed_image)
        block_texts: list[str] = []
        block_turns: list[OcrConversationTurn] = []
        for block in blocks:
            block_text = self._ocr_single_block(
                preprocessed_image,
                pytesseract,
                x=block["x"],
                y=block["y"],
                w=block["w"],
                h=block["h"],
            )
            if not block_text:
                continue
            block_texts.append(block_text)
            if self._turn_detection_enabled:
                cleaned_block, _ = self._postprocess_text(block_text)
                cleaned_block = cleaned_block.strip()
                if not cleaned_block:
                    continue
                block_turns.append(
                    OcrConversationTurn(
                        speaker=str(block.get("speaker", "them")),
                        text=_strip_trailing_time(cleaned_block) or cleaned_block,
                        time=_extract_trailing_time(cleaned_block),
                    )
                )

        if block_texts:
            raw_text = "\n".join(block_texts).strip()
            bubble_detection_used = True
        else:
            try:
                raw_text = pytesseract.image_to_string(
                    preprocessed_image,
                    lang=self._tesseract_lang,
                    config=tesseract_config,
                )
            except pytesseract.TesseractError as exc:
                message = str(exc).lower()
                if "failed loading language" in message or "error opening data file" in message:
                    raise OcrError("tesseract_language_not_available", status_code=503) from exc
                logger.exception("Tesseract OCR execution failed: %s", exc)
                raise OcrError("tesseract_execution_failed", status_code=503) from exc
            bubble_detection_used = False

        cleaned_text, postprocess_warnings = self._postprocess_text(raw_text)
        extracted = cleaned_text.strip()
        if not extracted:
            raise OcrError("ocr_no_text_detected", status_code=422)

        confidence = self._extract_tesseract_confidence(
            preprocessed_image,
            pytesseract,
            tesseract_config=tesseract_config,
        )
        conversation_turns = block_turns or self._extract_conversation_turns(
            preprocessed_image,
            pytesseract,
            tesseract_config=tesseract_config,
        )
        warnings = _deduplicate(
            [
                "tesseract_fallback_used",
                *crop_warnings,
                *preprocess_warnings,
                *postprocess_warnings,
            ]
        )
        metadata = {
            "crop_applied": bool(crop_metadata.get("crop_applied", False)),
            "bubble_detection_used": bubble_detection_used,
            "ocr_lang_used": self._tesseract_lang,
            "blocks_detected": len(blocks),
        }
        return OcrResult(
            extracted_text=extracted,
            provider="tesseract",
            confidence=confidence,
            warnings=warnings,
            conversation_turns=conversation_turns if conversation_turns else None,
            raw_text=raw_text.strip() if raw_text else None,
            metadata=metadata,
        )

    def _extract_tesseract_confidence(self, image, pytesseract, *, tesseract_config: str) -> float | None:
        try:
            data = pytesseract.image_to_data(
                image,
                lang=self._tesseract_lang,
                config=tesseract_config,
                output_type=pytesseract.Output.DICT,
            )
        except Exception:
            return None
        raw_conf = data.get("conf") if isinstance(data, dict) else None
        if not raw_conf:
            return None

        values: list[float] = []
        for item in raw_conf:
            try:
                number = float(item)
            except (TypeError, ValueError):
                continue
            if number >= 0:
                values.append(number / 100.0)
        if not values:
            return None
        return round(mean(values), 4)

    def _extract_conversation_turns(
        self,
        image,
        pytesseract,
        *,
        tesseract_config: str,
    ) -> list[OcrConversationTurn] | None:
        if not self._turn_detection_enabled:
            return None

        try:
            data = pytesseract.image_to_data(
                image,
                lang=self._tesseract_lang,
                config=tesseract_config,
                output_type=pytesseract.Output.DICT,
            )
        except Exception:
            return None

        if not isinstance(data, dict):
            return None
        text_items = data.get("text")
        if not isinstance(text_items, list) or not text_items:
            return None

        lines: dict[tuple[int, int, int], list[dict[str, float | str]]] = defaultdict(list)
        total = len(text_items)
        for idx in range(total):
            token = str(data.get("text", [""])[idx] or "").strip()
            if not token:
                continue
            try:
                conf = float(data.get("conf", ["-1"])[idx])
            except (TypeError, ValueError):
                conf = -1.0
            if conf < 0:
                continue

            key = (
                int(data.get("block_num", [0])[idx]),
                int(data.get("par_num", [0])[idx]),
                int(data.get("line_num", [0])[idx]),
            )
            lines[key].append(
                {
                    "text": token,
                    "left": float(data.get("left", [0])[idx]),
                    "top": float(data.get("top", [0])[idx]),
                    "width": float(data.get("width", [0])[idx]),
                }
            )

        if not lines:
            return None

        width = _read_image_width(image)
        turns: list[OcrConversationTurn] = []
        for key in sorted(lines.keys()):
            items = sorted(lines[key], key=lambda item: float(item["left"]))
            raw_line = " ".join(str(item["text"]) for item in items).strip()
            cleaned_line = self._clean_line(raw_line)
            if not cleaned_line or _is_timestamp_only(cleaned_line):
                continue

            line_left = min(float(item["left"]) for item in items)
            speaker = "me" if line_left >= width * 0.45 else "them"
            time_token = _extract_trailing_time(cleaned_line)
            line_text = _strip_trailing_time(cleaned_line).strip() if time_token else cleaned_line
            if not line_text:
                continue

            if turns and turns[-1].speaker == speaker and turns[-1].time is None:
                turns[-1] = OcrConversationTurn(
                    speaker=speaker,
                    text=f"{turns[-1].text} {line_text}".strip(),
                    time=time_token,
                )
            else:
                turns.append(OcrConversationTurn(speaker=speaker, text=line_text, time=time_token))

        return turns or None

    def _build_tesseract_config(self) -> str:
        # psm 6 is stable for dense chat screenshots, with OEM 3 for best available engine.
        return f"--oem {self._tesseract_oem} --psm {self._tesseract_psm}"

    def _crop_whatsapp_frame(self, image):
        warnings: list[str] = []
        metadata: dict[str, object] = {"crop_applied": False}
        if not self._whatsapp_crop_enabled:
            return image, metadata, warnings

        width, height = image.size
        top_ratio_px = int(height * self._wa_top_crop_ratio)
        bottom_ratio_px = int(height * self._wa_bottom_crop_ratio)
        top = min(max(self._whatsapp_crop_top_px, top_ratio_px), int(height * 0.35))
        bottom = min(max(self._whatsapp_crop_bottom_px, bottom_ratio_px), int(height * 0.35))

        if height - top - bottom <= int(height * 0.30):
            return image, metadata, warnings

        metadata = {
            "crop_applied": True,
            "crop_top_px": top,
            "crop_bottom_px": bottom,
            "crop_removed_ratio": round((top + bottom) / float(height), 4),
            "frame_width": width,
            "frame_height": height,
        }
        warnings.append("whatsapp_heuristic_crop_applied")
        logger.info(
            "OCR crop applied: top=%s bottom=%s height=%s removed_ratio=%s",
            top,
            bottom,
            height,
            metadata["crop_removed_ratio"],
        )
        return image.crop((0, top, width, height - bottom)), metadata, warnings

    def _preprocess_for_chat(self, image):
        warnings: list[str] = []
        try:
            import cv2
            import numpy as np
        except ImportError:
            fallback = image.convert("L")
            return fallback, ["opencv_not_installed_fallback"]

        array_rgb = np.array(image)

        gray = cv2.cvtColor(array_rgb, cv2.COLOR_RGB2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        contrast = clahe.apply(gray)
        denoised = cv2.medianBlur(contrast, 3)
        thresholded = cv2.adaptiveThreshold(
            denoised,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            15,
        )
        sharpen_kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
        sharpened = cv2.filter2D(thresholded, -1, sharpen_kernel)

        from PIL import Image

        processed = Image.fromarray(sharpened)
        warnings.append("ocr_preprocess_chat_profile")
        return processed, warnings

    def _detect_message_blocks(self, processed_image) -> list[dict[str, int | str]]:
        try:
            import cv2
            import numpy as np
        except ImportError:
            return []

        gray = np.array(processed_image.convert("L"))
        inv = cv2.bitwise_not(gray)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (35, 5))
        dilated = cv2.dilate(inv, kernel, iterations=1)
        contours, _ = cv2.findContours(dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        h, w = gray.shape[:2]
        min_area = max(1200, int((h * w) * 0.0007))
        blocks: list[dict[str, int | str]] = []
        for contour in contours:
            x, y, bw, bh = cv2.boundingRect(contour)
            area = bw * bh
            if area < min_area:
                continue
            if bw < int(w * 0.15) or bh < 20:
                continue
            if y < int(h * 0.02) or y + bh > int(h * 0.98):
                continue
            speaker = "me" if (x + bw / 2.0) > (w * 0.55) else "them"
            blocks.append({"x": x, "y": y, "w": bw, "h": bh, "speaker": speaker})

        blocks.sort(key=lambda item: int(item["y"]))
        logger.info("OCR block detection: blocks_detected=%s", len(blocks))
        return blocks

    def _ocr_single_block(self, processed_image, pytesseract, *, x: int, y: int, w: int, h: int) -> str:
        crop = processed_image.crop((x, y, x + w, y + h))
        psm = 7 if h < 44 else 6
        config = f"--oem {self._tesseract_oem} --psm {psm}"
        try:
            text = pytesseract.image_to_string(
                crop,
                lang=self._tesseract_lang,
                config=config,
            )
        except Exception:
            return ""
        return unicodedata.normalize("NFC", text or "").strip()

    def _postprocess_text(self, raw_text: str) -> tuple[str, list[str]]:
        text = unicodedata.normalize("NFC", raw_text or "")
        raw_lines = [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
        cleaned_lines: list[str] = []
        removed_by_rule: dict[str, int] = defaultdict(int)

        for index, line in enumerate(raw_lines):
            cleaned_line, reason = self._clean_line_with_reason(line, line_index=index)
            if not cleaned_line:
                removed_by_rule[reason] += 1
                continue
            cleaned_lines.append(cleaned_line)

        merged_lines = _merge_wrapped_lines(cleaned_lines)
        merged = "\n".join(merged_lines)
        merged = re.sub(r"[ \t]{2,}", " ", merged)
        merged = re.sub(r"\n{3,}", "\n\n", merged)
        merged = _normalize_spacing(merged)
        merged = merged.strip()

        warnings: list[str] = []
        if merged != text.strip():
            warnings.append("ocr_text_cleaned")
        if removed_by_rule:
            logger.info(
                "OCR postprocess removed lines: total_in=%s total_out=%s removed_by_rule=%s",
                len(raw_lines),
                len(cleaned_lines),
                dict(sorted(removed_by_rule.items())),
            )
        return merged, warnings

    def _clean_line(self, line: str) -> str:
        value, _ = self._clean_line_with_reason(line)
        return value

    def _clean_line_with_reason(self, line: str, *, line_index: int | None = None) -> tuple[str, str]:
        value = unicodedata.normalize("NFC", (line or "")).strip()
        if not value:
            return "", "empty"

        value = _strip_inline_noise_fragments(value)
        value = re.sub(r"\s{2,}", " ", value).strip()
        value = _strip_line_tail_noise(value)
        value = _normalize_spacing(value)
        if not value:
            return "", "noise_after_strip"
        lowered = value.casefold()

        if _INPUT_BAR_LINE.match(lowered):
            return "", "input_bar"
        if line_index is not None and line_index <= 1 and _looks_like_contact_header(value):
            return "", "chat_header"
        if line_index is not None and line_index <= 2 and _looks_like_header_artifact(value):
            return "", "chat_header_artifact"
        if _looks_like_status_chrome(value):
            return "", "status_chrome"
        if _is_ui_noise_line(value):
            return "", "ui_noise"
        if _is_timestamp_only(value):
            return "", "timestamp_only"
        if _looks_like_artifact_line(value):
            return "", "artifact"

        value = _repair_common_ocr_terms(value)
        value = _strip_line_tail_noise(value)
        value = _normalize_spacing(value)
        if not value:
            return "", "noise_after_repair"
        if _is_disposable_short_line(value):
            return "", "too_short_noise"
        return value, "kept"

    def _configure_tesseract_cmd(self, pytesseract) -> None:
        if self._tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = self._tesseract_cmd

    def _ensure_tesseract_runtime(self, pytesseract) -> None:
        if self._tesseract_cmd:
            if not shutil.which(self._tesseract_cmd) and not _path_exists(self._tesseract_cmd):
                raise OcrError("tesseract_binary_not_found", status_code=503)

        try:
            _ = pytesseract.get_tesseract_version()
        except pytesseract.TesseractNotFoundError as exc:
            raise OcrError("tesseract_not_installed", status_code=503) from exc
        except Exception as exc:
            logger.exception("Failed checking tesseract runtime: %s", exc)
            raise OcrError("tesseract_not_available", status_code=503) from exc

    def _google_vision_capability(self) -> tuple[bool, str]:
        try:
            from google.cloud import vision
        except ImportError:
            return False, "google_vision_dependency_missing"

        try:
            _ = vision.ImageAnnotatorClient()
        except Exception:
            return False, "google_vision_not_configured"

        return True, "ok"

    def _tesseract_capability(self) -> tuple[bool, str]:
        try:
            from PIL import Image  # noqa: F401
        except ImportError:
            return False, "pillow_not_installed"

        try:
            import pytesseract
        except ImportError:
            return False, "pytesseract_not_installed"

        self._configure_tesseract_cmd(pytesseract)
        if self._tesseract_cmd:
            if not shutil.which(self._tesseract_cmd) and not _path_exists(self._tesseract_cmd):
                return False, "tesseract_binary_not_found"

        try:
            _ = pytesseract.get_tesseract_version()
        except pytesseract.TesseractNotFoundError:
            return False, "tesseract_not_installed"
        except Exception:
            return False, "tesseract_not_available"

        return True, "ok"


def _path_exists(path_value: str) -> bool:
    import os

    return os.path.exists(path_value)


_TIMESTAMP_PATTERN = re.compile(r"^\d{1,2}:\d{2}(?:\s*[ap]m)?(?:\s*[w/|]+)?$", re.IGNORECASE)
_ALT_TIMESTAMP_PATTERN = re.compile(r"^\d{2}\.\d{2}\s*w$", re.IGNORECASE)
_UI_GLYPH_LINE = re.compile(r"^(?:[\W_]|w){1,6}$", re.IGNORECASE)
_INPUT_BAR_LINE = re.compile(r"^[@>\s]*(mensaje|message|enviar|type a message)\b.*$", re.IGNORECASE)
_STATUS_BAR_LINE = re.compile(
    r"^\d{1,2}[:.]\d{2}\s*(?:am|pm)?\s*(?:4g|5g|lte|volte|wifi|wi-fi|[1-9]\d?%|100%|)$",
    re.IGNORECASE,
)
_DOTTED_TIME_GARBAGE = re.compile(r"^\d{1,2}[.:]\d{2}\s*[w/|]{0,2}$", re.IGNORECASE)
_TRAILING_TIME_PATTERN = re.compile(r"\b(\d{1,2}:\d{2})\s*$")
_TRAILING_TIMESTAMP_FRAGMENT = re.compile(
    r"\s+\d{1,2}:\d{2}(?:\s*[ap]m)?(?:\s*[w/v/|]+)?\s*$",
    re.IGNORECASE,
)
_TRAILING_DECIMAL_NOISE = re.compile(r"\s+\d{1,2}\.\d{2}(?:\s*[wv])?\s*$", re.IGNORECASE)
_INLINE_DECIMAL_NOISE = re.compile(r"\b\d{1,2}\.\d{2}\s*[wv]\b", re.IGNORECASE)
_CHECK_NOISE_FRAGMENT = re.compile(r"(?:^|\s)(?:[wv]|[\/|]{1,3}|[✓✔]{1,2})(?:\s|$)", re.IGNORECASE)
_WORD_SUFFIX_GARBAGE = re.compile(r"([A-Za-zÀ-ÿ])\.po\b", re.IGNORECASE)
_JUG_NOISE = re.compile(r"\bjug\s*(?:[&@]+\s*){1,}(?:\d{1,2}:\d{2})?\b", re.IGNORECASE)


def _is_ui_noise_line(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return True
    if _UI_GLYPH_LINE.match(stripped):
        return True
    if _STATUS_BAR_LINE.match(stripped):
        return True
    if len(stripped) <= 2 and not any(ch.isalpha() for ch in stripped):
        return True
    return False


def _is_timestamp_only(value: str) -> bool:
    stripped = value.strip()
    return bool(
        _TIMESTAMP_PATTERN.match(stripped)
        or _ALT_TIMESTAMP_PATTERN.match(stripped)
        or _DOTTED_TIME_GARBAGE.match(stripped)
    )


def _is_disposable_short_line(value: str) -> bool:
    stripped = value.strip()
    if len(stripped) >= 3:
        return _looks_like_low_semantic_noise(stripped)
    if stripped.isdigit():
        return True
    if stripped.casefold() in {"ok", "si", "no"}:
        return False
    return True


def _looks_like_low_semantic_noise(value: str) -> bool:
    tokenized = re.findall(r"[A-Za-z0-9]+", value)
    if not tokenized:
        return True
    if len(value) <= 10 and len(tokenized) >= 2 and all(len(token) <= 2 for token in tokenized):
        return True
    return False


def _looks_like_contact_header(value: str) -> bool:
    cleaned = re.sub(r"[^A-Za-zÀ-ÿ\s]", " ", value).strip()
    if not cleaned:
        return False
    words = [word for word in cleaned.split() if word]
    if len(words) == 1:
        return len(words[0]) >= 3 and words[0][0].isupper()
    if len(words) == 2:
        return all(word[0].isupper() for word in words if word)
    return False


def _looks_like_header_artifact(value: str) -> bool:
    if re.search(r"[<>&:@]", value):
        words = [word for word in re.findall(r"[A-Za-zÀ-ÿ]+", value) if len(word) >= 3]
        if any(word[0].isupper() for word in words):
            return True
    non_alnum = sum(1 for char in value if not char.isalnum() and not char.isspace())
    ratio = non_alnum / max(len(value), 1)
    if ratio < 0.20:
        return False
    words = [word for word in re.findall(r"[A-Za-zÀ-ÿ]+", value) if word]
    if not words:
        return True
    if len(words) <= 3 and any(word[0].isupper() for word in words if word):
        return True
    return False


def _looks_like_status_chrome(value: str) -> bool:
    lowered = value.casefold().strip()
    if not lowered:
        return False

    starts_with_time = bool(re.match(r"^\d{1,2}[:.]\d{2}[a-z]?\b", lowered))
    markers = ("4g", "5g", "lte", "wifi", "wi-fi", "%", "@", "volte")
    has_marker = any(marker in lowered for marker in markers)
    non_alnum = sum(1 for char in lowered if not char.isalnum() and not char.isspace())
    ratio = non_alnum / max(len(lowered), 1)
    return starts_with_time and (has_marker or ratio > 0.15)


def _looks_like_artifact_line(value: str) -> bool:
    stripped = value.strip()
    if not stripped:
        return True
    if _UI_GLYPH_LINE.match(stripped):
        return True
    if len(stripped) <= 14 and re.search(r"[©<>@&]", stripped):
        return True
    tokens = [token for token in re.findall(r"[A-Za-z]+", stripped)]
    if len(tokens) == 2 and all(len(token) <= 2 for token in tokens):
        return True
    return False


def _repair_common_ocr_terms(value: str) -> str:
    fixed = value
    # Common Spanish OCR confusion where n-tilde is recognized as "fi".
    fixed = re.sub(r"\bnifia\b", "ni\u00f1a", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bnifio\b", "ni\u00f1o", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bnifias\b", "ni\u00f1as", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bnifios\b", "ni\u00f1os", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bniflos\b", "ni\u00f1os", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bdljo\b", "dijo", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bpreferfa\b", "prefer\u00eda", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\brlla\b", "ella", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bniflo\b", "ni\u00f1o", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bni\?a\b", "ni\u00f1a", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bni\?o\b", "ni\u00f1o", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bni\?os\b", "ni\u00f1os", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\bdespu\?s\b", "despu\u00e9s", fixed, flags=re.IGNORECASE)
    fixed = re.sub(r"\s{2,}", " ", fixed).strip()
    return unicodedata.normalize("NFC", fixed)


def _extract_trailing_time(line_text: str) -> str | None:
    match = _TRAILING_TIME_PATTERN.search(line_text)
    if not match:
        return None
    return match.group(1)


def _strip_trailing_time(line_text: str) -> str:
    return _TRAILING_TIME_PATTERN.sub("", line_text).strip()


def _strip_line_tail_noise(value: str) -> str:
    cleaned = value
    previous = None
    while cleaned != previous:
        previous = cleaned
        cleaned = _TRAILING_TIMESTAMP_FRAGMENT.sub("", cleaned)
        cleaned = _TRAILING_DECIMAL_NOISE.sub("", cleaned)
        cleaned = re.sub(r"(?:\s+[wv/|✓✔]{1,3})+$", "", cleaned, flags=re.IGNORECASE)
        cleaned = _WORD_SUFFIX_GARBAGE.sub(r"\1", cleaned)
    return cleaned.strip(" ,;:")


def _strip_inline_noise_fragments(value: str) -> str:
    cleaned = value
    cleaned = _INLINE_DECIMAL_NOISE.sub(" ", cleaned)
    cleaned = _JUG_NOISE.sub(" ", cleaned)
    cleaned = _CHECK_NOISE_FRAGMENT.sub(" ", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    return cleaned.strip()


def _normalize_spacing(value: str) -> str:
    text = value
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r"\s+\.", ".", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def _merge_wrapped_lines(lines: list[str]) -> list[str]:
    if not lines:
        return []
    merged: list[str] = [lines[0].strip()]
    for line in lines[1:]:
        current = line.strip()
        if not current:
            continue
        previous = merged[-1]
        should_join = (
            not previous.endswith((".", "!", "?", ":", ";"))
            and bool(re.match(r"^[a-záéíóúñ]", current))
        )
        if should_join:
            merged[-1] = f"{previous} {current}".strip()
        else:
            merged.append(current)
    return merged


def _deduplicate(values: list[str]) -> list[str]:
    result: list[str] = []
    for item in values:
        if item and item not in result:
            result.append(item)
    return result


def _read_image_width(image) -> float:
    size = getattr(image, "size", None)
    if isinstance(size, tuple) and len(size) == 2:
        return float(size[0])
    return 1080.0
