import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PROXY_URL = process.env.PROXY_URL || 'https://reachinbox.luxeillum.com';

async function proxyRequest(method, path, body) {
  const url = `${PROXY_URL}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body && Object.keys(body).length > 0) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  return data;
}

function buildQueryString(params) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null
  );
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

const TOOLS = [
  // ── Campaign tools ──────────────────────────────────────────────────────────
  {
    name: 'reachinbox_campaign_list',
    description: 'List all campaigns',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'number',  description: 'Number of campaigns to return', default: 50 },
        filter: { type: 'string',  description: 'Filter campaigns (e.g. all, active, paused)', default: 'all' },
        sort:   { type: 'string',  description: 'Sort order', default: 'newest' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_create',
    description: 'Create a new campaign',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Campaign name' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_start',
    description: 'Start a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_pause',
    description: 'Pause a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_update',
    description: 'Update campaign settings',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId:   { type: 'number', description: 'Campaign ID' },
        name:         { type: 'string', description: 'New campaign name' },
        scheduleType: { type: 'string', description: 'Schedule type' },
        timezone:     { type: 'string', description: 'Timezone' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_analytics',
    description: 'Get analytics for a specific campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_details',
    description: 'Get a campaign with its subsequences and configuration',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_total_analytics',
    description: 'Get total analytics across all campaigns',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        endDate:   { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
    },
  },

  // ── Subsequence tools ──────────────────────────────────────────────────────
  {
    name: 'reachinbox_subsequence_list',
    description: 'List subsequences for a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_subsequence_details',
    description: 'Get subsequence details',
    inputSchema: {
      type: 'object',
      required: ['subsequenceId'],
      properties: {
        subsequenceId: { type: 'number', description: 'Subsequence ID' },
      },
    },
  },
  {
    name: 'reachinbox_subsequence_create',
    description: 'Create a new subsequence in a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'name'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        name: { type: 'string', description: 'Subsequence name' },
        subject: { type: 'string', description: 'Email subject', default: '' },
        body: { type: 'string', description: 'Email body', default: '' },
      },
    },
  },
  {
    name: 'reachinbox_subsequence_update',
    description: 'Update a subsequence',
    inputSchema: {
      type: 'object',
      required: ['subsequenceId'],
      properties: {
        subsequenceId: { type: 'number', description: 'Subsequence ID' },
        name: { type: 'string', description: 'New subsequence name' },
        subject: { type: 'string', description: 'Email subject', default: '' },
        body: { type: 'string', description: 'Email body', default: '' },
      },
    },
  },

  // ── Sequence tools ─────────────────────────────────────────────────────────
  {
    name: 'reachinbox_campaign_sequences_get',
    description: 'Get the sequence builder payload for a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_sequences_save',
    description: 'Save sequence builder steps for a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'sequences'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        sequences: {
          type: 'array',
          description: 'Full sequence payload as returned by the campaign sequences endpoint',
          items: { type: 'object' },
        },
        coreVariables: {
          type: 'array',
          description: 'Optional core variables payload',
          items: { type: 'object' },
        },
      },
    },
  },

  // ── Lead tools ──────────────────────────────────────────────────────────────
  {
    name: 'reachinbox_leads_add',
    description: 'Add leads to a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'leads'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        leads: {
          type: 'array',
          description: 'Array of lead objects',
          items: {
            type: 'object',
            required: ['email'],
            properties: {
              email:     { type: 'string' },
              firstName: { type: 'string' },
              lastName:  { type: 'string' },
              phone:     { type: 'string' },
              company:   { type: 'string' },
              title:     { type: 'string' },
            },
          },
        },
        duplicates: { type: 'string', description: 'Duplicate handling strategy', default: 'skip' },
      },
    },
  },
  {
    name: 'reachinbox_leads_update',
    description: 'Update a lead in a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'email'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        email:      { type: 'string', description: 'Lead email address' },
        firstName:  { type: 'string' },
        lastName:   { type: 'string' },
        phone:      { type: 'string' },
        company:    { type: 'string' },
        title:      { type: 'string' },
      },
    },
  },
  {
    name: 'reachinbox_leads_delete',
    description: 'Delete leads from a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'emails'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        emails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of email addresses to delete',
        },
      },
    },
  },

  // ── Lead list tools ─────────────────────────────────────────────────────────
  {
    name: 'reachinbox_lead_list_get_all',
    description: 'Get all lead lists',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of lists to return', default: 50 },
      },
    },
  },
  {
    name: 'reachinbox_lead_list_create',
    description: 'Create a new lead list',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Lead list name' },
      },
    },
  },
  {
    name: 'reachinbox_lead_list_add_leads',
    description: 'Add leads to an existing lead list',
    inputSchema: {
      type: 'object',
      required: ['listId', 'leads'],
      properties: {
        listId: { type: 'number', description: 'Lead list ID' },
        leads: {
          type: 'array',
          description: 'Array of lead objects',
          items: { type: 'object' },
        },
      },
    },
  },

  // ── Account tools ───────────────────────────────────────────────────────────
  {
    name: 'reachinbox_account_list',
    description: 'List all connected email accounts',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reachinbox_account_warmup_analytics',
    description: 'Get warmup analytics for connected accounts',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ── Onebox (inbox) tools ────────────────────────────────────────────────────
  {
    name: 'reachinbox_onebox_list',
    description: 'List threads in the unified inbox',
    inputSchema: {
      type: 'object',
      properties: {
        page:  { type: 'number', description: 'Page number', default: 1 },
        limit: { type: 'number', description: 'Items per page', default: 20 },
      },
    },
  },
  {
    name: 'reachinbox_onebox_send',
    description: 'Send a reply in an inbox thread',
    inputSchema: {
      type: 'object',
      required: ['threadId', 'body'],
      properties: {
        threadId: { type: 'string', description: 'Thread ID to reply to' },
        body:     { type: 'string', description: 'Email body HTML or plain text' },
        subject:  { type: 'string', description: 'Email subject (optional for replies)' },
      },
    },
  },
  {
    name: 'reachinbox_onebox_mark_all_read',
    description: 'Mark all inbox threads as read',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reachinbox_onebox_unread_count',
    description: 'Get the count of unread inbox threads',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reachinbox_onebox_search',
    description: 'Search the unified inbox',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query' },
        page:  { type: 'number', description: 'Page number', default: 1 },
      },
    },
  },

  // ── Tag & misc tools ────────────────────────────────────────────────────────
  {
    name: 'reachinbox_tag_list',
    description: 'List all tags',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  // ── Webhook tools ───────────────────────────────────────────────────────────
  {
    name: 'reachinbox_webhook_list',
    description: 'List all webhook subscriptions',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reachinbox_webhook_subscribe',
    description: 'Subscribe to a webhook event',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'event', 'callbackUrl'],
      properties: {
        campaignId:   { type: 'number', description: 'Campaign ID' },
        event: {
          type: 'string',
          description: 'Event type to subscribe to',
          enum: [
            'ALL_EVENTS',
            'EMAIL_SENT',
            'EMAIL_OPENED',
            'EMAIL_CLICKED',
            'REPLY_RECEIVED',
            'EMAIL_BOUNCED',
            'LEAD_INTERESTED',
            'LEAD_NOT_INTERESTED',
            'CAMPAIGN_COMPLETED',
          ],
        },
        callbackUrl:  { type: 'string', description: 'URL to receive webhook POST' },
        allCampaigns: { type: 'boolean', description: 'Apply to all campaigns', default: false },
      },
    },
  },
  {
    name: 'reachinbox_webhook_unsubscribe',
    description: 'Unsubscribe from a webhook event',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'event', 'callbackUrl'],
      properties: {
        campaignId:  { type: 'number', description: 'Campaign ID' },
        event:       { type: 'string', description: 'Event type to unsubscribe from' },
        callbackUrl: { type: 'string', description: 'Callback URL to remove' },
      },
    },
  },
];

async function handleTool(name, args) {
  const a = args || {};

  switch (name) {
    // ── Campaign ──────────────────────────────────────────────────────────────
    case 'reachinbox_campaign_list': {
      const qs = buildQueryString({
        limit:  a.limit  ?? 50,
        filter: a.filter ?? 'all',
        sort:   a.sort   ?? 'newest',
      });
      return await proxyRequest('GET', `/api/v1/campaign/list${qs}`, {});
    }
    case 'reachinbox_campaign_create':
      return await proxyRequest('POST', '/api/v1/campaign/create', { name: a.name });

    case 'reachinbox_campaign_start':
      return await proxyRequest('POST', '/api/v1/campaign/start', { campaignId: a.campaignId });

    case 'reachinbox_campaign_pause':
      return await proxyRequest('POST', '/api/v1/campaign/pause', { campaignId: a.campaignId });

    case 'reachinbox_campaign_update': {
      const body = { campaignId: a.campaignId };
      if (a.name         !== undefined) body.name         = a.name;
      if (a.scheduleType !== undefined) body.scheduleType = a.scheduleType;
      if (a.timezone     !== undefined) body.timezone     = a.timezone;
      return await proxyRequest('POST', '/api/v1/campaign/update', body);
    }
    case 'reachinbox_campaign_analytics':
      return await proxyRequest('POST', '/api/v1/campaign/analytics', { campaignId: a.campaignId });

    case 'reachinbox_campaign_details': {
      const qs = buildQueryString({ campaignId: a.campaignId });
      return await proxyRequest('GET', `/api/v1/campaign/details${qs}`, {});
    }

    case 'reachinbox_campaign_sequences_get': {
      const qs = buildQueryString({ campaignId: a.campaignId });
      return await proxyRequest('GET', `/api/v1/campaign/sequences${qs}`, {});
    }

    case 'reachinbox_campaign_sequences_save': {
      const body = { campaignId: a.campaignId, sequences: a.sequences };
      if (a.coreVariables !== undefined) body.coreVariables = a.coreVariables;
      return await proxyRequest('POST', '/api/v1/sequences/add', body);
    }

    case 'reachinbox_campaign_total_analytics': {
      const body = {};
      if (a.startDate !== undefined) body.startDate = a.startDate;
      if (a.endDate   !== undefined) body.endDate   = a.endDate;
      return await proxyRequest('POST', '/api/v1/campaign/total-analytics', body);
    }

    // ── Subsequences ───────────────────────────────────────────────────────────
    case 'reachinbox_subsequence_list': {
      const qs = buildQueryString({ campaignId: a.campaignId });
      return await proxyRequest('GET', `/api/v1/subsequence/list${qs}`, {});
    }

    case 'reachinbox_subsequence_details': {
      const qs = buildQueryString({ subsequenceId: a.subsequenceId });
      return await proxyRequest('GET', `/api/v1/subsequence/details${qs}`, {});
    }

    case 'reachinbox_subsequence_create': {
      const body = { campaignId: a.campaignId, name: a.name };
      if (a.subject !== undefined) body.subject = a.subject;
      if (a.body !== undefined) body.body = a.body;
      if (a.leadStatusCondition !== undefined) body.leadStatusCondition = a.leadStatusCondition;
      if (a.leadActivityCondition !== undefined) body.leadActivityCondition = a.leadActivityCondition;
      if (a.leadReplyText !== undefined) body.leadReplyText = a.leadReplyText;
      if (a.leadReplyContext !== undefined) body.leadReplyContext = a.leadReplyContext;
      return await proxyRequest('POST', '/api/v1/subsequence/create', body);
    }

    case 'reachinbox_subsequence_update': {
      const body = { subsequenceId: a.subsequenceId };
      if (a.name !== undefined) body.name = a.name;
      if (a.subject !== undefined) body.subject = a.subject;
      if (a.body !== undefined) body.body = a.body;
      if (a.leadStatusCondition !== undefined) body.leadStatusCondition = a.leadStatusCondition;
      if (a.leadActivityCondition !== undefined) body.leadActivityCondition = a.leadActivityCondition;
      if (a.leadReplyText !== undefined) body.leadReplyText = a.leadReplyText;
      if (a.leadReplyContext !== undefined) body.leadReplyContext = a.leadReplyContext;
      return await proxyRequest('POST', '/api/v1/subsequence/update', body);
    }

    // ── Leads ─────────────────────────────────────────────────────────────────
    case 'reachinbox_leads_add':
      return await proxyRequest('POST', '/api/v1/leads/add', {
        campaignId: a.campaignId,
        leads:      a.leads,
        duplicates: a.duplicates ?? 'skip',
      });

    case 'reachinbox_leads_update': {
      const body = { campaignId: a.campaignId, email: a.email };
      if (a.firstName !== undefined) body.firstName = a.firstName;
      if (a.lastName  !== undefined) body.lastName  = a.lastName;
      if (a.phone     !== undefined) body.phone     = a.phone;
      if (a.company   !== undefined) body.company   = a.company;
      if (a.title     !== undefined) body.title     = a.title;
      return await proxyRequest('POST', '/api/v1/leads/update', body);
    }
    case 'reachinbox_leads_delete':
      return await proxyRequest('POST', '/api/v1/leads/delete', {
        campaignId: a.campaignId,
        emails:     a.emails,
      });

    // ── Lead lists ────────────────────────────────────────────────────────────
    case 'reachinbox_lead_list_get_all': {
      const qs = buildQueryString({ limit: a.limit ?? 50 });
      return await proxyRequest('GET', `/api/v1/leads-list/all${qs}`, {});
    }
    case 'reachinbox_lead_list_create':
      return await proxyRequest('POST', '/api/v1/leads-list/create', { name: a.name });

    case 'reachinbox_lead_list_add_leads':
      return await proxyRequest('POST', '/api/v1/leads-list/add-leads', {
        listId: a.listId,
        leads:  a.leads,
      });

    // ── Accounts ──────────────────────────────────────────────────────────────
    case 'reachinbox_account_list':
      return await proxyRequest('GET', '/api/v1/account/list', {});

    case 'reachinbox_account_warmup_analytics':
      return await proxyRequest('GET', '/api/v1/account/warmup-analytics', {});

    // ── Onebox ────────────────────────────────────────────────────────────────
    case 'reachinbox_onebox_list':
      return await proxyRequest('POST', '/api/v1/onebox/list', {
        page:  a.page  ?? 1,
        limit: a.limit ?? 20,
      });

    case 'reachinbox_onebox_send': {
      const body = { threadId: a.threadId, body: a.body };
      if (a.subject !== undefined) body.subject = a.subject;
      return await proxyRequest('POST', '/api/v1/onebox/send', body);
    }
    case 'reachinbox_onebox_mark_all_read':
      return await proxyRequest('POST', '/api/v1/onebox/mark-all-read', {});

    case 'reachinbox_onebox_unread_count':
      return await proxyRequest('POST', '/api/v1/onebox/unread-count', {});

    case 'reachinbox_onebox_search':
      return await proxyRequest('POST', '/api/v1/onebox/liveInbox/unifiedSearch', {
        query: a.query,
        page:  a.page ?? 1,
      });

    // ── Tags ──────────────────────────────────────────────────────────────────
    case 'reachinbox_tag_list':
      return await proxyRequest('GET', '/api/v1/others/listAllTags', {});

    // ── Webhooks ──────────────────────────────────────────────────────────────
    case 'reachinbox_webhook_list':
      return await proxyRequest('GET', '/api/v1/webhook/list-all', {});

    case 'reachinbox_webhook_subscribe':
      return await proxyRequest('POST', '/api/v1/webhook/subscribe', {
        campaignId:   a.campaignId,
        event:        a.event,
        callbackUrl:  a.callbackUrl,
        allCampaigns: a.allCampaigns ?? false,
      });

    case 'reachinbox_webhook_unsubscribe':
      return await proxyRequest('POST', '/api/v1/webhook/unsubscribe', {
        campaignId:  a.campaignId,
        event:       a.event,
        callbackUrl: a.callbackUrl,
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
  const server = new Server(
    { name: 'reachinbox-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleTool(name, args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: err.message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
