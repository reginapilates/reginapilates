// functions/api/auth.js

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const body = await request.json();
  const { password, loginId, loginPassword } = body;

  // ── 강사 ID/PW 로그인 (instructor.html 전용) ──
  if (loginId && loginPassword) {
    try {
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
            filter: {
              and: [
                { property: 'LoginId', rich_text: { equals: loginId } },
                { property: 'IsActive', checkbox: { equals: true } },
              ]
            }
          }),
        }
      );
      const data = await res.json();
      const page = (data.results || [])[0];

      if (!page) {
        return new Response(JSON.stringify({ success: false, error: 'not_found' }), { headers });
      }

      const storedPw = page.properties.LoginPassword?.rich_text?.[0]?.plain_text || '';
      if (storedPw !== loginPassword) {
        return new Response(JSON.stringify({ success: false, error: 'wrong_password' }), { headers });
      }

      const instructor = {
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || '',
        level: page.properties.Level?.select?.name || '2',
        isDirector: page.properties.Level?.select?.name === '1',
      };

      return new Response(JSON.stringify({
        success: true,
        level: parseInt(instructor.level) || 2,
        instructor,
      }), { headers });

    } catch(e) {
      return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers });
    }
  }

  // ── 기존 admin 비밀번호 로그인 ──
  if (password) {
    if (password === env.ADMIN_PASSWORD_L1) {
      return new Response(JSON.stringify({ success: true, level: 1 }), { headers });
    }
    if (password === env.ADMIN_PASSWORD_L2) {
      return new Response(JSON.stringify({ success: true, level: 2 }), { headers });
    }
    return new Response(JSON.stringify({ success: false }), { headers });
  }

  return new Response(JSON.stringify({ success: false, error: 'no_credentials' }), { headers });
}
