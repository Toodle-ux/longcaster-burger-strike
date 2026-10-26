import {t} from './i18n.mjs?v=9';
export function setupLocalVideo({video, input, controls, playButton, replayButton, closeButton, time, beforeSelect, onSource, onMessage}) {
  let url = null, generation = 0;
  const clock = seconds => {
    const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return `${String(Math.floor(value / 60)).padStart(2,'0')}:${String(value % 60).padStart(2,'0')}`;
  };
  function update() {
    playButton.textContent=t(video.ended?'重新播放':video.paused?'播放':'暂停');
    playButton.setAttribute('aria-label',t(video.paused?'播放本地视频':'暂停本地视频'));
    time.textContent = `${clock(video.currentTime)} / ${clock(video.duration)}`;
  }
  function clear() {
    generation++;
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (url) URL.revokeObjectURL(url);
    url = null;
    controls.hidden = closeButton.hidden = true;
    onSource(false);
  }
  async function play() {
    const request = generation;
    try { await video.play(); }
    catch (error) {
      if (request !== generation || !url) return;
      if (error.name === 'NotAllowedError') onMessage('视频已就绪，点击“播放”继续。');
      else if (error.name !== 'AbortError') {
        clear();
        onMessage('视频无法播放，请尝试 MP4（H.264）格式。');
      }
    }
    update();
  }
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.type && !file.type.startsWith('video/')) {
      onMessage('请选择视频文件。'); input.value=''; return;
    }
    beforeSelect();
    clear();
    // A blob URL reads the file on this device; no upload or full-file copy.
    url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    controls.hidden = closeButton.hidden = false;
    onSource(true);
    input.value='';
    play();
  });
  video.addEventListener('error', () => {
    if (!url || !video.error) return;
    clear(); onMessage('无法解码这个视频，请尝试 MP4（H.264）格式。');
  });
  for (const event of ['loadedmetadata','timeupdate','play','pause','ended']) video.addEventListener(event, update);
  playButton.addEventListener('click', () => {
    if (!url) return;
    if (video.paused || video.ended) { if (video.ended) video.currentTime=0; play(); }
    else video.pause();
  });
  replayButton.addEventListener('click', () => { if (url) { video.currentTime=0; play(); } });
  closeButton.addEventListener('click', () => {clear(); onMessage('已关闭视频，返回演示背景。');});
  return {choose:() => input.click(), clear, hasSource:() => Boolean(url),refreshLabels:update};
}
