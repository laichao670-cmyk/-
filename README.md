# 清影：照片工作台与视频水印修复

浏览器内运行的静态网站，照片和视频在本机处理，不上传媒体文件。无需 API 密钥，没有服务端图像模型。

## 已实现功能

- 照片局部平滑修复、纹理修复、原图对比。
- 亮度、对比度、色彩饱和度、冷暖和清晰度调整。
- 最多 8 张照片图层，移动、等比缩放、不透明度、层级管理。
- 横排、竖排、网格拼图。
- 连通相近颜色去背景、多边形保留、手动擦除与恢复、撤销抠图、柔化边缘。
- 导出 PNG、JPG、WebP，以及单层透明 PNG。
- 视频参考图案自动追踪，以及手动分段、全程固定水印修复；按浏览器支持导出 MP4 或 WebM。

## 上传 GitHub（网页操作）

1. 解压源码包，打开 qingying 文件夹。
2. 登录 https://github.com ，新建名为 qingying 的仓库，建议选择 Private（私有）。此源码包已有 README，无需额外初始化文件。
3. 在空仓库点击 uploading an existing file；已有文件的仓库使用 Add file → Upload files。
4. 将本目录内的 dist 文件夹、package.json、README.md 和 .gitignore 拖进上传区，保留 dist 内部目录结构。上传解压后的内容，而不是整个 ZIP。
5. 提交说明填“导入清影照片与视频编辑网站”，提交到新仓库默认分支。

上传后，仓库根目录应包含 dist/、package.json、README.md、.gitignore。源码可以继续交给其他开发工具修改。

## 本地运行

这是不需要构建的 HTML/CSS/JavaScript 项目。已安装 Python 的 Windows 电脑，在本目录打开终端运行：

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

浏览器打开 http://127.0.0.1:8000 。终端需要保持开启；Ctrl+C 停止服务。

不要直接双击 HTML 文件：ES 模块与 Worker 需要通过 HTTP 服务加载。没有 Python 时，也可以使用支持将 dist 作为站点根目录的静态服务器。

## 文件结构

- dist/index.html：网页界面。
- dist/style.css：样式与响应式布局。
- dist/app.js：文件读取、画布、修复、视频导出与主要交互。
- dist/photo-studio.js：照片调色、图层合成、抠图交互。
- dist/photo-core.js、photo-worker.js：照片像素处理与后台任务。
- dist/repair-core.js、repair-worker.js：局部修复算法。
- dist/auto-tracking.js、tracking-core.js、tracking-worker.js：视频水印模板追踪。
- dist/video-timeline.js：视频修复时段。

## 部署说明

上传 GitHub 是保存源代码，不会自动发布新的公开网站，也不会自动同步更新现有清影网站。

当前静态发布目录为 dist。代码的脚本、样式与 Worker 使用站点根路径。部署到 GitHub Pages 的 /仓库名/ 子路径前，需要统一适配这些资源路径；不能只上传后直接假定可以运行。

## 能力边界与验证范围

- 照片首张处理长边最多 2400 像素；新增图层长边最多 1600 像素。
- 抠图是颜色选择和手动工具，不是语义 AI 人像分割；复杂背景、头发边缘需要手动修整。
- 清晰度是锐化，不会恢复缺失的真实细节。
- 视频最多 200 MB、2 分钟，处理最长边 1280 像素。自动追踪需要先框选一次参考水印，未可靠匹配的画面会跳过修复。
- 已做像素算法检查、原生 Canvas 与 Worker 的图层交互检查、代码语法与界面元素绑定检查。
- 尚未完成真实浏览器拖拽、下载及真实视频的端到端验证。

## 导出版本

导出日期：2026-10-08
源版本：3984386ba362bee577c8b8730065687e467109d4
此包包含对应版本的网站代码；README 与 .gitignore 为本次导出附带说明。
