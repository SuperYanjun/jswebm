# Mkv Demuxer
基于Jswebm(https://github.com/jscodec/jswebm-demo)的魔改，优化了内存问题，可获取视频元信息及视频数据，结合webcodecs可进行视频帧的截取
还在测试中……
# Example
```javascript
const demuxer = new MkvDemuxer()
await demuxer.initFile(file, fileSize)
const meta = await demuxer.getMeta()
const data = await demuxer.getData()
const frame = await demuxer.seekFrame(0)
```