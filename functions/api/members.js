// functions/api/members.js

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  try {
    if (method === 'GET') {
      const response = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_MEMBERS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sorts: [{ property: 'CreatedAt', direction: 'descending' }],
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error', data }), { status: 500, headers });
      }

      const results = data.results || [];
      const members = results.map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        phone: page.properties.Phone?.phone_number || '',
        email: page.properties.Email?.email || '',
        birthDate: page.properties.BirthDate?.date?.start || '',
        address: page.properties.Address?.rich_text?.[0]?.plain_text || '',
        height: page.properties.Height?.number || null,
        weight: page.properties.Weight?.number || null,
        pilatesExp: page.properties.PilatesExp?.select?.name || '',
        painHistory: page.properties.PainHistory?.rich_text?.[0]?.plain_text || '',
        surgery: page.properties.Surgery?.checkbox || false,
        surgeryDetail: page.properties.SurgeryDetail?.rich_text?.[0]?.plain_text || '',
        visitSource: page.properties.VisitSource?.select?.name || '',
        marketingConsent: page.properties.MarketingConsent?.checkbox || false,
        adConsent: page.properties.AdConsent?.checkbox || false,
        createdAt: page.properties.CreatedAt?.date?.start || '',
      }));

      const url = new URL(request.url);
      const search = url.searchParams.get('search') || '';
      const filtered = search
        ? members.filter(m => m.name.includes(search) || m.phone.includes(search))
        : members;

      return new Response(JSON.stringify({ members: filtered }), { headers });
    }

    if (method === 'POST') {
      const body = await request.json();

      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: env.NOTION_MEMBERS_DB_ID },
          properties: {
            Name: { title: [{ text: { content: body.name } }] },
            Email: body.email ? { email: body.email } : undefined,
            Phone: body.phone ? { phone_number: body.phone } : undefined,
            BirthDate: body.birthDate ? { date: { start: body.birthDate } } : undefined,
            Address: { rich_text: [{ text: { content: body.address || '' } }] },
            Height: body.height ? { number: body.height } : undefined,
            Weight: body.weight ? { number: body.weight } : undefined,
            PilatesExp: body.pilatesExp ? { select: { name: body.pilatesExp } } : undefined,
            PainHistory: { rich_text: [{ text: { content: body.painHistory || '' } }] },
            Surgery: { checkbox: body.surgery || false },
            SurgeryDetail: { rich_text: [{ text: { content: body.surgeryDetail || '' } }] },
            VisitSource: body.visitSource ? { select: { name: body.visitSource } } : undefined,
            MarketingConsent: { checkbox: body.marketingConsent || false },
            AdConsent: { checkbox: body.adConsent || false },
            CreatedAt: { date: { start: new Date().toISOString().split('T')[0] } },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error', data }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ id: data.id, success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
