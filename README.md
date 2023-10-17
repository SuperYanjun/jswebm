# Mkv Demuxer
基于Jswebm（https://github.com/jscodec/jswebm-demo）的魔改，优化了内存问题，可获取视频元信息及视频数据，结合webcodecs可进行视频帧的截取
还在测试中……
# Example
```javascript
const webm = new JsWebm()
await webm.initFile(file, fileSize)
const meta = await webm.getMeta()
const data = await webm.getData()
const frame = await webm.seekFrame(0)
```