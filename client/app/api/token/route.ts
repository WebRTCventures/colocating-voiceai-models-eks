import { AccessToken } from 'livekit-server-sdk';
import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const livekitUrl = process.env.LIVEKIT_URL;

  if (!apiKey || !apiSecret || !livekitUrl) {
    return NextResponse.json(
      { error: 'Server misconfiguration: missing LiveKit environment variables' },
      { status: 500 },
    );
  }

  const participantIdentity = `user-${crypto.randomUUID().slice(0, 8)}`;

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    ttl: '6h',
  });

  token.addGrant({
    roomJoin: true,
    room: 'voice-agent-room',
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
  });

  const jwt = await token.toJwt();

  return NextResponse.json({ token: jwt, url: livekitUrl });
}
