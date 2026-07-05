<img width宽度="2112" height高度="1170" alt替代文本="image""图片" src源地址="https://github.com/user-attachments/assets/b7d216ab-4ed2-4ab7-8aab-a86c59d53605" />图片width宽度="2112" height高度="1170" alt替代文本="image""图片" src源地址="https://github.com/user-attachments/assets/b7d216ab-4ed2-4ab7-8aab-a86c59d53605" /><img width宽度="2112" height高度="1170" alt替代文本="image""图片" src源地址="https://github.com/user-attachments/assets/b7d216ab-4ed2-4ab7-8aab-a86c59d53605" />图片width="2112" height="1170" alt="image" src="https://github.com/user-attachments/assets/b7d216ab-4ed2-4ab7-8aab-a86c59d53605" />图片width="2112" height="1170" alt="image" src="https://github.com/user-attachments/assets/b7d216ab-4ed2-4ab7-8aab-a86c59d53605" />
**需求目标**

系统用于监听 Windows C 盘空间变化，发现哪些目录或文件导致空间持续减少，记录文件生成时间、增长趋势、来源路径，并给出“可直接删除 / 建议确认后删除 / 不建议删除”的分类结果，帮助用户安全清理空间。

**核心功能**

1. **磁盘空间监听**
   - 实时或定时监控 C 盘剩余空间。
   - 记录每次空间变化的时间、剩余容量、变化量。
   - 当 C 盘剩余空间低于阈值时提醒，例如低于 20GB、10GB、5GB。
   - 当短时间内空间异常减少时提醒，例如 1 小时减少超过 2GB。

2. **文件增长追踪**
   - 扫描 C 盘中近期新增或变大的文件。
   - 记录文件路径、大小、创建时间、修改时间、所属目录。
   - 支持按时间查看：
     - 最近 1 小时生成的文件
     - 今天生成的文件
     - 最近 7 天新增的大文件
     - 最近 30 天增长最快的目录

3. **大文件与大目录分析**
   - 展示 C 盘占用最大的目录。
   - 展示 C 盘占用最大的文件。
   - 展示目录大小变化趋势。
   - 支持快速定位常见空间占用位置，例如：
     - 下载目录
     - 桌面
     - 临时文件目录
     - 浏览器缓存
     - Windows 更新缓存
     - 日志目录
     - 软件缓存目录
     - 微信、QQ、企业微信等聊天文件缓存
     - 开发工具缓存，例如 npm、pip、Docker、IDE 缓存等

4. **文件清理分类**
   系统需要把扫描结果分成三类：

   **可以直接删除**
   - 系统临时文件
   - 回收站内容
   - 浏览器缓存
   - 软件临时缓存
   - 崩溃转储文件
   - 安装包缓存
   - Windows 更新残留缓存
   - 明确位于临时目录中的旧文件

   **建议确认后删除**
   - 下载目录中的大文件
   - 桌面上的旧文件
   - 聊天软件接收的文件
   - 视频、压缩包、安装包
   - 日志文件
   - 开发工具缓存
   - 重复文件
   - 很久未访问的大文件

   **不建议删除**
   - Windows 系统目录关键文件
   - Program Files 程序目录
   - 用户配置文件
   - 注册表、驱动、系统组件
   - 正在被程序使用的文件
   - 无法判断来源的重要文件

5. **生成时间与来源梳理**
   - 每个文件显示：
     - 文件名
     - 文件路径
     - 文件大小
     - 创建时间
     - 修改时间
     - 最近访问时间
     - 可能来源，例如浏览器、微信、系统更新、开发工具、临时文件
   - 对可疑增长目录给出解释：
     - “该目录今天新增 3.2GB，主要来自日志文件”
     - “该目录最近 7 天持续增长，可能是缓存未清理”
     - “该文件为安装包，超过 30 天未使用，可考虑删除”

6. **清理建议**
   - 按风险排序展示清理建议。
   - 优先推荐低风险清理项。
   - 显示预计可释放空间。
   - 删除前必须二次确认。
   - 支持先移动到回收站，而不是永久删除。
   - 支持建立清理记录，方便以后追踪。

7. **历史记录**
   - 保存每天 C 盘容量变化。
   - 保存每次扫描结果。
   - 保存每次清理操作：
     - 删除了哪些文件
     - 删除时间
     - 释放了多少空间
     - 操作人
   - 支持查看空间变化趋势图。

8. **提醒机制**
   - C 盘空间低时提醒。
   - 某个目录异常增长时提醒。
   - 发现超大临时文件时提醒。
   - 发现日志文件持续增长时提醒。
   - 可配置提醒阈值和扫描频率。

**建议界面**

主界面可以分为几个区域：

1. **C盘概览**
   - 当前剩余空间
   - 今日减少空间
   - 最近 7 天变化
   - 可安全清理空间

2. **空间变化**
   - 时间线展示 C 盘空间变小的过程
   - 标出异常下降时间点

3. **新增文件**
   - 最近生成的大文件列表
   - 支持按大小、时间、目录排序

4. **清理建议**
   - 可直接删除
   - 建议确认
   - 不建议删除

5. **目录排行**
   - 占用最大的目录
   - 增长最快的目录

6. **操作记录**
   - 历史扫描
   - 历史清理
   - 释放空间统计

**安全要求**

- 默认不自动删除任何文件。
- 删除操作优先进入回收站。
- 系统目录必须加保护规则。
- 对无法判断的文件，不给“直接删除”建议。
- 删除前展示完整路径和大小。
- 支持撤销或恢复，至少支持从回收站恢复。
- 需要管理员权限的操作必须明确提示。

**第一版可以先做的范围**
正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正在上传image.png…正正在上传image.png…正在上传image.png…正在上传image.p
