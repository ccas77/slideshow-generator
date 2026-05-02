import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

function checkAuth(req: NextRequest) {
  const pw = req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { imageData } = (await req.json()) as { imageData: string };
  if (!imageData) {
    return NextResponse.json({ error: "imageData required" }, { status: 400 });
  }

  const b64 = imageData.includes(",") ? imageData.split(",")[1] : imageData;
  const mimeType = imageData.startsWith("data:image/png") ? "image/png" : "image/jpeg";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { data: b64, mimeType } },
            {
              text: "Describe this image as an AI image generation prompt. Focus on the subject, composition, lighting, mood, colors, and style. Write a single paragraph prompt that could recreate a similar image. Respond with ONLY the prompt text, nothing else.",
            },
          ],
        },
      ],
    });

    const prompt = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    return NextResponse.json({ prompt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
