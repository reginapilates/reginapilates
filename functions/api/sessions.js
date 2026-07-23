// functions/api/sessions.js
// 개편: 세션 생성/수정 시 Contracts DB UsedSessions 카운터 업데이트

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
    // GET — 계약별/회원별 세션 목록 조회
    if (method === 'GET') {
      const url = new URL(request.url);
      const contractId = url.searchParams.get('contractId');
      const memberId = url.searchParams.get('memberId');

      const lastVisitOnly = url.searchParams.get('lastVisitOnly') === 'true';
      const filter = contractId
        ? { filter: { property: 'Contract', relation: { contains: contractId } } }
        : memberId
          ? { filter: { property: 'Member', relation: { contains: memberId } } }
          : {};

      // 페이지네이션으로 전체 조회
      let allResults = [];
      let hasMore = true;
      let startCursor = undefined;

      while (hasMore) {
        const qBody = {
          ...filter,
          sorts: [{ property: 'Date', direction: 'descending' }],
          page_size: 100,
        };
        if (startCursor) qBody.start_cursor = startCursor;

        const response = await fetch(
          `https://api.notion.com/v1/databases/${env.NOTION_SESSIONS_DB_ID}/query`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(qBody),
          }
        );
        const data = await response.json();
        allResults = allResults.concat(data.results || []);
        hasMore = data.has_more || false;
        startCursor = data.next_cursor;
      }

      // lastVisitOnly: 마지막 방문일 집계용 - 최소 필드만 반환
      if (lastVisitOnly) {
        const sessions = allResults.map(page => ({
          memberId: page.properties.Member?.relation?.[0]?.id || '',
          date: page.properties.Date?.date?.start || '',
          attendanceStatus: page.properties.AttendanceStatus?.select?.name || '',
        }));
        return new Response(JSON.stringify({ sessions }), { headers });
      }

      const sessions = allResults.map(page => ({
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

    // POST — 새 세션 기록
    if (method === 'POST') {
      const body = await request.json();
      const { memberName, contractId, memberId, scheduleId } = body;

      // 중복 방지: 이 Schedule에 이미 연결된 세션 있는지 확인
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
            body: JSON.stringify({ filter: { property: 'Schedule', relation: { contains: scheduleId } } }),
          }
        );
        const dupData = await dupRes.json();
        if ((dupData.results || []).length > 0) {
          // 기존 세션 업데이트만 (UsedSessions 변경 없음)
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

      // 현재 계약의 UsedSessions 조회 → 회차 계산
      let sessionNo = 1;
      let currentUsed = 0;
      if (contractId) {
        const contractPage = await fetch(`https://api.notion.com/v1/pages/${contractId}`, {
          headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
        });
        const contractData = await contractPage.json();
        currentUsed = contractData.properties?.UsedSessions?.number || 0;
        sessionNo = currentUsed + 1;
      }

      const isAttended = body.attendanceStatus === '참석' || body.attendanceStatus === '노쇼';
      const title = `${memberName} #${sessionNo}`;

      // 세션 생성 + (참석일 때만) UsedSessions +1 병렬 실행
      const [sessionRes] = await Promise.all([
        fetch('https://api.notion.com/v1/pages', {
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
              Condition: (body.condition && body.condition !== '—') ? { select: { name: body.condition } } : undefined,
              Memo: { rich_text: [{ text: { content: body.memo || '' } }] },
              AttendanceStatus: body.attendanceStatus ? { select: { name: body.attendanceStatus } } : undefined,
              Time: body.time ? { select: { name: body.time } } : undefined,
              Instructor: body.instructorId ? { relation: [{ id: body.instructorId }] } : undefined,
              Schedule: body.scheduleId ? { relation: [{ id: body.scheduleId }] } : undefined,
            },
          }),
        }),
        // 참석일 때만 UsedSessions +1
        (contractId && isAttended) ? fetch(`https://api.notion.com/v1/pages/${contractId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: { UsedSessions: { number: currentUsed + 1 } },
          }),
        }) : Promise.resolve(),
      ]);

      const sessionData = await sessionRes.json();
      if (!sessionRes.ok) {
        return new Response(JSON.stringify({ error: sessionData.message || 'Session creation failed' }), { status: 500, headers });
      }

      return new Response(JSON.stringify({ id: sessionData.id, sessionNo, success: true }), { headers });
    }

    // PUT — 세션 수정 (컨디션/메모/날짜/출석상태)
    if (method === 'PUT') {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('id');
      const body = await request.json();

      // 출석 상태 변경 시 UsedSessions 조정
      // prevAttendanceStatus: 이전 상태를 클라이언트에서 전달
      if (body.attendanceStatus && body.prevAttendanceStatus !== undefined && body.contractId) {
        const wasAttended = body.prevAttendanceStatus === '참석' || body.prevAttendanceStatus === '노쇼';
        const isNowAttended = body.attendanceStatus === '참석' || body.attendanceStatus === '노쇼';

        if (!wasAttended && isNowAttended) {
          // 결석/취소 → 참석: +1
          const cp = await fetch(`https://api.notion.com/v1/pages/${body.contractId}`, {
            headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
          });
          const cd = await cp.json();
          const cur = cd.properties?.UsedSessions?.number || 0;
          await fetch(`https://api.notion.com/v1/pages/${body.contractId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: { UsedSessions: { number: cur + 1 } } }),
          });
        } else if (wasAttended && !isNowAttended) {
          // 참석 → 결석/취소: -1
          const cp = await fetch(`https://api.notion.com/v1/pages/${body.contractId}`, {
            headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
          });
          const cd = await cp.json();
          const cur = cd.properties?.UsedSessions?.number || 0;
          await fetch(`https://api.notion.com/v1/pages/${body.contractId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
            body: JSON.stringify({ properties: { UsedSessions: { number: Math.max(0, cur - 1) } } }),
          });
        }
      }

      const properties = {};
      if (body.condition) properties.Condition = { select: { name: body.condition } };
      if (body.memo !== undefined) properties.Memo = { rich_text: [{ text: { content: body.memo } }] };
      if (body.date) properties.Date = { date: { start: body.date } };
      if (body.attendanceStatus) properties.AttendanceStatus = { select: { name: body.attendanceStatus } };

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

    // DELETE — 세션 삭제 + UsedSessions -1
    if (method === 'DELETE') {
      const url = new URL(request.url);
      const sessionId = url.searchParams.get('id');
      const contractId = url.searchParams.get('contractId');
      const prevAttendanceStatus = url.searchParams.get('prevStatus') || '';

      // 세션 archive
      await fetch(`https://api.notion.com/v1/pages/${sessionId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ archived: true }),
      });

      // 참석/노쇼였으면 UsedSessions -1
      if (contractId && (prevAttendanceStatus === '참석' || prevAttendanceStatus === '노쇼')) {
        try {
          const cp = await fetch(`https://api.notion.com/v1/pages/${contractId}`, {
            headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
          });
          const cd = await cp.json();
          const cur = cd.properties?.UsedSessions?.number || 0;
          await fetch(`https://api.notion.com/v1/pages/${contractId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${env.NOTION_API_KEY}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ properties: { UsedSessions: { number: Math.max(0, cur - 1) } } }),
          });
        } catch(e) {}
      }

      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
