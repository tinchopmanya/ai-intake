from app.repositories.analysis_results import AnalysisResultRepository
from app.repositories.advisor_outputs import AdvisorOutputRepository
from app.repositories.advisor_sessions import AdvisorSessionRepository
from app.repositories.cases import CaseRepository
from app.repositories.contacts import ContactRepository
from app.repositories.conversation_memory import ConversationMemoryRepository
from app.repositories.incidents import IncidentRepository
from app.repositories.mvp_metrics import MvpMetricsRepository
from app.repositories.protocols import ConnectionFactory
from app.repositories.protocols import ConnectionProtocol
from app.repositories.tracking_events import TrackingEventRepository


class UnitOfWork:
    def __init__(
        self,
        connection_factory: ConnectionFactory,
        tracking_repository: TrackingEventRepository | None = None,
    ) -> None:
        self._connection_factory = connection_factory
        self._connection: ConnectionProtocol | None = None
        self._tracking_repository = tracking_repository

        self.contacts: ContactRepository
        self.cases: CaseRepository
        self.analyses: AnalysisResultRepository
        self.sessions: AdvisorSessionRepository
        self.outputs: AdvisorOutputRepository
        self.memory: ConversationMemoryRepository
        self.incidents: IncidentRepository
        self.mvp_metrics: MvpMetricsRepository

    @property
    def tracking(self) -> TrackingEventRepository | None:
        return self._tracking_repository

    def __enter__(self) -> "UnitOfWork":
        self._connection = self._connection_factory()
        self.contacts = ContactRepository(self._connection)
        self.cases = CaseRepository(self._connection)
        self.analyses = AnalysisResultRepository(self._connection)
        self.sessions = AdvisorSessionRepository(self._connection)
        self.outputs = AdvisorOutputRepository(self._connection)
        self.memory = ConversationMemoryRepository(self._connection)
        self.incidents = IncidentRepository(self._connection)
        self.mvp_metrics = MvpMetricsRepository(self._connection)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self._connection is None:
            return
        if exc_type is None:
            self._connection.commit()
        else:
            self._connection.rollback()
        self._connection.close()
        self._connection = None

    def commit(self) -> None:
        if self._connection is None:
            raise RuntimeError("UnitOfWork is not active")
        self._connection.commit()

    def rollback(self) -> None:
        if self._connection is None:
            raise RuntimeError("UnitOfWork is not active")
        self._connection.rollback()

