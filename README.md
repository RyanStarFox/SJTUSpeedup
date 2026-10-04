# SJTUSpeedup

给 [交大课堂回看](https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/) 增加更多倍速。原生菜单只有 `0.5 / 0.75 / 1 / 1.25 / 1.5 / 2`，这个脚本保留这些档位，并加上 `2.5` 和 `3`，也可以自己输入 `0.1`–`10`。

同一套交互来自 [SpeedUp](https://github.com/RyanStarFox/SpeedUp)：记住倍速、短按前进后退、长按临时变速。教师画面和 PPT 会一起改速。

当前版本：**1.0.1**。

## 安装

Safari、Chrome、Edge、Firefox 用的是同一份 [`sjtu-speedup.user.js`](./sjtu-speedup.user.js)。脚本声明了 `@grant none`，在页面上下文里运行，不依赖油猴专用 API。

1. Safari 安装 [Userscripts](https://github.com/quoid/userscripts) 或 [Tampermonkey](https://www.tampermonkey.net/)。Chrome、Edge、Firefox 安装 Tampermonkey（Firefox 也可以用 Violentmonkey）。
2. **Chrome / Edge 138+**：在扩展详情里打开「允许运行用户脚本 / Allow User Scripts」，否则脚本不会执行。
3. 新建脚本，把 `sjtu-speedup.user.js` 全文粘贴进去并保存。
4. 打开课堂回看页，硬刷新（Cmd/Ctrl+Shift+R）。
5. 控制栏「倍速」上悬停，应看到 `3X` … `0.5X` 和最上面的自定义输入框。控制台应有：`[SJTUSpeedup] v1.0.1 active`。

## 功能

| 操作 | 效果 |
|---|---|
| 预设 | `0.5 / 0.75 / 1 / 1.25 / 1.5 / 2 / 2.5 / 3` |
| 自定义 | 输入 `0.1`–`10`，回车或失焦生效 |
| 记忆 | 用站点 `localStorage` 记住基础倍速，下次打开回看仍生效 |
| 短按 **O** / **P** | 正在播放、且不在输入框里时，后退 / 前进 5 秒 |
| 长按 **O** | 按下超过 0.5 秒后，在当前倍速上 ×0.5，松手恢复 |
| 长按 **P** | 按下超过 0.5 秒后，在当前倍速上 ×1.5，松手恢复 |
| **;** / **'** | 永久减 / 加 `0.5`；按住超过 0.5 秒后每 0.2 秒重复一次 |
| **,** / **.** | 永久减 / 加 `0.1`；按住超过 0.5 秒后每 0.1 秒重复一次 |

按钮上的数字是当前实际速度，长按期间也会跟着变。

倍速写在脚本顶部的 `CONFIG.presets` 里，想加 `4` 直接写进数组即可。

## 已知限制

- 浏览器大约在低于 `0.5x` 或高于 `4x` 时会把声音静音，画面仍可能继续播。
- 播放器大约允许到 `16x`，脚本把范围限制在 `0.1`–`10`。
- 直播这类实时流会拒绝改倍速，脚本不会硬改画面。
- 页面原本「长按右方向键临时 3 倍」会被拉回你设定的倍速。临时变速用长按 **O** / **P**。
- 左 / 右方向键、空格、`F` 仍是页面自己的快捷键。
- 在输入框里打字时，这些按键不会改倍速。
