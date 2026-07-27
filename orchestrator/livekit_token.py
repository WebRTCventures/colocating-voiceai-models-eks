"""LiveKit JWT token generation for the voice agent bot participant."""

from livekit.api import AccessToken, VideoGrants

from config import Config


def generate_token(config: Config) -> str:
    """Generate a LiveKit JWT token with publish/subscribe grants.

    The bot needs permission to:
    - Join the room
    - Subscribe to participant audio tracks (receive user audio)
    - Publish audio tracks (send TTS output)

    Args:
        config: Application configuration containing LiveKit API credentials.

    Returns:
        A signed JWT string for authenticating with the LiveKit room.
    """
    token = (
        AccessToken(config.livekit_api_key, config.livekit_api_secret)
        .with_identity("voice-agent")
        .with_name("Voice Agent")
        .with_grants(
            VideoGrants(
                room_join=True,
                room="voice-agent-room",
                can_publish=True,
                can_subscribe=True,
            )
        )
    )
    return token.to_jwt()
