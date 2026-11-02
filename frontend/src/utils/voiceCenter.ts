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

interface VoiceCenterTap {
  splitter: ChannelSplitterNode;
  merger: ChannelMergerNode;
  keepLeft: GainNode;
  mixRight: GainNode;
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
 */
export class VoiceCenterGraph {
  private context: AudioContext | null = null;
  private taps = new Map<HTMLMediaElement, VoiceCenterTap>();
  private amount = 0;

  get attached(): boolean {
    return this.taps.size > 0;
  }

  setAmount(amount: number) {
    this.amount = clampVoiceCenter(amount);
    this.applyGains();
  }

  resume() {
    const ctx = this.context;
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
  }

  attach(elements: Array<HTMLMediaElement | null | undefined>) {
    const live = elements.filter((item): item is HTMLMediaElement => Boolean(item));
    if (live.length === 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.resume();
    for (const [element] of this.taps) {
      if (!element.isConnected) this.taps.delete(element);
    }
    for (const element of live) {
      if (this.taps.has(element)) continue;
      try {
        const source = ctx.createMediaElementSource(element);
        const splitter = ctx.createChannelSplitter(2);
        const merger = ctx.createChannelMerger(2);
        const keepLeft = ctx.createGain();
        const mixRight = ctx.createGain();
        source.connect(splitter);
        splitter.connect(keepLeft, 0);
        splitter.connect(mixRight, 1);
        splitter.connect(merger, 1, 1);
        keepLeft.connect(merger, 0, 0);
        mixRight.connect(merger, 0, 0);
        merger.connect(ctx.destination);
        this.taps.set(element, { splitter, merger, keepLeft, mixRight });
      } catch {
        // Already captured by another graph, or the element is not ready.
      }
    }
    this.applyGains();
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

  private applyGains() {
    const { keepLeft, mixRightIntoLeft } = voiceCenterGains(this.amount);
    this.taps.forEach((tap) => {
      tap.keepLeft.gain.value = keepLeft;
      tap.mixRight.gain.value = mixRightIntoLeft;
    });
  }
}
