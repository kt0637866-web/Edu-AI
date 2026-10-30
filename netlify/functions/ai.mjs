const SYSTEM =
  "Bạn là trợ lý học tập cho học sinh Việt Nam. Trả lời bằng ngôn ngữ mà học sinh dùng. " +
  "Chỉ hỗ trợ việc học; nhẹ nhàng từ chối nội dung không phù hợp với học sinh.";
const IMG = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const no = (status) => new Response("", { status });

export default async (req) => {
  if (req.method !== "POST") return no(405);
  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!key) return no(500);
  const code = Netlify.env.get("ACCESS_CODE") || "";
  if (code && req.headers.get("x-access-code") !== code) return no(401);

  let b;
  try { b = await req.json(); } catch { return no(400); }
  const { prompt, images = [], fast = false } = b || {};
  if (typeof prompt !== "string" || !prompt || prompt.length > 40000) return no(400);
  if (!Array.isArray(images) || images.length > 3) return no(400);

  const content = [];
  for (const d of images) {
    const m = typeof d === "string" ? IMG.exec(d) : null;
    if (!m) return no(400);
    content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
  }
  content.push({ type: "text", text: prompt });

  const model = fast
    ? Netlify.env.get("FAST_MODEL") || "claude-haiku-5-5"
    : Netlify.env.get("MODEL") || "claude-sonnet-5-5";

  const up = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: Number(Netlify.env.get("MAX_TOKENS") || 2000),
      system: SYSTEM, stream: true, messages: [{ role: "user", content }],
    }),
  });
  if (!up.ok || !up.body) return no(up.status === 429 ? 429 : 502);

  const enc = new TextEncoder(), dec = new TextDecoder();
  const body = new ReadableStream({
    async start(ctrl) {
      const rd = up.body.getReader();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await rd.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            const j = line.slice(5).trim();
            if (!j || j === "[DONE]") continue;
            try {
              const ev = JSON.parse(j);
              if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta")
                ctrl.enqueue(enc.encode(ev.delta.text));
            } catch {}
          }
        }
      } catch {}
      ctrl.close();
    },
    cancel() { try { up.body.cancel(); } catch {} },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
};

export const config = { path: "/api/ai" };
