/**
 * Vercel Serverless Function: /api/contact
 * Receives form data and sends it to amoCRM as a Lead + Contact.
 *
 * Required Vercel Environment Variables:
 *   AMOCRM_TOKEN        — Bearer access token from amoCRM private integration
 *   AMOCRM_SUBDOMAIN    — e.g. "restacompany"  (without .amocrm.ru)
 *   AMOCRM_PIPELINE_ID  — e.g. "32149382"
 *   AMOCRM_REFRESH_TOKEN — refresh token (used to auto-renew access token)
 *   AMOCRM_CLIENT_ID    — integration client_id
 *   AMOCRM_CLIENT_SECRET — integration client_secret
 */

const SUBDOMAIN     = process.env.AMOCRM_SUBDOMAIN    || 'restacompany';
const PIPELINE_ID   = parseInt(process.env.AMOCRM_PIPELINE_ID || '32149382');
const BASE_URL      = `https://${SUBDOMAIN}.amocrm.ru`;

/**
 * Refresh the access token using the refresh token.
 * Returns new { access_token, refresh_token } or null on failure.
 */
async function refreshAccessToken() {
    const body = {
        client_id:     process.env.AMOCRM_CLIENT_ID,
        client_secret: process.env.AMOCRM_CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: process.env.AMOCRM_REFRESH_TOKEN,
        redirect_uri:  'https://resta-uz.vercel.app',
    };

    const res = await fetch(`${BASE_URL}/oauth2/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!res.ok) return null;
    return await res.json();
}

/**
 * Make an authenticated request to amoCRM API.
 * If 401, tries to refresh the token and retries once.
 */
async function amoRequest(path, payload, token) {
    const doRequest = async (t) =>
        fetch(`${BASE_URL}${path}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${t}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify(payload),
        });

    let res = await doRequest(token);

    // If unauthorized, try to refresh
    if (res.status === 401) {
        const newTokens = await refreshAccessToken();
        if (newTokens?.access_token) {
            // Note: to persist new tokens you need Vercel KV or similar storage.
            // For now we retry with the refreshed token for this request.
            res = await doRequest(newTokens.access_token);
        }
    }

    return res;
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    const { name, phone, company, message } = req.body || {};

    if (!name || !phone) {
        return res.status(400).json({ error: 'name va phone majburiy' });
    }

    const TOKEN = process.env.AMOCRM_TOKEN;
    if (!TOKEN) {
        console.error('AMOCRM_TOKEN env variable missing');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    try {
        // ── 1. Create Contact ────────────────────────────────────────────────
        const contactPayload = [
            {
                name,
                custom_fields_values: [
                    {
                        field_code: 'PHONE',
                        values: [{ value: phone, enum_code: 'WORK' }],
                    },
                ],
            },
        ];

        const contactRes = await amoRequest('/api/v4/contacts', contactPayload, TOKEN);

        let contactId = null;
        if (contactRes.ok) {
            const contactData = await contactRes.json();
            contactId = contactData?._embedded?.contacts?.[0]?.id ?? null;
        } else {
            console.warn('Contact creation failed:', contactRes.status, await contactRes.text());
        }

        // ── 2. Create Lead ───────────────────────────────────────────────────
        const leadPayload = [
            {
                name:        `${name} — Resta sayt`,
                pipeline_id: PIPELINE_ID,
                // Attach contact if created
                ...(contactId && {
                    _embedded: {
                        contacts: [{ id: contactId }],
                    },
                }),
                // Store extra info as note-style custom fields if they exist
                ...(company || message
                    ? {
                          custom_fields_values: [
                              ...(company
                                  ? [{ field_code: 'COMPANY', values: [{ value: company }] }]
                                  : []),
                          ],
                      }
                    : {}),
            },
        ];

        const leadRes = await amoRequest('/api/v4/leads', leadPayload, TOKEN);

        if (!leadRes.ok) {
            const errText = await leadRes.text();
            console.error('Lead creation failed:', leadRes.status, errText);
            return res.status(502).json({ error: 'amoCRM lead creation failed', detail: errText });
        }

        const leadData = await leadRes.json();
        const leadId   = leadData?._embedded?.leads?.[0]?.id ?? null;

        // ── 3. Add Note with full message ────────────────────────────────────
        if (leadId && message) {
            const notePayload = [
                {
                    entity_id:  leadId,
                    note_type:  'common',
                    params:     { text: `Xabar: ${message}\nKompaniya: ${company || '—'}\nManba: Resta sayt forma` },
                },
            ];
            await amoRequest('/api/v4/leads/notes', notePayload, TOKEN);
        }

        return res.status(200).json({ success: true, leadId });
    } catch (err) {
        console.error('amoCRM integration error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
