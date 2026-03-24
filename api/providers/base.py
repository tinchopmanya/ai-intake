from typing import Protocol


class AIProviderError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        provider_code: str | None = None,
        retryable: bool = False,
        provider_name: str | None = None,
        model: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.provider_code = provider_code
        self.retryable = retryable
        self.provider_name = provider_name
        self.model = model

    def __str__(self) -> str:
        return self.message


class AIProvider(Protocol):
    def generate_answer(self, message: str) -> str:
        ...
