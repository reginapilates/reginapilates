// functions/api/member-portal/auth.js

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  if (method === 'POST') {
    const body = await request.json();
    const { token, phone } = body;

    if (!token || !phone) {
      return new Response(JSON.stringify({ error: '토큰과 연락처를 입력해주세요' }), { status: 400, headers });
    }

    const res = await fetch(
      `https://api.notion.com/v1/databases/${env.NOTION_MEMBERS_DB_ID}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: { property: 'Token', rich_text: { equals: token } },
        }),
      }
    );

    const data = await res.json();
    const member = data.results?.[0];

    if (!member) {
      return new Response(JSON.stringify({ error: '유효하지 않은 링크입니다' }), { status: 401, headers });
    }

    const memberPhone = (member.properties.Phone?.phone_number || '').replace(/-/g, '');
    const inputPhone = phone.replace(/-/g, '');

    if (memberPhone !== inputPhone) {
      return new Response(JSON.stringify({ error: '연락처가 일치하지 않습니다' }), { status: 401, headers });
    }

    return new Response(JSON.stringify({
      success: true,
      memberId: member.id,
      memberName: member.properties.Name?.title?.[0]?.plain_text || '',
    }), { headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}
