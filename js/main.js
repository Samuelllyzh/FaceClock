// js/main.js

// —— DOM & 全局状态 ——
const tabs = document.querySelectorAll('.tab');
const panes = document.querySelectorAll('.pane');
const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const wrapper = document.querySelector('.video-wrapper');
const username = document.getElementById('usernameInput');
const enrollBtn = document.getElementById('enrollBtn');
const recognizeBtn = document.getElementById('recognizeBtn');
const messageDiv = document.getElementById('message');
const logContainer = document.getElementById('logContainer');
const logBody = document.querySelector('#logTable tbody');
const openFilter = document.getElementById('openFilter');
const showAllBtn = document.getElementById('showAllBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const filterModal = document.getElementById('filterModal');
const filterSelect = document.getElementById('filterSelect');
const filterConfirm = document.getElementById('filterConfirm');
const filterCancel = document.getElementById('filterCancel');

let rawDesc = {}; // { label: [descriptor,...], ... }
let faceMatcher = null;
let stream = null;
let enrollInterval = null;
let recognizeInterval = null;
let isRecognizing = false;

// —— 辅助函数 ——
function showMsg(msg, isErr = false) {
  messageDiv.textContent = msg;
  messageDiv.style.color = isErr ? '#f33' : '#8f8';
}
async function startVideo() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  wrapper.style.display = 'block';
}
function stopVideo() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  wrapper.style.display = 'none';
}
function loadDescriptors() {
  rawDesc = JSON.parse(localStorage.getItem('faceDescriptors') || '{}');
}
function saveDescriptors() {
  localStorage.setItem('faceDescriptors', JSON.stringify(rawDesc));
}
function rebuildMatcher() {
  const labeled = Object.entries(rawDesc).map(
    ([lab, arr]) =>
      new faceapi.LabeledFaceDescriptors(
        lab,
        arr.map((d) => new Float32Array(d))
      )
  );
  faceMatcher = labeled.length ? new faceapi.FaceMatcher(labeled, 0.6) : null;
  // 填充 Filter 下拉
  filterSelect.innerHTML = '<option value="">全部</option>';
  Object.keys(rawDesc).forEach((l) => {
    const o = document.createElement('option');
    o.value = o.textContent = l;
    filterSelect.appendChild(o);
  });
}
async function saveAttendanceToServer(logArr) {
  await fetch('/api/saveAttendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(logArr),
  });
}
// 读取 attendance.json，确保任何异常都返回空数组
async function loadAttendance() {
  try {
    const res = await fetch('/attendance.json');
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.trim()) return [];
    return JSON.parse(text);
  } catch (e) {
    console.warn('loadAttendance error:', e);
    return [];
  }
}
// 渲染打卡记录，可传入 nameFilter（'' 为不筛选）
async function renderLog(filter = '') {
  logBody.innerHTML = '';
  const arr = await loadAttendance();
  // ① 过滤
  const data = filter ? arr.filter((i) => i.name === filter) : arr;
  // ② 倒序
  data.sort((a, b) => new Date(b.time) - new Date(a.time));
  // ③ 渲染
  for (const item of data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.name}</td><td>${new Date(
      item.time
    ).toLocaleString()}</td>`;
    logBody.appendChild(tr);
  }
  logContainer.style.display = data.length ? 'block' : 'none';
}

// —— 核心逻辑 ——

// 录入：最多扫描 3 秒，检测到人脸后等待 3 秒再完成；超时后提示失败
async function enrollFace() {
  const lab = username.value.trim();
  if (!lab) return showMsg('请输入姓名', true);

  clearInterval(enrollInterval);
  showMsg('录入中…请正对摄像头');
  await startVideo();

  const startTime = Date.now();
  const timeoutMs = 3000; // 最大扫描 3 秒
  const scanIntervalMs = 200; // 每 200ms 扫描一次

  enrollInterval = setInterval(async () => {
    const elapsed = Date.now() - startTime;
    // 超过 3 秒还没检测到
    if (elapsed >= timeoutMs) {
      clearInterval(enrollInterval);
      stopVideo();
      return showMsg('录入失败：未检测到人脸', true);
    }
    // 尝试检测
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (det) {
      // 检测到 descriptor，先停扫描
      clearInterval(enrollInterval);
      // 延迟 3 秒再写入
      setTimeout(() => {
        rawDesc[lab] = rawDesc[lab] || [];
        rawDesc[lab].push(Array.from(det.descriptor));
        saveDescriptors();
        rebuildMatcher();
        stopVideo();
        showMsg(`录入成功：${lab}`);
      }, 3000);
    }
  }, scanIntervalMs);
}

// 识别：成功后再等 3 秒提示，5 秒内才算有效；超时 5 秒后提示失败
async function startRecognition() {
  if (!faceMatcher) {
    return showMsg('请先录入人脸', true);
  }
  if (isRecognizing) {
    clearInterval(recognizeInterval);
    isRecognizing = false;
    stopVideo();
    return showMsg('已取消打卡');
  }

  isRecognizing = true;
  showMsg('打卡中…请正对摄像头');
  await startVideo();

  const startTime = Date.now();
  const failureTimeoutMs = 5000; // 5 秒后算失败
  const scanIntervalMs = 200; // 每 200ms 扫描一次

  recognizeInterval = setInterval(async () => {
    const elapsed = Date.now() - startTime;

    // 检测人脸描述
    const results = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();

    // 同步画布
    const size = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, size);
    const resized = faceapi.resizeResults(results, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (resized.length > 0) {
      const best = faceMatcher.findBestMatch(resized[0].descriptor);
      new faceapi.draw.DrawBox(resized[0].detection.box, {
        label: best.toString(),
      }).draw(canvas);

      if (best.label !== 'unknown') {
        // 成功匹配：先停扫描，再延迟 3 秒提示
        clearInterval(recognizeInterval);
        setTimeout(async () => {
          stopVideo();
          // 写入记录
          const logArr = await loadAttendance();
          logArr.push({ name: best.label, time: new Date().toISOString() });
          await saveAttendanceToServer(logArr);
          showMsg(
            `打卡成功：${best.label} 时间 ${new Date().toLocaleTimeString()}`
          );
          isRecognizing = false;
        }, 3000);
        return;
      }
    }

    // 如果到 5 秒还没匹配成功，则失败
    if (elapsed >= failureTimeoutMs) {
      clearInterval(recognizeInterval);
      stopVideo();
      isRecognizing = false;
      return showMsg('识别失败：未匹配到已录入人脸', true);
    }

    // 否则继续下一次扫描
  }, scanIntervalMs);
}

// —— 事件绑定 & 初始化 ——
document.addEventListener('DOMContentLoaded', async () => {
  showMsg('模型加载中…');
  await faceapi.nets.tinyFaceDetector.loadFromUri('./models');
  await faceapi.nets.faceLandmark68Net.loadFromUri('./models');
  await faceapi.nets.faceRecognitionNet.loadFromUri('./models');
  loadDescriptors();
  rebuildMatcher();
  showMsg('准备就绪');
});

// Tabs 切换
tabs.forEach((t) => {
  t.addEventListener('click', () => {
    // 1. 切换样式
    tabs.forEach((x) => x.classList.remove('active'));
    panes.forEach((p) => p.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.tab).classList.add('active');

    // 2. 如果是“打卡记录”页
    if (t.dataset.tab === 'records') {
      // 清空筛选条件
      filterSelect.value = '';
      // 刷新全部记录
      renderLog();
    }
  });
});

// Buttons
enrollBtn.addEventListener('click', enrollFace);
recognizeBtn.addEventListener('click', startRecognition);
openFilter.addEventListener('click', async () => {
  const all = await loadAttendance();
  const names = [...new Set(all.map((i) => i.name))];
  filterSelect.innerHTML = '<option value="">全部</option>';
  names.forEach((n) => {
    const o = document.createElement('option');
    o.value = o.textContent = n;
    filterSelect.appendChild(o);
  });
  filterModal.classList.add('show');
});
filterCancel.addEventListener('click', () =>
  filterModal.classList.remove('show')
);
filterConfirm.addEventListener('click', () => {
  const filter = filterSelect.value;
  filterModal.classList.remove('show');

  // 手动切换到“打卡记录”标签页（绕过 tabs.forEach 里的清空筛选逻辑）
  tabs.forEach((t) => t.classList.remove('active'));
  panes.forEach((p) => p.classList.remove('active'));
  document.querySelector('.tab[data-tab="records"]').classList.add('active');
  document.getElementById('records').classList.add('active');

  // 渲染带筛选的最新记录
  renderLog(filter);
});
showAllBtn.addEventListener('click', () => {
  // 切换到“打卡记录”标签页。renderLog() 在标签的 click 监听里自动调用一次
  filterSelect.value = ''; // 可选：清空筛选条件
  document.querySelector('.tab[data-tab="records"]').click();
});
// 导出 CSV
exportCsvBtn.addEventListener('click', async () => {
  const all = await loadAttendance();
  const filter = filterSelect.value;
  let arr = filter ? all.filter((i) => i.name === filter) : all;
  if (!arr.length) return showMsg('当前没有记录可导出', true);

  // 倒序
  arr.sort((a, b) => new Date(b.time) - new Date(a.time));

  // 构造 CSV 并加 BOM
  const header = ['姓名', '时间'];
  const rows = arr.map((i) =>
    [`"${i.name}"`, `"${new Date(i.time).toLocaleString()}"`].join(',')
  );
  const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// 导出 JSON
exportJsonBtn.addEventListener('click', async () => {
  const all = await loadAttendance();
  const filter = filterSelect.value;
  let arr = filter ? all.filter((i) => i.name === filter) : all;
  if (!arr.length) return showMsg('当前没有记录可导出', true);

  // 倒序
  arr.sort((a, b) => new Date(b.time) - new Date(a.time));

  const blob = new Blob([JSON.stringify(arr, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('确认要清空所有人脸和记录吗？')) return;
  // 清本地人脸
  localStorage.removeItem('faceDescriptors');
  rebuildMatcher();

  // 清服务器打卡记录
  await saveAttendanceToServer([]);
  showMsg('已清空所有人脸和打卡记录，请刷新页面重新录入', false);
});

video.addEventListener('play', () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
});
