// Lucy Avatar — three.js + VRM lip-sync module
// Loaded via importmap in index.html

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

let scene, camera, renderer, vrm, clock, mixer;
let isSpeaking = false;
let currentMouthShape = 0;
let targetMouthShape = 0;
let blinkTimer = 0;
let nextBlinkTime = 3000;
let headSwayAngle = 0;
let mouseX = 0, mouseY = 0;
let isInitialized = false;

const PHONEME_MAP = {
  'a': 'aa', 'e': 'ee', 'i': 'ih', 'o': 'oh', 'u': 'ou',
  'b': 'aa', 'c': 'ee', 'd': 'aa', 'f': 'oh', 'g': 'aa',
  'h': 'aa', 'j': 'ih', 'k': 'ee', 'l': 'aa', 'm': 'aa',
  'n': 'ee', 'p': 'aa', 'q': 'ou', 'r': 'aa', 's': 'ih',
  't': 'ee', 'v': 'ih', 'w': 'ou', 'x': 'ee', 'y': 'ih', 'z': 'ih'
};

export async function initAvatar(container) {
  if (isInitialized) return;

  clock = new THREE.Clock();
  scene = new THREE.Scene();

  // Camera: bust shot
  camera = new THREE.PerspectiveCamera(25, container.clientWidth / container.clientHeight, 0.1, 20);
  camera.position.set(0, 1.35, 1.8);
  camera.lookAt(0, 1.35, 0);

  // Renderer with transparent background
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  container.appendChild(renderer.domElement);

  // Lighting: soft Fluent-themed
  const ambient = new THREE.AmbientLight(0x887dff, 0.6);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(1, 2, 2);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x479ef5, 0.3);
  fillLight.position.set(-1, 1, 1);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0x654cf5, 0.4);
  rimLight.position.set(0, 1, -1);
  scene.add(rimLight);

  // Mouse tracking for eye follow
  document.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  // Load VRM model
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  try {
    const gltf = await loader.loadAsync('/lucy.vrm');
    vrm = gltf.userData.vrm;
    VRMUtils.rotateVRM0(vrm);
    scene.add(vrm.scene);

    // Setup animations if available
    if (gltf.animations && gltf.animations.length > 0) {
      mixer = new THREE.AnimationMixer(vrm.scene);
      const clip = gltf.animations[0];
      mixer.clipAction(clip).play();
    }

    isInitialized = true;
    animate();
    console.log('[avatar] VRM loaded successfully');
  } catch (err) {
    console.warn('[avatar] VRM load failed, using fallback:', err);
    createFallbackAvatar(container);
  }
}

// Fallback: CSS animated avatar if VRM not available
function createFallbackAvatar(container) {
  container.innerHTML = `
    <div class="avatar-fallback" style="
      width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
      background: radial-gradient(circle at 50% 40%, var(--colorBrandBackground) 0%, transparent 70%);
    ">
      <div class="avatar-face" style="
        width: 80px; height: 80px; border-radius: 50%;
        background: linear-gradient(135deg, #654cf5, #479ef5);
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 0 30px rgba(101, 76, 245, 0.4);
        animation: avatarPulse 3s ease-in-out infinite;
      ">
        <span style="font-size: 36px;">✨</span>
      </div>
    </div>
    <style>
      @keyframes avatarPulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 30px rgba(101, 76, 245, 0.4); }
        50% { transform: scale(1.05); box-shadow: 0 0 50px rgba(101, 76, 245, 0.6); }
      }
      .avatar-fallback.speaking .avatar-face {
        animation: avatarSpeak 0.15s ease-in-out infinite alternate;
      }
      @keyframes avatarSpeak {
        0% { transform: scale(1); }
        100% { transform: scale(1.08) translateY(-2px); }
      }
    </style>
  `;
  isInitialized = true;
}

function animate() {
  if (!isInitialized || !vrm) return;
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // Blinking
  blinkTimer += delta * 1000;
  if (blinkTimer > nextBlinkTime) {
    triggerBlink();
    blinkTimer = 0;
    nextBlinkTime = 2000 + Math.random() * 4000;
  }

  // Head sway (gentle idle)
  if (!isSpeaking) {
    headSwayAngle += delta * 0.3;
    const headBone = vrm.humanoid?.getNormalizedBoneNode('head');
    if (headBone) {
      headBone.rotation.y = Math.sin(headSwayAngle) * 0.02;
      headBone.rotation.x = Math.sin(headSwayAngle * 0.7) * 0.01;
    }
  }

  // Eye tracking (follow mouse)
  if (vrm.lookAt) {
    const target = new THREE.Vector3(mouseX * 0.5, 1.35 + mouseY * 0.2, 2);
    vrm.lookAt.target = target;
  }

  // Smooth mouth shape interpolation
  currentMouthShape += (targetMouthShape - currentMouthShape) * Math.min(1, delta * 15);
  if (vrm.expressionManager) {
    vrm.expressionManager.setValue('aa', currentMouthShape * 0.8);
    vrm.expressionManager.setValue('oh', currentMouthShape * 0.3);
  }

  if (mixer) mixer.update(delta);
  vrm.update(delta);
  renderer.render(scene, camera);
}

function triggerBlink() {
  if (!vrm?.expressionManager) return;
  vrm.expressionManager.setValue('blink', 1.0);
  setTimeout(() => {
    if (vrm?.expressionManager) vrm.expressionManager.setValue('blink', 0.0);
  }, 150);
}

// Called by voice system with word boundary events
export function onWordBoundary(word) {
  if (!word) return;
  isSpeaking = true;
  const firstChar = word.charAt(0).toLowerCase();
  const shape = PHONEME_MAP[firstChar] || 'aa';
  targetMouthShape = shape === 'aa' ? 1.0 : shape === 'oh' ? 0.7 : shape === 'ee' ? 0.5 : 0.6;

  // Slight head nod while speaking
  if (vrm?.humanoid) {
    const headBone = vrm.humanoid.getNormalizedBoneNode('head');
    if (headBone) {
      headBone.rotation.x = -0.02 + Math.random() * 0.04;
    }
  }
}

export function onSilence() {
  isSpeaking = false;
  targetMouthShape = 0;
}

export function setExpression(name, value) {
  if (!vrm?.expressionManager) return;
  vrm.expressionManager.setValue(name, value);
}

export function setSpeaking(speaking) {
  isSpeaking = speaking;
  if (!speaking) targetMouthShape = 0;
  // Toggle fallback avatar state
  const fallback = document.querySelector('.avatar-fallback');
  if (fallback) {
    fallback.classList.toggle('speaking', speaking);
  }
}

export function resize(width, height) {
  if (!renderer || !camera) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

export function isReady() { return isInitialized; }
