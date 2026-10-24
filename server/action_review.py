"""Hermes pre_tool_call hook. Failure or missing human review blocks the action."""
import json
import sys
import urllib.request


def main():
    with open(sys.argv[1], encoding="utf-8") as descriptor:
        connection = json.load(descriptor)
    payload = json.load(sys.stdin)
    request = urllib.request.Request(
        connection["url"], data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + connection["token"]},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=connection["timeout"] + 5) as response:
        result = json.load(response)
    if result.get("action") not in ("block", "modify"):
        raise ValueError("Unsupported review response")
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not expose URLs, arguments, capability tokens or remote error bodies.
        print(json.dumps({"action": "block", "message": "App action was not reviewed. Reconnect Teammates and try again."}))
