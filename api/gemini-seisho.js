module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY が Vercel に設定されていません' });

  const { base64, mimeType } = req.body || {};
  if (!base64 || !mimeType) return res.status(400).json({ error: 'base64 と mimeType が必要です' });

  /* ① 画像生成モデルで清書画像を返す */
  const imageGenModels = [
    { ver: 'v1beta', model: 'gemini-2.0-flash-exp-image-generation' },
    { ver: 'v1beta', model: 'gemini-2.0-flash-preview-image-generation' },
  ];
  const imagePrompt =
    'この手書きの平面図を、CAD図面のように整然とした清書された建築平面図として描き直してください。' +
    '直線の壁、明確な部屋の境界線、読みやすい日本語の部屋名ラベルを白背景で描いてください。' +
    '手書き風の線は不要です。';

  for (const { ver, model } of imageGenModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${apiKey}`;
      const gemRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: imagePrompt },
            { inlineData: { mimeType, data: base64 } }
          ]}],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
        })
      });
      if (!gemRes.ok) { console.warn('[画像生成失敗]', model, gemRes.status); continue; }
      const json = await gemRes.json();
      const parts = json.candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return res.status(200).json({
            imageData: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png'
          });
        }
      }
    } catch (e) {
      console.warn('[画像生成エラー]', model, e.message);
    }
  }

  /* ② フォールバック：Visionモデルで部屋JSON解析を返し、クライアント側でCanvas描画 */
  const visionModels = [
    { ver: 'v1',     model: 'gemini-2.5-flash' },
    { ver: 'v1',     model: 'gemini-2.0-flash' },
    { ver: 'v1beta', model: 'gemini-2.5-flash' },
    { ver: 'v1beta', model: 'gemini-2.0-flash' },
  ];
  const visionPrompt =
    'この手書き平面図の各部屋・スペースを分析してください。\n' +
    '以下のJSON形式のみを出力してください。コードブロックや説明文は不要です。\n' +
    '{"rooms":[{"name":"部屋名","x":数値,"y":数値,"w":数値,"h":数値}]}\n' +
    'ルール：x,yは左上原点からの相対位置（グリッド単位）、w,hは幅・高さ（グリッド単位）。' +
    '隣接する部屋は座標が連続するようにしてください。部屋名が読み取れない場合は「部屋」としてください。';

  for (const { ver, model } of visionModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${model}:generateContent?key=${apiKey}`;
      const gemRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: visionPrompt },
            { inlineData: { mimeType, data: base64 } }
          ]}]
        })
      });
      if (!gemRes.ok) continue;
      const json = await gemRes.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const clean = text.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return res.status(200).json({ rooms: parsed.rooms || [] });
      }
    } catch (e) {
      console.warn('[Vision解析エラー]', model, e.message);
    }
  }

  return res.status(500).json({ error: '全モデルで処理に失敗しました' });
};
