const video = document.getElementById('video');
const canvas = document.getElementById('overlay');

// 加载模型
async function loadModels() {
  const MODEL_URL = './models';
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
}

// 启动摄像头
function startVideo() {
  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((stream) => (video.srcObject = stream))
    .catch((err) => console.error('Camera error:', err));
}

// 每帧检测并绘制
video.addEventListener('play', () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const displaySize = { width: video.videoWidth, height: video.videoHeight };
  faceapi.matchDimensions(canvas, displaySize);

  setInterval(async () => {
    const detections = await faceapi.detectAllFaces(
      video,
      new faceapi.TinyFaceDetectorOptions()
    );
    const resized = faceapi.resizeResults(detections, displaySize);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    faceapi.draw.drawDetections(canvas, resized);
    // 若需绘制关键点： faceapi.draw.drawFaceLandmarks(canvas, resized);
  }, 100);
});

// 初始化
(async () => {
  await loadModels();
  startVideo();
})();
