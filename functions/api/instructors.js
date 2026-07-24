// functions/api/instructors.js

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
    // GET — 강사 목록
    if (method === 'GET') {
      const res = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_INSTRUCTORS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sorts: [{ property: 'Level', direction: 'ascending' }],
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });

      const instructors = (data.results || []).map(page => ({
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        phone: page.properties.Phone?.phone_number || '',
        email: page.properties.Email?.email || '',
        level: page.properties.Level?.select?.name || '',
        isActive: page.properties.IsActive?.checkbox || false,
        loginId: page.properties.LoginId?.rich_text?.[0]?.plain_text || '',
        loginPassword: page.properties.LoginPassword?.rich_text?.[0]?.plain_text || '',
      }));

      return new Response(JSON.stringify({ instructors }), { headers });
    }

    // POST — 강사 등록
    if (method === 'POST') {
      const body = await request.json();
      const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: env.NOTION_INSTRUCTORS_DB_ID },
          properties: {
            Name: { title: [{ text: { content: body.name } }] },
            Phone: body.phone ? { phone_number: body.phone } : undefined,
            Email: body.email ? { email: body.email } : undefined,
            Level: body.level ? { select: { name: body.level } } : undefined,
            IsActive: { checkbox: body.isActive !== false },
            LoginId: body.loginId ? { rich_text: [{ text: { content: body.loginId } }] } : undefined,
            LoginPassword: body.loginPassword ? { rich_text: [{ text: { content: body.loginPassword } }] } : undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
      return new Response(JSON.stringify({ id: data.id, success: true }), { headers });
    }

    // PUT — 강사 수정
    if (method === 'PUT') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      const body = await request.json();
      const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: {
            Name: { title: [{ text: { content: body.name } }] },
            Phone: body.phone ? { phone_number: body.phone } : undefined,
            Email: body.email ? { email: body.email } : undefined,
            Level: body.level ? { select: { name: body.level } } : undefined,
            IsActive: { checkbox: body.isActive !== false },
            LoginId: body.loginId !== undefined ? { rich_text: [{ text: { content: body.loginId } }] } : undefined,
            LoginPassword: body.loginPassword !== undefined ? { rich_text: [{ text: { content: body.loginPassword } }] } : undefined,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    // DELETE — 강사 삭제 (archive)
    if (method === 'DELETE') {
      const url = new URL(request.url);
      const id = url.searchParams.get('id');
      const res = await fetch(`https://api.notion.com/v1/pages/${id}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ archived: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
