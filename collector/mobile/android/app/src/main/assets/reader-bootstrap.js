(async () => {
  const host = document.querySelector('#results');
  host.textContent = '正在载入资料…';
  try {
    const response = await fetch('/library/data');
    if (!response.ok) throw new Error('连接或授权已失效，请返回 App 检查配对。');
    window.LIBRARY_DATA = await response.json();
    window.LIBRARY_REMOTE = true;
    // Native reader is read-only. Native credentials are never exposed to script.
    const script = document.createElement('script');
    script.src = '/library/assets/library.js';
    document.head.append(script);
  } catch (error) { host.textContent = error.message; }
})();
