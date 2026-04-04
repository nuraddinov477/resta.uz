/**
 * Vercel Serverless Function: /api/contact
 * Receives form data and:
 *   1. Sends email to abbosmirziyoyev1@gmail.com
 *   2. Creates Lead + Contact in amoCRM
 *
 * Required Vercel Environment Variables:
 *   GMAIL_USER           — Gmail address used to send (e.g. abbosmirziyoyev1@gmail.com)
 *   GMAIL_PASS           — Gmail App Password (not regular password)
 *   AMOCRM_TOKEN         — Bearer access token from amoCRM private integration
 *   AMOCRM_SUBDOMAIN     — e.g. "restacompany"
 *   AMOCRM_PIPELINE_ID   — e.g. "32149382"
 *   AMOCRM_REFRESH_TOKEN
 *   AMOCRM_CLIENT_ID
 *   AMOCRM_CLIENT_SECRET
 */

import nodemailer from 'nodemailer';

const SUBDOMAIN   = process.env.AMOCRM_SUBDOMAIN  || 'restacompany';
const PIPELINE_ID = parseInt(process.env.AMOCRM_PIPELINE_ID || '32149382');
const BASE_URL    = `https://${SUBDOMAIN}.amocrm.ru`;

async function refreshAccessToken() {
    const res = await fetch(`${BASE_URL}/oauth2/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id:     process.env.AMOCRM_CLIENT_ID,
            client_secret: process.env.AMOCRM_CLIENT_SECRET,
            grant_type:    'refresh_token',
            refresh_token: process.env.AMOCRM_REFRESH_TOKEN,
            redirect_uri:  'https://resta-uz.vercel.app',
        }),
    });
    if (!res.ok) return null;
    return await res.json();
}

async function amoRequest(path, payload, token) {
    const doRequest = (t) => fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    let res = await doRequest(token);
    if (res.status === 401) {
        const newTokens = await refreshAccessToken();
        if (newTokens?.access_token) res = await doRequest(newTokens.access_token);
    }
    return res;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    const { name, phone, company, message } = req.body || {};

    if (!name || !phone) {
        return res.status(400).json({ error: 'name va phone majburiy' });
    }

    try {
        // ── 1. Email yuborish ────────────────────────────────────────────────
        if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
            });
            await transporter.sendMail({
                from: `"RESTA Sayt" <${process.env.GMAIL_USER}>`,
                to: 'abbosmirziyoyev1@gmail.com',
                subject: `Yangi murojaat: ${name} — ${phone}`,
                html: `
                    <div style="font-family:Arial,sans-serif;max-width:500px">
                        <h2 style="color:#1a3575">Yangi murojaat — RESTA sayt</h2>
                        <p><b>Ism:</b> ${name}</p>
                        <p><b>Telefon:</b> <a href="tel:${phone}">${phone}</a></p>
                        ${company ? `<p><b>Kompaniya:</b> ${company}</p>` : ''}
                        ${message ? `<p><b>Xabar:</b> ${message}</p>` : ''}
                        <hr style="margin-top:20px">
                        <small style="color:#888">RESTA.uz sayt formasi orqali yuborildi</small>
                    </div>
                `,
            }).catch(err => console.error('Email error:', err));
        }

        // ── 2. amoCRM: Contact + Lead ────────────────────────────────────────
        const TOKEN = process.env.AMOCRM_TOKEN;
        if (TOKEN) {
            const contactRes = await amoRequest('/api/v4/contacts', [{
                name,
                custom_fields_values: [{
                    field_code: 'PHONE',
                    values: [{ value: phone, enum_code: 'WORK' }],
                }],
            }], TOKEN);

            let contactId = null;
            if (contactRes.ok) {
                const data = await contactRes.json();
                contactId = data?._embedded?.contacts?.[0]?.id ?? null;
            }

            const leadPayload = [{
                name: `${name} — Resta sayt`,
                pipeline_id: PIPELINE_ID,
                ...(contactId && { _embedded: { contacts: [{ id: contactId }] } }),
            }];

            const leadRes = await amoRequest('/api/v4/leads', leadPayload, TOKEN);
            if (leadRes.ok) {
                const leadData = await leadRes.json();
                const leadId = leadData?._embedded?.leads?.[0]?.id ?? null;
                if (leadId && message) {
                    await amoRequest('/api/v4/leads/notes', [{
                        entity_id: leadId,
                        note_type: 'common',
                        params: { text: `Xabar: ${message}\nManba: Resta sayt forma` },
                    }], TOKEN);
                }
            }
        }

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Contact handler error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
