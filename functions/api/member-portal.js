// functions/api/member-portal.js
// 회원 개인 포털 API - 토큰 + 연락처 인증

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;
  const url = new URL(request.url);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (method === 'OPTIONS') return new Response(null, { headers });

  try {
    // POST /api/member-portal/auth — 토큰 + 연락처 인증
    if (method === 'POST' && url.pathname.endsWith('/auth')) {
      const body = await request.json();
      const { token, phone } = body;

      if (!token || !phone) {
        return new Response(JSON.stringify({ error: '토큰과 연락처를 입력해주세요' }), { status: 400, headers });
      }

      // Members DB에서 토큰으로 회원 찾기
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

      // 연락처 확인 (하이픈 제거 후 비교)
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

    // GET /api/member-portal — 회원 포털 데이터 (토큰 인증 필요)
    if (method === 'GET') {
      const token = url.searchParams.get('token');
      const memberId = url.searchParams.get('memberId');

      if (!token || !memberId) {
        return new Response(JSON.stringify({ error: '인증 정보가 없습니다' }), { status: 401, headers });
      }

      // 토큰 재검증
      const mRes = await fetch(`https://api.notion.com/v1/pages/${memberId}`, {
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
        },
      });
      const mData = await mRes.json();
      const memberToken = mData.properties?.Token?.rich_text?.[0]?.plain_text || '';

      if (memberToken !== token) {
        return new Response(JSON.stringify({ error: '인증 실패' }), { status: 401, headers });
      }

      const memberName = mData.properties?.Name?.title?.[0]?.plain_text || '';

      // 계약 조회
      const cRes = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_CONTRACTS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: { property: 'Member', relation: { contains: memberId } },
            sorts: [{ property: 'SignedAt', direction: 'descending' }],
          }),
        }
      );
      const cData = await cRes.json();
      const contracts = (cData.results || []).map(p => ({
        id: p.id,
        title: p.properties.Name?.title?.[0]?.plain_text || '',
        sessions: p.properties.Sessions?.number || 0,
        startDate: p.properties.StartDate?.date?.start || '',
        endDate: p.properties.EndDate?.date?.start || '',
        status: p.properties.Status?.select?.name || '',
      }));

      // 활성 계약 세션 수 계산
      const activeContracts = contracts.filter(c => c.status === '진행중' || c.status === '일시정지');
      for (const c of activeContracts) {
        const sRes = await fetch(
          `https://api.notion.com/v1/databases/${env.NOTION_SESSIONS_DB_ID}/query`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filter: { property: 'Contract', relation: { contains: c.id } },
            }),
          }
        );
        const sData = await sRes.json();
        c.usedSessions = (sData.results || []).length;
        c.remainingSessions = Math.max(0, c.sessions - c.usedSessions);
      }

      // 예약 일정 조회 (오늘 이후)
      const today = new Date();
      const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

      const schRes = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_SCHEDULE_DB_ID}/query`,
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
                { property: 'Member', relation: { contains: memberId } },
                { property: 'Type', select: { equals: '회원예약' } },
              ]
            },
            sorts: [{ property: 'Date', direction: 'ascending' }],
          }),
        }
      );
      const schData = await schRes.json();

      // 강사 이름 조회
      const instrIds = [...new Set((schData.results||[]).map(p => p.properties.Instructor?.relation?.[0]?.id).filter(Boolean))];
      const instrMap = {};
      for (const iId of instrIds) {
        try {
          const iRes = await fetch(`https://api.notion.com/v1/pages/${iId}`, {
            headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
          });
          const iData = await iRes.json();
          instrMap[iId] = iData.properties?.Name?.title?.[0]?.plain_text || '';
        } catch(e) {}
      }

      const schedules = (schData.results || [])
        .map(p => ({
          id: p.id,
          date: p.properties.Date?.date?.start || '',
          time: p.properties.Time?.select?.name || '',
          instructorName: instrMap[p.properties.Instructor?.relation?.[0]?.id] || '',
          status: p.properties.Status?.select?.name || '확정',
          contractId: p.properties.Contract?.relation?.[0]?.id || '',
        }))
        .filter(s => s.date >= todayStr && s.status !== '취소');

      return new Response(JSON.stringify({
        memberName,
        contracts: activeContracts,
        schedules,
        today: todayStr,
      }), { headers });
    }

    // PUT /api/member-portal/cancel — 예약 취소
    if (method === 'PUT' && url.pathname.endsWith('/cancel')) {
      const body = await request.json();
      const { scheduleId, token, memberId } = body;

      // 토큰 재검증
      const mRes = await fetch(`https://api.notion.com/v1/pages/${memberId}`, {
        headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
      });
      const mData = await mRes.json();
      if (mData.properties?.Token?.rich_text?.[0]?.plain_text !== token) {
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

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
}
