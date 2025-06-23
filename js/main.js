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
function renderLog(filter = '') {
  logBody.innerHTML = '';
  loadAttendance().then((arr) => {
    const data = filter ? arr.filter((i) => i.name === filter) : arr;
    data.forEach((i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i.name}</td><td>${new Date(
        i.time
      ).toLocaleString()}</td>`;
      logBody.appendChild(tr);
    });
    logContainer.style.display = data.length ? 'block' : 'none';
  });
}

// —— 核心逻辑 ——

async function enrollFace() {
  const lab = username.value.trim();
  if (!lab) return showMsg('请输入姓名', true);
  clearInterval(enrollInterval);
  await startVideo();
  showMsg('录入中...');
  enrollInterval = setInterval(async () => {
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (det) {
      clearInterval(enrollInterval);
      stopVideo();
      rawDesc[lab] = rawDesc[lab] || [];
      rawDesc[lab].push(Array.from(det.descriptor));
      saveDescriptors();
      rebuildMatcher();
      showMsg(`录入成功：${lab}`);
    }
  }, 500);
}

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

  recognizeInterval = setInterval(async () => {
    const results = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();

    // 同步 Canvas 大小
    const size = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, size);
    const resized = faceapi.resizeResults(results, size);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (resized.length === 0) {
      // 如果一帧都没检测到人脸，就继续等下一帧
      return;
    }

    // 这里只取第一张脸来做示例
    const descriptor = resized[0].descriptor;
    const best = faceMatcher.findBestMatch(descriptor);
    new faceapi.draw.DrawBox(resized[0].detection.box, {
      label: best.toString(),
    }).draw(canvas);

    if (best.label === 'unknown') {
      // 无匹配：停止打卡，提示失败
      clearInterval(recognizeInterval);
      isRecognizing = false;
      stopVideo();
      return showMsg('识别失败：未匹配到已录入人脸', true);
    }

    // 匹配成功：记录打卡并退出
    clearInterval(recognizeInterval);
    isRecognizing = false;
    stopVideo();

    const logArr = await loadAttendance();
    logArr.push({ name: best.label, time: new Date().toISOString() });
    await saveAttendanceToServer(logArr);

    showMsg(`打卡成功：${best.label} 时间 ${new Date().toLocaleTimeString()}`);
  }, 200);
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
    tabs.forEach((x) => x.classList.remove('active'));
    panes.forEach((p) => p.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.tab).classList.add('active');
  });
});

// Buttons
enrollBtn.addEventListener('click', enrollFace);
recognizeBtn.addEventListener('click', startRecognition);
openFilter.addEventListener('click', () => filterModal.classList.add('show'));
filterCancel.addEventListener('click', () =>
  filterModal.classList.remove('show')
);
filterConfirm.addEventListener('click', () => {
  renderLog(filterSelect.value);
  filterModal.classList.remove('show');
  document.querySelector('.tab[data-tab="records"]').click();
});
showAllBtn.addEventListener('click', () => {
  renderLog();
  document.querySelector('.tab[data-tab="records"]').click();
});
exportCsvBtn.addEventListener(
  'click',
  () => renderLog() || alert('请先“查看全部”后再导出') || location.reload()
);
exportJsonBtn.addEventListener(
  'click',
  () => renderLog() || alert('请先“查看全部”后再导出') || location.reload()
);

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('确认要清空所有人脸和记录吗？')) return;
  localStorage.removeItem('faceDescriptors');
  localStorage.removeItem('attendanceLog');
  showMsg('已清空本地数据，请刷新页面重新录入', false);
});
