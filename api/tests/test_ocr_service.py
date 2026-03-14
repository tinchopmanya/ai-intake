from app.services.ocr_service import OcrService
from app.services.ocr_service import _repair_common_ocr_terms
from PIL import Image
from PIL import ImageDraw


def test_repair_common_ocr_terms_for_nino_nina() -> None:
    assert _repair_common_ocr_terms("mi nifia esta bien") == "mi ni\u00f1a esta bien"
    assert _repair_common_ocr_terms("el nifio llego") == "el ni\u00f1o llego"


def test_postprocess_removes_ui_noise_and_timestamps() -> None:
    service = OcrService()
    cleaned, warnings = service._postprocess_text(
        "21:24\n4G\nMensaje\nHola, como estas?\n20:05\n//\n"
    )
    assert cleaned == "Hola, como estas?"
    assert "ocr_text_cleaned" in warnings


def test_postprocess_removes_whatsapp_chrome_patterns() -> None:
    service = OcrService()
    dirty = (
        "21:24M 4 @ D Sal GOO 4\n"
        "Marcela\n"
        "55.96 w\n"
        "@ Mensaje vo eo\n"
        "o @ <\n"
        "El re linda no va, se juega y se tiene amigos porque son buenos.\n"
        "Sino despues la nifia empieza.\n"
        "Porque hay nifios lindos que son malos.\n"
        "ah bueno si\n"
    )
    cleaned, warnings = service._postprocess_text(dirty)

    assert "21:24M" not in cleaned
    assert "Marcela" not in cleaned
    assert "< fy Marcela or & :" not in cleaned
    assert "55.96 w" not in cleaned
    assert "Mensaje" not in cleaned
    assert "o @ <" not in cleaned
    assert "El re linda no va" in cleaned
    assert "Sino despues la ni\u00f1a empieza." in cleaned
    assert "Porque hay ni\u00f1os lindos que son malos." in cleaned
    assert "ah bueno si" in cleaned
    assert "ocr_text_cleaned" in warnings


def test_postprocess_fine_cleanup_for_residual_whatsapp_noise() -> None:
    service = OcrService()
    dirty = (
        "de Emanuel, que te parece que dljo\n"
        "Valentina, que preferfa que fuera una\n"
        "niña, porque ella solo tiene primos\n"
        "varones, que rlla no tiene primas para\n"
        "jugar\n"
        "jug & & 20:05\n"
        "pfff , y bueno , es lo que hay 55.96 w\n"
        "tiene la nena de marcia decile\n"
        "que es re linda 59.97 v\n"
        "que es re linda\n"
        "El re linda no va, se juega y se tiene\n"
        "amigos porque son buenos ellos no\n"
        "porque son lindos.\n"
        "Sino después la niña empieza de que\n"
        "fulano es pobre, es marroncita, es\n"
        "gordita. No hay que catalogar a los\n"
        "niflos.po 20:09\n"
        "Por caracteristicas 45.99\n"
        "Porque hay niños lindos que son\n"
        "malos. 20:10\n"
    )
    cleaned, warnings = service._postprocess_text(dirty)

    assert "55.96 w" not in cleaned
    assert "59.97 v" not in cleaned
    assert "45.99" not in cleaned
    assert "20:05" not in cleaned
    assert "20:09" not in cleaned
    assert "20:10" not in cleaned
    assert "jug & &" not in cleaned
    assert "dijo" in cleaned
    assert "prefería" in cleaned
    assert "ella" in cleaned
    assert "niños" in cleaned
    assert "Porque hay niños lindos que son malos." in cleaned
    assert "ocr_text_cleaned" in warnings


class _DummyImage:
    size = (1080, 1920)


class _DummyPytesseract:
    class Output:
        DICT = "dict"

    @staticmethod
    def image_to_data(*args, **kwargs):  # noqa: ANN002, ANN003
        return {
            "text": [
                "Hola",
                "como",
                "estas",
                "20:05",
                "Todo",
                "bien",
                "20:07",
            ],
            "conf": ["90", "91", "88", "80", "89", "87", "82"],
            "left": [90, 140, 210, 480, 640, 700, 980],
            "top": [100, 100, 100, 100, 180, 180, 180],
            "width": [40, 50, 60, 40, 45, 40, 35],
            "block_num": [1, 1, 1, 1, 2, 2, 2],
            "par_num": [1, 1, 1, 1, 1, 1, 1],
            "line_num": [1, 1, 1, 1, 1, 1, 1],
        }


def test_extract_conversation_turns_groups_me_and_them() -> None:
    service = OcrService(turn_detection_enabled=True)
    turns = service._extract_conversation_turns(
        _DummyImage(),
        _DummyPytesseract(),
        tesseract_config="--oem 3 --psm 6",
    )

    assert turns is not None
    assert len(turns) == 2
    assert turns[0].speaker == "them"
    assert turns[0].text == "Hola como estas"
    assert turns[0].time == "20:05"
    assert turns[1].speaker == "me"
    assert turns[1].text == "Todo bien"
    assert turns[1].time == "20:07"


def test_crop_whatsapp_frame_uses_ratio_and_removes_ui() -> None:
    service = OcrService(
        whatsapp_crop_top_px=80,
        whatsapp_crop_bottom_px=120,
        wa_top_crop_ratio=0.15,
        wa_bottom_crop_ratio=0.17,
        whatsapp_crop_enabled=True,
    )
    image = Image.new("RGB", (1080, 2400), color=(255, 255, 255))
    cropped, metadata, warnings = service._crop_whatsapp_frame(image)

    assert bool(metadata.get("crop_applied")) is True
    assert int(metadata.get("crop_top_px", 0)) >= 300
    assert int(metadata.get("crop_bottom_px", 0)) >= 300
    assert "whatsapp_heuristic_crop_applied" in warnings
    assert cropped.size[1] < image.size[1]


def test_detect_message_blocks_finds_multiple_regions() -> None:
    try:
        import cv2  # noqa: F401
    except Exception:
        return

    service = OcrService()
    image = Image.new("L", (1080, 1400), color=255)
    draw = ImageDraw.Draw(image)
    draw.rectangle((60, 180, 680, 280), fill=0)   # them
    draw.rectangle((420, 420, 1020, 540), fill=0) # me

    blocks = service._detect_message_blocks(image.convert("RGB"))
    assert len(blocks) >= 2
    assert any(block.get("speaker") == "them" for block in blocks)
    assert any(block.get("speaker") == "me" for block in blocks)
