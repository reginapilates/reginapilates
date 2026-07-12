// functions/api/programs.js

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
        `https://api.notion.com/v1/databases/${env.NOTION_PROGRAMS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sorts: [{ property: 'Name', direction: 'ascending' }],
          }),
        }
      );

      const data = await response.json();

      // Notion API 오류 처리
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error', data }), { status: 500, headers });
      }

      const results = data.results || [];
      const programs = results.map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        type: page.properties.Type?.select?.name || '',
        instructor: page.properties.Instructor?.rich_text?.[0]?.plain_text || '',
        sessions: page.properties.Sessions?.number || 0,
        pricePerSession: page.properties.PricePerSession?.number || 0,
        totalPrice: page.properties.TotalPrice?.formula?.number || 0,
        discount: page.properties.Discount?.number || 0,
        finalPrice: page.properties.FinalPrice?.formula?.number || 0,
        isActive: page.properties.IsActive?.checkbox || false,
      }));

      const activePrograms = programs.filter(p => p.isActive);
      return new Response(JSON.stringify({ programs: activePrograms, all: programs }), { headers });
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
          parent: { database_id: env.NOTION_PROGRAMS_DB_ID },
          properties: {
            Name: { title: [{ text: { content: body.name } }] },
            Type: body.type ? { select: { name: body.type } } : undefined,
            Instructor: { rich_text: [{ text: { content: body.instructor || '' } }] },
            Sessions: { number: body.sessions || 0 },
            PricePerSession: { number: body.pricePerSession || 0 },
            Discount: { number: body.discount || 0 },
            IsActive: { checkbox: body.isActive !== false },
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
