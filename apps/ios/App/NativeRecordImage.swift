import ImageIO
import UIKit

enum NativeRecordImage {
  static func cameraJPEG(_ image:UIImage,metadata:[String:Any]?)->Data? {
    guard let bytes=image.jpegData(compressionQuality:1),let metadata else{return image.jpegData(compressionQuality:1)}
    guard let source=CGImageSourceCreateWithData(bytes as CFData,nil) else{return nil}
    let output=NSMutableData()
    guard let destination=CGImageDestinationCreateWithData(output,"public.jpeg" as CFString,1,nil) else{return nil}
    CGImageDestinationAddImageFromSource(destination,source,0,metadata as CFDictionary)
    guard CGImageDestinationFinalize(destination) else{return nil}
    return output as Data
  }
  static func dimensions(_ data:Data)->(Int,Int)? {
    guard let source=CGImageSourceCreateWithData(data as CFData,nil),let values=CGImageSourceCopyPropertiesAtIndex(source,0,nil) as? [CFString:Any],let width=values[kCGImagePropertyPixelWidth] as? Int,let height=values[kCGImagePropertyPixelHeight] as? Int else{return nil}
    let orientation=values[kCGImagePropertyOrientation] as? Int ?? 1
    return [5,6,7,8].contains(orientation) ? (height,width) : (width,height)
  }
  static func decode(_ data:Data,maxPixels:Int)->UIImage? {
    guard let source=CGImageSourceCreateWithData(data as CFData,nil),let image=CGImageSourceCreateThumbnailAtIndex(source,0,
      [kCGImageSourceCreateThumbnailFromImageAlways:true,kCGImageSourceCreateThumbnailWithTransform:true,kCGImageSourceThumbnailMaxPixelSize:maxPixels,kCGImageSourceShouldCacheImmediately:true] as CFDictionary) else{return nil}
    return UIImage(cgImage:image)
  }
}

import AVFoundation
import PDFKit

@MainActor enum NativeRecordThumbnail {
  static func make(url:URL,mime:String) async -> Data? {
    var image:UIImage?
    if mime.hasPrefix("image/"),let data=try? Data(contentsOf:url) {image=NativeRecordImage.decode(data,maxPixels:512)}
    else if mime == "application/pdf" {image=PDFDocument(url:url)?.page(at:0)?.thumbnail(of:CGSize(width:384,height:512),for:.mediaBox)}
    else if mime.hasPrefix("video/") {
      let generator=AVAssetImageGenerator(asset:AVURLAsset(url:url));generator.appliesPreferredTrackTransform=true;generator.maximumSize=CGSize(width:512,height:512)
      if let cg=try? generator.copyCGImage(at:.zero,actualTime:nil) {image=UIImage(cgImage:cg)}
    }
    guard let image else{return nil}
    for quality in [0.8,0.5,0.25] {if let data=image.jpegData(compressionQuality:quality),data.count <= 256*1024 {return data}}
    return nil
  }
}
