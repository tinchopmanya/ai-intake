from __future__ import annotations

import io
from dataclasses import dataclass
from statistics import mean


class OcrError(Exception):
    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True)
class OcrResult:
    extracted_text: str
    provider: str
    confidence: float | None
    warnings: list[str]


class OcrService:
    def __init__(self, provider: str = "auto") -> None:
        self._provider = (provider or "auto").strip().lower()

    def extract_text(self, image_bytes: bytes) -> OcrResult:
        providers = self._resolve_provider_order()
        failures: list[str] = []
        for provider in providers:
            try:
                if provider == "google_vision":
                    return self._extract_google_vision(image_bytes)
                if provider == "tesseract":
                    return self._extract_tesseract(image_bytes)
            except Exception as exc:
                failures.append(f"{provider}: {type(exc).__name__}")

        raise OcrError(
            "ocr_unavailable"
            if not failures
            else f"ocr_unavailable ({', '.join(failures)})"
        )

    def _resolve_provider_order(self) -> list[str]:
        if self._provider == "google_vision":
            return ["google_vision"]
        if self._provider == "tesseract":
            return ["tesseract"]
        return ["google_vision", "tesseract"]

    def _extract_google_vision(self, image_bytes: bytes) -> OcrResult:
        from google.cloud import vision

        client = vision.ImageAnnotatorClient()
        image = vision.Image(content=image_bytes)
        response = client.document_text_detection(image=image)
        if response.error and response.error.message:
            raise OcrError(f"google_vision_error: {response.error.message}")

        annotation = response.full_text_annotation
        extracted = (annotation.text or "").strip() if annotation else ""
        if not extracted:
            raise OcrError("google_vision_empty")

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
        from PIL import Image
        import pytesseract

        image = Image.open(io.BytesIO(image_bytes))
        raw_text = pytesseract.image_to_string(image)
        extracted = raw_text.strip()
        if not extracted:
            raise OcrError("tesseract_empty")

        confidence = self._extract_tesseract_confidence(image)
        return OcrResult(
            extracted_text=extracted,
            provider="tesseract",
            confidence=confidence,
            warnings=[
                "tesseract_fallback_used",
            ],
        )

    def _extract_tesseract_confidence(self, image) -> float | None:
        import pytesseract

        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
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
