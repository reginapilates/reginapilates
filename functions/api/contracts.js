// functions/api/contracts.js

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
      const memberId = url.searchParams.get('memberId');

      const filterBody = memberId
        ? { filter: { property: 'Member', relation: { contains: memberId } } }
        : {};

      const response = await fetch(
        `https://api.notion.com/v1/databases/${env.NOTION_CONTRACTS_DB_ID}/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.NOTION_API_KEY}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...filterBody,
            sorts: [{ property: 'SignedAt', direction: 'descending' }],
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data.message }), { status: 500, headers });
      }

      const contracts = (data.results || []).map(page => ({
        id: page.id,
        title: page.properties.Name?.title?.[0]?.plain_text || '',
        memberId: page.properties.Member?.relation?.[0]?.id || '',
        programId: page.properties.Program?.relation?.[0]?.id || '',
        sessions: page.properties.Sessions?.number || 0,
        remainingSessions: page.properties.RemainingSessions?.number || 0,
        totalAmount: page.properties.TotalAmount?.number || 0,
        paymentMethod: page.properties.PaymentMethod?.select?.name || '',
        startDate: page.properties.StartDate?.date?.start || '',
        endDate: page.properties.EndDate?.date?.start || '',
        signedAt: page.properties.SignedAt?.date?.start || '',
        driveLink: page.properties.DriveLink?.url || '',
        status: page.properties.Status?.select?.name || '',
        pauseDate: page.properties.PauseDate?.date?.start || '',
        resumeDate: page.properties.ResumeDate?.date?.start || '',
        note: page.properties.Note?.rich_text?.[0]?.plain_text || '',
      }));

      return new Response(JSON.stringify({ contracts }), { headers });
    }

    // POST — 새 계약 생성
    if (method === 'POST') {
      const body = await request.json();
      const { memberName, programName, pdfBase64, ...contractData } = body;

      // 1. 구글 드라이브에 PDF 저장
      let driveLink = '';
      if (pdfBase64) {
        try {
          driveLink = await uploadToDrive(env, pdfBase64, memberName, contractData.signedAt);
          console.log('Drive link:', driveLink);
        } catch(e) {
          console.error('Drive upload failed:', e.message);
        }
      }

      // 2. Notion에 계약 저장
      const title = `${memberName} - ${programName}`;
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
            RemainingSessions: { number: contractData.sessions || 0 },
            TotalAmount: { number: contractData.totalAmount || 0 },
            PaymentMethod: contractData.paymentMethod ? { select: { name: contractData.paymentMethod } } : undefined,
            StartDate: contractData.startDate ? { date: { start: contractData.startDate } } : undefined,
            EndDate: contractData.endDate ? { date: { start: contractData.endDate } } : undefined,
            SignedAt: { date: { start: new Date().toISOString().split('T')[0] } },
            DriveLink: driveLink ? { url: driveLink } : undefined,
            Status: { select: { name: '진행중' } },
            Note: { rich_text: [{ text: { content: contractData.note || '' } }] },
          },
        }),
      });

      const notionData = await notionRes.json();
      if (!notionRes.ok) {
        return new Response(JSON.stringify({ error: notionData.message, details: notionData }), { status: 500, headers });
      }

      return new Response(JSON.stringify({ id: notionData.id, driveLink, success: true }), { headers });
    }

    // PUT — 계약 상태 업데이트
    if (method === 'PUT') {
      const url = new URL(request.url);
      const contractId = url.searchParams.get('id');
      const body = await request.json();

      const properties = {};
      if (body.status) properties.Status = { select: { name: body.status } };
      if (body.remainingSessions !== undefined) properties.RemainingSessions = { number: body.remainingSessions };
      if (body.pauseDate) properties.PauseDate = { date: { start: body.pauseDate } };
      else if (body.pauseDate === null) properties.PauseDate = { date: null };
      if (body.resumeDate) properties.ResumeDate = { date: { start: body.resumeDate } };
      else if (body.resumeDate === null) properties.ResumeDate = { date: null };
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

  // Step 1: 메타데이터만 먼저 파일 생성
  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: fileName,
        parents: [env.GOOGLE_DRIVE_FOLDER_ID],
        mimeType: 'application/pdf',
      }),
    }
  );

  const createData = await createRes.json();
  if (!createRes.ok || !createData.id) {
    throw new Error(`파일 생성 실패: ${JSON.stringify(createData)}`);
  }

  const fileId = createData.id;

  // Step 2: 파일 내용 업로드
  const pdfBytes = base64ToUint8Array(pdfBase64);
  const uploadRes = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/pdf',
        'Content-Length': pdfBytes.length.toString(),
      },
      body: pdfBytes,
    }
  );

  if (!uploadRes.ok) {
    const uploadData = await uploadRes.json();
    throw new Error(`파일 업로드 실패: ${JSON.stringify(uploadData)}`);
  }

  // Step 3: 공개 읽기 권한 부여
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
