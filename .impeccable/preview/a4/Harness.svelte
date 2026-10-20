<script lang="ts">const prepare = () => { void window.a4controller.prepare({ kind: 'delete-cache', cacheName: 'assets' }); };</script>
<aside aria-label="Test harness" style="position:fixed;bottom:30px;right:12px;z-index:1"><button onclick={prepare}>Prepare fixture action</button><button onclick={() => window.a4finish?.()}>Finish fixture action</button></aside>
