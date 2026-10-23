import { deflateSync } from "node:zlib";
export function workshopLogo(red:number,green:number,blue:number) {
  function chunk(type:string,data:Buffer) {
    const name=Buffer.from(type), crcInput=Buffer.concat([name,data]);let crc=0xffffffff;
    for(const b of crcInput){crc^=b;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
  }
  const size=64,header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=y*(size*4+1)+1+x*4;
    const light=x>18&&x<45&&(y>18&&y<25||y>29&&y<35||y>39&&y<45);
    pixels[i]=light?255:red;pixels[i+1]=light?255:green;pixels[i+2]=light?255:blue;pixels[i+3]=255;
  }
  const png=Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),chunk("IHDR",header),chunk("IDAT",deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
  return "data:image/png;base64,"+png.toString("base64");
}
