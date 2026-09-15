<fieldset aria-label="Conversion mode">
  <label class="selected"><input class="visually-hidden" type="radio" name="mode" checked />On device</label>
  <label class="server"><input class="visually-hidden" type="radio" name="mode" disabled />
    Server <span>coming back soon</span>
  </label>
</fieldset>

<style>
  fieldset { display: flex; margin: 0; border: 1px solid var(--rule); border-radius: 999px; padding: 3px; gap: 2px; font-size: 13px; }
  label { padding: 7px 14px; border-radius: 999px; display: flex; align-items: center; gap: 6px; }
  .selected { background: var(--ink); color: var(--bg); font-weight: 500; }
  label:has(:focus-visible) { outline: 2px solid var(--teal); outline-offset: 2px; }
  .server { color: var(--faint); }
  span { color: var(--terracotta); font-weight: 500; letter-spacing: .02em; font-size: 13px; }
  @media (max-width: 719px) {
    label { padding: 6px 11px; }
    .server { flex-wrap: wrap; justify-content: center; gap: 2px 6px; }
  }
</style>
