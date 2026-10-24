// Original Teammates Bot mark, shared with the authored React avatar.
// Run from the repository root with: swift scripts/mobile-icons.swift
import AppKit
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(calibratedWhite: 17.0/255.0, alpha: 1).setFill()
NSBezierPath(rect: NSRect(x: 0, y: 0, width: 1024, height: 1024)).fill()
let transform = NSAffineTransform()
transform.translateX(by: 128, yBy: 128)
transform.scale(by: 16)
transform.concat()
NSColor(calibratedRed: 222.0/255, green: 221.0/255, blue: 216.0/255, alpha: 1).setFill()
let face = NSBezierPath()
face.move(to: NSPoint(x: 24,y: 3))
face.curve(to: NSPoint(x: 43,y: 27), controlPoint1: NSPoint(x: 36,y: 3), controlPoint2: NSPoint(x: 44,y: 14))
face.curve(to: NSPoint(x: 21,y: 44), controlPoint1: NSPoint(x: 42,y: 39), controlPoint2: NSPoint(x: 33,y: 46))
face.curve(to: NSPoint(x: 5,y: 22), controlPoint1: NSPoint(x: 9,y: 43), controlPoint2: NSPoint(x: 3,y: 34))
face.curve(to: NSPoint(x: 24,y: 3), controlPoint1: NSPoint(x: 6,y: 10), controlPoint2: NSPoint(x: 13,y: 3))
face.close(); face.fill()
NSColor(calibratedWhite: 21.0/255, alpha: 1).setFill()
for x in [16.0, 28.0] { NSBezierPath(roundedRect: NSRect(x: x,y: 19,width: 4.5,height: 11), xRadius: 2.25,yRadius: 2.25).fill() }
image.unlockFocus()
func write(_ relative: String, _ size: Int) throws {
  let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil,pixelsWide: size,pixelsHigh: size,bitsPerSample: 8,samplesPerPixel: 3,hasAlpha: false,isPlanar: false,colorSpaceName: .deviceRGB,bytesPerRow: 0,bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  image.draw(in: NSRect(x: 0,y: 0,width: size,height: size)); NSGraphicsContext.restoreGraphicsState()
  try bitmap.representation(using: .png,properties: [:])!.write(to: root.appendingPathComponent(relative))
}
try write("mobile/assets/icon.png",1024)
try write("mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",1024)
for (density,size) in [("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)] {
  for name in ["ic_launcher","ic_launcher_round","ic_launcher_foreground"] { try write("mobile/android/app/src/main/res/mipmap-\(density)/\(name).png", name == "ic_launcher_foreground" ? size*3 : size) }
}
