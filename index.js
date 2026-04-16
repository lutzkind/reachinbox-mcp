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

function normalizeCampaignCopyBehavior(behavior = {}) {
  return {
    includeName: Boolean(behavior.includeName ?? false),
    includeOptions: behavior.includeOptions !== false,
    includeSchedule: behavior.includeSchedule !== false,
    includeSequences: behavior.includeSequences !== false,
    includeSubsequences: behavior.includeSubsequences !== false,
  };
}

function buildCampaignUpdateOptionsPayload(source = {}) {
  const payload = {};
  const allowedKeys = [
    'stopOnReply',
    'stopOnDomainReply',
    'tracking',
    'linkTracking',
    'deliveryOptimizations',
    'dailyLimit',
    'blockquote',
    'notificationEmail',
    'allowRiskyEmails',
    'unsubscribeHeader',
    'maxNewLeads',
    'autoOptimizeAzMetric',
    'prioritizeNewLeads',
    'prioritizeSubsequenceLeads',
    'globalUnsubscribe',
    'opportunity',
    'automaticReschedule',
    'providerMatchingEnabled',
    'targetLeadEsp',
    'bounceProtection',
    'pausedByBounceProtection',
    'aiTimeGapsEnabled',
    'bounceProtectionThreshold',
    'cc',
    'bcc',
    'aiReplies',
    'accountsToUse',
    'exclude',
  ];

  for (const key of allowedKeys) {
    if (source[key] !== undefined) payload[key] = source[key];
  }

  const minimumExtraDelay = source.minimumExtraDelay ?? source.minExtraDelay;
  if (minimumExtraDelay !== undefined) payload.minimumExtraDelay = minimumExtraDelay;

  const maximumExtraDelay = source.maximumExtraDelay ?? source.maxExtraDelay;
  if (maximumExtraDelay !== undefined) payload.maximumExtraDelay = maximumExtraDelay;

  if (payload.exclude === undefined) payload.exclude = [];
  return payload;
}

function buildCampaignSchedulePayload(source = {}) {
  const schedules = Array.isArray(source.schedules) ? source.schedules : [];
  return {
    startDate: source.startDate,
    endDate: source.endDate,
    schedules: schedules.map((schedule) => ({
      name: schedule.name,
      timing: {
        from: schedule.timeFrom ?? schedule.timing?.from,
        to: schedule.timeTo ?? schedule.timing?.to,
      },
      timezone: schedule.timezone,
      days: schedule.days,
    })),
  };
}

function buildCampaignSequencePayload(source = {}, details = {}) {
  const payload = {};
  if (source.sequences !== undefined) payload.sequences = source.sequences;
  const coreVariables = source.coreVariables ?? details.coreVariables;
  if (coreVariables !== undefined) payload.coreVariables = coreVariables;
  return payload;
}

function extractSubsequenceRows(response) {
  const data = response?.data ?? response;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.subsequences)) return data.subsequences;
  return [];
}

function sanitizeSubsequencePayload(source = {}) {
  const payload = {};
  const ignoredKeys = new Set([
    'id',
    'subsequenceId',
    'subSequenceId',
    'campaignId',
    'userId',
    'workspaceId',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'status',
    'statusConnection',
    'statusMessage',
  ]);

  for (const [key, value] of Object.entries(source)) {
    if (ignoredKeys.has(key) || value === undefined) continue;
    payload[key] = value;
  }

  return payload;
}

function normalizeLeadForImport(lead = {}) {
  const normalizedLead = {};
  const ignoredKeys = new Set([
    'id',
    'leadsListId',
    'leadFinderId',
    'validationStatus',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ]);

  for (const [key, value] of Object.entries(lead)) {
    if (ignoredKeys.has(key)) continue;

    if (key === 'attributes' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [attributeKey, attributeValue] of Object.entries(value)) {
        if (attributeValue !== undefined && attributeValue !== null && attributeValue !== '') {
          normalizedLead[attributeKey] = attributeValue;
        }
      }
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      normalizedLead[key] = value;
    }
  }

  return normalizedLead;
}

async function fetchLeadListLeads(options) {
  const rows = [];
  let analytics = {};
  let currentOffset = options.offset;
  const pageSize = Math.max(1, options.limit);
  const targetCount = options.returnAll ? Number.POSITIVE_INFINITY : Math.max(1, options.maxLeads);

  while (rows.length < targetCount) {
    const path = `/api/v1/leads-list/all-leads?leadsListId=${options.listId}&lastLead=${options.lastLead ? 'true' : 'false'}&limit=${pageSize}&offset=${currentOffset}`;
    const response = await proxyRequest('GET', path, {});
    const data = response?.data ?? {};
    const pageRows = Array.isArray(data.rows) ? data.rows : [];
    analytics = data.analytics ?? {};
    rows.push(...pageRows);

    if (!options.returnAll || pageRows.length < pageSize) break;
    currentOffset += pageRows.length;
  }

  const slicedRows = rows.slice(0, targetCount);
  return {
    status: 200,
    message: 'Lead list leads',
    data: {
      analytics,
      rows: slicedRows,
      count: slicedRows.length,
      leadsListId: options.listId,
    },
  };
}

async function addLeadListToCampaign(listId, campaignId) {
  const leadListId = Number(listId);
  const targetCampaignId = Number(campaignId);

  let result = await proxyRequest('POST', '/api/v1/lead-list/copy-leads-to-campaign', {
    campaignId: targetCampaignId,
    leadsListId: leadListId,
  });

  if (result?.status !== 404) return result;

  result = await proxyRequest('POST', '/api/v1/leads-list/copy-leads-to-campaign', {
    campaignId: targetCampaignId,
    leadsListId: leadListId,
  });

  if (result?.status !== 404) return result;

  const leadListResponse = await fetchLeadListLeads({
    listId: leadListId,
    limit: 100,
    offset: 0,
    returnAll: true,
    maxLeads: Number.POSITIVE_INFINITY,
    lastLead: false,
  });

  const rows = Array.isArray(leadListResponse?.data?.rows) ? leadListResponse.data.rows : [];
  const uniqueEmails = [...new Set(rows
    .map((lead) => String((lead.email ?? lead.attributes?.email ?? '')).trim().toLowerCase())
    .filter((email) => email.includes('@')))];

  if (!uniqueEmails.length) {
    return {
      status: 200,
      message: 'No valid emails found in lead list to add to campaign.',
      data: [],
    };
  }

  const batchSize = 100;
  const responses = [];
  for (let emailIndex = 0; emailIndex < uniqueEmails.length; emailIndex += batchSize) {
    const emails = uniqueEmails.slice(emailIndex, emailIndex + batchSize);
    responses.push(await proxyRequest('POST', '/api/v1/campaigns/add-email', {
      campaignId: targetCampaignId,
      emails,
    }));
  }

  return {
    status: 200,
    message: 'Added lead list emails to campaign using add-email fallback.',
    data: {
      leadsListId: leadListId,
      campaignId: targetCampaignId,
      totalEmails: uniqueEmails.length,
      batches: responses.length,
      responses,
    },
  };
}

async function getCampaignSettingsBundle(campaignId) {
  const [
    detailsResponse,
    optionsResponse,
    scheduleResponse,
    sequencesResponse,
    subsequenceListResponse,
  ] = await Promise.all([
    proxyRequest('GET', `/api/v1/campaign/details?campaignId=${campaignId}`, {}),
    proxyRequest('GET', `/api/v1/campaign/options?campaignId=${campaignId}`, {}),
    proxyRequest('GET', `/api/v1/campaign/schedule?campaignId=${campaignId}`, {}),
    proxyRequest('GET', `/api/v1/campaign/sequences?campaignId=${campaignId}`, {}),
    proxyRequest('GET', `/api/v1/subsequence/list?campaignId=${campaignId}`, {}),
  ]);

  const subsequenceRows = extractSubsequenceRows(subsequenceListResponse);
  const subsequenceDetails = await Promise.all(subsequenceRows.map(async (row) => {
    const subsequenceId = Number(row.subsequenceId ?? row.id ?? row.subSequenceId ?? 0);
    if (!subsequenceId) return row;
    const response = await proxyRequest('GET', `/api/v1/subsequence/details?subsequenceId=${subsequenceId}`, {});
    return response?.data ?? response;
  }));

  return {
    status: 200,
    message: 'Campaign settings bundle',
    data: {
      campaignId,
      details: detailsResponse?.data ?? detailsResponse,
      options: optionsResponse?.data ?? optionsResponse,
      schedule: scheduleResponse?.data ?? scheduleResponse,
      sequences: sequencesResponse?.data ?? sequencesResponse,
      subsequences: subsequenceDetails,
    },
  };
}

async function applyCampaignSettingsBundle(campaignId, bundle = {}, behavior = {}) {
  const options = normalizeCampaignCopyBehavior(behavior);
  const details = bundle.details ?? {};
  const campaignOptions = bundle.options ?? {};
  const schedule = bundle.schedule ?? {};
  const sequences = bundle.sequences ?? {};
  const subsequences = Array.isArray(bundle.subsequences) ? bundle.subsequences : [];
  const responses = {};

  if (options.includeName && details.name) {
    responses.update = await proxyRequest('POST', '/api/v1/campaign/update', {
      campaignId: Number(campaignId),
      name: details.name,
    });
  }

  if (options.includeOptions && Object.keys(campaignOptions).length > 0) {
    responses.updateOptions = await proxyRequest('POST', '/api/v1/campaign/update-options', {
      campaignId: String(campaignId),
      ...buildCampaignUpdateOptionsPayload(campaignOptions),
    });
  }

  if (options.includeSchedule && Object.keys(schedule).length > 0) {
    responses.saveSchedule = await proxyRequest('POST', '/api/v1/schedule/add', {
      campaignId: String(campaignId),
      ...buildCampaignSchedulePayload(schedule),
    });
  }

  if (options.includeSequences && Object.keys(sequences).length > 0) {
    responses.saveSequences = await proxyRequest('POST', '/api/v1/sequences/add', {
      campaignId: String(campaignId),
      ...buildCampaignSequencePayload(sequences, details),
    });
  }

  if (options.includeSubsequences && subsequences.length > 0) {
    const targetSubsequenceResponse = await proxyRequest('GET', `/api/v1/subsequence/list?campaignId=${campaignId}`, {});
    const targetSubsequences = extractSubsequenceRows(targetSubsequenceResponse);
    const targetByName = new Map();

    for (const row of targetSubsequences) {
      const name = String(row.name ?? '').trim();
      if (name) targetByName.set(name, row);
    }

    const subsequenceResults = [];
    for (const sourceSubsequence of subsequences) {
      const payload = sanitizeSubsequencePayload(sourceSubsequence);
      const name = String(payload.name ?? '').trim();
      if (!name) continue;

      const existing = targetByName.get(name);
      if (existing) {
        const subsequenceId = Number(existing.subsequenceId ?? existing.id ?? existing.subSequenceId ?? 0);
        if (!subsequenceId) continue;
        subsequenceResults.push(await proxyRequest('POST', '/api/v1/subsequence/update', {
          subsequenceId,
          ...payload,
        }));
      } else {
        subsequenceResults.push(await proxyRequest('POST', '/api/v1/subsequence/create', {
          campaignId: Number(campaignId),
          ...payload,
        }));
      }
    }

    responses.subsequences = subsequenceResults;
  }

  return {
    status: 200,
    message: 'Applied campaign settings bundle',
    data: {
      campaignId,
      behavior: options,
      responses,
    },
  };
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
    name: 'reachinbox_campaign_options',
    description: 'Get campaign options and configuration details',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_schedule',
    description: 'Get campaign schedule details',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_list_accounts',
    description: 'List accounts attached to a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        limit: { type: 'number', description: 'Maximum accounts to return', default: 5 },
      },
    },
  },
  {
    name: 'reachinbox_campaign_list_accounts_errors',
    description: 'List account errors for a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        limit: { type: 'number', description: 'Maximum errors to return', default: 5 },
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
  {
    name: 'reachinbox_campaign_delete',
    description: 'Delete a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_get_settings_bundle',
    description: 'Get a full editable settings bundle for a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_apply_settings_bundle',
    description: 'Apply a settings bundle to a campaign',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'bundle'],
      properties: {
        campaignId: { type: 'number', description: 'Target campaign ID' },
        bundle: { type: 'object', description: 'Bundle from reachinbox_campaign_get_settings_bundle' },
        behavior: {
          type: 'object',
          description: 'Optional toggles for which parts of the bundle to apply',
          properties: {
            includeName: { type: 'boolean' },
            includeOptions: { type: 'boolean' },
            includeSchedule: { type: 'boolean' },
            includeSequences: { type: 'boolean' },
            includeSubsequences: { type: 'boolean' },
          },
        },
      },
    },
  },
  {
    name: 'reachinbox_campaign_copy_settings',
    description: 'Copy settings from one campaign to another',
    inputSchema: {
      type: 'object',
      required: ['sourceCampaignId', 'targetCampaignId'],
      properties: {
        sourceCampaignId: { type: 'number', description: 'Source campaign ID' },
        targetCampaignId: { type: 'number', description: 'Target campaign ID' },
        behavior: {
          type: 'object',
          description: 'Optional toggles for which parts of the bundle to copy',
          properties: {
            includeName: { type: 'boolean' },
            includeOptions: { type: 'boolean' },
            includeSchedule: { type: 'boolean' },
            includeSequences: { type: 'boolean' },
            includeSubsequences: { type: 'boolean' },
          },
        },
      },
    },
  },
  {
    name: 'reachinbox_campaign_update_options',
    description: 'Update the full campaign options payload',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'payload'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        payload: { type: 'object', description: 'Options payload to send to /api/v1/campaign/update-options' },
      },
    },
  },
  {
    name: 'reachinbox_campaign_save_schedule',
    description: 'Replace the campaign schedule payload',
    inputSchema: {
      type: 'object',
      required: ['campaignId', 'payload'],
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        payload: { type: 'object', description: 'Schedule payload to send to /api/v1/schedule/add' },
      },
    },
  },

  // ── Schedule template tools ───────────────────────────────────────────────
  {
    name: 'reachinbox_schedule_template_list',
    description: 'List schedule templates',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'reachinbox_schedule_template_create',
    description: 'Create a schedule template',
    inputSchema: {
      type: 'object',
      required: ['payload'],
      properties: {
        payload: { type: 'object', description: 'Schedule template payload' },
      },
    },
  },
  {
    name: 'reachinbox_schedule_template_update',
    description: 'Update a schedule template',
    inputSchema: {
      type: 'object',
      required: ['scheduleTemplateId', 'payload'],
      properties: {
        scheduleTemplateId: { type: 'number', description: 'Schedule template ID' },
        payload: { type: 'object', description: 'Schedule template payload' },
      },
    },
  },
  {
    name: 'reachinbox_schedule_template_delete',
    description: 'Delete a schedule template',
    inputSchema: {
      type: 'object',
      required: ['scheduleTemplateId'],
      properties: {
        scheduleTemplateId: { type: 'number', description: 'Schedule template ID' },
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
        search: { type: 'string', description: 'Optional substring filter for list names' },
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
  {
    name: 'reachinbox_lead_list_get_leads',
    description: 'Get leads from a lead list',
    inputSchema: {
      type: 'object',
      required: ['listId'],
      properties: {
        listId: { type: 'number', description: 'Lead list ID' },
        limit: { type: 'number', description: 'Page size', default: 50 },
        offset: { type: 'number', description: 'Pagination offset', default: 0 },
        returnAll: { type: 'boolean', description: 'Paginate until all rows are collected', default: true },
        maxLeads: { type: 'number', description: 'Maximum leads to return when returnAll=false', default: 100 },
        lastLead: { type: 'boolean', description: 'Use lastLead=true source ordering', default: false },
      },
    },
  },
  {
    name: 'reachinbox_lead_list_update',
    description: 'Rename or update a lead list',
    inputSchema: {
      type: 'object',
      required: ['listId', 'name'],
      properties: {
        listId: { type: 'number', description: 'Lead list ID' },
        name: { type: 'string', description: 'New lead list name' },
      },
    },
  },
  {
    name: 'reachinbox_lead_list_add_to_campaign',
    description: 'Add all leads from a lead list to a campaign',
    inputSchema: {
      type: 'object',
      required: ['listId', 'campaignId'],
      properties: {
        listId: { type: 'number', description: 'Lead list ID' },
        campaignId: { type: 'number', description: 'Target campaign ID' },
      },
    },
  },
  {
    name: 'reachinbox_lead_list_delete',
    description: 'Delete a lead list',
    inputSchema: {
      type: 'object',
      required: ['listId'],
      properties: {
        listId: { type: 'number', description: 'Lead list ID' },
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

  // ── Blocklist tools ─────────────────────────────────────────────────────────
  {
    name: 'reachinbox_blocklist_add',
    description: 'Add emails, domains, keywords, or reply keywords to the blocklist',
    inputSchema: {
      type: 'object',
      properties: {
        emails:          { type: 'array', items: { type: 'string' }, description: 'Email addresses to block' },
        domains:         { type: 'array', items: { type: 'string' }, description: 'Domains to block' },
        keywords:        { type: 'array', items: { type: 'string' }, description: 'Subject/body keywords to block' },
        repliesKeywords: { type: 'array', items: { type: 'string' }, description: 'Reply keywords to block' },
      },
    },
  },
  {
    name: 'reachinbox_blocklist_get',
    description: 'Get blocklist entries. Optionally filter by table: emails, domains, keywords, repliesKeywords',
    inputSchema: {
      type: 'object',
      properties: {
        table:  { type: 'string', description: 'emails | domains | keywords | repliesKeywords (omit for all)' },
        limit:  { type: 'number', description: 'Max entries to return' },
        offset: { type: 'number', description: 'Pagination offset' },
        q:      { type: 'string', description: 'Search query' },
      },
    },
  },
  {
    name: 'reachinbox_blocklist_delete',
    description: 'Remove entries from the blocklist by value',
    inputSchema: {
      type: 'object',
      required: ['table', 'ids'],
      properties: {
        table: { type: 'string', description: 'emails | domains | keywords | repliesKeywords' },
        ids:   { type: 'array', items: { type: 'string' }, description: 'Values to remove' },
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

    case 'reachinbox_campaign_options': {
      const qs = buildQueryString({ campaignId: a.campaignId });
      return await proxyRequest('GET', `/api/v1/campaign/options${qs}`, {});
    }

    case 'reachinbox_campaign_schedule': {
      const qs = buildQueryString({ campaignId: a.campaignId });
      return await proxyRequest('GET', `/api/v1/campaign/schedule${qs}`, {});
    }

    case 'reachinbox_campaign_list_accounts': {
      const qs = buildQueryString({ campaignId: a.campaignId, limit: a.limit ?? 5 });
      return await proxyRequest('GET', `/api/v1/campaign/list-accounts${qs}`, {});
    }

    case 'reachinbox_campaign_list_accounts_errors': {
      const qs = buildQueryString({ campaignId: a.campaignId, limit: a.limit ?? 5 });
      return await proxyRequest('GET', `/api/v1/campaign/list-accounts-errors${qs}`, {});
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
    case 'reachinbox_campaign_delete':
      return await proxyRequest('DELETE', `/api/v1/campaign/delete?campaignId=${Number(a.campaignId)}`, {});

    case 'reachinbox_campaign_get_settings_bundle':
      return await getCampaignSettingsBundle(Number(a.campaignId));

    case 'reachinbox_campaign_apply_settings_bundle':
      return await applyCampaignSettingsBundle(Number(a.campaignId), a.bundle, a.behavior ?? {});

    case 'reachinbox_campaign_copy_settings': {
      const bundleResponse = await getCampaignSettingsBundle(Number(a.sourceCampaignId));
      const bundle = bundleResponse?.data ?? {};
      const result = await applyCampaignSettingsBundle(Number(a.targetCampaignId), bundle, a.behavior ?? {});
      result.sourceCampaignId = Number(a.sourceCampaignId);
      result.targetCampaignId = Number(a.targetCampaignId);
      return result;
    }

    case 'reachinbox_campaign_update_options':
      return await proxyRequest('POST', '/api/v1/campaign/update-options', {
        campaignId: String(a.campaignId),
        ...buildCampaignUpdateOptionsPayload(a.payload),
      });

    case 'reachinbox_campaign_save_schedule':
      return await proxyRequest('POST', '/api/v1/schedule/add', {
        campaignId: String(a.campaignId),
        ...buildCampaignSchedulePayload(a.payload),
      });

    // ── Schedule templates ───────────────────────────────────────────────────
    case 'reachinbox_schedule_template_list':
      return await proxyRequest('GET', '/api/v1/schedule/templates', {});

    case 'reachinbox_schedule_template_create':
      return await proxyRequest('POST', '/api/v1/schedule/save-template', a.payload);

    case 'reachinbox_schedule_template_update':
      return await proxyRequest('PUT', `/api/v1/schedule/template/${Number(a.scheduleTemplateId)}`, a.payload);

    case 'reachinbox_schedule_template_delete':
      return await proxyRequest('DELETE', `/api/v1/schedule/template/${Number(a.scheduleTemplateId)}`, {});

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
      const qs = buildQueryString({ limit: a.limit ?? 50, contains: a.search });
      return await proxyRequest('GET', `/api/v1/leads-list/all${qs}`, {});
    }
    case 'reachinbox_lead_list_create':
      return await proxyRequest('POST', '/api/v1/leads-list/create', { name: a.name });

    case 'reachinbox_lead_list_add_leads': {
      const normalizedLeads = (Array.isArray(a.leads) ? a.leads : []).map((lead) => normalizeLeadForImport(lead));
      const newCoreVariables = [...new Set(normalizedLeads.flatMap((lead) => Object.keys(lead).filter((key) => key !== 'email')))];
      return await proxyRequest('POST', '/api/v1/leads-list/add-leads', {
        leadsListId: Number(a.listId),
        leads: normalizedLeads,
        newCoreVariables,
        duplicates: [],
      });
    }

    case 'reachinbox_lead_list_get_leads':
      return await fetchLeadListLeads({
        listId: Number(a.listId),
        limit: a.limit ?? 50,
        offset: a.offset ?? 0,
        returnAll: a.returnAll ?? true,
        maxLeads: a.maxLeads ?? 100,
        lastLead: a.lastLead ?? false,
      });

    case 'reachinbox_lead_list_update':
      return await proxyRequest('PUT', '/api/v1/leads-list/update', {
        leadsListId: Number(a.listId),
        name: a.name,
      });

    case 'reachinbox_lead_list_add_to_campaign':
      return await addLeadListToCampaign(a.listId, a.campaignId);

    case 'reachinbox_lead_list_delete':
      return await proxyRequest('DELETE', `/api/v1/leads-list/delete?leadsListId=${Number(a.listId)}`, {});

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

    // ── Blocklist ─────────────────────────────────────────────────────────────
    case 'reachinbox_blocklist_add':
      return await proxyRequest('POST', '/api/v1/blocklist/add', {
        emails:          a.emails          || [],
        domains:         a.domains         || [],
        keywords:        a.keywords        || [],
        repliesKeywords: a.repliesKeywords || [],
      });

    case 'reachinbox_blocklist_get': {
      const path = a.table ? `/api/v1/blocklist/${a.table}` : '/api/v1/blocklist';
      const qs = buildQueryString({
        limit:  a.limit,
        offset: a.offset,
        q:      a.q,
      });
      return await proxyRequest('GET', `${path}${qs}`, {});
    }

    case 'reachinbox_blocklist_delete':
      return await proxyRequest('DELETE', `/api/v1/blocklist/${a.table}`, { ids: a.ids });

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
