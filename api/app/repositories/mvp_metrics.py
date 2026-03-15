from collections.abc import Mapping
from typing import Any

from app.repositories.protocols import ConnectionProtocol


class MvpMetricsRepository:
    def __init__(self, connection: ConnectionProtocol) -> None:
        self._connection = connection

    def snapshot(self) -> Mapping[str, Any]:
        query = """
            SELECT
                (SELECT COUNT(DISTINCT user_id)::bigint FROM auth_sessions) AS users_logged_in,
                (
                    SELECT COUNT(*)::bigint
                    FROM users
                    WHERE onboarding_completed = TRUE
                ) AS users_completed_onboarding,
                (SELECT COUNT(*)::bigint FROM advisor_sessions) AS wizard_sessions_created,
                (
                    SELECT COUNT(*)::bigint
                    FROM analytics.wizard_events
                    WHERE event_name = 'reply_generated'
                      AND COALESCE(success, TRUE) = TRUE
                ) AS replies_generated,
                (
                    SELECT COUNT(*)::bigint
                    FROM analytics.wizard_events
                    WHERE event_name = 'reply_copied'
                      AND COALESCE(success, TRUE) = TRUE
                ) AS replies_copied,
                (SELECT COUNT(*)::bigint FROM cases) AS cases_created,
                (SELECT COUNT(*)::bigint FROM incidents) AS incidents_created,
                (
                    SELECT COUNT(*)::bigint
                    FROM analytics.wizard_events
                    WHERE event_name = 'case_exported'
                      AND COALESCE(success, TRUE) = TRUE
                ) AS case_exports,
                (
                    SELECT COUNT(*)::bigint
                    FROM (
                        SELECT user_id
                        FROM analytics.wizard_events
                        WHERE user_id IS NOT NULL
                          AND occurred_at >= (NOW() - INTERVAL '7 days')
                        GROUP BY user_id
                        HAVING COUNT(DISTINCT DATE(occurred_at)) >= 2
                    ) AS returning_users
                ) AS returning_users_7d
        """
        with self._connection.cursor() as cursor:
            cursor.execute(query)
            row = cursor.fetchone()
        return dict(row or {})
