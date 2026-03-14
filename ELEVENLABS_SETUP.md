# ElevenLabs API Key Setup

## Get Your Free API Key:

1. **Sign up**: https://elevenlabs.io/
2. **Go to Dashboard**: Click "API Key" in left menu
3. **Copy your API key**: It starts with `sk_...`

## Update the Code:

Replace the placeholder API key in `app.js` line 1022:

```javascript
'xi-api-key': 'YOUR_ACTUAL_API_KEY_HERE', // Replace with your real API key
```

## Free Tier Limits:
- **10,000 characters/month** (free)
- **Rachel voice** (ultra-realistic female)
- **Adam voice** (ultra-realistic male)

## Test It:
1. Start your app: `npm start`
2. Say "Volt, hello"
3. You should hear Rachel's ultra-realistic voice!

## Fallback:
If ElevenLabs fails (no internet, API limit), it automatically falls back to browser TTS.

## Alternative Voices:
- Change `rachel` to `adam` for male voice
- Or try: `bella`, `domi`, `elli`
