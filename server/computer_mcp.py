"""A profile-bound MCP client for this app's private computer service.

Hermes owns the MCP connection. The server owns the VM; this process never
receives model credentials or runs commands on the host.
"""
import base64
import json
import sys
import urllib.request
import urllib.error

try:
    from mcp.server import MCPServer
    from mcp.server.mcpserver import Image
except ImportError:  # Hermes installations still using the MCP v1 SDK.
    from mcp.server.fastmcp import FastMCP as MCPServer, Image

with open(sys.argv[1], encoding="utf-8") as descriptor:
    connection = json.load(descriptor)

server = MCPServer("Teammates Computer")


def call(tool, arguments):
    request = urllib.request.Request(
        connection["url"] + "/" + tool,
        data=json.dumps(arguments).encode(),
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + connection["token"]},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=170) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        try:
            message = json.loads(error.read()).get("error", "Computer request failed")
        except (ValueError, TypeError):
            message = "Computer request failed"
        raise RuntimeError(message) from None


@server.tool()
def computer_screenshot() -> Image:
    """Capture your own Linux computer's 1280x800 screen. Hermes returns the image as a cached MEDIA:path. Use vision_analyze on that path to inspect the screen before clicking; it needs a configured vision-capable model. Refused while the user has control."""
    return Image(data=base64.b64decode(call("screenshot", {})["image"]), format="png")


@server.tool()
def computer_action(type: str, x: int = 0, y: int = 0, text: str = "", key: str = "", button: str = "left", direction: str = "down", amount: int = 3) -> str:
    """Act on your Linux computer. type: click, move, type, key, scroll. Coordinates are 1280x800. key uses X11 names such as Return, ctrl+l, alt+F4. For a browser, click its window or use ctrl+l, type the URL, then Return. Only this bot's computer is affected. Refused while the user has control."""
    return json.dumps(call("action", {"type": type, "x": x, "y": y, "text": text, "key": key, "button": button, "direction": direction, "amount": amount}))


@server.tool()
def computer_shell(command: str) -> str:
    """Run a Bash command INSIDE your Linux computer, starting in ~/workspace. Files and browser logins in its home persist across sleep. This does not run on the host. No model credentials are available inside. Refused while the user has control. Ask before consequential external actions."""
    return call("shell", {"command": command})["output"]


if __name__ == "__main__":
    server.run(transport="stdio")
