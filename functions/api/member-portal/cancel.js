// functions/api/member-portal/cancel.js

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  if (method === 'POST' || method === 'PUT') {
    const body = await request.json();
    const { scheduleId, token, memberId } = body;

    // 토큰 재검증
    const mRes = await fetch(`https://api.notion.com/v1/pages/${memberId}`, {
      headers: {
        'Authorization': `Bearer ${env.NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      },
    });
    const mData = await mRes.json();
    const storedToken = mData.properties?.Token?.rich_text?.[0]?.plain_text || '';

    if (storedToken !== token) {
      return new Response(JSON.stringify({ error: '인증 실패' }), { status: 401, headers });
    }

    await fetch(`https://api.notion.com/v1/pages/${scheduleId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: { Status: { select: { name: '취소' } } } }),
    });

    return new Response(JSON.stringify({ success: true }), { headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}
