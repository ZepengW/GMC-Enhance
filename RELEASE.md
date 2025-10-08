# GMC-Enhance Release Notes

> 累积版本更新记录（Cumulative Changelog）
>
> 最新版本：v0.3.1  (2025-10-08)

---
## v0.3.1 (2025-10-08)

### 更新摘要 / Highlights
- 自定义快捷键映射（选项页可视化配置 + 即时应用）
- 快捷键冲突检测、重置默认与步长配置联动
- HUD 叠加、直播进度条与跨标签控制体验修复

- Customizable keyboard mapping (options UI with live application)
- Shortcut conflict detection, one-click reset, and step-size alignment
- Fixes for stacked HUDs, live-progress handling, and cross-tab control

### 详细说明 / Details
1. **快捷键自定义 / Customizable Shortcuts**：新增选项页快捷键表格，可捕获组合键、提示冲突、写入 `storage.sync`，内容脚本实时载入，HUD 操作与文档同步更新。
2. **步长与文案同步 / Step & Docs Alignment**：默认快进/速度/音量步长与 README 统一，避免快捷键说明与实际行为不一致。
3. **控制体验优化 / Control UX**：改进跨标签媒体控制的目标锁定逻辑，使后台标签响应更稳定，减少误切换。

<ol>
<li><strong>Customizable Shortcuts</strong> – Options page now features a keymap table that captures combos, warns about conflicts, and persists them to <code>storage.sync</code>; content scripts pick up changes instantly and the HUD plus docs stay aligned.</li>
<li><strong>Step &amp; Docs Alignment</strong> – Default seek/speed/volume steps now match the README so shortcut descriptions reflect actual behavior.</li>
<li><strong>Control UX</strong> – Cross-tab media targeting logic is more robust, keeping background tabs steady and reducing unintended focus switches.</li>
</ol>

### 修复 / Fixes
- 解决 HUD 多次触发时重叠显示的问题，确保提示面板仅存在一份 / Prevent HUD from overlaying itself on repeated triggers.
- 当监测到直播源时固定进度条展示，避免 seek 逻辑造成跳动假象 / Keep live-stream progress static to avoid misleading jumps.
- 调整倍速调节快捷键映射，修正键位与实际动作错位 / Corrected speed-control shortcut mapping mismatch.

## v0.3.0 (2025-10-04)

### 更新摘要 / Highlights
- 10 段均衡器（真实叠加频响）
- 双谱实时显示（原始/处理后）+ 历史最值包络
- 自适应 dB 纵轴（自动范围 + 友好刻度）
- 全局 Q 因子可调（写入预设，兼容旧预设）
- 橘色播放速度徽章（1× 隐藏，按标签页独立）
- 单一可视化画布（频谱 + 增益曲线 + 历史 + 图例）
- 降低默认 Q 使曲线更平滑
- 标签/图例自适应压缩
- HUD Seek 预览与跨标签同步优化

- 10-band equalizer (true composite frequency response)
- Dual real-time spectrum (pre/post EQ) + historical min/max envelope
- Adaptive dB scaling (auto range with nice ticks)
- Adjustable global Q factor (stored in presets, backward compatible)
- Playback speed badge (orange) per tab (hidden at 1×)
- Unified visualization canvas (spectrum + gain + history + legend)
- Smoother gain contour via reduced default Q
- Responsive legend & label compression
- HUD seek preview & cross-tab sync refinements

### 详细说明 / Details
1. **10 段 EQ + 真实响应**：使用 `getFrequencyResponse` 获取整条滤波链真实幅频，避免简单相加误差。
2. **统一画布**：合并频谱、曲线、历史区与图例，减少重绘与布局开销。
3. **谱线与历史**：即时柱经过 EMA 平滑；最小/最大包络帮助判断能量波动区间。
4. **自适应 dB 范围**：根据当前极值自动裁剪/扩展，生成易读刻度并避免留白或裁切。
5. **全局 Q**：带宽可调，预设序列化；旧预设缺失 Q 时采用默认值。
6. **播放速度徽章**：仅当速率 ≠ 1× 显示（如 `.75`、`1.25`、`2`），与红色 EQ 修改图标共存。
7. **HUD 改进**：Seek 高亮正确消失；跨标签控制时后台轮询同步；直播跳转智能降级为提示。
8. **曲线平滑**：降低默认 Q 以减少窄带重叠产生的“鼓包/锯齿”。
9. **标签自适应**：自动缩写与压缩防止布局溢出。

<ol>
<li><strong>10-Band EQ &amp; True Response</strong> – Uses <code>getFrequencyResponse</code> to reflect actual overlapping filter output.</li>
<li><strong>Unified Canvas</strong> – Merged separate visualization layers to reduce repaint overhead and improve clarity.</li>
<li><strong>Spectrum + History</strong> – Captures EMA-smoothed instantaneous bars plus min/max envelope for contextual range.</li>
<li><strong>Adaptive dB Range</strong> – Auto-determines vertical scale to avoid clipping / wasted space; generates human-readable ticks.</li>
<li><strong>Global Q</strong> – User-adjustable bandwidth; serialized with presets (legacy presets fallback gracefully).</li>
<li><strong>Playback Speed Badge</strong> – Per-tab badge (e.g. <code>.75</code>, <code>1.25</code>, <code>2</code>) shown only when rate ≠ 1×; coexists with red EQ-modified icon.</li>
<li><strong>HUD Improvements</strong> – Seek highlight clears correctly; background polling only when active tab differs; live streams show informative state instead of invalid seeks.</li>
<li><strong>Curve Smoothing</strong> – Lower default Q reduces comb/bump artifacts from narrow overlap.</li>
<li><strong>Label Responsiveness</strong> – Abbreviation and compression prevent layout overflow.</li>
</ol>

![EQ Popup](docs/imgs/popup-eq.png)

### 兼容性 / Compatibility
- 旧预设（无 `q`）自动使用当前默认 Q。
- 新增频段默认 0 dB，不改变原始声音。
- 无需手动迁移。

- Old presets (no `q`) load with default global Q.
- Added EQ bands initialize to 0 dB (neutral).
- No manual migration required.


### 性能 / Performance
中文：
- 单一 Canvas 降低内存与上下文切换。
- 条件式徽章更新避免无意义重绘。

English:
- Single canvas lowers memory & context switches.
- Conditional badge updates avoid unnecessary UI churn.

