# GMC-Enhance Release Notes

> 累积版本更新记录（Cumulative Changelog）
>
> 最新版本：v0.3.0  (2025-10-04)

---
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

1. **10-Band EQ & True Response** – Uses `getFrequencyResponse` to reflect actual overlapping filter output.
2. **Unified Canvas** – Merged separate visualization layers to reduce repaint overhead and improve clarity.
3. **Spectrum + History** – Captures EMA-smoothed instantaneous bars plus min/max envelope for contextual range.
4. **Adaptive dB Range** – Auto-determines vertical scale to avoid clipping / wasted space; generates human-readable ticks.
5. **Global Q** – User-adjustable bandwidth; serialized with presets (legacy presets fallback gracefully).
6. **Playback Speed Badge** – Per-tab badge (e.g. `.75`, `1.25`, `2`) shown only when rate ≠ 1×; coexists with red EQ-modified icon.
7. **HUD Improvements** – Seek highlight clears correctly; background polling only when active tab differs; live streams show informative state instead of invalid seeks.
8. **Curve Smoothing** – Lower default Q reduces comb/bump artifacts from narrow overlap.
9. **Label Responsiveness** – Abbreviation and compression prevent layout overflow.

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

