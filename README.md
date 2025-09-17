[English](README_en.md) | [中文](README.md)

# GMC-Enhance

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kibmlbbigjmpmfjpcjhlmimehchnamgi?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/kibmlbbigjmpmfjpcjhlmimehchnamgi)

统一控制 · 强大的快捷键 · 独立的标签页会话

Global Media Control (GMC)-Enhance 是一个 Chrome 扩展程序，它增强了 Chrome 内置的全局媒体控制功能。它提供了真正的**统一控制**，**全局快捷键**实现即时操作，以及**独立的标签页会话**，使每个标签页保持其播放、速度和效果状态而互不干扰。

![Logo](docs/imgs/banner.png)

## 目录

1. [功能](#功能)
2. [用户指南](#用户指南)
   - [基本播放控制](#1-基本播放控制)
   - [音频效果控制](#2-音频效果控制)
   - [快捷键](#3-快捷键)
3. [安装方法](#安装方法)
4. [贡献](#贡献)
5. [许可证](#许可证)
6. [权限](#权限)


## 功能

GMC-Enhance 提供了一系列功能来改善您的媒体播放体验：

- [x] **统一媒体控制**：通过单一工具栏界面管理所有媒体会话，无需切换标签页。
- [x] **播放控制**：播放、暂停、快退/快进以及调整播放速度。
- [x] **全局快捷键**：通过键盘快捷键实现即时控制（快进、速度、音量、静音、选择活动视频）。
- [x] **独立的标签页会话**：每个标签页保持其播放速度、选定目标视频、音量和音频效果状态，无意的跨标签干扰将不再发生。
- [x] **音量控制**：调整单个视频的音量，包括静音/取消静音选项。
- [x] **音频效果**：通过调整特定频段（例如降低人声或增强低音）来提升音频质量。
- [x] **浮动窗口**：通过快捷键调整时显示浮动窗口，方便查看当前状态。

## 用户指南

### 1. 基本播放控制

直接通过工具栏或键盘快捷键控制视频播放。支持的操作包括播放、暂停、快退/快进以及速度调整。
![Popup Page](docs/imgs/popup-page.png)

### 2. 音频效果控制

通过高级音频控制提升您的聆听体验。例如：

- 通过降低 1kHz–4kHz 频段的频率来减少人声音量。
- 通过增加低频段来增强低音。

这些调整对直播或音频不平衡的视频特别有用。

### 3. 快捷键

GMC-Enhance 支持以下键盘快捷键，用于快速、无干扰的媒体控制，并支持自定义快捷键（右键图片，点击“选项”）。

| 操作                  | 快捷键              | 描述                                                                                                      |
|-----------------------|---------------------|-----------------------------------------------------------------------------------------------------------|
| 选择控制的视频        | `Alt + Shift + V`   | 选择要控制的视频。                                                                                       |
| 播放/暂停             | `Alt + Shift + K`   | 切换选定视频的播放/暂停状态。<br>如果您在有视频的页面上，默认情况下此快捷键控制该视频，除非您已使用 `Alt + Shift + U` 选择了其他视频。 |
| 快退                  | `Alt + Shift + J`   | 快退（默认：-10 秒）。<br>如果您在有视频的页面上，默认情况下此快捷键控制该视频，除非您已使用 `Alt + Shift + U` 选择了其他视频。      |
| 快进                  | `Alt + Shift + L`   | 快进（默认：+10 秒）。<br>如果您在有视频的页面上，默认情况下此快捷键控制该视频，除非您已使用 `Alt + Shift + U` 选择了其他视频。       |
| 加速播放              | `Alt + Shift + O`   | 增加播放速度（默认：+0.25x）。                                                                           |
| 减速播放              | `Alt + Shift + U`   | 减少播放速度（默认：-0.25x）。                                                                           |
| 重置速度              | `Alt + Shift + I`   | 将播放速度重置为正常（默认：1x）。                                                                        |
| 设置速度              | `Alt + Shift + P`   | 在预设播放速度之间循环切换。                                                                             |
| 增加音量              | `Alt + Shift + >`   | 增加音量（默认：+5%）。                                                                                  |
| 减少音量              | `Alt + Shift + <`   | 减少音量（默认：-5%）。                                                                                  |
| 静音/取消静音         | `Alt + Shift + M`   | 切换静音/取消静音。                                                                                       |

![Floating Video Control](docs/imgs/video_float_card.gif)

**提示**：通过将快捷键映射到键盘旋钮，您可以精确控制视频进度，这也是开发此扩展的灵感来源。

## 安装方法

### 方式一：谷歌商店直接安装

- 打开 [Chrome 网上应用店 GMC-Enhance 页面](https://chromewebstore.google.com/detail/kibmlbbigjmpmfjpcjhlmimehchnamgi?utm_source=item-share-cb)。
- 点击“添加至 Chrome”按钮，按提示完成安装。

### 方式二：解压安装（适用于无法访问商店或本地调试）

1. 前往 [GitHub Release 页面](https://github.com/ZepengW/GMC-Enhance/releases) 下载最新的安装包（ZIP格式）。
2. 解压下载的 ZIP 文件到本地文件夹。
3. 打开 Chrome，进入 `chrome://extensions/` 页面。
4. 开启右上角“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择刚才解压的文件夹。
6. 安装完成后即可使用 GMC-Enhance。

## 贡献

欢迎贡献！如果您想为 GMC-Enhance 做出贡献，请按照以下步骤操作：

1. Fork 此仓库。
2. 为您的功能或错误修复创建一个新分支。
3. 提交更改并提交拉取请求。

对于重大更改，请先打开一个 issue 讨论您想要更改的内容。

## 许可证

此项目根据 [GNU 通用公共许可证 v3.0](https://www.gnu.org/licenses/gpl-3.0.en.html) 许可。您可以根据 GPL-3.0 许可证的条款自由使用、修改和分发此软件，该许可证确保衍生作品保持开源。

## 权限

GMC-Enhance 请求其功能所需的最低权限：

- `activeTab`：在用户调用扩展 UI 时与当前标签页交互，并捕获可见标签页的屏幕截图。
- `tabs`：需要枚举标签页并向其发送消息以获取媒体信息/控制。
- `storage`：保存偏好设置，如快进/速度步长、均衡器预设和音量步长。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=ZepengW/GMC-Enhance&type=Timeline)](https://www.star-history.com/#ZepengW/GMC-Enhance&Timeline)
