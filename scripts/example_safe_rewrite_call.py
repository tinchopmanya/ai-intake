import json
import os

import requests


def main() -> None:
    api_url = os.getenv("API_URL", "http://localhost:8000")
    token = os.getenv("ACCESS_TOKEN", "")
    if not token:
        raise SystemExit("Define ACCESS_TOKEN con un bearer token valido.")

    payload = {
        "message_text": "Siempre haces lo mismo, llegas tarde y despues tengo que reorganizar todo. Si vas a venir avisa.",
        "mode": "reactive",
        "relationship_type": "familia",
        "source_type": "text",
        "quick_mode": False,
        "save_session": True,
        "context": {
            "relationship_mode": "coparenting",
            "response_style": "cordial_colaborativo",
        },
    }

    response = requests.post(
        f"{api_url}/v1/advisor",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        data=json.dumps(payload),
        timeout=30,
    )
    print(response.status_code)
    print(response.text)


if __name__ == "__main__":
    main()
