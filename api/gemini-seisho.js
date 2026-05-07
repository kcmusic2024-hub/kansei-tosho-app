export const config = { runtime: 'edge' };

export default async function handler(req) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const ok  = (data)        => new Response(JSON.stringify(data), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
  const err = (msg, status) => new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  /* 診断用GET */
  if (req.method === 'GET') {
    const key = process.env.GEMINI_API_KEY;
    return ok({
      status: key ? 'ok' : 'missing',
      keyLength: key ? key.length : 0,
      keyPrefix: key ? key.slice(0, 6) + '...' : null,
      runtime: 'edge'
    });
  }

  if (req.method !== 'POST') return err('Method not allowed', 405);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return err('GEMINI_API_KEY が Vercel に設定されていません', 500);

  let body;
  try { body = await req.json(); } catch { return err('リクエスト形式が不正です', 400); }

  const { base64, mimeType } = body;
  if (!base64 || !mimeType) return err('base64 と mimeType が必要です', 400);

  /* Vercel Edge 30秒制限に対して2秒の余裕を確保 */
  const STARTED = Date.now();
  function msLeft() { return Math.max(0, 28000 - (Date.now() - STARTED)); }

  /* タイムアウト付き fetch ヘルパー */
  async function fetchWithLimit(url, options, limitMs) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), limitMs);
    try {
      return await fetch(url, { ...options, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }
  }

  const imagePrompt =
    'この手書きの平面図を、CAD図面のように整然とした清書された建築平面図として描き直してください。' +
    '白背景に黒い線のみで描いてください。色は一切使わず、白と黒だけで表現してください。' +
    '直線の壁、明確な部屋の境界線、読みやすい日本語の部屋名ラベルを描いてください。' +
    '手書き風の線は不要です。';

  /* ① 画像生成モデルで清書画像を生成（Vision解析のために6秒を確保） */
  const imageGenModels = [
    { ver: 'v1beta', model: 'gemini-2.0-flash-exp-image-generation' },
    { ver: 'v1beta', model: 'gemini-2.0-flash-preview-image-generation' },
  ];

  for (const { ver, model } of imageGenModels) {
    const limit = Math.min(msLeft() - 6000, 20000);
    if (limit < 2000) break;  /* Vision解析のための時間が確保できない場合はスキップ */
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${apiKey}`;
      const gemRes = await fetchWithLimit(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: imagePrompt },
            { inlineData: { mimeType, data: base64 } }
          ]}],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        })
      }, limit);
      if (!gemRes.ok) { console.warn('[画像生成失敗]', model, gemRes.status); continue; }
      const json = await gemRes.json();
      const parts = json.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return ok({ imageData: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' });
        }
      }
      console.warn('[画像生成] 画像データなし:', model);
    } catch (e) {
      console.warn('[画像生成エラー]', model, e.message);
    }
  }

  /* ② フォールバック：Visionモデルで部屋JSON解析 → クライアント側Canvas描画 */
  const visionModels = [
    { ver: 'v1',     model: 'gemini-2.0-flash' },
    { ver: 'v1beta', model: 'gemini-2.5-flash' },
  ];
  const visionPrompt =
    'この手書き平面図の各部屋・スペースを分析してください。\n' +
    '以下のJSON形式のみを出力してください。コードブロックや説明文は不要です。\n' +
    '{"rooms":[{"name":"部屋名","x":数値,"y":数値,"w":数値,"h":数値}]}\n' +
    'ルール：x,yは左上原点からの相対位置（グリッド単位）、w,hは幅・高さ（グリッド単位）。' +
    '隣接する部屋は座標が連続するようにしてください。部屋名が読み取れない場合は「部屋」としてください。';

  for (const { ver, model } of visionModels) {
    const limit = Math.min(msLeft() - 1000, 8000);
    if (limit < 1000) break;
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${apiKey}`;
      const gemRes = await fetchWithLimit(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: visionPrompt },
            { inlineData: { mimeType, data: base64 } }
          ]}]
        })
      }, limit);
      if (!gemRes.ok) continue;
      const json = await gemRes.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.rooms && parsed.rooms.length > 0) {
          return ok({ rooms: parsed.rooms });
        }
      }
    } catch (e) {
      console.warn('[Vision解析エラー]', model, e.message);
    }
  }

  return err('AIによる処理に失敗しました。再試行してください。', 500);
}
