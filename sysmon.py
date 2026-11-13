"""Sysmon Topbar 的后端：系统指标采集、重启、关闭。

三条约束写在最前面，改代码前先读：
1. 所有子进程都带 CREATE_NO_WINDOW，不能在桌面弹黑框。
2. nvidia-smi 是阻塞调用，必须丢到线程池，不能堵住 aiohttp 的事件循环。
3. 重启走「引导脚本 + 延迟启动」：旧进程先退，端口释放后新进程才 bind，
   否则 Windows 上会直接报端口占用，服务就起不来了。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

import psutil
from aiohttp import web
from server import PromptServer

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
COMFY_DIR = os.path.dirname(os.path.dirname(PLUGIN_DIR))
STATE_DIR = os.path.join(COMFY_DIR, "user", "sysmon")
BOOT_SCRIPT = os.path.join(PLUGIN_DIR, "restart_boot.py")

_CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
# 引导进程还得脱离父作业对象，否则作业一关就把它和新实例一起杀掉
_BREAKAWAY = 0x01000000            # CREATE_BREAKAWAY_FROM_JOB

_nv_name = ""

# CPU 温度：Windows 上 psutil 读不到，也没有免提权的途径。
# 这台机器的 ACPI 热区恒为 27.9°C，满载不变，是机箱环境值，拿来当 CPU 温度是误导。
# 唯一可靠来源是 LibreHardwareMonitor（要管理员权限加载内核驱动），
# 所以走它自带的 Remote Web Server：GET http://127.0.0.1:<port>/data.json。
# LHM 没开 / 没装 / 没运行，就退到 WMI 命名空间，再读不到就是 None，前端显示「—」。
LHM_PORTS = (8085,)

_lhm_lock = threading.Lock()
_lhm = {"port": None, "temp": None, "gpu_temp": None, "ok": False, "ts": 0.0}

# 系统里配了 http_proxy，直连本机端口会被代理挡成 502，必须空 ProxyHandler。
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

_temp_lock = threading.Lock()
_temp_state = {"value": None, "src": None, "checked": 0.0}

# CPU 使用率由后台线程按固定 1 秒窗口采样。
# 不能在接口里现采：psutil.cpu_percent(interval=None) 两次调用挨太近会返回 0.0，
# 顶栏就会出现「明明在跑却显示 0%」。
_cpu_cache = {"percent": 0.0}

_CPU_HW = ("/intelcpu", "/amdcpu", "/cpu")
_GPU_HW = ("/gpu-nvidia", "/gpu-amd", "/gpu-intel")
_CPU_TEMP_KEYS = ("CPU Package", "CPU (Tctl/Tdie)", "Core Average", "Core Max", "CPU Core")


def _fetch_json(url, timeout):
    with _OPENER.open(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


def _parse_lhm(root):
    """从 LHM 的 data.json 里取 CPU 封装温度和 GPU 核心温度。

    实测这版（0.9.6）的 JSON 结构：root → 计算机名 → 硬件 → 分组 → 传感器，
    硬件节点只有 HardwareId（如 /intelcpu/0），没有 Type 字段；
    传感器的 Type 才是 "Temperature"，另外带 SensorId（如 /intelcpu/0/temperature/16），
    Value 形如 "50.0 °C"。所以硬件归属优先从 SensorId 的前两段取，比靠层级继承可靠。
    """
    cpu, gpu = {}, None

    def walk(node, hw):
        nonlocal gpu
        if node.get("HardwareId"):
            hw = node["HardwareId"]
        sid = node.get("SensorId")
        if sid and sid.startswith("/"):
            parts = sid.split("/")
            if len(parts) >= 3 and parts[1] and parts[2]:
                hw = "/%s/%s" % (parts[1], parts[2])
        if node.get("Type") == "Temperature":
            name = (node.get("Text") or "").strip()
            val = _num(str(node.get("Value", "")).split(" ")[0].replace(",", "."))
            if val is not None:
                low = (hw or "").lower()
                if any(low.startswith(p) for p in _CPU_HW):
                    cpu[name] = val
                elif any(low.startswith(p) for p in _GPU_HW) and gpu is None:
                    if name.lower() in ("gpu core", "gpu temperature"):
                        gpu = val
        for c in node.get("Children") or ():
            walk(c, hw)

    walk(root, "")

    cpu_temp = None
    for k in _CPU_TEMP_KEYS:
        if k in cpu:
            cpu_temp = cpu[k]
            break
    if cpu_temp is None and cpu:
        cores = [v for k, v in cpu.items() if k.lower().startswith("core")]
        cpu_temp = max(cores) if cores else max(cpu.values())
    return cpu_temp, gpu


def _lhm_worker():
    """常驻线程：每 2 秒拉一次 LHM 数据，断了就重新探端口。"""
    while True:
        with _lhm_lock:
            port = _lhm["port"]
        data = None
        if port:
            try:
                data = _fetch_json("http://127.0.0.1:%d/data.json" % port, 1.5)
            except Exception:
                data = None
        if data is None:
            for p in LHM_PORTS:
                try:
                    data = _fetch_json("http://127.0.0.1:%d/data.json" % p, 0.6)
                except Exception:
                    continue
                port = p
                break
        if data is None:
            with _lhm_lock:
                _lhm.update(port=None, temp=None, gpu_temp=None, ok=False)
            time.sleep(5.0)
            continue
        try:
            cpu_t, gpu_t = _parse_lhm(data)
        except Exception:
            cpu_t, gpu_t = None, None
        with _lhm_lock:
            _lhm.update(port=port, temp=cpu_t, gpu_temp=gpu_t, ok=True, ts=time.time())
        time.sleep(2.0)


def _probe_cpu_temp():
    """LHM 没开摄像头式接口时，最后试一次它的 WMI 命名空间。"""
    ps = (
        "try {"
        " $s = Get-CimInstance -Namespace 'root/LibreHardwareMonitor' -ClassName Sensor "
        "-ErrorAction Stop | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'CPU' };"
        " if ($s) { ($s | Measure-Object -Property Value -Maximum).Maximum }"
        "} catch { '' }"
    )
    out = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], timeout=8.0)
    return _num(out)


def _temp_worker():
    """后台线程：HTTP 通着就完全不打扰；断了才隔一分钟试一次 WMI。"""
    while True:
        with _lhm_lock:
            ok = _lhm["ok"]
        if ok:
            time.sleep(30)
            continue
        with _temp_lock:
            _temp_state["checked"] = time.time()
        val = _probe_cpu_temp()
        with _temp_lock:
            _temp_state["value"] = val
            _temp_state["src"] = "wmi" if val is not None else None
        time.sleep(120)


def _run(cmd, timeout=2.5):
    """跑一条命令拿 stdout，失败一律返回空串，不让采集把整个接口拖挂。"""
    try:
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
            creationflags=_CREATE_NO_WINDOW,
        )
        if r.returncode == 0:
            return (r.stdout or "").strip()
    except Exception:
        pass
    return ""


def _num(v, cast=float):
    try:
        return cast(float(str(v).strip()))
    except Exception:
        return None


def _cpu_worker():
    psutil.cpu_percent(interval=None)  # 建立基线，丢弃
    while True:
        try:
            _cpu_cache["percent"] = round(psutil.cpu_percent(interval=1.0), 1)
        except Exception:
            time.sleep(1.0)


def _start_workers():
    threading.Thread(target=_cpu_worker, name="sysmon-cpu", daemon=True).start()
    if os.name == "nt":
        threading.Thread(target=_lhm_worker, name="sysmon-lhm", daemon=True).start()
        threading.Thread(target=_temp_worker, name="sysmon-cpu-temp", daemon=True).start()


def _gpu():
    global _nv_name
    out = _run([
        "nvidia-smi",
        "--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,power.draw,clocks.sm",
        "--format=csv,noheader,nounits",
    ])
    if not out:
        return None
    parts = [p.strip() for p in out.splitlines()[0].split(",")]
    if len(parts) < 7:
        return None
    _nv_name = parts[0]
    return {
        "name": parts[0],
        "util": _num(parts[1], int),
        "temp": _num(parts[2], int),
        "mem_used": _num(parts[3], int),
        "mem_total": _num(parts[4], int),
        "power": _num(parts[5]),
        "clock": _num(parts[6], int),
    }


def _cpu():
    with _lhm_lock:
        temp, src = _lhm["temp"], "lhm" if _lhm["temp"] is not None else None
    if temp is None:
        with _temp_lock:
            temp = _temp_state["value"]
            src = _temp_state["src"]
    freq = None
    try:
        f = psutil.cpu_freq()
        freq = int(f.current) if f and f.current else None
    except Exception:
        pass
    return {
        "percent": _cpu_cache["percent"],
        "freq": freq,
        "temp": None if temp is None else round(temp, 1),
        "temp_src": src,
        "cores": psutil.cpu_count(logical=True),
    }


def _ram():
    m = psutil.virtual_memory()
    return {
        "percent": round(m.percent, 1),
        "used": round(m.used / 1024 ** 3, 1),
        "total": round(m.total / 1024 ** 3, 1),
    }


def collect():
    me = psutil.Process(os.getpid())
    try:
        uptime = int(time.time() - me.create_time())
    except Exception:
        uptime = 0
    with _lhm_lock:
        lhm = {"ok": _lhm["ok"], "port": _lhm["port"]}
    return {
        "cpu": _cpu(),
        "gpu": _gpu(),
        "ram": _ram(),
        "lhm": lhm,
        "comfy": {"pid": os.getpid(), "uptime": uptime, "python": sys.version.split()[0]},
        "ts": int(time.time() * 1000),
    }


def _is_local(request):
    # 这套接口能关掉服务，只允许本机页面调用
    return request.remote in ("127.0.0.1", "::1", "localhost", None)


def _build_argv():
    """按当前进程的真实启动方式重建命令行。

    sys.argv[0] 是 main.py 的相对路径（依赖 cwd），所以转绝对；
    -s 这类解释器开关不在 sys.argv 里，靠 sys.flags 还回去，
    否则重启后 user site-packages 的状态会跟启动时不一致。
    """
    argv = [sys.executable]
    if getattr(sys.flags, "no_user_site", 0):
        argv.append("-s")
    argv.append(os.path.abspath(sys.argv[0]))
    argv.extend(sys.argv[1:])
    return argv


def _schedule_restart():
    os.makedirs(STATE_DIR, exist_ok=True)
    plan_path = os.path.join(STATE_DIR, "restart_plan.json")
    plan = {
        "argv": _build_argv(),
        "cwd": os.getcwd(),
        "log": os.path.join(STATE_DIR, "restart.log"),
        "delay": 3.0,
    }
    with open(plan_path, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)

    base = _DETACHED if os.name == "nt" else 0
    argv = [sys.executable, BOOT_SCRIPT, plan_path]
    for extra in ((_BREAKAWAY,) if os.name == "nt" else (0,)):
        try:
            subprocess.Popen(
                argv,
                cwd=os.getcwd(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=base | extra,
                close_fds=True,
            )
            return
        except OSError as e:
            # 父作业不允许脱离时退回普通方式，至少交给子脚本自己再试一次
            if not extra:
                raise
            print("[Sysmon] 引导进程无法脱离作业（%s），退回普通方式" % e)



def _defer_exit(delay):
    """先把 HTTP 响应发出去，再退出进程。"""
    import asyncio
    asyncio.get_event_loop().call_later(delay, os._exit, 0)


def init():
    routes = PromptServer.instance.routes

    @routes.get("/sysmon/stats")
    async def sysmon_stats(request):
        loop = __import__("asyncio").get_running_loop()
        data = await loop.run_in_executor(None, collect)
        return web.json_response(data)

    @routes.post("/sysmon/restart")
    async def sysmon_restart(request):
        if not _is_local(request):
            return web.json_response({"error": "local access only", "code": "local_only"}, status=403)
        try:
            _schedule_restart()
        except Exception as e:
            return web.json_response({"error": str(e), "code": "restart_failed"}, status=500)
        print("[Sysmon] 正在重启 ComfyUI，新进程 3 秒后拉起")
        _defer_exit(0.8)
        return web.json_response({"ok": True, "action": "restart"})

    @routes.post("/sysmon/shutdown")
    async def sysmon_shutdown(request):
        if not _is_local(request):
            return web.json_response({"error": "local access only", "code": "local_only"}, status=403)
        print("[Sysmon] 收到关闭指令，进程退出")
        _defer_exit(0.5)
        return web.json_response({"ok": True, "action": "shutdown"})

    _start_workers()
