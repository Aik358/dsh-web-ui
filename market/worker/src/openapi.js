/**
 * OpenAPI 3.1.0 description of the dsh-market.com edge API. Served at
 * GET /openapi.json and linked from the API catalog as service-desc.
 */
export default {
  openapi: '3.1.0',
  info: {
    title: 'DSH Web UI Marketplace API',
    version: '1.0.0',
    description: 'Edge API of dsh-market.com: vote counts, device-gated likes, Turnstile challenges and skin asset delivery for the DSH Web UI marketplace.',
  },
  servers: [{ url: 'https://dsh-market.com' }],
  paths: {
    '/api': {
      get: {
        summary: 'API service information',
        responses: { 200: { description: 'Service info and catalog link' } },
      },
    },
    '/api/health': {
      get: {
        summary: 'Health check',
        responses: { 200: { description: 'Alive' } },
      },
    },
    '/api/stats': {
      get: {
        summary: 'Vote counts per kind and asset id',
        responses: { 200: { description: 'Vote counts' } },
      },
    },
    '/api/install': {
      post: {
        summary: 'Record one successful Workshop install (skins, pets or community plugins); one event per install, Turnstile-gated',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['kind', 'asset_id', 'device_fp', 'install_id', 'turnstile_token'],
                properties: {
                  kind: { type: 'string', enum: ['skin', 'pet', 'plugin'] },
                  asset_id: { type: 'string' },
                  device_fp: { type: 'string' },
                  install_id: { type: 'string' },
                  turnstile_token: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Install recorded; returns the refreshed cumulative install count' },
          400: { description: 'Invalid parameters or JSON' },
          403: { description: 'Turnstile challenge missing or invalid' },
        },
      },
    },
    '/api/like': {
      post: {
        summary: 'Like or unlike an asset (one vote per device, Turnstile-gated)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['kind', 'asset_id', 'device_fp'],
                properties: {
                  kind: { type: 'string', enum: ['skin', 'pet', 'plugin'] },
                  asset_id: { type: 'string' },
                  device_fp: { type: 'string' },
                  turnstile_token: { type: 'string' },
                  unlike: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Like recorded; returns ok, liked and votes' },
          400: { description: 'Invalid parameters or JSON' },
          403: { description: 'Turnstile verification failed' },
        },
      },
    },
    '/api/turnstile/challenge': {
      get: {
        summary: 'Turnstile challenge page for the market card',
        responses: { 200: { description: 'HTML challenge page' } },
      },
    },
    '/api/telemetry/event': {
      post: {
        summary: 'Record one anonymous usage event (site pageview or plugin heartbeat)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['kind', 'visitor'],
                properties: {
                  kind: { type: 'string', enum: ['pageview', 'heartbeat'] },
                  visitor: { type: 'string', description: 'Random client-generated id; hashed with a server salt before storage' },
                  path: { type: 'string', description: 'Site path, pageview kind only' },
                  items: {
                    type: 'array',
                    description: 'Reported package names, heartbeat kind only',
                    items: {
                      type: 'object',
                      required: ['name'],
                      properties: {
                        name: { type: 'string', description: 'Package name or asset id (e.g. skin:harbor)' },
                        version: { type: 'string' },
                        channel: { type: 'string', enum: ['market', 'npm', 'unknown'], description: 'Install channel hint when determinable' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Event accepted (duplicates collapse per day)' },
          400: { description: 'Invalid parameters or JSON' },
        },
      },
    },
    '/api/telemetry/summary': {
      get: {
        summary: 'Aggregate UV/PV summary; counts only, never raw events',
        parameters: [
          { name: 'days', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 365 } },
          { name: 'paths_limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, description: 'Hot-path page size' },
          { name: 'paths_offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Hot-path page offset; the full count is site.paths_total' },
          { name: 'items_limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 200 }, description: 'Heartbeat-item page size' },
          { name: 'items_offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Heartbeat-item page offset; the full count is plugins.totals.items' },
        ],
        responses: {
          200: { description: 'Per-day and per-item aggregates for site pageviews and plugin heartbeats; hot paths and items are paginated, totals included' },
          403: { description: 'TELEMETRY_READ_KEY configured and not presented' },
        },
      },
    },
    '/api/npm-badge/downloads': {
      get: {
        summary: 'Shields endpoint badge: monthly npm downloads summed over the current and legacy aggregate package names',
        responses: { 200: { description: 'Shields endpoint schema (schemaVersion 1)' } },
      },
    },
    '/api/npm-badge/version': {
      get: {
        summary: 'Shields endpoint badge: latest aggregate version across the current and legacy package names',
        responses: { 200: { description: 'Shields endpoint schema (schemaVersion 1)' } },
      },
    },
    '/api/npm-badge/total': {
      get: {
        summary: 'Shields endpoint badge: all-time cumulative npm downloads summed over every published family package (both aggregate names included)',
        responses: { 200: { description: 'Shields endpoint schema (schemaVersion 1)' } },
      },
    },
    '/api/npm-downloads': {
      get: {
        summary: 'Last-30d npm downloads for every npm-backed plugin in the served manifest; npm registry public data, not Workshop install counts',
        responses: {
          200: { description: 'JSON map of npm package name to last-30d download count' },
          503: { description: 'Plugin manifest unreadable' },
        },
      },
    },
    '/api/telemetry/badge/users': {
      get: {
        summary: 'Shields endpoint badge: all-time distinct heartbeat visitors (anonymous install count); aggregate only, no key required',
        responses: { 200: { description: 'Shields endpoint schema (schemaVersion 1)' } },
      },
    },
    '/api/skin-center/v2/skins/{skinId}/{asset}': {
      get: {
        summary: 'Skin asset (stylesheet, patches, hooks.mjs, assets/*, preview/*)',
        parameters: [
          { name: 'skinId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'asset', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Skin asset' },
          404: { description: 'Skin or asset not found' },
        },
      },
    },
  },
}
