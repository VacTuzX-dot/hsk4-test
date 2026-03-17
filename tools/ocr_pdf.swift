import Foundation
import Vision
import PDFKit
import AppKit

struct PageResult: Encodable {
  let page: Int
  let text: String
  let lines: [LineResult]
}

struct Output: Encodable {
  let file: String
  let pageCount: Int
  let pages: [PageResult]
}

struct LineResult: Encodable {
  let text: String
  let minX: Double
  let minY: Double
  let maxX: Double
  let maxY: Double
}

func renderPage(_ page: PDFPage, scale: CGFloat = 2.0) -> CGImage? {
  let bounds = page.bounds(for: .mediaBox)
  let width = max(1, Int(bounds.width * scale))
  let height = max(1, Int(bounds.height * scale))

  guard
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
    let ctx = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )
  else {
    return nil
  }

  ctx.setFillColor(NSColor.white.cgColor)
  ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
  ctx.saveGState()
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)
  ctx.restoreGState()
  return ctx.makeImage()
}

func ocrPage(_ page: PDFPage) throws -> [LineResult] {
  guard let image = renderPage(page) else {
    throw NSError(domain: "ocr_pdf", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to render page"])
  }

  let request = VNRecognizeTextRequest()
  request.recognitionLanguages = ["zh-Hans", "en-US"]
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.minimumTextHeight = 0.01

  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  try handler.perform([request])

  let results = (request.results ?? []).compactMap { obs -> LineResult? in
    guard let candidate = obs.topCandidates(1).first else { return nil }
    let box = obs.boundingBox
    return LineResult(
      text: candidate.string,
      minX: Double(box.minX),
      minY: Double(box.minY),
      maxX: Double(box.maxX),
      maxY: Double(box.maxY)
    )
  }

  return results.sorted {
    let y1 = $0.minY
    let y2 = $1.minY
    if abs(y1 - y2) > 0.012 {
      return y1 > y2
    }
    return $0.minX < $1.minX
  }
}

if CommandLine.arguments.count < 2 {
  FileHandle.standardError.write(Data("Usage: ocr_pdf.swift <pdf-file>\n".utf8))
  exit(1)
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let doc = PDFDocument(url: url) else {
  FileHandle.standardError.write(Data("Unable to open PDF: \(path)\n".utf8))
  exit(1)
}

var pages: [PageResult] = []
for index in 0..<doc.pageCount {
  guard let page = doc.page(at: index) else { continue }
  let lines = try ocrPage(page)
  let text = lines.map(\.text).joined(separator: "\n")
  pages.append(PageResult(page: index + 1, text: text, lines: lines))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let output = Output(file: path, pageCount: doc.pageCount, pages: pages)
let data = try encoder.encode(output)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
