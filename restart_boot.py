"""重启引导脚本：等旧进程退干净、端口释放，再拉起新的 ComfyUI。

单独一个进程做这件事，是因为旧进程必须自己死掉才能释放 8188，
而新进程又必须由「还活着的」东西来 spawn。

关键在 CREATE_BREAKAWAY_FROM_JOB：父进程可能身处带
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 的作业对象里（终端、IDE、自动化工具调起的
进程都是），那种作业一关闭就把整棵进程树杀掉，连在这里 sleep 的引导进程也一起没了。
表现就是「旧进程正常退出、新进程永远不出现」。加上这个标志才能脱离作业。
父作业不允许脱离时会抛 OSError，退回不带它的方式。
"""

import json
import os
import subprocess
import sys
import time

CREATE_NEW_PROCESS_GROUP = 0x00000200
DETACHED_PROCESS = 0x00000008
CREATE_BREAKAWAY_FROM_JOB = 0x01000000


def _flags(breakaway):
    if os.name != "nt":
        return 0
    flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    if breakaway:
        flags |= CREATE_BREAKAWAY_FROM_JOB
    return flags


def main():
    if len(sys.argv) < 2:
        return
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        plan = json.load(f)

    log = open(plan["log"], "ab", buffering=0)

    def note(msg):
        log.write(("%s %s\n" % (time.strftime("%H:%M:%S"), msg)).encode("utf-8"))

    note("===== boot start, pid=%d =====" % os.getpid())

    time.sleep(float(plan.get("delay", 3.0)))
    note("delay done, spawning")

    for breakaway in (True, False):
        try:
            subprocess.Popen(
                plan["argv"],
                cwd=plan["cwd"],
                stdin=subprocess.DEVNULL,
                stdout=log,
                stderr=log,
                creationflags=_flags(breakaway),
                close_fds=True,
            )
            note("spawn ok (breakaway=%s): %s" % (breakaway, " ".join(plan["argv"])))
            return
        except OSError as e:
            note("spawn failed (breakaway=%s): %r" % (breakaway, e))
    note("gave up")


if __name__ == "__main__":
    main()
