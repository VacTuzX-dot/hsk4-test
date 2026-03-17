import Foundation
import Vision
import AppKit

struct LineResult: Encodable {
  let text: String
  let minX: Double
  let minY: Double
  let maxX: Double
  let maxY: Double
}

struct Output: Encodable {
  let file: String
  let text: String
  let lines: [LineResult]
}

if CommandLine.arguments.count < 2 {
  FileHandle.standardError.write(Data("Usage: ocr_image.swift <image-file>\n".utf8))
  exit(1)
}

let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let image = NSImage(contentsOf: url) else {
  FileHandle.standardError.write(Data("Unable to open image: \(path)\n".utf8))
  exit(1)
}

var rect = NSRect(origin: .zero, size: image.size)
guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
  FileHandle.standardError.write(Data("Unable to decode image: \(path)\n".utf8))
  exit(1)
}

let request = VNRecognizeTextRequest()
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.minimumTextHeight = 0.01

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try handler.perform([request])

let lines = (request.results ?? []).compactMap { obs -> LineResult? in
  guard let candidate = obs.topCandidates(1).first else { return nil }
  let box = obs.boundingBox
  return LineResult(
    text: candidate.string,
    minX: Double(box.minX),
    minY: Double(box.minY),
    maxX: Double(box.maxX),
    maxY: Double(box.maxY)
  )
}.sorted {
  if abs($0.minY - $1.minY) > 0.012 {
    return $0.minY > $1.minY
  }
  return $0.minX < $1.minX
}

let output = Output(file: path, text: lines.map(\.text).joined(separator: "\n"), lines: lines)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let data = try encoder.encode(output)
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
