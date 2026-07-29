import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json(
      { status: 'unhealthy', reason: 'missing env vars' },
      { status: 503 }
    );
  }

  return NextResponse.json({ status: 'ok' });
}
