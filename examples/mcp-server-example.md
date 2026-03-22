# Example: Adding an MCP Server

MCP (Model Context Protocol) servers give Claude access to external APIs and services. This example shows how to add one.

## Python MCP Server (FastMCP pattern)

```python
# server.py
import json
import signal
import sys
from mcp.server.fastmcp import FastMCP

# Clean shutdown (prevents slow Claude Code session exit)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
signal.signal(signal.SIGINT, lambda *_: sys.exit(0))

mcp = FastMCP("My API Server")

@mcp.tool(annotations={"readOnlyHint": True})
def search_items(query: str, limit: int = 10) -> str:
    """Search for items matching a query."""
    # Your API call here
    results = my_api.search(query, limit=limit)
    return json.dumps(results, indent=2)

@mcp.tool(annotations={"readOnlyHint": True})
def get_item(item_id: str) -> str:
    """Get a single item by ID."""
    item = my_api.get(item_id)
    return json.dumps(item, indent=2)

if __name__ == "__main__":
    mcp.run(transport="stdio")
```

## Setup

```bash
# Create venv and install dependencies
python3 -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install "mcp[cli]>=1.0.0" "requests>=2.32.0"
```

## Register with Claude Code

MCP servers MUST be registered at user scope. Project-scope servers appear connected but their tools silently don't load.

**macOS:**
```bash
claude mcp add my-api -s user \
  -e "API_KEY=$MY_API_KEY" \
  -- python3 /full/path/to/server.py
```

**Windows:**
```bash
claude mcp add my-api -s user \
  -e "API_KEY=your-key" \
  -- cmd /c python C:\full\path\to\server.py
```

**Or edit `~/.claude.json` directly:**
```json
"my-api": {
  "type": "stdio",
  "command": "python3",
  "args": ["/full/path/to/server.py"],
  "env": {
    "API_KEY": "your-key"
  }
}
```

## Verify

```bash
node ~/.claude/scripts/check-mcp-health.js my-api
```

## Key rules

- Always include `"type": "stdio"` in the config
- Use absolute paths, not relative
- Credentials go in `env`, not hardcoded in code
- Add SIGTERM/SIGINT handlers for clean shutdown
- Use `readOnlyHint` and `destructiveHint` annotations on tools
- For write operations, consider adding a `confirm: bool` safety parameter
