import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const POLL_MS = 2000;
const HOLD_MS = 2000;       // 长按多久弹出关机确认
const CLICK_MAX_MS = 1000;  // 松手时按住超过这个时长就不当点击，避免长按半路放弃误重启
const BAR_ID = "sysmon-bar";
const DIALOG_ID = "sysmon-dialog";
const CONFIRM_ID = "sysmon-confirm";

/* ---------------- 样式 ---------------- */

const CSS = `
#sysmon-bar {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
  height: 100%;
  max-height: 40px;
  padding: 0 4px 0 2px;
  /* 不写 font-family：继承顶栏容器的字体，跟旁边的按钮保持一致 */
  font-size: 12.5px;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--fg-color, #ddd);
  user-select: none;
}
/* 兜底：拿不到顶栏容器时才浮起来，位置压到标签栏下方，绝不盖住标签 */
#sysmon-bar.floating {
  position: fixed;
  top: calc(var(--workflow-tabs-height, 34px) + 6px);
  right: 10px;
  z-index: 900;
  height: 30px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--comfy-menu-bg, #202020) 88%, transparent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, .28);
  padding: 0 6px;
}
.sysmon-item {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  padding: 0 8px;
  border-radius: 999px;
  cursor: pointer;
  transition: background .15s;
}
.sysmon-item:hover { background: rgba(127, 127, 127, .16); }
.sysmon-dot {
  width: 6px; height: 6px; border-radius: 50%;
  margin-right: 3px;
  background: var(--sysmon-dot, #5ac16b);
  flex: 0 0 auto;
}
.sysmon-k { opacity: .5; font-size: 11.5px; letter-spacing: .02em; }
.sysmon-v { font-weight: 600; min-width: 30px; text-align: right; }
/* 温度跟使用率拉开一点，两者是同一条目里的两组数据 */
.sysmon-t { opacity: .7; margin-left: 5px; min-width: 24px; text-align: right; }
.sysmon-t.none { opacity: .28; }
/* 单位比数值小一号：℃ 这个字符本身是全角宽度，同字号会显大，太小又糊 */
.sysmon-u { font-size: .88em; font-weight: 400; opacity: .8; margin-left: 1px; }
.sysmon-sep {
  width: 1px; height: 14px;
  margin: 0 3px;
  background: currentColor; opacity: .16;
  flex: 0 0 auto;
}
/* 电源键：圆形，单击重启，长按 2 秒关机，两者都要二次确认 */
.sysmon-power {
  position: relative;
  display: grid; place-items: center;
  width: 26px; height: 26px;
  flex: 0 0 auto;
  margin: 0 2px 0 4px;
  padding: 0;
  border: 0; border-radius: 50%;
  background: transparent; color: inherit;
  cursor: pointer;
  opacity: .8;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  transition: background .15s, color .15s, opacity .15s;
}
.sysmon-power:hover { background: rgba(127, 127, 127, .18); opacity: 1; }
.sysmon-power .sysmon-power-ico {
  display: block;
  width: 15px; height: 15px;
  position: relative; z-index: 1;
}
.sysmon-power .sysmon-power-ring {
  position: absolute;
  left: 0; top: 0;
  display: block;
  width: 26px; height: 26px;
  transform: rotate(-90deg);
  transform-origin: 50% 50%;
  overflow: visible;
  fill: none;
  stroke: #e0776f;
  stroke-width: 2;
  stroke-linecap: round;
  /* pathLength=100 把整圈归一化，dasharray/dashoffset 直接用百分比，
     不用去算圆周长，换半径也不会错位 */
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  opacity: 0;
  pointer-events: none;
  transition: opacity .12s linear;
}
.sysmon-power.holding, .sysmon-power.armed { opacity: 1; color: #e0776f; }
.sysmon-power.holding .sysmon-power-ring, .sysmon-power.armed .sysmon-power-ring { opacity: 1; }
.sysmon-power.armed .sysmon-power-ico { animation: sysmon-armed .9s ease-in-out infinite; }
@keyframes sysmon-armed {
  0%, 100% { opacity: 1; }
  50% { opacity: .45; }
}
.sysmon-power.busy { pointer-events: none; opacity: .45; }

#sysmon-dialog {
  position: fixed; inset: 0; z-index: 4000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .42);
  backdrop-filter: blur(1.5px);
}
#sysmon-confirm {
  position: fixed; inset: 0; z-index: 4200;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, .5);
  backdrop-filter: blur(2px);
}
.sysmon-panel {
  width: 380px; max-width: calc(100vw - 32px);
  border-radius: 12px;
  background: var(--comfy-menu-bg, #202020);
  color: var(--fg-color, #ddd);
  border: 1px solid rgba(127, 127, 127, .26);
  box-shadow: 0 16px 48px rgba(0, 0, 0, .45);
  font: 12px/1.5 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow: hidden;
}
.sysmon-confirm-panel {
  width: 322px; max-width: calc(100vw - 32px);
  border-radius: 12px;
  background: var(--comfy-menu-bg, #202020);
  color: var(--fg-color, #ddd);
  border: 1px solid rgba(127, 127, 127, .3);
  box-shadow: 0 18px 54px rgba(0, 0, 0, .55);
  font: 13px/1.6 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  overflow: hidden;
  animation: sysmon-pop .14s ease-out;
}
@keyframes sysmon-pop {
  from { transform: scale(.96); opacity: .6; }
  to { transform: scale(1); opacity: 1; }
}
.sysmon-confirm-head {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px 6px;
  font-size: 14px; font-weight: 600;
}
.sysmon-confirm-head .ico { width: 16px; height: 16px; flex: 0 0 auto; }
.sysmon-confirm-body { padding: 0 16px 12px; opacity: .75; }
.sysmon-confirm-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 10px 14px 14px;
  border-top: 1px solid rgba(127, 127, 127, .14);
}
.sysmon-confirm-foot button {
  font: inherit; font-size: 12.5px;
  padding: 6px 16px; border-radius: 7px;
  border: 1px solid rgba(127, 127, 127, .3);
  background: transparent; color: inherit;
  cursor: pointer;
  transition: background .12s, border-color .12s;
}
.sysmon-confirm-foot button:hover { background: rgba(127, 127, 127, .16); }
.sysmon-confirm-foot button.ok-restart {
  border-color: transparent; background: #3b7ddd; color: #fff;
}
.sysmon-confirm-foot button.ok-restart:hover { background: #4b8bea; }
.sysmon-confirm-foot button.ok-stop {
  border-color: transparent; background: #cf4d47; color: #fff;
}
.sysmon-confirm-foot button.ok-stop:hover { background: #dd5c55; }
.sysmon-confirm-foot button:focus-visible {
  outline: 2px solid #6aa9f0; outline-offset: 2px;
}
.sysmon-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px 10px;
  font-size: 13px; font-weight: 600;
}
.sysmon-x {
  border: 0; background: transparent; color: inherit;
  font-size: 17px; line-height: 1; cursor: pointer;
  opacity: .5; padding: 2px 5px; border-radius: 6px;
}
.sysmon-x:hover { opacity: 1; background: rgba(127, 127, 127, .16); }
.sysmon-body { padding: 0 14px 4px; }
.sysmon-row {
  display: flex; align-items: baseline; gap: 10px;
  padding: 5px 0;
  border-top: 1px solid rgba(127, 127, 127, .14);
}
.sysmon-row:first-child { border-top: 0; }
.sysmon-row .r-k { flex: 0 0 84px; opacity: .58; }
.sysmon-row .r-v {
  flex: 1; text-align: right;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.sysmon-note {
  padding: 8px 14px 0;
  font-size: 11px; line-height: 1.5;
  opacity: .55;
}
.sysmon-wait {
  padding: 18px 14px 6px;
  font-size: 12px; line-height: 1.7;
}
.sysmon-wait b { font-weight: 600; }
.sysmon-spin {
  display: inline-block; width: 10px; height: 10px; margin-right: 6px;
  border: 1.6px solid currentColor; border-top-color: transparent;
  border-radius: 50%; vertical-align: -1px;
  animation: sysmon-spin .8s linear infinite;
}
@keyframes sysmon-spin { to { transform: rotate(360deg); } }
`;

/* ---------------- 语言 ---------------- */

// 跟随 ComfyUI 的界面语言：先读中文语言包写入的 AGL.Locale，
// 再读新版前端的 Comfy.Locale，都没有时才退回浏览器语言。
const STRINGS = {
  zh: {
    cpuUsage: "CPU 使用率",
    gpuUsage: "GPU 使用率",
    powerHint: "单击重启·长按关机",
    tempMissing: "读不到 CPU 温度：需要 LibreHardwareMonitor 以管理员运行并开启 Remote Web Server",
    tempLhm: "CPU 温度（LibreHardwareMonitor）",
    tempWmi: "CPU 温度（WMI）",
    panelTitle: "系统状态",
    close: "关闭",
    loading: "正在读取系统状态…",
    rCpu: "处理器",
    rGpu: "显卡",
    rVram: "显存 / 功耗",
    rRam: "内存",
    rComfy: "ComfyUI",
    rProc: "进程",
    stRunning: "运行中",
    stPending: "排队中",
    stIdle: "空闲",
    noNvidia: "未检测到 NVIDIA 显卡",
    queueText: (n) => `队列 ${n}`,
    procText: (pid, up) => `PID ${pid} · 已运行 ${up}`,
    noteNoTemp: "CPU 温度未取到。需要在 LibreHardwareMonitor 里打开 "
      + "Options → Remote Web Server → Run（默认端口 8085），"
      + "本插件检测到后会自动接上，不用重启 ComfyUI。",
    confirmRestart: "重启 ComfyUI？",
    confirmStop: "关闭 ComfyUI？",
    descRestart: "进程会退出并在约 3 秒后重新拉起，页面会自动刷新。正在跑的任务会被打断。",
    descStop: "服务会立即停止，浏览器与本页的连接断开。已排队的任务不会执行。",
    cancel: "取消",
    okRestart: "确认重启",
    okStop: "确认关闭",
    busyRestart: "正在重启 ComfyUI…",
    busyRestartDesc: "旧进程退出后约 3 秒拉起，页面会自动刷新。",
    busyStop: "正在关闭 ComfyUI…",
    busyStopDesc: "服务停止后这个页面会失去连接，可以关掉标签页。",
    stopped: "ComfyUI 已停止。",
    relaunch: "重新启动：",
    timeout: "重启超时",
    timeoutDesc: "服务 2 分钟内没有恢复，请手动检查终端输出。",
    busyHead: "ComfyUI",
    unitDay: "天",
    unitHour: "时",
    unitMin: "分",
  },
  en: {
    cpuUsage: "CPU usage",
    gpuUsage: "GPU usage",
    powerHint: "Click to restart · hold to shut down",
    tempMissing: "CPU temperature unavailable: run LibreHardwareMonitor as administrator "
      + "with the Remote Web Server enabled",
    tempLhm: "CPU temperature (LibreHardwareMonitor)",
    tempWmi: "CPU temperature (WMI)",
    panelTitle: "System status",
    close: "Close",
    loading: "Reading system status…",
    rCpu: "CPU",
    rGpu: "GPU",
    rVram: "VRAM / power",
    rRam: "Memory",
    rComfy: "ComfyUI",
    rProc: "Process",
    stRunning: "Running",
    stPending: "Queued",
    stIdle: "Idle",
    noNvidia: "No NVIDIA GPU detected",
    queueText: (n) => `${n} in queue`,
    procText: (pid, up) => `PID ${pid} · up ${up}`,
    noteNoTemp: "CPU temperature unavailable. Open Options → Remote Web Server → Run "
      + "in LibreHardwareMonitor (default port 8085). The bar connects on its own, "
      + "no ComfyUI restart needed.",
    confirmRestart: "Restart ComfyUI?",
    confirmStop: "Shut down ComfyUI?",
    descRestart: "The process exits and starts again in about 3 seconds, then the page reloads. "
      + "Running tasks are interrupted.",
    descStop: "The server stops at once and this page loses its connection. "
      + "Queued tasks will not run.",
    cancel: "Cancel",
    okRestart: "Restart",
    okStop: "Shut down",
    busyRestart: "Restarting ComfyUI…",
    busyRestartDesc: "The old process exits and the new one starts in about 3 seconds. "
      + "The page reloads itself.",
    busyStop: "Shutting down ComfyUI…",
    busyStopDesc: "This page loses its connection once the server stops. You can close the tab.",
    stopped: "ComfyUI stopped.",
    relaunch: "Start it again with:",
    timeout: "Restart timed out",
    timeoutDesc: "The server did not come back within 2 minutes. Check the terminal output.",
    busyHead: "ComfyUI",
    unitDay: "d",
    unitHour: "h",
    unitMin: "min",
  },
};

function pickLang(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return null;
  return s.startsWith("zh") ? "zh" : "en";
}

function detectLang() {
  try {
    const ui = app && app.ui && app.ui.settings;
    const v = ui && typeof ui.getSettingValue === "function" ? ui.getSettingValue("AGL.Locale") : null;
    const hit = pickLang(v);
    if (hit) return hit;
  } catch (err) {
    // 旧版前端没有 settings API
  }
  try {
    const em = app && app.extensionManager;
    const v = em && em.setting && typeof em.setting.get === "function" ? em.setting.get("Comfy.Locale") : null;
    const hit = pickLang(v);
    if (hit) return hit;
  } catch (err) {
    // 同上
  }
  return pickLang(navigator.language) || "en";
}

let LANG = detectLang();

function t(key) {
  const d = STRINGS[LANG] || STRINGS.en;
  const v = d[key];
  return v === undefined ? (STRINGS.en[key] ?? key) : v;
}

function ensureCss() {
  if (document.getElementById("sysmon-style")) return;
  const st = document.createElement("style");
  st.id = "sysmon-style";
  st.textContent = CSS;
  document.head.appendChild(st);
}

/* ---------------- 小工具 ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);

function fmtUptime(sec) {
  if (!sec || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} ${t("unitDay")} ${h} ${t("unitHour")}`;
  if (h) return `${h} ${t("unitHour")} ${m} ${t("unitMin")}`;
  return `${m} ${t("unitMin")}`;
}

// 负载越高越显眼，但不用强色块，只动小圆点
function loadColor(pct) {
  if (pct == null) return "#6b7280";
  if (pct >= 90) return "#e05c5c";
  if (pct >= 70) return "#d99b3d";
  return "#5ac16b";
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

/* ---------------- 顶栏 ---------------- */

let last = { stats: null, queue: { running: 0, pending: 0 } };

function buildBar() {
  const bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.innerHTML = `
    <div class="sysmon-item" data-open="1" title="${t("cpuUsage")}">
      <span class="sysmon-dot" data-cpu-dot></span>
      <span class="sysmon-k">CPU</span>
      <span class="sysmon-v" data-cpu-v>—</span>
      <span class="sysmon-t" data-cpu-t>—</span>
    </div>
    <span class="sysmon-sep"></span>
    <div class="sysmon-item" data-open="1" title="${t("gpuUsage")}">
      <span class="sysmon-dot" data-gpu-dot></span>
      <span class="sysmon-k">GPU</span>
      <span class="sysmon-v" data-gpu-v>—</span>
      <span class="sysmon-t" data-gpu-t>—</span>
    </div>
    <span class="sysmon-sep"></span>
    <button class="sysmon-power" data-power title="${t("powerHint")}">
      <svg class="sysmon-power-ring" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="13" cy="13" r="11" pathLength="100"></circle>
      </svg>
      <svg class="sysmon-power-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M12 3.4v8"></path>
        <path d="M7.2 6.1a8.2 8.2 0 1 0 9.6 0"></path>
      </svg>
    </button>
  `;
  bar.addEventListener("click", (e) => {
    if (e.target.closest("[data-open]")) openDialog();
  });
  wirePower($(".sysmon-power", bar));
  return bar;
}

/* ---------------- 电源键 ---------------- */

// 单击 → 重启确认；按住 2 秒 → 关机确认。
// 进度环用 rAF 逐帧推进 stroke-dashoffset（pathLength=100，一帧一步），
// 不用 CSS transition：transition 在「先复位再启动」时容易从旧值起跳，
// 表现就是圆环从半路开始转，看着是歪的。rAF 每帧都从 0 重新算，不会偏。
function wirePower(btn) {
  if (!btn) return;
  const ring = $(".sysmon-power-ring circle", btn);
  let raf = 0;
  let startTs = 0;
  let holding = false;
  let fired = false;
  let downAt = 0;

  const setProgress = (p) => {
    if (!ring) return;
    const v = Math.max(0, Math.min(1, p));
    if (v >= 1) {
      // 满圈时把 dash 去掉，两个圆头帽就不会在 12 点处叠出一个疙瘩
      ring.style.strokeDasharray = "none";
      ring.style.strokeDashoffset = "0";
    } else {
      ring.style.strokeDasharray = "100";
      ring.style.strokeDashoffset = String(100 * (1 - v));
    }
  };

  const stopRaf = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const reset = () => {
    stopRaf();
    holding = false;
    btn.classList.remove("holding", "armed");
    setProgress(0);
  };

  function tick(now) {
    if (!holding) return;
    const p = (now - startTs) / HOLD_MS;
    setProgress(p);
    if (p >= 1) {
      holding = false;
      fired = true;
      btn.classList.add("armed");
      openConfirm("shutdown");
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  btn.addEventListener("pointerdown", (e) => {
    if (btn.classList.contains("busy") || e.button > 0) return;
    e.preventDefault();
    fired = false;
    downAt = Date.now();
    holding = true;
    btn.classList.add("holding");
    btn.classList.remove("armed");
    setProgress(0);
    startTs = performance.now();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (err) {
      // 部分浏览器不支持捕获，退化成普通行为
    }
    stopRaf();
    raf = requestAnimationFrame(tick);
  });

  const release = (shouldClick) => {
    if (fired) {
      fired = false;
      reset();
      return;
    }
    const held = Date.now() - downAt;
    reset();
    if (shouldClick && held <= CLICK_MAX_MS) openConfirm("restart");
  };

  btn.addEventListener("pointerup", () => release(true));
  btn.addEventListener("pointercancel", () => release(false));
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

function paintBar() {
  const bar = document.getElementById(BAR_ID);
  if (!bar) return;
  const s = last.stats;
  const q = last.queue;

  const cpu = s && s.cpu;
  const gpu = s && s.gpu;

  const cV = $("[data-cpu-v]", bar);
  const cT = $("[data-cpu-t]", bar);
  const cDot = $("[data-cpu-dot]", bar);
  if (cpu) {
    setText(cV, cpu.percent.toFixed(0) + "%");
    if (cpu.temp == null) {
      setText(cT, "—");
      cT.classList.add("none");
      cT.title = t("tempMissing");
    } else {
      cT.innerHTML = cpu.temp.toFixed(0) + '<span class="sysmon-u">℃</span>';
      cT.classList.remove("none");
      cT.title = cpu.temp_src === "lhm" ? t("tempLhm") : t("tempWmi");
    }
    cDot.style.background = loadColor(cpu.percent);
  }

  const gV = $("[data-gpu-v]", bar);
  const gT = $("[data-gpu-t]", bar);
  const gDot = $("[data-gpu-dot]", bar);
  if (gpu) {
    setText(gV, (gpu.util == null ? "—" : gpu.util + "%"));
    if (gpu.temp == null) {
      setText(gT, "—");
    } else {
      gT.innerHTML = gpu.temp + '<span class="sysmon-u">℃</span>';
    }
    gDot.style.background = loadColor(gpu.util);
  } else {
    setText(gV, "—");
    setText(gT, "—");
    if (gDot) gDot.style.background = "#6b7280";
  }

  const power = $(".sysmon-power", bar);
  if (power && !power.classList.contains("holding") && !power.classList.contains("armed")) {
    const busy = q.running > 0;
    power.title = t("powerHint");
    power.style.color = busy ? "#6aa9f0" : "";
  }

  // 语言切换后重挂 title，顶栏不用重建
  const items = bar.querySelectorAll(".sysmon-item");
  if (items[0]) items[0].title = t("cpuUsage");
  if (items[1]) items[1].title = t("gpuUsage");
}

// 找登录/用户头像按钮，把这条挂到它左边。
// Vue 那层可能给按钮套了一层不带 flex 的 div，所以要往上找到最近的 flex 容器，
// 再插到「包含登录按钮的那个子节点」前面，视觉上就正好在头像左侧。
function resolveSlot() {
  const login = document.querySelector(
    '[data-testid="current-user-button"], [data-testid="login-button"]'
  );
  if (login) {
    let node = login;
    for (let i = 0; i < 6; i++) {
      const p = node.parentElement;
      if (!p || p === document.body) break;
      if (getComputedStyle(p).display.includes("flex")) return { container: p, before: node };
      node = p;
    }
    if (login.parentElement) return { container: login.parentElement, before: login };
  }
  const acts = document.querySelector('[data-testid="action-bar-buttons"]');
  if (acts && acts.parentElement) return { container: acts.parentElement, before: acts };
  return null;
}

function mount() {
  ensureCss();
  let bar = document.getElementById(BAR_ID);
  if (!bar) bar = buildBar();
  const slot = resolveSlot();

  if (slot) {
    bar.classList.remove("floating");
    if (bar.parentElement !== slot.container || bar.nextElementSibling !== slot.before) {
      slot.container.insertBefore(bar, slot.before);
    }
  } else if (!bar.isConnected) {
    bar.classList.add("floating");
    document.body.appendChild(bar);
  }

  // 挂载结果打一行日志，方便定位布局问题
  if (!mount.logged) {
    mount.logged = true;
    const p = bar.parentElement;
    console.log("[Sysmon] parent=", p && p.tagName, String(p && p.className || "").slice(0, 90),
      "before=", slot && slot.before && slot.before.getAttribute("data-testid"),
      "floating=", bar.classList.contains("floating"));
  }
  paintBar();
}

/* ---------------- 运行状态弹窗 ---------------- */

let dialogEl = null;

function closeDialog() {
  if (dialogEl) {
    dialogEl.remove();
    dialogEl = null;
  }
  document.removeEventListener("keydown", onKey);
}

function onKey(e) {
  if (e.key === "Escape") closeDialog();
}

function row(k, v) {
  return `<div class="sysmon-row"><span class="r-k">${k}</span><span class="r-v">${v}</span></div>`;
}

function dialogBody() {
  const s = last.stats;
  const q = last.queue;
  if (!s) return `<div class="sysmon-wait">${t("loading")}</div>`;

  const cpu = s.cpu || {};
  const gpu = s.gpu;
  const ram = s.ram || {};
  const cf = s.comfy || {};

  const state = q.running > 0 ? t("stRunning") : (q.pending > 0 ? t("stPending") : t("stIdle"));
  const stateColor = q.running > 0 ? "#6aa9f0" : (q.pending > 0 ? "#d99b3d" : "#5ac16b");

  let html = `<div class="sysmon-body">`;
  html += row(t("rCpu"), `${cpu.percent ?? "—"}% · ${cpu.freq ? cpu.freq + " MHz" : "—"}`
    + (cpu.temp == null ? "" : ` · ${cpu.temp}<span class="sysmon-u">℃</span>`));
  html += row(t("rGpu"), gpu
    ? `${gpu.util ?? "—"}% · ${gpu.temp ?? "—"}<span class="sysmon-u">℃</span>`
      + ` · ${gpu.mem_used ?? "—"}/${gpu.mem_total ?? "—"} MiB`
    : t("noNvidia"));
  html += row(t("rVram"), gpu
    ? `${gpu.mem_total ? Math.round(gpu.mem_used / gpu.mem_total * 100) : "—"}% · ${gpu.power ?? "—"} W`
    : "—");
  html += row(t("rRam"), `${ram.percent ?? "—"}% · ${ram.used ?? "—"}/${ram.total ?? "—"} GB`);
  html += row(t("rComfy"), `<span style="color:${stateColor}">● </span>${state}`
    + ` · ${t("queueText")(q.pending)}`);
  html += row(t("rProc"), t("procText")(cf.pid ?? "—", fmtUptime(cf.uptime)));
  html += `</div>`;

  if (cpu.temp == null) {
    html += `<div class="sysmon-note">${t("noteNoTemp")}</div>`;
  }
  return html;
}

function openDialog() {
  if (dialogEl) return;
  ensureCss();
  dialogEl = document.createElement("div");
  dialogEl.id = DIALOG_ID;
  dialogEl.innerHTML = `
    <div class="sysmon-panel" role="dialog" aria-modal="true">
      <div class="sysmon-head">
        <span>${t("panelTitle")}</span>
        <button class="sysmon-x" data-act="cancel" aria-label="${t("close")}">×</button>
      </div>
      <div data-slot="body">${dialogBody()}</div>
    </div>`;
  document.body.appendChild(dialogEl);
  document.addEventListener("keydown", onKey);

  dialogEl.addEventListener("click", (e) => {
    if (e.target === dialogEl) return closeDialog();
    const btn = e.target.closest("[data-act]");
    if (btn && btn.dataset.act === "cancel") closeDialog();
  });
}

function refreshDialog() {
  if (!dialogEl) return;
  const slot = dialogEl.querySelector('[data-slot="body"]');
  if (slot) slot.innerHTML = dialogBody();
}

function busyView(title, text) {
  if (!dialogEl) return;
  const slot = dialogEl.querySelector('[data-slot="body"]');
  if (slot) {
    slot.innerHTML = `<div class="sysmon-wait"><span class="sysmon-spin"></span>`
      + `<b>${title}</b><br>${text}</div>`;
  }
  const head = dialogEl.querySelector(".sysmon-head span");
  if (head) head.textContent = t("busyHead");
}

// 电源键触发的操作没有弹窗可依附时，临时开一个进度面板
function ensureDialog() {
  if (!dialogEl) openDialog();
}

/* ---------------- 二级确认 ---------------- */

let confirmEl = null;

const CONFIRM_ICO = {
  restart:
    '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#6aa9f0" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"></path>'
    + '<path d="M21 3v6h-6"></path></svg>',
  shutdown:
    '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#e0776f" stroke-width="2" '
    + 'stroke-linecap="round"><path d="M12 3.4v8"></path>'
    + '<path d="M7.2 6.1a8.2 8.2 0 1 0 9.6 0"></path></svg>',
};

function closeConfirm(run) {
  if (confirmEl) {
    confirmEl.remove();
    confirmEl = null;
  }
  document.removeEventListener("keydown", onConfirmKey, true);
  if (run) run();
}

function onConfirmKey(e) {
  if (!confirmEl) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeConfirm(null);
  } else if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    const ok = $(".sysmon-confirm-foot button[data-act='ok']", confirmEl);
    if (ok) ok.click();
  }
}

function openConfirm(kind) {
  // 同一个确认框不重复开
  if (confirmEl) return;
  ensureCss();

  const isStop = kind === "shutdown";
  const title = isStop ? t("confirmStop") : t("confirmRestart");
  const desc = isStop ? t("descStop") : t("descRestart");

  confirmEl = document.createElement("div");
  confirmEl.id = CONFIRM_ID;
  confirmEl.innerHTML = `
    <div class="sysmon-confirm-panel" role="alertdialog" aria-modal="true"
         aria-labelledby="sysmon-confirm-title">
      <div class="sysmon-confirm-head">
        ${CONFIRM_ICO[isStop ? "shutdown" : "restart"]}
        <span id="sysmon-confirm-title">${title}</span>
      </div>
      <div class="sysmon-confirm-body">${desc}</div>
      <div class="sysmon-confirm-foot">
        <button data-act="cancel">${t("cancel")}</button>
        <button data-act="ok" class="${isStop ? "ok-stop" : "ok-restart"}">
          ${isStop ? t("okStop") : t("okRestart")}
        </button>
      </div>
    </div>`;

  document.body.appendChild(confirmEl);
  document.addEventListener("keydown", onConfirmKey, true);

  // 默认焦点落在「取消」上，避免回车误确认
  const cancelBtn = $("button[data-act='cancel']", confirmEl);
  if (cancelBtn) cancelBtn.focus();

  confirmEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (btn) {
      const act = btn.dataset.act;
      closeConfirm(act === "ok"
        ? (isStop ? doShutdown : doRestart)
        : null);
      return;
    }
    if (e.target === confirmEl) closeConfirm(null);
  });
}

/* ---------------- 动作 ---------------- */

function powerBusy(on) {
  const btn = document.querySelector(".sysmon-power");
  if (!btn) return;
  btn.classList.toggle("busy", !!on);
  btn.classList.remove("holding", "armed");
  const ring = $(".sysmon-power-ring circle", btn);
  if (ring) ring.style.strokeDashoffset = "100";
}

async function doRestart() {
  powerBusy(true);
  ensureDialog();
  busyView(t("busyRestart"), t("busyRestartDesc"));
  try {
    await api.fetchApi("/sysmon/restart", { method: "POST" });
  } catch (err) {
    // 进程在这个请求返回前就退了，fetch 报错属于正常现象
  }
  await waitBack();
}

async function doShutdown() {
  powerBusy(true);
  ensureDialog();
  busyView(t("busyStop"), t("busyStopDesc"));
  try {
    await api.fetchApi("/sysmon/shutdown", { method: "POST" });
  } catch (err) {
    // 同上
  }
  const slot = dialogEl && dialogEl.querySelector('[data-slot="body"]');
  if (slot) slot.innerHTML = `<div class="sysmon-wait"><b>${t("stopped")}</b><br>`
    + `${t("relaunch")}<code>python_embeded\\python.exe -s ComfyUI\\main.py</code></div>`;
}

async function waitBack() {
  const t0 = Date.now();
  // 先等旧进程彻底退掉，否则第一次探测必然命中旧端口
  await new Promise((r) => setTimeout(r, 2500));
  while (Date.now() - t0 < 120000) {
    try {
      const res = await fetch("/system_stats", { cache: "no-store" });
      if (res.ok) {
        location.reload();
        return;
      }
    } catch (err) {
      // 服务还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  powerBusy(false);
  busyView(t("timeout"), t("timeoutDesc"));
}

/* ---------------- 数据 ---------------- */

async function pull() {
  // 用户在设置里切换语言后，关掉已经打开的弹层，下一帧按新语言重绘
  const lang = detectLang();
  if (lang !== LANG) {
    LANG = lang;
    closeConfirm(null);
    closeDialog();
  }
  try {
    const res = await api.fetchApi("/sysmon/stats", { cache: "no-store" });
    if (res.ok) last.stats = await res.json();
  } catch (err) {
    // 重启瞬间会失败，保持上一帧即可
  }
  try {
    const res = await api.fetchApi("/queue", { cache: "no-store" });
    if (res.ok) {
      const q = await res.json();
      last.queue = {
        running: (q.queue_running || []).length,
        pending: (q.queue_pending || []).length,
      };
    }
  } catch (err) {
    // 同上
  }
  paintBar();
  refreshDialog();
}

/* ---------------- 注册 ---------------- */

app.registerExtension({
  name: "Sysmon.Topbar",

  async setup() {
    ensureCss();
    mount();

    // 顶栏是 Vue 渲染的，切视图会重建，靠 observer 保活
    let timer = null;
    const obs = new MutationObserver(() => {
      const bar = document.getElementById(BAR_ID);
      if (bar && bar.isConnected && timer === null) {
        const slot = resolveSlot();
        if (!slot && bar.parentElement === document.body) return;
        if (slot && bar.parentElement === slot.container && bar.nextElementSibling === slot.before) return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        mount();
      }, 200);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    await pull();
    setInterval(pull, POLL_MS);
  },
});
