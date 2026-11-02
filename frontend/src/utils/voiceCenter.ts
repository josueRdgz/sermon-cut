/** Mix a right-channel voice toward the stereo center (preview + FFmpeg). */

export const DEFAULT_VOICE_CENTER = 0.35;

export function clampVoiceCenter(amount: number | null | undefined): number {
  if (amount == null || !Number.isFinite(amount)) return 0;
  return Math.max(0, Math.min(1, amount));
}

export function voiceCenterGains(amount: number | null | undefined): {
  keepLeft: number;
  mixRightIntoLeft: number;
} {
  const g = clampVoiceCenter(amount);
  if (g <= 0) return { keepLeft: 1, mixRightIntoLeft: 0 };
  const keepLeft = 1 / (1 + g);
  return { keepLeft, mixRightIntoLeft: g * keepLeft };
}

export function mixVoiceCenterSample(
  left: number,
  right: number,
  amount: number | null | undefined,
): { left: number; right: number } {
  const { keepLeft, mixRightIntoLeft } = voiceCenterGains(amount);
  return { left: keepLeft * left + mixRightIntoLeft * right, right };
}

interface VoiceCenterTap {
  source: MediaElementAudioSourceNode;
  processor: ScriptProcessorNode;
}

let sharedGraph: VoiceCenterGraph | null = null;

/** One graph for the editor lifetime so remounts do not recapture media elements. */
export function getVoiceCenterGraph(): VoiceCenterGraph {
  if (!sharedGraph) sharedGraph = new VoiceCenterGraph();
  return sharedGraph;
}

/**
 * Routes sermon media through a stereo mix so a right-channel voice sits
 * closer to the center. ``element.volume`` / ``muted`` still apply.
 *
 * Capture only after the AudioContext is running (a user gesture). Capturing a
 * muted video, or capturing while the context is suspended, leaves WKWebView
 * silent because createMediaElementSource cannot be undone.
 */
export class VoiceCenterGraph {
  private context: AudioContext | null = null;
  private taps = new Map<HTMLMediaElement, VoiceCenterTap>();
  private amount = 0;

  get attached(): boolean {
    return this.taps.size > 0;
  }

  get running(): boolean {
    return this.context?.state === 'running';
  }

  setAmount(amount: number) {
    this.amount = clampVoiceCenter(amount);
  }

  async resume(): Promise<boolean> {
    const ctx = this.ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    return ctx.state === 'running';
  }

  attach(elements: Array<HTMLMediaElement | null | undefined>) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    const live = elements.filter((item): item is HTMLMediaElement =>
      Boolean(item && item.isConnected && item.readyState >= HTMLMediaElement.HAVE_METADATA && !item.muted),
    );
    for (const [element] of this.taps) {
      if (!element.isConnected) this.taps.delete(element);
    }
    for (const element of live) {
      if (this.taps.has(element)) continue;
      const wasPlaying = !element.paused;
      try {
        const source = ctx.createMediaElementSource(element);
        const processor = ctx.createScriptProcessor(1024, 2, 2);
        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer;
          const output = event.outputBuffer;
          const inL = input.getChannelData(0);
          const inR = input.numberOfChannels > 1 ? input.getChannelData(1) : inL;
          const outL = output.getChannelData(0);
          const outR = output.numberOfChannels > 1 ? output.getChannelData(1) : outL;
          const { keepLeft, mixRightIntoLeft } = voiceCenterGains(this.amount);
          for (let i = 0; i < inL.length; i++) {
            const right = inR[i] ?? inL[i];
            outL[i] = keepLeft * inL[i] + mixRightIntoLeft * right;
            if (outR !== outL) outR[i] = right;
          }
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        this.taps.set(element, { source, processor });
        if (wasPlaying) {
          void element.play().catch(() => undefined);
        }
      } catch {
        // Already captured by another graph, or the element is not ready.
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.context = new Ctor();
    return this.context;
  }
}
