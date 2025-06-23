// js/main.js

// ==== DOM 引用 ====
const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const usernameInput = document.getElementById('usernameInput');
const enrollBtn = document.getElementById('enrollBtn');
const recognizeBtn = document.getElementById('recognizeBtn');
const showLogBtn = document.getElementById('showLogBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const messageDiv = document.getElementById('message');
const logContainer = document.getElementById('logContainer');
const logTableBody = document.querySelector('#logTable tbody');

let rawDescriptors = {}; // { label: [ [descriptorArray], … ], … }
let faceMatcher = null;
let enrollInterval = null;
let recognizeInterval = null;
let isRecognizing = false;

/** 显示摄像头 & 画布 */
function showCamera() {
  video.style.display = 'block';
  canvas.style.display = 'block';
}
/** 隐藏摄像头 & 画布 */
function hideCamera() {
  video.style.display = 'none';
  canvas.style.display = 'none';
}

/** 1. 加载 face-api 模型 */
async function loadModels() {
  const M = './models';
  await faceapi.nets.tinyFaceDetector.loadFromUri(M);
  await faceapi.nets.faceLandmark68Net.loadFromUri(M);
  await faceapi.nets.faceRecognitionNet.loadFromUri(M);
}

/** 2. 启动摄像头（安全上下文下） */
function startVideo() {
  if (navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        video.srcObject = stream;
      })
      .catch((err) => {
        console.error(err);
        showMessage('无法访问摄像头', true);
      });
  } else {
    showMessage('浏览器不支持 getUserMedia', true);
  }
}

/** 3. 从项目文件 descriptors.json 读取已有人脸描述 */
async function fetchDescriptors() {
  try {
    const res = await fetch('descriptors.json');
    rawDescriptors = res.ok ? await res.json() : {};
  } catch (e) {
    console.warn('读取 descriptors.json 失败，使用空列表');
    rawDescriptors = {};
  }
}

/** 4. 将 rawDescriptors 转为 LabeledFaceDescriptors */
function loadLabeledDescriptors() {
  return Object.entries(rawDescriptors).map(
    ([label, arr]) =>
      new faceapi.LabeledFaceDescriptors(
        label,
        arr.map((d) => new Float32Array(d))
      )
  );
}

/** 5. 构建或刷新 FaceMatcher */
function rebuildMatcher() {
  const labeled = loadLabeledDescriptors();
  if (labeled.length) {
    faceMatcher = new faceapi.FaceMatcher(labeled, 0.6);
    showMessage(`已载入 ${labeled.length} 人脸`);
  } else {
    faceMatcher = null;
    showMessage('暂无已录入人脸');
  }
}

/** 6. 将 rawDescriptors 写出为 JSON 文件，触发下载 */
async function saveDescriptors() {
  try {
    await fetch('/api/saveDescriptors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rawDescriptors),
    });
    showMessage('人脸信息已自动保存到服务器 descriptors.json');
  } catch (e) {
    console.error(e);
    showMessage('保存到服务器失败，请检查后端是否启动', true);
  }
}

/** 7. 人脸录入流程：弹出摄像头，连续检测直到成功 */
function enrollFace() {
  const label = usernameInput.value.trim();
  if (!label) {
    return showMessage('请输入姓名再录入', true);
  }
  if (enrollInterval) clearInterval(enrollInterval);

  showCamera();
  showMessage('录入中，请正对摄像头');
  enrollInterval = setInterval(async () => {
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (det) {
      clearInterval(enrollInterval);
      rawDescriptors[label] = rawDescriptors[label] || [];
      rawDescriptors[label].push(Array.from(det.descriptor));
      rebuildMatcher();
      saveDescriptors();
      hideCamera();
      showMessage(`录入成功：${label}`);
    }
  }, 500);
}

/** 8. 打卡识别流程：弹出摄像头，连续检测直到匹配 */
function startRecognition() {
  if (!faceMatcher) {
    return showMessage('请先录入人脸', true);
  }
  if (isRecognizing) {
    // 取消识别
    clearInterval(recognizeInterval);
    isRecognizing = false;
    hideCamera();
    showMessage('已取消打卡');
    return;
  }

  isRecognizing = true;
  showCamera();
  showMessage('打卡中，请正对摄像头');

  recognizeInterval = setInterval(async () => {
    const results = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();
    const size = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, size);
    const resized = faceapi.resizeResults(results, size);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const r of resized) {
      const best = faceMatcher.findBestMatch(r.descriptor);
      new faceapi.draw.DrawBox(r.detection.box, {
        label: best.toString(),
      }).draw(canvas);
      if (best.label !== 'unknown') {
        clearInterval(recognizeInterval);
        isRecognizing = false;
        hideCamera();
        logAttendance(best.label);
        showMessage(
          `打卡成功：${best.label} ${new Date().toLocaleTimeString()}`
        );
        return;
      }
    }
  }, 300);
}

/** 9. 保存打卡记录到 localStorage */
function logAttendance(name) {
  const log = JSON.parse(localStorage.getItem('attendanceLog') || '[]');
  log.push({ name, time: new Date().toISOString() });
  localStorage.setItem('attendanceLog', JSON.stringify(log));
}

/** 10. 渲染打卡记录表格 */
function renderLog() {
  const log = JSON.parse(localStorage.getItem('attendanceLog') || '[]');
  logTableBody.innerHTML = '';
  log.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.name}</td><td>${new Date(
      item.time
    ).toLocaleString()}</td>`;
    logTableBody.appendChild(tr);
  });
  logContainer.style.display = log.length ? 'block' : 'none';
}

/** 11. 导出 CSV */
function exportCsv() {
  const log = JSON.parse(localStorage.getItem('attendanceLog') || '[]');
  if (!log.length) return showMessage('暂无记录可导出', true);
  const header = ['姓名', '时间'];
  const rows = log.map((i) =>
    [`"${i.name}"`, `"${new Date(i.time).toLocaleString()}"`].join(',')
  );
  const csv = [header.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 12. 页面提示 */
function showMessage(msg, isError = false) {
  messageDiv.textContent = msg;
  messageDiv.style.color = isError ? '#f33' : '#8f8';
}

// ==== 事件绑定 & 初始化 ====
enrollBtn.addEventListener('click', enrollFace);
recognizeBtn.addEventListener('click', startRecognition);
showLogBtn.addEventListener('click', renderLog);
exportCsvBtn.addEventListener('click', exportCsv);

video.addEventListener('play', () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
});

// 页面加载
document.addEventListener('DOMContentLoaded', async () => {
  showMessage('初始化中…');
  try {
    await loadModels();
    await fetchDescriptors();
    startVideo();
    rebuildMatcher();
    hideCamera();
    showMessage('准备就绪');
  } catch (e) {
    console.error(e);
    showMessage('初始化失败，请刷新重试', true);
  }
});
