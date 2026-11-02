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

/**
 * Live preview mix. Captures the dedicated ``<audio>`` once (never a video —
 * ``createMediaElementSource`` is irreversible and WKWebView stays silent if
 * the captured element is muted or later reloaded).
 *
 * The slider only updates GainNode values. Reloading a panned AAC file
 * fragments playback.
 */
export class VoiceCenterMixer {
  private context: AudioContext | null = null;
  private keepGain: GainNode | null = null;
  private mixGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private captured = false;
  private amount = 0;
  private outputGain = 1;

  get attached(): boolean {
    return this.captured;
  }

  setAmount(amount: number) {
    this.amount = clampVoiceCenter(amount);
    this.applyMix();
  }

  setOutputGain(gain: number, muted = false) {
    this.outputGain = muted ? 0 : Math.max(0, Math.min(1, gain));
    if (this.masterGain) this.masterGain.gain.value = this.outputGain;
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

  attach(element: HTMLMediaElement | null | undefined) {
    if (this.captured || !element || !element.isConnected) return;
    if (element.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    try {
      const source = ctx.createMediaElementSource(element);
      const splitter = ctx.createChannelSplitter(2);
      const keepGain = ctx.createGain();
      const mixGain = ctx.createGain();
      const merger = ctx.createChannelMerger(2);
      const master = ctx.createGain();
      source.connect(splitter);
      splitter.connect(keepGain, 0);
      splitter.connect(mixGain, 1);
      splitter.connect(merger, 1, 1);
      keepGain.connect(merger, 0, 0);
      mixGain.connect(merger, 0, 0);
      merger.connect(master);
      master.connect(ctx.destination);
      this.keepGain = keepGain;
      this.mixGain = mixGain;
      this.masterGain = master;
      this.captured = true;
      this.applyMix();
      master.gain.value = this.outputGain;
    } catch {
      // Already captured by another graph, or this WKWebView cannot remix.
    }
  }

  private applyMix() {
    const { keepLeft, mixRightIntoLeft } = voiceCenterGains(this.amount);
    if (this.keepGain) this.keepGain.gain.value = keepLeft;
    if (this.mixGain) this.mixGain.gain.value = mixRightIntoLeft;
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

let sharedMixer: VoiceCenterMixer | null = null;

export function getVoiceCenterMixer(): VoiceCenterMixer {
  if (!sharedMixer) sharedMixer = new VoiceCenterMixer();
  return sharedMixer;
}
