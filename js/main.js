// js/main.js

/**
 * —— DOM & 全局状态 ——
 * 获取页面元素和初始化全局变量
 */
const tabs = document.querySelectorAll('.tab'); // 顶部选项卡
const panes = document.querySelectorAll('.pane'); // 对应内容区
const video = document.getElementById('video'); // 摄像头 video 元素
const canvas = document.getElementById('overlay'); // 绘制人脸框的 canvas
const wrapper = document.querySelector('.video-wrapper'); // 视频容器，用于显示/隐藏
const username = document.getElementById('usernameInput'); // 用户输入框
const enrollBtn = document.getElementById('enrollBtn'); // 录入按钮
const recognizeBtn = document.getElementById('recognizeBtn'); // 打卡按钮
const messageDiv = document.getElementById('message'); // 提示信息区域
const logContainer = document.getElementById('logContainer'); // 打卡记录容器
const logBody = document.querySelector('#logTable tbody'); // 打卡记录表格主体
const openFilter = document.getElementById('openFilter'); // 打开筛选弹窗按钮
const showAllBtn = document.getElementById('showAllBtn'); // 查看全部记录按钮
const exportCsvBtn = document.getElementById('exportCsvBtn'); // 导出 CSV 按钮
const exportJsonBtn = document.getElementById('exportJsonBtn'); // 导出 JSON 按钮
const filterModal = document.getElementById('filterModal'); // 筛选弹窗
const filterSelect = document.getElementById('filterSelect'); // 筛选下拉列表
const filterConfirm = document.getElementById('filterConfirm'); // 筛选确认按钮
const filterCancel = document.getElementById('filterCancel'); // 筛选取消按钮

let rawDesc = {}; // 本地存储的人脸描述对象：{ label: [descriptorArray,...], ... }
let faceMatcher = null; // face-api.js 的匹配器
let stream = null; // 摄像头 MediaStream
let enrollInterval = null; // 录入定时器
let recognizeInterval = null; // 识别定时器
let isRecognizing = false; // 打卡中状态标志

/**
 * —— 辅助函数 ——
 * 一些通用工具，不影响核心逻辑
 */

// 显示提示信息
function showMsg(msg, isErr = false) {
  messageDiv.textContent = msg;
  messageDiv.style.color = isErr ? '#f33' : '#8f8';
}

// 启动摄像头，显示 video 容器
async function startVideo() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  wrapper.style.display = 'block';
}

// 关闭摄像头，隐藏 video 容器
function stopVideo() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  wrapper.style.display = 'none';
}

// 从 localStorage 读取人脸描述
function loadDescriptors() {
  rawDesc = JSON.parse(localStorage.getItem('faceDescriptors') || '{}');
}

// 将 rawDesc 写回 localStorage
function saveDescriptors() {
  localStorage.setItem('faceDescriptors', JSON.stringify(rawDesc));
}

// 基于 rawDesc 构建 FaceMatcher 并初始化筛选下拉
function rebuildMatcher() {
  const labeled = Object.entries(rawDesc).map(
    ([lab, arr]) =>
      new faceapi.LabeledFaceDescriptors(
        lab,
        arr.map((d) => new Float32Array(d))
      )
  );
  faceMatcher = labeled.length ? new faceapi.FaceMatcher(labeled, 0.6) : null;
  // （可选）筛选下拉项由打卡记录动态生成，此处暂保留录入标签初始化
  filterSelect.innerHTML = '<option value="">全部</option>';
  Object.keys(rawDesc).forEach((l) => {
    const o = document.createElement('option');
    o.value = o.textContent = l;
    filterSelect.appendChild(o);
  });
}

// 将打卡记录推送到后端写入 attendance.json
async function saveAttendanceToServer(logArr) {
  await fetch('/api/saveAttendance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(logArr),
  });
}

// 读取服务器端的 attendance.json，异常情况下返回空数组
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

// 渲染打卡记录：支持筛选和时间倒序
async function renderLog(filter = '') {
  logBody.innerHTML = '';
  const arr = await loadAttendance();
  // 筛选
  const data = filter ? arr.filter((i) => i.name === filter) : arr;
  // 时间倒序
  data.sort((a, b) => new Date(b.time) - new Date(a.time));
  // 渲染到表格
  for (const item of data) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.name}</td><td>${new Date(
      item.time
    ).toLocaleString()}</td>`;
    logBody.appendChild(tr);
  }
  logContainer.style.display = data.length ? 'block' : 'none';
}

/**
 * —— 核心逻辑 ——
 * 录入与打卡两大功能模块
 */

// 人脸录入：最多扫描 3 秒，检测到后延迟 3 秒保存并提示
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
    // 超时未检测到人脸
    if (elapsed >= timeoutMs) {
      clearInterval(enrollInterval);
      stopVideo();
      return showMsg('录入失败：未检测到人脸', true);
    }
    // 检测单人脸并提取 descriptor
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (det) {
      // 停止扫描，延迟 3 秒写入特征
      clearInterval(enrollInterval);
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

// 人脸识别打卡：5 秒内匹配成功，延迟 3 秒提示；超时失败
async function startRecognition() {
  if (!faceMatcher) return showMsg('请先录入人脸', true);
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

    // 检测所有人脸并获取 descriptors
    const results = await faceapi
      .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors();

    // 同步 canvas 尺寸并清空
    faceapi.matchDimensions(canvas, {
      width: video.videoWidth,
      height: video.videoHeight,
    });
    const resized = faceapi.resizeResults(results, {
      width: video.videoWidth,
      height: video.videoHeight,
    });
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (resized.length > 0) {
      // 取第一张脸尝试匹配
      const best = faceMatcher.findBestMatch(resized[0].descriptor);
      new faceapi.draw.DrawBox(resized[0].detection.box, {
        label: best.toString(),
      }).draw(canvas);

      if (best.label !== 'unknown') {
        // 匹配成功：停止扫描，延迟 3 秒保存并提示
        clearInterval(recognizeInterval);
        setTimeout(async () => {
          stopVideo();
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

    // 超过失败阈值未匹配，提示失败
    if (elapsed >= failureTimeoutMs) {
      clearInterval(recognizeInterval);
      stopVideo();
      isRecognizing = false;
      return showMsg('识别失败：未匹配到已录入人脸', true);
    }
  }, scanIntervalMs);
}

/**
 * —— 事件绑定 & 初始化 ——
 */
// 页面加载完成后初始化模型和匹配器
document.addEventListener('DOMContentLoaded', async () => {
  showMsg('模型加载中…');
  await faceapi.nets.tinyFaceDetector.loadFromUri('./models');
  await faceapi.nets.faceLandmark68Net.loadFromUri('./models');
  await faceapi.nets.faceRecognitionNet.loadFromUri('./models');
  loadDescriptors();
  rebuildMatcher();
  showMsg('准备就绪');
});

// 顶部 Tab 切换逻辑
tabs.forEach((t) => {
  t.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.remove('active'));
    panes.forEach((p) => p.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.tab).classList.add('active');
    // 切到记录页时刷新并清空筛选
    if (t.dataset.tab === 'records') {
      filterSelect.value = '';
      renderLog();
    }
  });
});

// 各按钮绑定事件
enrollBtn.addEventListener('click', enrollFace);
recognizeBtn.addEventListener('click', startRecognition);
openFilter.addEventListener('click', async () => {
  // 弹窗前动态加载有记录的人员
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
  // 手动切换到“打卡记录”标签
  tabs.forEach((t) => t.classList.remove('active'));
  panes.forEach((p) => p.classList.remove('active'));
  document.querySelector('.tab[data-tab="records"]').classList.add('active');
  document.getElementById('records').classList.add('active');
  // 带筛选渲染
  renderLog(filter);
});
showAllBtn.addEventListener('click', () => {
  filterSelect.value = '';
  document.querySelector('.tab[data-tab="records"]').click();
});

// 导出 CSV
exportCsvBtn.addEventListener('click', async () => {
  const all = await loadAttendance();
  const filter = filterSelect.value;
  let arr = filter ? all.filter((i) => i.name === filter) : all;
  if (!arr.length) return showMsg('当前没有记录可导出', true);
  arr.sort((a, b) => new Date(b.time) - new Date(a.time));
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

// 清除所有人脸及打卡记录
document.getElementById('resetBtn').addEventListener('click', async () => {
  if (!confirm('确认要清空所有人脸和记录吗？')) return;
  localStorage.removeItem('faceDescriptors');
  localStorage.removeItem('attendanceLog');
  rebuildMatcher();
  await saveAttendanceToServer([]);
  showMsg('已清空所有人脸和打卡记录，请刷新页面重新录入', false);
});

// 同步 canvas 尺寸，保证绘制准确
video.addEventListener('play', () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
});
