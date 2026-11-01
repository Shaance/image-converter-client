<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { supported, probeMaxArea } from './lib/capabilities';
  import { createQueue } from './lib/queue.svelte';
  import ModeSwitch from './lib/components/ModeSwitch.svelte';
  import DropZone from './lib/components/DropZone.svelte';
  import FormatChips from './lib/components/FormatChips.svelte';
  import FileList from './lib/components/FileList.svelte';
  import DownloadBar from './lib/components/DownloadBar.svelte';
  import Icons from './lib/components/Icons.svelte';
  import { SERVER_URL } from './lib/server';
  let queue = $state<ReturnType<typeof createQueue>>();
  let unavailable = $state(!supported());
  const serverMode = $derived(queue?.mode === 'server');
  const serverHost = $derived(new URL(SERVER_URL).host);
  // Files added while the canvas probe is still running; handed to the queue as soon as it exists.
  let pending: File[] = [];
  onMount(() => {
    let cancelled = false;
    if (!unavailable) {
      // Attach worker listeners immediately; the probe finishes before files can be added.
      void probeMaxArea().then(maxArea => {
        if (cancelled) return;
        try {
          const worker = new Worker(new URL('./lib/pipeline.worker.ts', import.meta.url), { type: 'module' });
          queue = createQueue({ worker, maxArea });
          if (pending.length) void queue.add(pending.splice(0));
        } catch { unavailable = true; }
      });
    }
    return () => { cancelled = true; queue?.dispose(); };
  });
  let dropZone: DropZone;
  let initialReveal = true;
  function revealHero(node: HTMLElement) { if (initialReveal) node.classList.add('reveal'); initialReveal = false; }
  async function focusDrop() { await tick(); dropZone.focus(); }
  type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void>; updateCallbackDone: Promise<void> };
  // One helper owns every empty <-> busy morph (first add, clear all, last-row
  // removal). The state update always runs, even when the transition is skipped,
  // so an interrupted morph (add during clear, clear during add, mode switch)
  // can never leave stale or missing UI.
  function morph(update: () => void, direction: 'in' | 'out') {
    const doc = document as unknown as {
      startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike;
    };
    const root = document.documentElement;
    if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); return; }
    root.classList.remove('morph-in', 'morph-out');
    root.classList.add('morphing', direction === 'in' ? 'morph-in' : 'morph-out');
    const transition = doc.startViewTransition(async () => { update(); await tick(); });
    current = transition;
    // A newer morph skips this one; only the latest may clear the classes.
    const done = () => { if (current === transition) { current = undefined; root.classList.remove('morphing', 'morph-in', 'morph-out'); } };
    transition.ready.catch(() => {}); // a skipped transition rejects ready/finished
    transition.finished.then(done, done);
    // The update runs a frame later; files added before then must land after it.
    const applied = transition.updateCallbackDone.catch(() => {});
    updating = applied;
    void applied.then(() => { if (updating === applied) updating = undefined; });
  }
  let current: ViewTransitionLike | undefined;
  let updating: Promise<void> | undefined;
  function onAdd(files: File[]) {
    const q = queue;
    if (!q) { pending.push(...files); return; }
    if (updating) { void updating.then(() => onAdd(files)); return; }
    // q.add pushes the jobs synchronously, so the transition's snapshot sees them.
    if (q.fileCount === 0) morph(() => void q.add(files), 'in');
    else void q.add(files);
  }
  function clear() { morph(() => queue?.clear(), 'out'); void focusDrop(); }
  function removeLast(id: string) { morph(() => queue?.remove(id), 'out'); void focusDrop(); }
</script>

<main>
  <header class="reveal">
    <div class="title">Image converter</div>
    <ModeSwitch mode={queue?.mode ?? 'device'} onchange={mode => queue?.setMode(mode)} disabled={!queue} />
  </header>
  {#if !queue?.fileCount}
    <section use:revealHero class="hero" style="--delay: var(--stagger)">
      <h1>Convert photos to <em>JPEG</em>, <em>PNG</em>, <em>WebP</em> and more.</h1>
      <div class="subtitle">
        <p class:active={!serverMode} aria-hidden={serverMode ? true : undefined}>Everything happens in your browser. Your photos never leave this device.</p>
        <p class:active={serverMode} aria-hidden={serverMode ? undefined : true}>Photos are uploaded to {serverHost}, converted, and deleted right away.</p>
      </div>
    </section>
  {/if}
  <div class="drop-reveal reveal" style="--delay: calc(var(--stagger) * 2)">
    <DropZone bind:this={dropZone} variant={queue?.fileCount ? 'compact' : 'hero'} ready={!!queue}
      message={unavailable ? 'On-device conversion needs a newer browser (Safari 17, Chrome 80 or Firefox 114).'
        : queue?.workerStatus.status === 'unavailable' ? 'The converter stopped. Reload the page to continue.' : undefined}
      onadd={onAdd} />
  </div>
  <div class="settings">
    <span class="label">Convert to</span>
    <FormatChips value={queue?.format ?? 'jpeg'} onchange={format => queue?.setFormat(format)}
      smaller={queue?.smaller ?? false} onsmaller={on => queue?.setSmaller(on)} server={serverMode} disabled={!queue} />
  </div>
  {#if queue?.fileCount}
    <FileList {queue} onclear={clear} onremovelast={removeLast} />
    <DownloadBar {queue} />
  {/if}
  <div class="spacer"></div>
  <footer>
    <p class="privacy"><Icons name="lock" size={14} />No accounts, tracking or EXIF data.</p>
    <a href="https://github.com/Shaance/image-converter-client" aria-label="Source on GitHub"><Icons name="github" /><span>Source on GitHub</span></a>
  </footer>
</main>

<style>
  main { max-width: 1200px; min-height: 100svh; margin: 0 auto; padding: 40px 96px 56px; display: flex; flex-direction: column; }
  /* Wraps only below ~350 px, where the switch no longer fits beside the title. */
  header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 14px; }
  .title { font: 500 24px var(--serif); white-space: nowrap; }
  .hero { view-transition-name: hero; padding: 96px 0 48px; max-width: 760px; }
  h1 { font: 400 56px/1.08 var(--serif); margin: 0 0 20px; letter-spacing: -.01em; text-wrap: pretty; }
  em { color: var(--teal); }
  .subtitle { display: grid; }
  .subtitle p { grid-area: 1 / 1; font-size: 18px; line-height: 1.55; color: var(--muted); margin: 0; max-width: 560px; }
  .subtitle p:not(.active) { visibility: hidden; }
  .drop-reveal { view-transition-name: drop; }
  /* One instance in both states: the settings never relocate between empty and busy. */
  .settings { view-transition-name: settings; display: flex; align-items: baseline; flex-wrap: wrap; gap: 16px; padding-top: 28px; }
  footer { view-transition-name: footer; display: flex; justify-content: space-between; align-items: center; gap: 20px; font-size: 13px; color: var(--muted); border-top: 1px solid var(--rule); padding-top: 20px; margin-top: 0; }
  .spacer { flex-grow: 1; min-height: 64px; }
  footer p { margin: 0; }
  .privacy { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  footer a { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex-shrink: 0; color: var(--muted); white-space: nowrap; }
  @media (hover: hover) and (pointer: fine) { footer a:hover { color: var(--teal-dark); } }
  @media (prefers-reduced-motion: no-preference) {
    .subtitle p { transition: opacity var(--fast) var(--ease-out), visibility var(--fast); }
    .subtitle p:not(.active) { opacity: 0; }
  }
  @media (max-width: 719px) {
    main { padding: 32px 20px 24px; }
    .hero { padding: 32px 0 28px; }
    h1 { font-size: 40px; }
    .settings { padding-top: 24px; }
    footer { gap: 8px; }
    footer a { width: 44px; height: 44px; }
    footer a span { display: none; }
    .spacer { min-height: 40px; }
  }
  @media (max-width: 389px) {
    header { column-gap: 10px; }
    .title { font-size: 21px; }
  }
</style>
