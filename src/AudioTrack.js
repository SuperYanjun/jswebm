const Track = require('./Track');

class AudioTrack extends Track {
  constructor(trackHeader, dataInterface) {
    super();
    this.dataInterface = dataInterface;
    this.offset = trackHeader.offset;
    this.size = trackHeader.size;
    this.end = trackHeader.end;
    this.loaded = false;
    this.rate = null;
    this.channel = null;
    this.bitDepth = null;
  }

  async load() {
    while (this.dataInterface.offset < this.end) {
      if (!this.currentElement) {
        this.currentElement = await this.dataInterface.peekElement();
        if (this.currentElement === null) return null;
      }

      switch (this.currentElement.id) {
        //TODO add duration and title
        case 0xB5: //Sample Frequency //TODO: MAKE FLOAT
          var rate = await this.dataInterface.readFloat(this.currentElement.size);
          if (rate !== null) this.rate = rate;
          else
            return null;
          break;
        case 0x9F: //Channels 
          var channels = await this.dataInterface.readUnsignedInt(this.currentElement.size);
          if (channels !== null) this.channels = channels;
          else
            return null;
          break;
        case 0x6264: //bitDepth 
          var bitDepth = await this.dataInterface.readUnsignedInt(this.currentElement.size);
          if (bitDepth !== null)
            this.bitDepth = bitDepth;
          else
            return null;
          break;
        default:
          console.warn("Ifno element not found, skipping");
          break;
      }
      this.currentElement = null;
    }
    this.loaded = true;
  }
}

module.exports = AudioTrack;
