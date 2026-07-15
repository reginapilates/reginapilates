// functions/api/sessions.js
// 세션 목록 조회 + 출석 기록

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

  try {
    // GET — 계약별 세션 목록 조회
    if (method === 'GET') {
      const url = new URL(request.url);
      const contractId = url.searchParams.get('contractId');
      const memberId = url.searchParams.get('memberId');

      const filter = contractId ? {
        filter: {
          property: 'Contract',
          relation: { contains: contractId }
        }
      } : memberId ? {
        filter: {
          property: 'Member',
          relation: { contains: memberId }
        }
      } : {};

      const response = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_SESSIONS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...filter,
            sorts: [{ property: 'Date', direction: 'descending' }],
          }),
        }
      );

      const data = await response.json();
      const sessions = data.results.map(page => ({
        id: page.id,
        title: page.properties.Name?.title?.[0]?.plain_text || '',
        contractId: page.properties.Contract?.relation?.[0]?.id || '',
        memberId: page.properties.Member?.relation?.[0]?.id || '',
        sessionNo: page.properties.SessionNo?.number || 0,
        date: page.properties.Date?.date?.start || '',
        condition: page.properties.Condition?.select?.name || '',
        memo: page.properties.Memo?.rich_text?.[0]?.plain_text || '',
        attended: page.properties.AttendanceStatus?.select?.name === '참석' || false,
        attendanceStatus: page.properties.AttendanceStatus?.select?.name || '',
        time: page.properties.Time?.select?.name || '',
        instructorId: page.properties.Instructor?.relation?.[0]?.id || '',
      }));

      return new Response(JSON.stringify({ sessions }), { headers });
    }

    // POST — 새 세션 기록 (출석 체크)
    if (method === 'POST') {
      const body = await request.json();
      const { memberName, contractId, memberId } = body;

      // 1. 이미 이 Schedule에 연결된 세션이 있는지 확인 (중복 방지)
      const scheduleId = body.scheduleId;
      if (scheduleId) {
        const dupRes = await fetch(
          `https://api.notion.com/v1/databases/${env.NOTION_SESSIONS_DB_ID}/query`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filter: { property: 'Schedule', relation: { contains: scheduleId } },
            }),
          }
        );
        const dupData = await dupRes.json();
        if ((dupData.results || []).length > 0) {
          // 이미 세션 있음 → 기존 세션 업데이트만
          const existingSession = dupData.results[0];
          await fetch(`https://api.notion.com/v1/pages/${existingSession.id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              properties: {
                AttendanceStatus: body.attendanceStatus ? { select: { name: body.attendanceStatus } } : undefined,
                Condition: (body.condition && body.condition !== '—') ? { select: { name: body.condition } } : undefined,
                Memo: { rich_text: [{ text: { content: body.memo || '' } }] },
              },
            }),
          });
          return new Response(JSON.stringify({ id: existingSession.id, updated: true, success: true }), { headers });
        }
      }

      // DB에서 현재 세션 수 조회 → 회차 계산
      const existingRes = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_SESSIONS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: contractId ? {
              property: 'Contract',
              relation: { contains: contractId }
            } : undefined,
          }),
        }
      );
      const existingData = await existingRes.json();
      const sessionNo = (existingData.results?.length || 0) + 1;

      // 잔여횟수는 Sessions DB 개수로 자동 계산되므로 별도 조회 불필요

      const title = `${memberName} #${sessionNo}`;

      // 3. 세션 생성
      const sessionRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: env.NOTION_SESSIONS_DB_ID },
          properties: {
            Name: { title: [{ text: { content: title } }] },
            Contract: contractId ? { relation: [{ id: contractId }] } : undefined,
            Member: memberId ? { relation: [{ id: memberId }] } : undefined,
            SessionNo: { number: sessionNo },
            Date: { date: { start: body.date || new Date().toISOString().split('T')[0] } },
            Condition: (body.condition && body.condition !== '—')
              ? { select: { name: body.condition } } : undefined,
            Memo: { rich_text: [{ text: { content: body.memo || '' } }] },
            AttendanceStatus: body.attendanceStatus ? { select: { name: body.attendanceStatus } } : undefined,
            Time: body.time ? { select: { name: body.time } } : undefined,
            Instructor: body.instructorId ? { relation: [{ id: body.instructorId }] } : undefined,
            Schedule: body.scheduleId ? { relation: [{ id: body.scheduleId }] } : undefined,
          },
        }),
      });

      const sessionData2 = await sessionRes.json();

      if (!sessionRes.ok) {
        return new Response(JSON.stringify({
          error: sessionData2.message || 'Session creation failed',
          details: sessionData2
        }), { status: 500, headers });
      }

      // RemainingSessions 필드 업데이트 불필요 - Sessions DB 개수로 자동 계산됨

      return new Response(JSON.stringify({
        id: sessionData2.id,
        sessionNo,
        success: true
      }), { headers });
    }

    // PUT — 세션 수정 (컨디션/메모 업데이트)
    if (method === 'PUT') {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('id');
      const body = await request.json();

      const properties = {};
      if (body.condition) properties.Condition = { select: { name: body.condition } };
      if (body.memo !== undefined) properties.Memo = { rich_text: [{ text: { content: body.memo } }] };
      if (body.date) properties.Date = { date: { start: body.date } };

      await fetch(`https://api.notion.com/v1/pages/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties }),
      });

      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
