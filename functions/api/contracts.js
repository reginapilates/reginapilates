// functions/api/contracts.js
// 개편: Sessions N+1 제거 (UsedSessions 필드), Programs/Instructors 병렬 쿼리

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
    // GET — 회원별 또는 전체 계약 목록
    if (method === 'GET') {
      const url = new URL(request.url);

      // 서명 데이터 전용 엔드포인트
      if (url.pathname.endsWith('/signature')) {
        const id = url.searchParams.get('id');
        if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers });
        const response = await fetch(`https://api.notion.com/v1/pages/${id}`, {
          headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
        });
        const data = await response.json();
        const signatureData =
          (data.properties?.SignatureData?.rich_text?.[0]?.plain_text || '') +
          (data.properties?.SignatureData2?.rich_text?.[0]?.plain_text || '') +
          (data.properties?.SignatureData3?.rich_text?.[0]?.plain_text || '');
        return new Response(JSON.stringify({ signatureData }), { headers });
      }

      const memberId = url.searchParams.get('memberId');
      const filterBody = memberId
        ? { filter: { property: 'Member', relation: { contains: memberId } } }
        : {};

      // 1. 계약 전체 조회 (페이지네이션)
      let allResults = [];
      let hasMore = true;
      let startCursor = undefined;
      while (hasMore) {
        const qBody = {
          ...filterBody,
          sorts: [{ property: 'SignedAt', direction: 'descending' }],
          page_size: 100,
        };
        if (startCursor) qBody.start_cursor = startCursor;

        const response = await fetch(
          `https://api.notion.com/v1/databases/${env.NOTION_CONTRACTS_DB_ID}/query`,
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
        if (!response.ok) return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
        allResults = allResults.concat(data.results || []);
        hasMore = data.has_more || false;
        startCursor = data.next_cursor;
      }

      const rawContracts = allResults.map(page => ({
        id: page.id,
        title: page.properties.Name?.title?.[0]?.plain_text || '',
        memberId: page.properties.Member?.relation?.[0]?.id || '',
        programId: page.properties.Program?.relation?.[0]?.id || '',
        sessions: page.properties.Sessions?.number || 0,
        // UsedSessions 필드에서 직접 읽기 (N+1 제거 핵심)
        usedSessions: page.properties.UsedSessions?.number || 0,
        totalAmount: page.properties.TotalAmount?.number || 0,
        paymentMethod: page.properties.PaymentMethod?.select?.name || '',
        startDate: page.properties.StartDate?.date?.start || '',
        endDate: page.properties.EndDate?.date?.start || '',
        signedAt: page.properties.SignedAt?.date?.start || '',
        signatureData: (page.properties.SignatureData?.rich_text?.[0]?.plain_text || '') +
          (page.properties.SignatureData2?.rich_text?.[0]?.plain_text || '') +
          (page.properties.SignatureData3?.rich_text?.[0]?.plain_text || ''),
        driveLink: page.properties.DriveLink?.url || '',
        status: page.properties.Status?.select?.name || '',
        pauseDate: page.properties.PauseDate?.date?.start || '',
        resumeDate: page.properties.ResumeDate?.date?.start || '',
        note: page.properties.Note?.rich_text?.[0]?.plain_text || '',
      }));

      // 2. Programs → Instructors 병렬 조회 (순차 N번 → 병렬 1라운드)
      const programIds = [...new Set(rawContracts.map(c => c.programId).filter(Boolean))];
      const programPages = await Promise.all(
        programIds.map(pid =>
          fetch(`https://api.notion.com/v1/pages/${pid}`, {
            headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
          }).then(r => r.json()).catch(() => null)
        )
      );

      // 강사 ID 수집 → 병렬 조회
      const instructorIdMap = {}; // programId → instructorId
      programIds.forEach((pid, i) => {
        instructorIdMap[pid] = programPages[i]?.properties?.Instructor?.relation?.[0]?.id || '';
      });
      const instructorIds = [...new Set(Object.values(instructorIdMap).filter(Boolean))];
      const instructorPages = await Promise.all(
        instructorIds.map(iid =>
          fetch(`https://api.notion.com/v1/pages/${iid}`, {
            headers: { 'Authorization': `Bearer ${env.NOTION_API_KEY}`, 'Notion-Version': '2022-06-28' },
          }).then(r => r.json()).catch(() => null)
        )
      );
      const instructorNameMap = {}; // instructorId → name
      instructorIds.forEach((iid, i) => {
        instructorNameMap[iid] = instructorPages[i]?.properties?.Name?.title?.[0]?.plain_text || '';
      });

      const programInstructorMap = {}; // programId → { instructorId, instructorName, isTrial }
      programIds.forEach((pid, i) => {
        const iid = instructorIdMap[pid] || '';
        const isTrial = programPages[i]?.properties?.IsTrial?.checkbox || false;
        programInstructorMap[pid] = { instructorId: iid, instructorName: instructorNameMap[iid] || '', isTrial };
      });

      // 3. 잔여 계산 + 자동 만료 처리 (Sessions DB 쿼리 없음)
      const today = new Date().toISOString().split('T')[0];

      const autoExpirePromises = [];
      const contracts = rawContracts.map(c => {
        const remainingSessions = Math.max(0, c.sessions - c.usedSessions);
        const instrInfo = programInstructorMap[c.programId] || {};

        // 자동 만료 처리 (진행중인 계약만)
        if (c.status === '진행중') {
          const isExpired = c.endDate && c.endDate < today;
          const isDepleted = remainingSessions === 0 && c.sessions > 0;
          if (isExpired || isDepleted) {
            autoExpirePromises.push(
              fetch(`https://api.notion.com/v1/pages/${c.id}`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${env.NOTION_API_KEY}`,
                  'Notion-Version': '2022-06-28',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ properties: { Status: { select: { name: '완료' } } } }),
              }).catch(() => {})
            );
            c.status = '완료';
          }
        }

        return {
          ...c,
          remainingSessions,
          instructorId: instrInfo.instructorId || '',
          instructorName: instrInfo.instructorName || '',
          isTrial: instrInfo.isTrial || false,
        };
      });

      // 자동 만료 처리 병렬 실행 (응답 기다리지 않음 - fire & forget)
      if (autoExpirePromises.length > 0) Promise.all(autoExpirePromises).catch(() => {});

      return new Response(JSON.stringify({ contracts }), { headers });
    }

    // POST — 새 계약 생성
    if (method === 'POST') {
      const body = await request.json();
      const { memberName, programName, pdfBase64, ...contractData } = body;

      let driveLink = '';
      let driveError = '';
      if (pdfBase64) {
        try {
          driveLink = await uploadToDrive(env, pdfBase64, memberName, contractData.signedAt);
        } catch(e) {
          driveError = e.message;
        }
      }

      const title = programName;
      const notionRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          parent: { database_id: env.NOTION_CONTRACTS_DB_ID },
          properties: {
            Name: { title: [{ text: { content: title } }] },
            Member: contractData.memberId ? { relation: [{ id: contractData.memberId }] } : undefined,
            Program: contractData.programId ? { relation: [{ id: contractData.programId }] } : undefined,
            Sessions: { number: contractData.sessions || 0 },
            UsedSessions: { number: 0 }, // 신규 계약은 0으로 초기화
            TotalAmount: { number: contractData.totalAmount || 0 },
            PaymentMethod: contractData.paymentMethod ? { select: { name: contractData.paymentMethod } } : undefined,
            StartDate: contractData.startDate ? { date: { start: contractData.startDate } } : undefined,
            EndDate: contractData.endDate ? { date: { start: contractData.endDate } } : undefined,
            SignedAt: { date: { start: new Date().toISOString().split('T')[0] } },
            DriveLink: driveLink ? { url: driveLink } : undefined,
            Status: { select: { name: '진행중' } },
            SignatureData: contractData.signatureData ? {
              rich_text: [{ text: { content: contractData.signatureData.substring(0, 1900) } }]
            } : undefined,
            SignatureData2: contractData.signatureData && contractData.signatureData.length > 1900 ? {
              rich_text: [{ text: { content: contractData.signatureData.substring(1900, 3800) } }]
            } : undefined,
            SignatureData3: contractData.signatureData && contractData.signatureData.length > 3800 ? {
              rich_text: [{ text: { content: contractData.signatureData.substring(3800, 5700) } }]
            } : undefined,
            Note: { rich_text: [{ text: { content: contractData.note || '' } }] },
          },
        }),
      });

      const notionData = await notionRes.json();
      if (!notionRes.ok) {
        return new Response(JSON.stringify({ error: notionData.message, details: notionData }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ id: notionData.id, driveLink, driveError, success: true }), { headers });
    }

    // PUT — 계약 상태 업데이트
    if (method === 'PUT') {
      const url = new URL(request.url);
      const contractId = url.searchParams.get('id');
      const body = await request.json();

      const properties = {};
      if (body.status) properties.Status = { select: { name: body.status } };
      if (body.pauseDate) properties.PauseDate = { date: { start: body.pauseDate } };
      else if (body.pauseDate === null) properties.PauseDate = { date: null };
      if (body.resumeDate) properties.ResumeDate = { date: { start: body.resumeDate } };
      else if (body.resumeDate === null) properties.ResumeDate = { date: null };
      if (body.endDate) properties.EndDate = { date: { start: body.endDate } };
      if (body.note !== undefined) properties.Note = { rich_text: [{ text: { content: body.note } }] };

      const response = await fetch(`https://api.notion.com/v1/pages/${contractId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${env.NOTION_API_KEY}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties }),
      });

      if (!response.ok) {
        const data = await response.json();
        return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
      }
      return new Response(JSON.stringify({ success: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), { status: 500, headers });
  }
}

// ── 구글 드라이브 업로드 ──
async function uploadToDrive(env, pdfBase64, memberName, signedAt) {
  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const token = await getAccessToken(serviceAccount);

  const date = signedAt || new Date().toISOString().split('T')[0];
  const fileName = `Regina_${memberName}_${date}.pdf`;
  const pdfBytes = base64ToUint8Array(pdfBase64);

  // multipart 업로드 (parents 없이 SA 본인 드라이브에 저장)
  const boundary = 'foo_bar_baz';
  const metaPart = JSON.stringify({ name: fileName, mimeType: 'application/pdf' });

  // ArrayBuffer로 multipart body 직접 조립
  const enc = new TextEncoder();
  const partHeader1 = enc.encode(
    `--${boundary}
Content-Type: application/json; charset=UTF-8

${metaPart}
--${boundary}
Content-Type: application/pdf

`
  );
  const partFooter = enc.encode(`
--${boundary}--`);

  const bodyBuffer = new Uint8Array(partHeader1.length + pdfBytes.length + partFooter.length);
  bodyBuffer.set(partHeader1, 0);
  bodyBuffer.set(pdfBytes, partHeader1.length);
  bodyBuffer.set(partFooter, partHeader1.length + pdfBytes.length);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBuffer,
    }
  );

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.id) {
    throw new Error(`업로드 실패: ${JSON.stringify(uploadData)}`);
  }

  const fileId = uploadData.id;

  // 공개 읽기 권한 부여
  await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    }
  );

  // SA 드라이브에서 원장 드라이브 폴더로 이동
  // (폴더 ID를 addParents로 추가하고 기존 parent 제거)
  const moveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${env.GOOGLE_DRIVE_FOLDER_ID}&removeParents=root&fields=id`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );

  // 이동 실패해도 파일은 존재하므로 링크 반환
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// ── Google Service Account → Access Token ──
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const payload = btoa(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const signingInput = `${header}.${payload}`;
  const privateKey = await importPrivateKey(serviceAccount.private_key);

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const jwt = `${signingInput}.${sigB64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`토큰 발급 실패: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryDer = base64ToUint8Array(pemContents);

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
