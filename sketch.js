const remoteVideo = document.getElementById('remote-video');
const setupScreen = document.getElementById('setup-screen');
const gameScreen = document.getElementById('game-screen');
const statusMsg = document.getElementById('status-msg');
const aiHandDisplay = document.getElementById('ai-hand');
const gameOverScreen = document.getElementById('game-over-screen');
const qrcodeContainer = document.getElementById('qrcode-container');
const countdownElt = document.getElementById('countdown');

let peer; // PeerJS 物件
let gameState = "SETUP"; // SETUP (顯示QR Code), WAITING_FOR_START (等待玩家比讚開始), WAITING (等待玩家出拳), COUNTDOWN, RESULT, COOLDOWN, ENDED
let currentUserGesture = "UNKNOWN";
let isProcessing = false; // 防止運算堆疊導致卡死

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

// 1. 處理 PeerJS 連線
const urlParams = new URLSearchParams(window.location.search);
const remoteId = urlParams.get('join');

if (remoteId) {
    // 手機端模式
    setupScreen.innerHTML = "<h2 style='color:#00f3ff'>STREAMING TO HOST...</h2>";
    peer = new Peer();
    peer.on('open', (id) => {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
            .then(stream => {
                peer.call(remoteId, stream);
            });
    });
} else {
    // 電腦展示端模式
    peer = new Peer();
    peer.on('open', (id) => {
        const joinUrl = `${window.location.origin}${window.location.pathname}?join=${id}`;
        new QRCode(qrcodeContainer, { text: joinUrl, width: 180, height: 180 });
    });

    peer.on('call', (call) => {
        call.answer();
        call.on('stream', (stream) => {
            remoteVideo.srcObject = stream;
            // 確保影片播放
            remoteVideo.onloadedmetadata = () => {
                remoteVideo.play().catch(e => console.error("Play error:", e));
            };
            setupScreen.style.display = 'none';
            gameScreen.style.display = 'block';
            gameState = "WAITING_FOR_START"; // 掃描完成，等待玩家比讚開始遊戲
            initHandTracking();
        });
    });
}

// 2. 手勢辨識設定
function initHandTracking() {
    hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0, // 降低複雜度以提升效能，防止卡頓
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7
    });
    hands.onResults(onResults);
    
    async function processFrame() {
        if (remoteVideo.readyState >= 2 && !remoteVideo.paused && !isProcessing) {
            try {
                isProcessing = true;
                await hands.send({ image: remoteVideo });
            } catch (e) {
                console.error("MediaPipe error:", e);
            } finally {
                isProcessing = false; // 確保無論成功或失敗，isProcessing 都會被重置
            }
        }
        requestAnimationFrame(processFrame);
    }
    processFrame();
}

function onResults(results) {
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;
    
    const landmarks = results.multiHandLandmarks[0];
    currentUserGesture = detectGesture(landmarks);

    if (gameState === "SETUP") {
        // 在設定階段不處理手勢
        return;
    }

    if (gameState === "WAITING_FOR_START" && currentUserGesture === "THUMBS_UP") {
        statusMsg.innerText = "偵測中... 請出拳！"; // 第一次開始遊戲，提示出拳
        startCountdown();
    } else if (gameState === "WAITING" && ["ROCK", "PAPER", "SCISSORS"].includes(currentUserGesture)) {
        startCountdown();
    } else if ((gameState === "COUNTDOWN" || gameState === "RESULT") && currentUserGesture === "THUMBS_DOWN") {
        // 如果偵測到倒讚，直接結束遊戲
        gameOver();
    } else if (gameState === "COOLDOWN" && currentUserGesture === "THUMBS_UP") {
        resetGame();
    } else if (gameState === "ENDED" && currentUserGesture === "THUMBS_UP") {
        resetGame(); // 從遊戲結束畫面重新開始
    }
}

// 3. 猜拳手勢邏輯辨識
function detectGesture(lm) {
    const fingerTips = [8, 12, 16, 20];
    const fingerBases = [6, 10, 14, 18];
    let openFingers = 0;

    for (let i = 0; i < 4; i++) {
        if (lm[fingerTips[i]].y < lm[fingerBases[i]].y) openFingers++;
    }

    // 優化比讚辨識：拇指尖端 (4) 垂直高度明顯高於拇指指根 (2)，且其他手指收起
    // 更加靈敏的比讚辨識：拇指尖端 (4) 只要高於拇指掌指關節 (2) 且其他手指收起
    const thumbPointingUp = lm[4].y < lm[2].y; // 拇指尖端 (4) 的 Y 座標小於拇指掌指關節 (2) 的 Y 座標，表示拇指向上
    const otherFingersClosed = openFingers === 0; // 其他四指都閉合

    // 新增倒讚辨識：拇指尖端 (4) 垂直高度明顯低於拇指掌指關節 (2)，且其他手指收起
    const thumbPointingDown = lm[4].y > lm[2].y;

    const thumbUp = thumbPointingUp && otherFingersClosed;

    // 簡單判斷邏輯
    if (thumbUp) return "THUMBS_UP";
    if (openFingers === 0) return "ROCK";
    if (openFingers === 2) return "SCISSORS";
    if (openFingers === 4) return "PAPER";
    if (thumbPointingDown && otherFingersClosed) return "THUMBS_DOWN";
    return "UNKNOWN";
}

// 4. 遊戲流程
const moves = ["ROCK", "PAPER", "SCISSORS"];
const emojis = { ROCK: "✊", PAPER: "✋", SCISSORS: "✌️", UNKNOWN: "❓" };

function startCountdown() {
    gameState = "COUNTDOWN";
    let count = 3;
    countdownElt.style.display = "block";
    
    const timer = setInterval(() => {
        if (count > 0) {
            countdownElt.innerText = count;
            statusMsg.innerText = `準備... ${count}`;
            aiHandDisplay.innerText = "🎲"; // 轉動中
            count--;
        } else {
            clearInterval(timer);
            countdownElt.style.display = "none";
            playRPS();
        }
    }, 800);
}

function playRPS() {
    gameState = "RESULT";
    const aiMove = moves[Math.floor(Math.random() * 3)];
    aiHandDisplay.innerText = emojis[aiMove];
    
    const userGesture = currentUserGesture; // 取得揭曉瞬間的手勢

    let result = "";
    if (userGesture === "UNKNOWN") {
        result = "MISSED (偵測失敗)";
    } else if (userGesture === aiMove) {
        result = "DRAW (平手)";
    } else if (
        (userGesture === "ROCK" && aiMove === "SCISSORS") ||
        (userGesture === "PAPER" && aiMove === "ROCK") ||
        (userGesture === "SCISSORS" && aiMove === "PAPER")
    ) {
        result = "YOU WIN! (玩家勝利)";
        spawnConfetti();
    } else {
        result = "YOU LOSE! (玩家失敗)";
        spawnLosingEffect(); // 觸發全螢幕噴氣
    }

    statusMsg.innerHTML = `<span style="color:white">${result}</span><br>比出 👍 手勢以重新開始`;
    currentUserGesture = "UNKNOWN"; // 重置手勢，避免立即跳轉到下一局
    gameState = "COOLDOWN";
}

function gameOver() {
    gameState = "ENDED";
    gameScreen.style.display = 'none';
    gameOverScreen.style.display = 'flex'; // 顯示遊戲結束畫面
    statusMsg.innerText = "遊戲結束！"; // 更新狀態訊息
    aiHandDisplay.innerText = "💀"; // AI 顯示骷髏頭
    currentUserGesture = "UNKNOWN"; // 重置手勢
    // 這裡不應該呼叫 startCountdown()，因為遊戲已經結束
}

function resetGame() {
    // 根據前一個狀態決定下一個狀態和提示訊息
    if (gameState === "ENDED") {
        gameState = "WAITING_FOR_START";
        statusMsg.innerText = "掃描完成，請比 👍 手勢開始遊戲！";
    } else { // 從 COOLDOWN 狀態回來，表示要開始新一局
        gameState = "WAITING";
        statusMsg.innerText = "偵測中... 請出拳！";
    }
    aiHandDisplay.innerText = "🤖";
    gameOverScreen.style.display = 'none'; // 隱藏遊戲結束畫面
    currentUserGesture = "UNKNOWN"; // 重置手勢，確保重新開始時沒有殘留的比讚手勢
}

function spawnConfetti() {
    const duration = 3 * 1000;
    const end = Date.now() + duration;
    const colors = ['#00f3ff', '#ff00ff', '#ffffff'];

    (function frame() {
        // 全螢幕隨機爆發
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0, y: 0.6 }, colors: colors });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1, y: 0.6 }, colors: colors });
        if (Math.random() < 0.1) {
            confetti({ particleCount: 20, startVelocity: 30, spread: 360, origin: { x: Math.random(), y: Math.random() }, colors: colors });
        }

        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}

function spawnLosingEffect() {
    // 全螢幕明顯噴氣效果 (灰白色系)
    confetti({
        particleCount: 200,
        spread: 120,
        origin: { y: 0.5 },
        colors: ['#ffffff', '#bbbbbb', '#888888'],
        startVelocity: 60,
        gravity: 0.8,
        scalar: 3, // 粒子變大
        shapes: ['circle']
    });

    // 呼叫畫面震動
    const container = document.getElementById('main-container');
    container.classList.add('shake-effect');
    setTimeout(() => {
        container.classList.remove('shake-effect');
    }, 500);
}