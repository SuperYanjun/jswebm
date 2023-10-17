const DataInterface = require("./DataInterface/DataInterface");
const SeekHead = require("./SeekHead");
const SegmentInfo = require("./SegmentInfo");
const Tracks = require("./Tracks");
const Cluster = require("./Cluster");
const Cues = require("./Cues");
const ElementHeader = require("./ElementHeader");
const {findClosestNumber, findNumber} = require('./utils')
/**
 * @classdesc Wrapper class to handle webm demuxing
 */
class JsWebm {
  constructor() {
    this.dataInterface = new DataInterface(this);
    this.tempElementHeader = new ElementHeader(-1, -1, -1, -1);
    this.tempElementHeader.reset();
    this.currentElement = null;
    this.segment = null;
    this.seekHead = null;
    this.segmentInfo = null; // assuming 1 for now
    this.tracks = null;
    this.currentCluster = null;
    this.videoFormat = null;
    this.audioFormat = null;
    this.videoCodec = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.videoPackets = [];
    this.audioPackets = [];

    this.currentFileOffset = 0;
    this.file = null;
    this.fileSize = 0;

    this.isEBMLSegmentLoaded = false; // have we found the segment position
    this.isEBMLHeaderLoaded = false;
    this.isEBMLSeekHeadLoaded = false;
    this.isEBMLSegmentInfoLoaded = false;
    this.isEBMLTracksLoaded = false;
    this.isEBMLCuesLoaded = false;
    this.isEBMLClustersLoaded = false;

    this.isMetaLoaded = false;
    this.isDataLoaded = false;

    Object.defineProperty(this, "duration", {
      get: function () {
        if (this.segmentInfo.duration < 0) return -1;
        return this.segmentInfo.duration / 1000; // / 1000000000.0; ;
      },
    });
    Object.defineProperty(this, "keyframeTimestamp", {
      get: function () {
        if (this.videoPackets.length > 0) {
          return this.videoPackets[0].keyframeTimestamp;
        } else {
          return -1;
        }
      },
    });
  }

  /**
   *
   * Sets up the meta data validation after
   */
  validateMetadata() {
    var codecID;
    var channels;
    var rate;
    var tempTrack;
    //Multiple video tracks are allowed, for now just return the first one
    for (var i in this.tracks.trackEntries) {
      var trackEntry = this.tracks.trackEntries[i];
      if (trackEntry.trackType === 2) {
        tempTrack = trackEntry;
        codecID = trackEntry.codecID;
        channels = trackEntry.channels;
        rate = trackEntry.rate;
        break;
      }
    }
    this.audioTrack = tempTrack;
    switch (codecID) {
      case "A_VORBIS":
        this.audioCodec = "vorbis";
        this.initVorbisHeaders(tempTrack);
        break;
      case "A_OPUS":
        this.audioCodec = "opus";
        this.initOpusHeaders(tempTrack);
        break;
      case "A_AAC":
        this.audioCodec = "aac";
        this.initAacHeaders(tempTrack);
        break;
      default:
        this.audioCodec = null;
        break;
    }

    for (var i in this.tracks.trackEntries) {
      var trackEntry = this.tracks.trackEntries[i];
      if (trackEntry.trackType === 1) {
        // video track
        tempTrack = trackEntry;
        codecID = trackEntry.codecID;
        break;
      }
    }

    switch (codecID) {
      case "V_VP8":
        this.videoCodec = "vp8";
        break;
      case "V_VP9":
        this.videoCodec = "vp9";
        break;
      default:
        this.videoCodec = null;
        break;
    }

    this.videoTrack = tempTrack;
    var fps = 0; // For now?
    this.videoFormat = {
      width: tempTrack.width,
      height: tempTrack.height,
      chromaWidth: tempTrack.width >> 1,
      chromaHeight: tempTrack.height >> 1,
      cropLeft: tempTrack.pixelCropLeft,
      cropTop: tempTrack.pixelCropTop,
      cropWidth:
        tempTrack.width - tempTrack.pixelCropLeft - tempTrack.pixelCropRight,
      cropHeight:
        tempTrack.height - tempTrack.pixelCropTop - tempTrack.pixelCropBottom,
      displayWidth: tempTrack.displayWidth,
      displayHeight: tempTrack.displayHeight,
      fps: fps,
    };
  }

  initOpusHeaders(trackEntry) {
    this.audioTrack = trackEntry;
  }

  initVorbisHeaders(trackEntry) {
    var headerParser = new DataView(trackEntry.codecPrivate);
    var packetCount = headerParser.getUint8(0);
    var firstLength = headerParser.getUint8(1);
    var secondLength = headerParser.getUint8(2);
    var thirdLength = headerParser.byteLength - firstLength - secondLength - 1;
    if (packetCount !== 2) throw "INVALID VORBIS HEADER";
    var start = 3;
    var end = start + firstLength;

    this.audioPackets.push({
      data: headerParser.buffer.slice(start, end),
      timestamp: -1,
    });
    start = end;
    end = start + secondLength;

    this.audioPackets.push({
      data: headerParser.buffer.slice(start, end),
      timestamp: -1,
    });
    start = end;
    end = start + thirdLength;
    this.audioPackets.push({
      data: headerParser.buffer.slice(start, end),
      timestamp: -1,
    });
    this.audioTrack = trackEntry;
  }

  initAacHeaders(trackEntry) {
    this.audioTrack = trackEntry;
  }

  async initFile(file, fileSize) {
    if (this.file) {
      this.reset();
    }
    this.file = file;
    this.fileSize = fileSize;
    await this.dataInterface.recieveInput();
  }

  async getMeta() {
    await this.getElementPositions();
    console.log("seekhead loaded", this.seekHead);
    await this.getSegmentInfo();
    console.log("segmentInfo loaded", this.segmentInfo);
    await this.getTracks();
    console.log("tracks loaded", this.tracks);
    if (!this.isMetaLoaded) {
      this.validateMetadata();
    }
    this.isMetaLoaded = true;
    const meta = {
      info: this.segmentInfo,
      audioFormat: this.audioFormat,
      videoFormat: this.videoFormat,
    };
    console.log("meta loaded", meta);
    return meta;
  }
  async getData() {
    if (!this.isMetaLoaded) {
      console.log("need to load meta");
      await this.getMeta();
    }
    await this.getCues();
    console.log("cues loaded", this.cues);
    await this.getClusters();
    console.log("clusters loaded", this.videoPackets);
    // todo: duration
    const data = {
      cues: this.cues,
      videoPackets: this.videoPackets,
      audioPackets: this.audioPackets,
    };
    this.isDataLoaded = true;
    return data;
  }
  async seekFrame(timestamp) {
    if (!this.isDataLoaded) {
      console.log("need to load data");
      await this.getData();
    }
    const frame = this.seek(timestamp);
    console.log("seek frame", timestamp, frame);
    return frame;
  }
  seek(timestamp) {
    const cues = this.cues.entries || [];
    const packets = this.videoPackets || [];
    const milliTime = timestamp * 1000;
    const closestIndex = findClosestNumber(
      cues.map((each) => each.cueTime),
      milliTime
    );
    const frameMilliTime = cues[closestIndex].cueTime || 0;
    const frameTime = frameMilliTime / 1000 || 0;
    const packetIndex = findNumber(
      packets.map((each) => each.timestamp),
      frameTime
    );
    const frame = packets[packetIndex];
    return frame
  }

  async loadEBML() {
    if (this.isEBMLSegmentLoaded) return;
    //Header is small so we can read the whole thing in one pass or just wait for more data if necessary
    var dataInterface = this.dataInterface; //cache dataInterface reference
    if (!this.isEBMLHeaderLoaded) {
      //only load it if we didnt already load it
      if (!this.elementEBML) {
        this.elementEBML = await dataInterface.peekElement();
        if (!this.elementEBML) return null;

        if (this.elementEBML.id !== 0x1a45dfa3) {
          //EBML
          //If the header has not loaded and the first element is not the header, do not continue
          console.warn("INVALID PARSE, HEADER NOT LOCATED");
        }
      }

      var end = this.elementEBML.end;
      while (dataInterface.offset < end) {
        if (!this.tempElementHeader.status) {
          await dataInterface.peekAndSetElement(this.tempElementHeader);
          if (!this.tempElementHeader.status) return null;
        }
        var skipped = await this.dataInterface.skipBytes(
          this.tempElementHeader.size
        );
        if (skipped === false) return null;
        this.tempElementHeader.reset();
      }
      this.isEBMLHeaderLoaded = true;
    }

    //Now find segment offsets
    if (!this.currentElement)
      this.currentElement = await this.dataInterface.peekElement();

    if (!this.currentElement) return null;

    switch (this.currentElement.id) {
      case 0x18538067: // Segment
        this.segment = this.currentElement;
        break;
      case 0xec: // void
        var skipped = await this.dataInterface.skipBytes(
          this.tempElementHeader.size
        );
        if (skipped === false) return null;
        break;
      default:
        console.warn("Global element not found, id: " + this.currentElement.id);
    }
    this.currentElement = null;
    this.isEBMLSegmentLoaded = true;
  }

  async loadSeekHead() {
    if (this.isEBMLSeekHeadLoaded) return;
    var status = false;
    while (
      this.dataInterface.offset < this.currentFileOffset &&
      !this.isEBMLSeekHeadLoaded
    ) {
      if (!this.tempElementHeader.status) {
        await this.dataInterface.peekAndSetElement(this.tempElementHeader);
        if (!this.tempElementHeader.status) return null;
      }
      switch (this.tempElementHeader.id) {
        case 0x114d9b74: //Seek Head
          if (!this.seekHead)
            this.seekHead = new SeekHead(
              this.tempElementHeader.getData(),
              this.dataInterface
            );
          await this.seekHead.load();
          if (!this.seekHead.loaded) return false;
          this.isEBMLSeekHeadLoaded = true;
          break;
        default:
          var skipped = await this.dataInterface.skipBytes(
            this.tempElementHeader.size
          );
          if (skipped === false) return;
          // console.log("UNSUPORTED ELEMENT FOUND, SKIPPING : " +this.tempElementHeader.id.toString(16));
          break;
      }
      this.tempElementHeader.reset();
    }
    return status;
  }

  async loadSegmentInfo() {
    if (this.isEBMLSegmentInfoLoaded) return;
    var status = false;
    while (
      this.dataInterface.offset < this.currentFileOffset &&
      !this.isEBMLSegmentInfoLoaded
    ) {
      if (!this.tempElementHeader.status) {
        await this.dataInterface.peekAndSetElement(this.tempElementHeader);
        if (!this.tempElementHeader.status) return null;
      }
      switch (this.tempElementHeader.id) {
        case 0x1549a966: //Info
          if (!this.segmentInfo)
            this.segmentInfo = new SegmentInfo(
              this.tempElementHeader.getData(),
              this.dataInterface
            );
          await this.segmentInfo.load();
          if (!this.segmentInfo.loaded) return false;
          this.isEBMLSegmentInfoLoaded = true;
          break;
        default:
          var skipped = await this.dataInterface.skipBytes(
            this.tempElementHeader.size
          );
          if (skipped === false) return;
          // console.log("UNSUPORTED ELEMENT FOUND, SKIPPING : " +this.tempElementHeader.id.toString(16));
          break;
      }
      this.tempElementHeader.reset();
    }
    return status;
  }

  async loadTracks() {
    if (this.isEBMLTracksLoaded) return;
    var status = false;
    while (
      this.dataInterface.offset < this.currentFileOffset &&
      !this.isEBMLTracksLoaded
    ) {
      if (!this.tempElementHeader.status) {
        await this.dataInterface.peekAndSetElement(this.tempElementHeader);
        if (!this.tempElementHeader.status) return null;
      }
      switch (this.tempElementHeader.id) {
        case 0x1654ae6b: //Tracks
          if (!this.tracks)
            this.tracks = new Tracks(
              this.tempElementHeader.getData(),
              this.dataInterface,
              this
            );
          await this.tracks.load();
          if (!this.tracks.loaded) return false;
          this.isEBMLTracksLoaded = true;
          break;
        default:
          var skipped = await this.dataInterface.skipBytes(
            this.tempElementHeader.size
          );
          if (skipped === false) return;
          // console.log("LOAD TRACKS...SKIPPING : " + this.tempElementHeader.id.toString(16));
          break;
      }
      this.tempElementHeader.reset();
    }
    return status;
  }
  async loadCues() {
    if (this.isEBMLCuesLoaded) return;
    var status = false;
    while (
      this.dataInterface.offset < this.currentFileOffset &&
      !this.isEBMLCuesLoaded
    ) {
      if (!this.tempElementHeader.status) {
        await this.dataInterface.peekAndSetElement(this.tempElementHeader);
        if (!this.tempElementHeader.status) return null;
      }
      switch (this.tempElementHeader.id) {
        case 0x1c53bb6b: //Cues
          if (!this.cues)
            this.cues = new Cues(
              this.tempElementHeader.getData(),
              this.dataInterface,
              this
            );
          await this.cues.load();
          if (!this.cues.loaded) return false;
          this.isEBMLCuesLoaded = true;
          break;
        default:
          var skipped = await this.dataInterface.skipBytes(
            this.tempElementHeader.size
          );
          if (skipped === false) return;
          break;
      }
      this.tempElementHeader.reset();
    }
    return status;
  }

  async loadClusters() {
    var status = false;
    while (this.dataInterface.offset < this.currentFileOffset) {
      if (!this.tempElementHeader.status) {
        await this.dataInterface.peekAndSetElement(this.tempElementHeader);
        if (!this.tempElementHeader.status) return null;
      }
      switch (this.tempElementHeader.id) {
        case 0x18538067: // Segment
          break;
        case 0x1f43b675: //Cluster
          if (!this.currentCluster) {
            this.currentCluster = new Cluster(
              this.tempElementHeader.offset,
              this.tempElementHeader.size,
              this.tempElementHeader.end,
              this.tempElementHeader.dataOffset,
              this.dataInterface,
              this
            );
          }
          status = this.currentCluster.load();
          if (!this.currentCluster.loaded) {
            return status;
          }
          this.currentCluster = null;
          break;
        default:
          var skipped = await this.dataInterface.skipBytes(
            this.tempElementHeader.size
          );
          if (skipped === false) return;
          // console.log("LOAD CLUSTERS...SKIPPING : " + this.tempElementHeader.id.toString(16));
          break;
      }
      this.tempElementHeader.reset();
    }

    return status;
  }
  // todo: 修改这里
  async getElementPositions() {
    while (!this.isEBMLSegmentLoaded) {
      await this.loadEBML();
    }
    while (!this.isEBMLSeekHeadLoaded) {
      await this.loadSeekHead();
    }
  }
  async getSegmentInfo() {
    while (!this.isEBMLSegmentInfoLoaded) {
      await this.loadSegmentInfo();
    }
  }
  async getTracks() {
    while (!this.isEBMLTracksLoaded) {
      await this.loadTracks();
    }
  }
  async getCues() {
    while (!this.isEBMLCuesLoaded) {
      await this.loadCues();
    }
  }
  async getClusters() {
    this.currentFileOffset = 0;
    this.dataInterface.flush();
    await this.dataInterface.recieveInput();
    while (this.dataInterface.offset < this.fileSize) {
      await this.loadClusters();
    }
  }

  reset() {
    this.dataInterface.flush();
    this.tempElementHeader = new ElementHeader(-1, -1, -1, -1);
    this.tempElementHeader.reset();
    this.currentElement = null;
    this.segment = null;
    this.seekHead = null;
    this.segmentInfo = null; // assuming 1 for now
    this.tracks = null;
    this.currentCluster = null;
    this.videoFormat = null;
    this.audioFormat = null;
    this.videoCodec = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.videoPackets = [];
    this.audioPackets = [];

    this.currentFileOffset = 0;
    this.file = null;
    this.fileSize = 0;

    this.isEBMLSegmentLoaded = false; // have we found the segment position
    this.isEBMLHeaderLoaded = false;
    this.isEBMLSeekHeadLoaded = false;
    this.isEBMLSegmentInfoLoaded = false;
    this.isEBMLTracksLoaded = false;
    this.isEBMLCuesLoaded = false;
    this.isEBMLClustersLoaded = false;

    this.isMetaLoaded = false;
    this.isDataLoaded = false;
  }
}

module.exports = JsWebm;
