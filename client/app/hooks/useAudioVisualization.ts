'use client';

import { useEffect, useRef, useCallback } from 'react';
import {
  createAudioAnalyser,
  LocalAudioTrack,
  RemoteAudioTrack,
} from 'livekit-client';

/** Number of frequency bins to render (voice-relevant range: ~85-4000Hz at 48kHz) */
const VOICE_BINS = 32;

/** Canvas logical dimensions */
const CANVAS_WIDTH = 300;
const CANVAS_HEIGHT = 100;

/** Background color for the canvas — uses a very dark transparent shade */
const BG_COLOR = 'rgba(26, 20, 16, 0.6)';

/** Gradient colors: warm gold (low amplitude) → bright gold (high amplitude) */
const COLOR_LOW = { r: 160, g: 125, b: 63 }; // #a07d3f
const COLOR_HIGH = { r: 212, g: 165, b: 89 }; // #d4a559

/**
 * Interpolate between the warm and bright gold colors based on normalized amplitude.
 */
function getBarColor(normalized: number): string {
  const r = Math.round(COLOR_LOW.r + (COLOR_HIGH.r - COLOR_LOW.r) * normalized);
  const g = Math.round(COLOR_LOW.g + (COLOR_HIGH.g - COLOR_LOW.g) * normalized);
  const b = Math.round(COLOR_LOW.b + (COLOR_HIGH.b - COLOR_LOW.b) * normalized);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Render a flat line (zero-amplitude state) on the canvas.
 * Used when track is null or muted.
 */
function renderFlatLine(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const barWidth = CANVAS_WIDTH / VOICE_BINS;
  const gap = 1;

  for (let i = 0; i < VOICE_BINS; i++) {
    ctx.fillStyle = getBarColor(0);
    const x = i * barWidth;
    // 1px tall bar at the bottom = flat line
    ctx.fillRect(x + gap / 2, CANVAS_HEIGHT - 1, barWidth - gap, 1);
  }
}

/**
 * Hook that drives a real-time audio visualization on an HTML canvas element.
 *
 * Uses the LiveKit SDK's `createAudioAnalyser` to get frequency data from an
 * audio track, then renders frequency bars in a requestAnimationFrame loop.
 *
 * When track is null, renders a flat line (zero-amplitude state).
 *
 * @param canvasRef - React ref to the target canvas element
 * @param track - A local or remote audio track, or null when inactive
 */
export function useAudioVisualization(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  track: LocalAudioTrack | RemoteAudioTrack | null,
): void {
  const animationFrameRef = useRef<number | null>(null);
  const cleanupRef = useRef<(() => Promise<void>) | null>(null);

  const setupCanvas = useCallback(
    (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = CANVAS_WIDTH * dpr;
      canvas.height = CANVAS_HEIGHT * dpr;
      canvas.style.width = `${CANVAS_WIDTH}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.scale(dpr, dpr);
      return ctx;
    },
    [],
  );

  // Effect for when there is no track: render flat line
  useEffect(() => {
    if (track) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = setupCanvas(canvas);
    if (!ctx) return;

    renderFlatLine(ctx);
  }, [canvasRef, track, setupCanvas]);

  // Effect for when there is a track: create analyser and render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !track) return;

    const ctx = setupCanvas(canvas);
    if (!ctx) return;

    // Create the audio analyser via the LiveKit SDK utility
    const { analyser, cleanup } = createAudioAnalyser(track, {
      fftSize: 256,
      smoothingTimeConstant: 0.7,
      minDecibels: -90,
      maxDecibels: -10,
    });

    cleanupRef.current = cleanup;

    const frequencyData = new Uint8Array(analyser.frequencyBinCount);

    const draw = () => {
      analyser.getByteFrequencyData(frequencyData);

      // Clear with dark background
      ctx.fillStyle = BG_COLOR;
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const binCount = Math.min(VOICE_BINS, frequencyData.length);
      const barWidth = CANVAS_WIDTH / binCount;
      const gap = 1;

      for (let i = 0; i < binCount; i++) {
        const value = frequencyData[i];
        // Normalize amplitude to 0-1 range
        const normalized = value / 255;

        // Bar height: minimum 1px (flat line when muted), max fills canvas
        const barHeight = Math.max(1, normalized * CANVAS_HEIGHT);

        // Gradient from green (low amplitude) to cyan (high amplitude)
        ctx.fillStyle = getBarColor(normalized);

        const x = i * barWidth;
        const y = CANVAS_HEIGHT - barHeight;

        ctx.fillRect(x + gap / 2, y, barWidth - gap, barHeight);
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    // Start the animation loop
    animationFrameRef.current = requestAnimationFrame(draw);

    // Cleanup when track changes or component unmounts
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [canvasRef, track, setupCanvas]);
}
