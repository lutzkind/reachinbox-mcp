# ReachInbox MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that gives AI tools (Claude Code, Gemini CLI, Codex CLI, etc.) full access to the [ReachInbox](https://app.reachinbox.ai) cold email platform via a self-hosted proxy.

## Tools (27 total)

| Category | Tool | Description |
|---|---|---|
| **Campaign** | `reachinbox_campaign_list` | List all campaigns |
| | `reachinbox_campaign_create` | Create a new campaign |
| | `reachinbox_campaign_start` | Start a campaign |
| | `reachinbox_campaign_pause` | Pause a campaign |
| | `reachinbox_campaign_update` | Update campaign settings |
| | `reachinbox_campaign_analytics` | Get campaign analytics |
| | `reachinbox_campaign_details` | Get campaign details |
| | `reachinbox_campaign_total_analytics` | Get aggregated analytics |
| **Subsequences** | `reachinbox_subsequence_list` | List subsequences for a campaign |
| | `reachinbox_subsequence_details` | Get subsequence details |
| | `reachinbox_subsequence_create` | Create a subsequence |
| | `reachinbox_subsequence_update` | Update a subsequence |
| **Leads** | `reachinbox_leads_add` | Add leads to a campaign |
| | `reachinbox_leads_update` | Update a lead |
| | `reachinbox_leads_delete` | Delete leads from a campaign |
| **Lead Lists** | `reachinbox_lead_list_get_all` | Get all lead lists |
| | `reachinbox_lead_list_create` | Create a lead list |
| | `reachinbox_lead_list_add_leads` | Add leads to a list |
| **Accounts** | `reachinbox_account_list` | List connected email accounts |
| | `reachinbox_account_warmup_analytics` | Get warmup analytics |
| **Inbox** | `reachinbox_onebox_list` | List inbox threads |
| | `reachinbox_onebox_send` | Send an email reply |
| | `reachinbox_onebox_mark_all_read` | Mark all messages as read |
| | `reachinbox_onebox_unread_count` | Get unread count |
| | `reachinbox_onebox_search` | Search inbox threads |
| **Tags** | `reachinbox_tag_list` | List all tags |
| **Webhooks** | `reachinbox_webhook_list` | List webhook subscriptions |
| | `reachinbox_webhook_subscribe` | Subscribe to events |
| | `reachinbox_webhook_unsubscribe` | Remove a subscription |

## Requirements

- A running instance of [reachinbox-proxy](https://github.com/lutzkind/reachinbox-proxy) — the proxy handles authentication against the ReachInbox platform using your login credentials.
- The current live API exposes campaign details and subsequence list/details/create/update routes; those are now surfaced through the MCP so campaign composition can stay inside MCP instead of dropping to raw proxy calls.

## Installation

### Run directly

```bash
PROXY_URL=https://your-proxy-domain.com node index.js
```

### Run via Docker (recommended)

Uses the standard MCP container architecture with the v16 SSE wrapper bridge:

```bash
docker run -d \
  --name mcp-reachinbox \
  --restart unless-stopped \
  -e COMMAND="node /app/index.js" \
  -e PORT=3000 \
  -e PROXY_URL=https://your-proxy-domain.com \
  -p 3027:3000 \
  mcp-optimized:latest \
  node server.js

docker cp index.js mcp-reachinbox:/app/index.js
docker restart mcp-reachinbox
```

## Configuration

### Gemini CLI (`~/.gemini/settings.json`)

```json
{
  "mcpServers": {
    "reachinbox": {
      "url": "http://127.0.0.1:3027/sse",
      "type": "sse",
      "trust": true
    }
  }
}
```

### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "reachinbox": {
      "type": "sse",
      "url": "http://127.0.0.1:3027/sse"
    }
  }
}
```

### stdio (for any MCP-compatible client)

```json
{
  "mcpServers": {
    "reachinbox": {
      "command": "node",
      "args": ["/path/to/index.js"],
      "env": { "PROXY_URL": "https://your-proxy-domain.com" }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PROXY_URL` | `https://reachinbox.luxeillum.com` | Base URL of the ReachInbox proxy |

## Related

- [reachinbox-proxy](https://github.com/lutzkind/reachinbox-proxy) — The self-hosted proxy that handles authentication
- [n8n-nodes-reachinbox-proxy](https://github.com/lutzkind/n8n-nodes-reachinbox-proxy) — n8n community nodes for the same proxy

## License

MIT
