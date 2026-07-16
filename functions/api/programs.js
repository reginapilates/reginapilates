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
    // GET — 프로그램 목록 조회
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
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error', data }), { status: 500, headers });
      }

      const results = data.results || [];

      // 강사 ID 목록 수집 → 이름 조회
      const instructorIds = [...new Set(results
        .map(p => p.properties.Instructor?.relation?.[0]?.id)
        .filter(Boolean)
      )];

      const instructorMap = {};
      for (const id of instructorIds) {
        try {
          const iRes = await fetch(`https://api.notion.com/v1/pages/${id}`, {
            headers: {
              'Authorization': `Bearer ${env.NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
            },
          });
          const iData = await iRes.json();
          instructorMap[id] = iData.properties?.Name?.title?.[0]?.plain_text || '';
        } catch(e) {}
      }

      const programs = results.map(page => {
        const instructorId = page.properties.Instructor?.relation?.[0]?.id || '';
        return {
          id: page.id,
          name: page.properties.Name?.title?.[0]?.plain_text || '',
          type: page.properties.Type?.select?.name || '',
          instructorId,
          instructor: instructorMap[instructorId] || '',
          sessions: page.properties.Sessions?.number || 0,
          pricePerSession: page.properties.PricePerSession?.number || 0,
          totalPrice: page.properties.TotalPrice?.formula?.number ||
            page.properties.TotalPrice?.number || 0,
          discount: page.properties.Discount?.number || 0,
          finalPrice: page.properties.FinalPrice?.formula?.number ||
            page.properties.FinalPrice?.number || 0,
          duration: page.properties.Duration?.number || null,
          isActive: page.properties.IsActive?.checkbox || false,
        isTrial: page.properties.IsTrial?.checkbox || false,
        };
      });

      const activePrograms = programs.filter(p => p.isActive);
      return new Response(JSON.stringify({ programs: activePrograms, all: programs }), { headers });
    }

    // POST — 신규 프로그램 등록
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
            Instructor: body.instructorId ? { relation: [{ id: body.instructorId }] } : undefined,
            Sessions: { number: body.sessions || 0 },
            PricePerSession: { number: body.pricePerSession || 0 },
            Discount: { number: body.discount || 0 },
            Duration: body.duration ? { number: body.duration } : undefined,
            IsActive: { checkbox: body.isActive !== false },
            IsTrial: { checkbox: body.isTrial || false },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error', data }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ id: data.id, success: true }), { headers });
    }

    // PUT — 프로그램 수정
    if (method === 'PUT') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });

      const body = await request.json();

      const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            Name: { title: [{ text: { content: body.name } }] },
            Type: body.type ? { select: { name: body.type } } : undefined,
            Instructor: body.instructorId ? { relation: [{ id: body.instructorId }] } : undefined,
            Sessions: { number: body.sessions || 0 },
            PricePerSession: { number: body.pricePerSession || 0 },
            Discount: { number: body.discount || 0 },
            Duration: body.duration ? { number: body.duration } : undefined,
            IsActive: { checkbox: body.isActive !== false },
            IsTrial: { checkbox: body.isTrial || false },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error' }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // DELETE — 프로그램 삭제 (Notion에서는 archive 처리)
    if (method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });

      const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ archived: true }),
      });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message || 'Notion API error' }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
