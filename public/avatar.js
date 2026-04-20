// Lucy Avatar — TalkingHead integration
// Uses met4citizen/TalkingHead for full 3D avatar with lip-sync, gestures, moods
// All assets loaded from CDN — zero local binary files

import { TalkingHead } from 'talkinghead';

let head = null;
let isInitialized = false;
let currentState = 'idle'; // idle, thinking, speaking, listening

// Free Ready Player Me avatar URL (no account needed for public models)
const AVATAR_URL = 'https://models.readyplayer.me/64bfa15f0e72c63d7c3934a6.glb?morphTargets=ARKit,Oculus+Visemes,mouthOpen,mouthSmile,eyesClosed,eyesLookUp,eyesLookDown&textureSizeLimit=1024&textureFormat=png';

export async function initAvatar(container, onProgress) {
  if (isInitialized) return;

  try {
    head = new TalkingHead(container, {
      lipsyncModules: ['en'],
      cameraView: 'upper',
      cameraRotateEnable: true,
      cameraZoomEnable: true,
      lightAmbientIntensity: 2.5,
      lightDirectIntensity: 25,
      lightDirectPhi: 0.5,
      lightDirectTheta: 2,
      avatarMood: 'neutral',
      avatarIdleEyeContact: 0.3,
      avatarIdleHeadMove: 0.6,
      avatarSpeakingEyeContact: 0.6,
      avatarSpeakingHeadMove: 0.6,
      modelFPS: 30,
    });

    await head.showAvatar({
      url: AVATAR_URL,
      body: 'F',
      avatarMood: 'neutral',
      lipsyncLang: 'en',
    }, (ev) => {
      if (ev.lengthComputable && onProgress) {
        const pct = Math.round(ev.loaded / ev.total * 100);
        onProgress(pct);
      }
    });

    isInitialized = true;
    console.log('[avatar] TalkingHead loaded successfully');
  } catch (err) {
    console.error('[avatar] TalkingHead failed:', err);
    createFallbackAvatar(container);
    isInitialized = true;
  }
}

// Feed audio + word timestamps for lip-synced speech
export async function speakWithAudio(audioBuffer, wordsTimestamps) {
  if (!head || !isInitialized) return;
  setState('speaking');
  try {
    // TalkingHead can play audio with lip-sync from word timestamps
    await head.speakAudio(audioBuffer, { words: wordsTimestamps });
  } catch (err) {
    console.warn('[avatar] speakAudio failed:', err);
  }
  setState('idle');
}

// Speak text using TalkingHead's built-in viseme engine (no external TTS needed)
export async function speakText(text) {
  if (!head || !isInitialized) return;
  setState('speaking');
  try {
    // Use built-in lip-sync without TTS audio (mouth moves, no sound)
    // Pair with external audio playback for sound
    await head.speakText(text, { ttsEndpoint: null });
  } catch {
    // Fallback: just move mouth
    head.speakEmoji('😊');
  }
  setState('idle');
}

// Set avatar conversation state
export function setState(state) {
  if (!head || !isInitialized) return;
  currentState = state;

  switch (state) {
    case 'thinking':
      head.setMood('neutral');
      head.playGesture('thinking');
      break;
    case 'speaking':
      head.setMood('neutral');
      break;
    case 'listening':
      head.setMood('happy', 0.3);
      break;
    case 'idle':
    default:
      head.setMood('neutral');
      break;
  }

  // Update fallback avatar state
  const fallback = document.querySelector('.avatar-fallback');
  if (fallback) fallback.className = 'avatar-fallback ' + state;
}

export function setMood(mood) {
  if (head) head.setMood(mood);
}

export function setSpeaking(speaking) {
  setState(speaking ? 'speaking' : 'idle');
}

export function onWordBoundary(word) {
  // TalkingHead handles lip-sync internally via speakAudio/speakText
  // This is a no-op for compatibility with the voice system
}

export function onSilence() {
  setState('idle');
}

export function isReady() { return isInitialized; }
export function getHead() { return head; }

// Fallback if TalkingHead fails to load
function createFallbackAvatar(container) {
  container.innerHTML = `
    <div class="avatar-fallback idle" style="
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(ellipse at 50% 40%, rgba(101,76,245,0.15) 0%, rgba(30,30,30,0.95) 70%);
    ">
      <div class="avatar-orb" style="
        width: 100px; height: 100px; border-radius: 50%;
        background: linear-gradient(135deg, #654cf5, #479ef5);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 40px rgba(101, 76, 245, 0.5);
        transition: all 0.3s ease;
      ">
        <span style="font-size: 44px;">✨</span>
      </div>
    </div>
    <style>
      .avatar-fallback.speaking .avatar-orb {
        animation: orbSpeak 0.3s ease-in-out infinite alternate;
        box-shadow: 0 0 60px rgba(101, 76, 245, 0.7);
      }
      .avatar-fallback.thinking .avatar-orb {
        animation: orbThink 2s ease-in-out infinite;
      }
      .avatar-fallback.listening .avatar-orb {
        box-shadow: 0 0 50px rgba(71, 158, 245, 0.6);
      }
      @keyframes orbSpeak {
        from { transform: scale(1); }
        to { transform: scale(1.1) translateY(-3px); }
      }
      @keyframes orbThink {
        0%, 100% { transform: scale(1) rotate(0deg); }
        50% { transform: scale(0.95) rotate(5deg); }
      }
    </style>
  `;
}

