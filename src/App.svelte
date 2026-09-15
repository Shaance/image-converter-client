<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { supported, probeMaxArea } from './lib/capabilities';
  import { createQueue } from './lib/queue.svelte';
  import ModeSwitch from './lib/components/ModeSwitch.svelte';
  import DropZone from './lib/components/DropZone.svelte';
  import FormatChips from './lib/components/FormatChips.svelte';
  import FileList from './lib/components/FileList.svelte';
  import DownloadAll from './lib/components/DownloadAll.svelte';
  import Icons from './lib/components/Icons.svelte';
  let queue = $state<ReturnType<typeof createQueue>>();
  let unavailable = $state(!supported());
  onMount(() => {
    let cancelled = false;
    if (!unavailable) {
      // Attach worker listeners immediately; the probe finishes before files can be added.
      void probeMaxArea().then(maxArea => {
        if (cancelled) return;
        try {
          const worker = new Worker(new URL('./lib/pipeline.worker.ts', import.meta.url), { type: 'module' });
          queue = createQueue({ worker, maxArea });
        } catch { unavailable = true; }
      });
    }
    return () => { cancelled = true; queue?.dispose(); };
  });
  let dropZone: DropZone;
  let initialReveal = true;
  function revealHero(node: HTMLElement) { if (initialReveal) node.classList.add('reveal'); initialReveal = false; }
  async function focusDrop() { await tick(); dropZone.focus(); }
  function clear() { queue?.clear(); void focusDrop(); }
</script>

<main>
  <header class="reveal">
    <div class="title">Image converter</div>
    <ModeSwitch />
  </header>
  {#if !queue?.fileCount}
    <section use:revealHero class="hero" style="--delay: var(--stagger)">
      <h1>Convert photos to <em>JPEG</em>, <em>PNG</em>, <em>WebP</em> and more, without uploading them.</h1>
      <p>Everything happens in your browser. Your files never leave this device.</p>
    </section>
  {/if}
  <div class="drop-reveal reveal" style="--delay: calc(var(--stagger) * 2)">
    <DropZone bind:this={dropZone} variant={queue?.fileCount ? 'compact' : 'hero'} disabled={!queue}
      message={unavailable ? 'On-device conversion needs a newer browser (Safari 17, Chrome 80 or Firefox 114).'
        : queue?.workerStatus.status === 'unavailable' ? 'The converter stopped. Reload the page to continue.' : undefined}
      onadd={files => { void queue?.add(files); }} />
  </div>
  {#if !queue?.fileCount}
    <div class="empty-formats"><span class="label">Convert to</span>
      <FormatChips value={queue?.format ?? 'jpeg'} onchange={format => queue?.setFormat(format)} disabled={!queue} />
    </div>
  {/if}
  {#if queue?.fileCount}
    <FileList {queue} onclear={clear} onempty={focusDrop} />
    <DownloadAll zip={queue.zip} bytes={queue.bytesOut} />
  {/if}
  <div class="spacer"></div>
  <footer>
    <div><p class="privacy"><Icons name="lock" size={14} />No uploads, no accounts, no tracking.</p>
      <p>Converted files carry no EXIF or location data.</p></div>
    <a href="https://github.com/Shaance/image-converter-client">Source on GitHub</a>
  </footer>
</main>

<style>
  main { max-width: 1200px; min-height: 100svh; margin: 0 auto; padding: 40px 96px 56px; display: flex; flex-direction: column; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
  .title { font: 500 24px var(--serif); white-space: nowrap; }
  .hero { padding: 96px 0 48px; max-width: 760px; }
  h1 { font: 400 56px/1.08 var(--serif); margin: 0 0 20px; letter-spacing: -.01em; text-wrap: pretty; }
  em { color: var(--teal); }
  .hero p { font-size: 18px; line-height: 1.55; color: var(--muted); margin: 0; max-width: 560px; }
  .empty-formats { display: flex; align-items: center; padding-top: 28px; gap: 16px; }
  footer { display: flex; justify-content: space-between; gap: 20px; font-size: 13px; color: var(--muted); border-top: 1px solid var(--rule); padding-top: 20px; margin-top: 0; }
  .spacer { flex-grow: 1; min-height: 64px; }
  footer p { margin: 0; }
  footer p + p { margin-top: 6px; }
  .privacy { display: flex; align-items: center; gap: 6px; }
  footer a { color: var(--muted); white-space: nowrap; }
  @media (max-width: 719px) {
    main { padding: 64px 20px 24px; }
    header { flex-wrap: wrap; }
    .hero { padding: 48px 0; }
    h1 { font-size: 40px; }
    .empty-formats { align-items: baseline; flex-wrap: wrap; }
    footer { flex-direction: column; gap: 12px; margin-top: 0; }
    .spacer { min-height: 40px; }
  }
</style>
