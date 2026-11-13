"""Sysmon Topbar：顶栏显示 CPU / GPU / ComfyUI 状态，并带重启、关闭。

注册顺序不能换：先挂路由，再声明 WEB_DIRECTORY。
"""

from . import sysmon

WEB_DIRECTORY = "./web"

sysmon.init()

# 这个插件不加节点，但 ComfyUI 把没有 NODE_CLASS_MAPPINGS 的包当作被跳过
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
