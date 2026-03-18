from app.api.routers.advisor import _build_chat_system_prompt


def test_refine_mode_prompt_requires_advisor_judgment() -> None:
    prompt = _build_chat_system_prompt(
        "advisor_refine_response",
        advisor_name="Robert",
        advisor_role="Estrategico",
    )

    assert "advisor estrategico, no como escribiente obediente" in prompt
    assert "No obedezcas ciegamente" in prompt
    assert '"suggested_reply"' in prompt


def test_conversation_mode_prompt_keeps_conversation_contract() -> None:
    prompt = _build_chat_system_prompt(
        "advisor_conversation",
        advisor_name="Laura",
        advisor_role="Empatica",
    )

    assert "Estas en modo advisor_conversation." in prompt
    assert '"suggested_reply": null' in prompt
