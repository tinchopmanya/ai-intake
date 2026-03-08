from typing import Protocol


class AIProviderError(Exception):
    pass


class AIProvider(Protocol):
    def generate_answer(self, message: str) -> str:
        ...
