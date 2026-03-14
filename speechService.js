/**
 * speechService.js
 * ElevenLabs Text-to-Speech service for AI-VAOM
 * Converts Gemini voice_response text into professional, human-like audio.
 */

const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
const dotenv = require('dotenv');
dotenv.config();

// ---------------------------------------------------------------------------
// Client initialisation
// ---------------------------------------------------------------------------
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// ---------------------------------------------------------------------------
// Constants – tweak to suit your preferred voice / quality
// ---------------------------------------------------------------------------
// "Rachel" is a natural-sounding female narrator voice available on all plans.
// Swap for any Voice ID from your ElevenLabs dashboard.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel
const DEFAULT_MODEL    = 'eleven_turbo_v2';        // lowest-latency production model

// ---------------------------------------------------------------------------
// Core helper: stream → Buffer
// ---------------------------------------------------------------------------
/**
 * Collects all chunks from a Node.js Readable stream into a single Buffer.
 * @param {import('stream').Readable} stream
 * @returns {Promise<Buffer>}
 */
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data',  (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end',   ()      => resolve(Buffer.concat(chunks)));
    stream.on('error', (err)   => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * generateSpeech
 * Converts `text` into MP3 audio using ElevenLabs and returns a Buffer.
 *
 * @param {string}  text    - The text to synthesise (max ~5 000 chars for turbo model)
 * @param {string}  voiceId - Optional ElevenLabs Voice ID (defaults to Rachel)
 * @param {string}  model   - Optional model ID (defaults to eleven_turbo_v2)
 * @returns {Promise<Buffer>} - MP3 audio data as a Node.js Buffer
 */
async function generateSpeech(text, voiceId = DEFAULT_VOICE_ID, model = DEFAULT_MODEL) {
  if (!text || text.trim() === '') {
    throw new Error('speechService.generateSpeech: text must be a non-empty string');
  }

  console.log(`🎙️  ElevenLabs TTS → voice: ${voiceId} | model: ${model}`);
  console.log(`   Text: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`);

  const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
    text,
    model_id:              model,
    output_format:         'mp3_44100_128',
    voice_settings: {
      stability:        0.5,
      similarity_boost: 0.75,
      style:            0.0,
      use_speaker_boost: true,
    },
  });

  const buffer = await streamToBuffer(audioStream);
  console.log(`   ✅ Audio generated – ${buffer.length} bytes`);
  return buffer;
}

/**
 * generateSpeechStream
 * Like generateSpeech but returns the raw Readable stream directly.
 * Useful when you want to pipe audio to the HTTP response without buffering.
 *
 * @param {string} text
 * @param {string} voiceId
 * @param {string} model
 * @returns {Promise<import('stream').Readable>}
 */
async function generateSpeechStream(text, voiceId = DEFAULT_VOICE_ID, model = DEFAULT_MODEL) {
  if (!text || text.trim() === '') {
    throw new Error('speechService.generateSpeechStream: text must be a non-empty string');
  }
  return elevenlabs.textToSpeech.convert(voiceId, {
    text,
    model_id:      model,
    output_format: 'mp3_44100_128',
    voice_settings: {
      stability:         0.5,
      similarity_boost:  0.75,
      style:             0.0,
      use_speaker_boost: true,
    },
  });
}

module.exports = { generateSpeech, generateSpeechStream };
