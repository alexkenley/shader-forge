const root = document.getElementById('code-bridge-root');

if (root) {
  root.innerHTML = `
    <div class="bridge-bar">
      <div class="bridge-title">Shader Forge Code Bridge</div>
      <div class="bridge-meta">Preserved editor source retained. Standalone extraction in progress.</div>
    </div>
    <section class="bridge-panel">
      <h1>Legacy code workspace preserved</h1>
      <p>
        The Guardian-derived code editor internals are still in this repo, but the old dashboard shell is not
        being used as a live entry point anymore. Shader Forge will replace that outer chrome with a native
        editor dock and a dedicated multi-terminal surface.
      </p>
      <ul class="bridge-list">
        <li>Preserved Monaco/search code remains under <code>web/js/pages/code.js</code>.</li>
        <li>The React shell owns the main editor layout and runtime-facing docks.</li>
        <li>The next major chunk is a proper PTY-backed terminal dock with multiple tabs.</li>
      </ul>
      <div class="bridge-code">retained source: web/js/pages/code.js
retained styling: web/css/style.css
next extraction target: shell/engine-shell/src</div>
    </section>
  `;
}
